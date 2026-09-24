#!/usr/bin/env node
// Standalone development harness. Never imported by an application route.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const requirePackage = createRequire(new URL("../package.json", import.meta.url));
const expectedAccount = "acct_1U6AS79rQIwIEzKe";
const agreementVersion = "ruined_membership-v2";
const names = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID", "STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID"];
const read = path => readFileSync(resolve(root, path), "utf8");

export function optionsFrom(args) {
  const options = { port: 3233, selfTest: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--port" && /^\d+$/.test(args[index + 1] ?? "")) {
      options.port = Number(args[++index]);
      if (options.port < 1024 || options.port > 65535) throw new Error("Port must be between 1024 and 65535.");
    } else throw new Error("Unknown or invalid argument. Use --help, --self-test, or --port NUMBER.");
  }
  return options;
}

export function validateEnvironment(env) {
  // No dotenv loader: never discover or reuse an application's environment file.
  if (env.DATABASE_URL || Object.keys(env).some(name => /SUPABASE/.test(name) && env[name])) {
    throw new Error("Remove DATABASE_URL and Supabase environment variables. This harness only uses in-memory PGlite.");
  }
  if (/^(?:sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "") || /^pk_live_/.test(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "")) {
    throw new Error("Live Stripe credentials are forbidden in the sandbox harness.");
  }
  const missing = names.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}. See docs/stripe-sandbox-smoke.md.`);
  if (!/^(?:rk|sk)_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY)) throw new Error("STRIPE_SECRET_KEY must be a sandbox rk_test_ or sk_test_ key.");
  if (!/^pk_test_[A-Za-z0-9_]+$/.test(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)) throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a sandbox pk_test_ key.");
  if (!/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET)) throw new Error("STRIPE_WEBHOOK_SECRET must be the sandbox CLI forwarding signing secret.");
  for (const name of names.slice(3)) if (!/^price_[A-Za-z0-9]+$/.test(env[name])) throw new Error(`${name} must contain one Stripe Price ID.`);
  if (env.STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID === env.STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID) throw new Error("Monthly and annual Price IDs must differ.");
  return Object.fromEntries(names.map(name => [name, env[name]]));
}

function sqlFor(engine) {
  const sql = async (strings, ...values) => {
    const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
    return (await engine.query(text, values.map(value => value instanceof Date ? value.toISOString() : value))).rows;
  };
  sql.json = value => JSON.stringify(value);
  sql.begin = callback => engine.transaction(transaction => callback(sqlFor(transaction)));
  return sql;
}

function sourceLoader(overrides) {
  const cache = new Map();
  function load(path) {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(root)) throw new Error("A source dependency escaped the repository.");
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loaded = { exports: {} };
    cache.set(absolute, loaded);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
      fileName: absolute,
    }).outputText;
    const requireSource = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === "server-only") return {};
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(absolute), name);
        const match = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`]
          .find(candidate => extname(candidate) && existsSync(candidate));
        if (!match) throw new Error(`Unresolved source dependency: ${name}`);
        return extname(match) === ".json" ? JSON.parse(readFileSync(match, "utf8")) : load(match);
      }
      // The application must never open a PostgreSQL connection in this process.
      if (name === "postgres") throw new Error("Network database access is forbidden in this harness.");
      return requirePackage(name);
    };
    new Function("require", "module", "exports", code)(requireSource, loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}

async function createFixture(origin) {
  const engine = new PGlite();
  try {
    await engine.exec("create role anon; create role authenticated; create role service_role;");
    const migrations = [...read("scripts/migrate-platform.mjs").matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)];
    assert.ok(migrations.length > 40, "Missing full application migration list.");
    for (const migration of migrations) await engine.exec(read(migration[1]));
    const fixture = { memberId: randomUUID(), authUserId: randomUUID(), acceptanceId: randomUUID(), attemptId: randomUUID() };
    fixture.email = `stripe-smoke-${fixture.memberId}@example.test`;
    const termsId = randomUUID();
    const terms = "SANDBOX TEST ONLY. Synthetic adult member consents to the selected test recurring membership amount. No real membership or legal agreement is created.";
    const hash = createHash("sha256").update(terms).digest("hex");
    await engine.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)", [fixture.memberId, fixture.email]);
    fixture.personId = (await engine.query("select person_id from ruined_members where id=$1", [fixture.memberId])).rows[0].person_id;
    await engine.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1", [fixture.personId]);
    await engine.query("insert into member_lifecycle(member_id,account_state) values($1,'active')", [fixture.memberId]);
    await engine.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [fixture.authUserId, fixture.memberId, fixture.personId, fixture.email]);
    await engine.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [fixture.authUserId]);
    await engine.query("update member_onboardings set billing_plan='monthly',profile_completed_at=now(),agreement_completed_at=now() where member_id=$1", [fixture.memberId]);
    await engine.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',2,'Sandbox paid terms',$2,$3,'published',now())", [termsId, terms, hash]);
    const ageId = (await engine.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key) values($1,'age_attestation','sandbox-age18',now(),$2) returning id", [fixture.memberId, `smoke-age:${fixture.memberId}`])).rows[0].id;
    await engine.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      values($1,$2,$3,$4,$5,$6,'Sandbox Test Member',$7,'checkbox_and_submit',now(),'ruined_membership',2,'Sandbox paid terms',$8,$9,$10)`,
    [fixture.acceptanceId, termsId, fixture.personId, fixture.memberId, fixture.authUserId, ageId, fixture.email, hash, terms, `smoke-agreement:${fixture.memberId}`]);
    const sql = sqlFor(engine);
    const noCommunication = new Proxy({}, { get: (_target, property) => {
      if (property === "__esModule") return true;
      return () => { throw new Error("External communication is disabled in the sandbox harness."); };
    } });
    let workerCalls = 0;
    const load = sourceLoader({
      "@/lib/database/server": { getApplicationDatabase: () => sql,
        withFreshApplicationDatabaseRead: (_stage, callback) => callback() },
      "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: fixture.authUserId, email: fixture.email }) },
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ stripeCheckoutReady: true, minimumAge: 18, mode: "connected" }),
        getStripePublishableKey: () => process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY },
      "@/lib/workflows/worker": { processWorkflowBatch: async () => { workerCalls++; } },
      "@/lib/google/calendar": noCommunication,
      "@/lib/support/delivery": noCommunication,
    });
    const checkout = load("app/api/stripe/checkout/route.ts");
    const webhook = load("app/api/stripe/webhook/route.ts");
    const server = load("src/lib/stripe/server.ts");
    const identity = load("src/lib/membership/repository.ts");
    const platform = load("src/lib/platform/repository.ts");
    // Exercise actual application identity guards before making any Stripe call.
    assert.equal((await identity.getMemberIdentity(fixture.authUserId)).billingState, "pending");
    assert.equal((await platform.requireActivePlatformMemberLink(fixture)).memberId, fixture.memberId);
    let accountVerified = false;
    return { engine, fixture, checkout, webhook, server, load, origin, workerCalls: () => workerCalls,
      async verifyAccount() {
        if (accountVerified) return;
        const account = await server.getStripe().accounts.retrieve();
        if (account.id !== expectedAccount || server.getStripeLivemode()) throw new Error("The server key does not belong to the expected Ruined sandbox.");
        accountVerified = true;
      },
      async status() {
        const member = (await engine.query(`select m.membership_state,l.billing_state,l.administrative_onboarding_state,l.program_state,l.standing_state,
          o.billing_confirmed_at from ruined_members m join member_lifecycle l on l.member_id=m.id
          join member_onboardings o on o.member_id=m.id where m.id=$1`, [fixture.memberId])).rows[0];
        const attempts = (await engine.query("select id,status,billing_plan,stripe_price_id,stripe_session_id,stripe_subscription_id,recurring_payment_accepted_at from stripe_checkout_attempts where member_id=$1 order by created_at", [fixture.memberId])).rows;
        const invoices = (await engine.query("select id,purpose,stripe_status,amount_due,amount_paid,currency from stripe_invoices where member_id=$1 order by created_at", [fixture.memberId])).rows;
        const events = (await engine.query("select event_id,event_type,status,attempts from stripe_webhook_events order by received_at desc limit 20")).rows;
        return { sandboxAccount: expectedAccount, accountVerified, fixtureMemberId: fixture.memberId, member, attempts, invoices, events,
          communicationWorkerDisabled: true, acknowledgedWorkerCalls: workerCalls };
      },
    };
  } catch (error) {
    await engine.close();
    throw error;
  }
}

function html(app, token) {
  // Only public configuration and synthetic fixture identifiers enter the browser.
  const config = JSON.stringify({ publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    acceptanceId: app.fixture.acceptanceId, attemptId: app.fixture.attemptId, token }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ruined Stripe sandbox test</title><style>body{font:16px system-ui;margin:24px auto;padding:0 16px;max-width:960px;color:#202020;background:#f3f1eb}h1{font-size:26px}p{line-height:1.5}label{display:block;margin:16px 0}button,select{font:inherit;padding:10px}button{cursor:pointer}pre{font-size:12px;padding:16px;background:white;overflow:auto}#error{color:#a01515;white-space:pre-wrap}#checkout{margin:24px 0;min-height:20px}.note{background:#f7df97;padding:16px}</style>
<h1>Ruined · Stripe sandbox test</h1><p class="note">Development harness for ${expectedAccount}. Synthetic member, test payments, in-memory database. Email verification and the app signup screens are not part of this test. Closing this process erases its local records; Stripe sandbox objects remain.</p>
<form id="form"><label>Plan <select id="plan"><option value="monthly">Monthly · $499 USD / month</option><option value="annual">Annual · $5,040 USD / year upfront</option></select></label>
<label><input type="checkbox" id="consent" required> I authorize the selected recurring sandbox payment. This is a test-only agreement.</label>
<button type="submit" id="start">Open sandbox Checkout</button></form><p id="error" role="alert"></p><div id="checkout"></div>
<h2>Verified local billing state</h2><p>Only the signed webhook can update these records. A return from Checkout is not proof of payment.</p><pre id="state" aria-live="polite">Loading fixture…</pre>
<script src="https://js.stripe.com/dahlia/stripe.js"></script><script>
const config=${config}; let checkout; let busy=false;
const error=document.getElementById('error'); const button=document.getElementById('start');
const plan=document.getElementById('plan'); const consent=document.getElementById('consent');
const headers={'Content-Type':'application/json','X-Ruined-Smoke':config.token};
document.addEventListener('securitypolicyviolation',event=>{let source='inline content';try{source=new URL(event.blockedURI).origin;}catch{}error.textContent='Browser policy blocked '+event.effectiveDirective+' from '+source;});
plan.addEventListener('change',()=>{consent.checked=false;error.textContent='';if(checkout){checkout.destroy();checkout=null;}button.textContent='Open sandbox Checkout';});
async function refresh(){try{const response=await fetch('/status',{cache:'no-store'});if(!response.ok)throw Error('Status unavailable');document.getElementById('state').textContent=JSON.stringify(await response.json(),null,2);}catch{document.getElementById('state').textContent='Harness stopped or unavailable.';}}
document.getElementById('form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;button.disabled=true;plan.disabled=true;consent.disabled=true;error.textContent='';try{
 const response=await fetch('/api/stripe/checkout',{method:'POST',headers,body:JSON.stringify({plan:plan.value,recurringPaymentAccepted:consent.checked,acceptanceId:config.acceptanceId,attemptId:config.attemptId})});
 const result=await response.json();if(!response.ok){if(result.plan){plan.value=result.plan;consent.checked=false;}throw Error(result.error||'Checkout could not open');}
 plan.value=result.plan;
 if(checkout)checkout.destroy();checkout=await Stripe(config.publishableKey).createEmbeddedCheckoutPage({clientSecret:result.clientSecret});checkout.mount('#checkout');button.textContent='Resume sandbox Checkout';
 }catch(problem){error.textContent=problem.message||'Checkout could not open';}finally{busy=false;button.disabled=false;plan.disabled=false;consent.disabled=false;refresh();}});
refresh();setInterval(refresh,2500);
</script></html>`;
}

function response(body, status = 200, type = "application/json") {
  const hashes = tag => [...body.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))]
    .map(match => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`).join(" ");
  const security = type.startsWith("text/html") ? { "Content-Security-Policy": [
    "default-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    `script-src 'self' https://*.stripe.com https://*.link.com ${hashes("script")}`,
    "style-src 'self' 'unsafe-inline'", "frame-src https://*.stripe.com https://link.com https://*.link.com",
    "connect-src 'self' https://*.stripe.com https://link.com https://*.link.com",
    "img-src 'self' data: https://*.stripe.com https://*.link.com",
  ].join("; ") } : {};
  return new Response(type === "application/json" ? JSON.stringify(body) : body, { status,
    headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY", ...security } });
}

async function dispatch(app, token, request) {
  const url = new URL(request.url);
  if (url.origin !== app.origin || request.headers.get("host") !== new URL(app.origin).host) return response({ error: "Loopback host required." }, 403);
  // Stripe redirects the browser cross-site after payment. This GET only renders
  // the fixture; it cannot activate membership or create another Checkout.
  const safeReturn = request.method === "GET" && url.pathname === "/my/join/complete";
  if (request.headers.get("sec-fetch-site") === "cross-site" && !safeReturn) return response({ error: "Cross-site access is forbidden." }, 403);
  if (request.method === "POST" && url.pathname === "/api/stripe/webhook") return app.webhook.POST(request);
  if (request.method === "POST" && url.pathname === "/api/stripe/checkout") {
    if (request.headers.get("origin") !== app.origin || request.headers.get("x-ruined-smoke") !== token) return response({ error: "Open the local harness before starting Checkout." }, 403);
    try { await app.verifyAccount(); }
    catch { return response({ error: "Sandbox account verification failed. Check the key account and Account read permission." }, 502); }
    return app.checkout.POST(request);
  }
  if (request.method === "GET" && url.pathname === "/status") return response(await app.status());
  if (request.method === "GET" && ["/", "/my/join/complete"].includes(url.pathname)) return response(html(app, token), 200, "text/html; charset=utf-8");
  return response({ error: "Not found." }, 404);
}

async function selfTest() {
  const fake = { STRIPE_SECRET_KEY: "sk_test_local_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_local_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_local_fixture", STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID: "price_monthly", STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual" };
  assert.throws(() => validateEnvironment({ ...fake, STRIPE_SECRET_KEY: "sk_live_forbidden" }), /Live Stripe/);
  assert.throws(() => validateEnvironment({ ...fake, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_forbidden" }), /Live Stripe/);
  assert.throws(() => validateEnvironment({ ...fake, DATABASE_URL: "forbidden" }), /DATABASE_URL/);
  assert.throws(() => validateEnvironment({ ...fake, NEXT_PUBLIC_SUPABASE_URL: "forbidden" }), /Supabase/);
  assert.throws(() => validateEnvironment({}), /Missing environment variables/);
  assert.throws(() => optionsFrom(["--host", "0.0.0.0"]), /Unknown/);
  assert.throws(() => optionsFrom(["--port", "0"]), /Port/);
  Object.assign(process.env, fake);
  const app = await createFixture("http://127.0.0.1:3233");
  try {
    const post = body => app.checkout.POST(new Request(`${app.origin}/api/stripe/checkout`, { method: "POST", headers: { origin: app.origin }, body: JSON.stringify(body) }));
    assert.equal((await post({ ...app.fixture, plan: "monthly", recurringPaymentAccepted: false })).status, 400);
    assert.equal((await post({ ...app.fixture, plan: "cheap", recurringPaymentAccepted: true })).status, 400);
    const input = { ...app.fixture, plan: "monthly", stripePriceId: "price_monthly", paidAgreementVersion: agreementVersion };
    const billing = app.load("src/lib/stripe/billing-repository.ts");
    const first = await billing.reserveMembershipCheckout(input);
    const second = await billing.reserveMembershipCheckout({ ...input, attemptId: randomUUID() });
    assert.equal(first.attemptId, second.attemptId);
    assert.equal(first.plan, "monthly");
    const unsigned = new Request(`${app.origin}/api/stripe/webhook`, { method: "POST", body: "{}" });
    assert.equal((await app.webhook.POST(unsigned)).status, 400);
    const event = { id: `evt_smoke_${randomUUID().replaceAll("-", "")}`, object: "event", api_version: app.server.STRIPE_API_VERSION,
      created: Math.floor(Date.now() / 1000), livemode: false, type: "charge.succeeded", data: { object: { id: "ch_smoke_ignored" } } };
    const payload = JSON.stringify(event);
    const signature = app.server.getStripe().webhooks.generateTestHeaderString({ payload, secret: fake.STRIPE_WEBHOOK_SECRET });
    const signed = () => new Request(`${app.origin}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": signature }, body: payload });
    assert.equal((await app.webhook.POST(signed())).status, 200);
    assert.equal((await (await app.webhook.POST(signed())).json()).duplicate, true);
    const status = await app.status();
    assert.equal(status.member.billing_state, "pending");
    assert.equal(status.events.length, 1);
    assert.equal(app.workerCalls(), 0);
    assert.equal((await dispatch(app, "token", new Request(`${app.origin}/status`, { headers: { host: "attacker.example" } }))).status, 403);
    assert.equal((await dispatch(app, "token", new Request(`${app.origin}/api/stripe/checkout`, { method: "POST", headers: { host: "127.0.0.1:3233", origin: "https://attacker.example" } }))).status, 403);
    assert.equal((await dispatch(app, "token", new Request(`${app.origin}/my/join/complete?session_id=cs_test_return`, { headers: { host: "127.0.0.1:3233", "sec-fetch-site": "cross-site" } }))).status, 200);
    assert.equal((await dispatch(app, "token", new Request(`${app.origin}/my/join/complete`, { method: "POST", headers: { host: "127.0.0.1:3233", "sec-fetch-site": "cross-site" } }))).status, 403);
    const page = html(app, "fixture-token");
    assert.ok(!page.includes(fake.STRIPE_SECRET_KEY) && !page.includes(fake.STRIPE_WEBHOOK_SECRET));
    console.log("Offline self-test passed: full schema, actual identity/consent guards, reservation reuse, signed webhook deduplication, pending billing, loopback/CSRF guards, and no rendered secrets. No Stripe network requests made.");
  } finally { await app.engine.close(); }
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/stripe-sandbox-smoke.mjs [--port 3233]\n       node scripts/stripe-sandbox-smoke.mjs --self-test\n\nOnly 127.0.0.1; Ruined sandbox only. Read docs/stripe-sandbox-smoke.md. Never load an app .env file.");
    return;
  }
  // Make origin and paid agreement independent of any deployed environment.
  process.env.NODE_ENV = "development";
  process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = agreementVersion;
  process.env.STRIPE_MEMBERSHIP_LIVE_ENABLED = "false";
  process.env.STRIPE_TAX_ENABLED = "false";
  delete globalThis.ruinedStripeClient;
  if (options.selfTest) {
    if (process.env.DATABASE_URL || Object.keys(process.env).some(name => /SUPABASE/.test(name) && process.env[name])) throw new Error("Remove database and Supabase environment variables before running this test.");
    if (/^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "") || /^pk_live_/.test(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "")) throw new Error("Remove live Stripe credentials before running this test.");
    return selfTest();
  }
  Object.assign(process.env, validateEnvironment(process.env));
  const origin = `http://127.0.0.1:${options.port}`;
  process.env.NEXT_PUBLIC_SITE_URL = origin;
  const app = await createFixture(origin);
  const token = randomUUID();
  const http = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.socket.remoteAddress !== "127.0.0.1") { outgoing.writeHead(403).end(); return; }
      const chunks = []; let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > 1_000_000) { outgoing.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = ["GET", "HEAD"].includes(incoming.method) ? undefined : Buffer.concat(chunks);
      const request = new Request(new URL(incoming.url, origin), { method: incoming.method, headers: incoming.headers, body });
      const result = await dispatch(app, token, request);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      // Never log provider errors, raw payloads, headers, or environment values.
      outgoing.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      outgoing.end(JSON.stringify({ error: "Local harness request failed. Check the offline self-test and fixture status." }));
    }
  });
  http.requestTimeout = 30_000;
  http.headersTimeout = 10_000;
  try {
    await new Promise((done, fail) => { http.once("error", fail); http.listen(options.port, "127.0.0.1", done); });
  } catch (error) { await app.engine.close(); throw error; }
  console.log(`Sandbox harness ready: ${origin}\nAccount: ${expectedAccount}\nWebhook: ${origin}/api/stripe/webhook\nNo Stripe requests have been made. Only explicit Checkout submission contacts the sandbox.`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    http.close(async () => { await app.engine.close(); process.exit(0); });
    http.closeAllConnections();
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Configuration errors have controlled text and no values; runtime errors may contain secrets.
    try {
      const options = optionsFrom(process.argv.slice(2));
      if (!options.selfTest && !options.help) validateEnvironment(process.env);
      if (options.selfTest) {
        let diagnostic = error instanceof Error ? error.stack : "Unknown offline test failure";
        for (const name of names.slice(0, 3)) if (process.env[name]) diagnostic = diagnostic.replaceAll(process.env[name], "[redacted]");
        console.error(diagnostic);
      }
      console.error("Sandbox harness could not start or its offline self-test failed. No production state was changed.");
    } catch (configurationError) { console.error(configurationError.message); }
    process.exitCode = 1;
  });
}
