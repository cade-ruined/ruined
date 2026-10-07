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
const names = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID", "STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID"];
const read = path => readFileSync(resolve(root, path), "utf8");

export function optionsFrom(args) {
  const options = { port: 3233, selfTest: false, help: false, deferred: false, prepaid: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--prepaid") options.prepaid = true;
    else if (arg === "--native-consent") options.nativeConsent = true;
    else if (arg === "--deferred") options.deferred = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--port" && /^\d+$/.test(args[index + 1] ?? "")) {
      options.port = Number(args[++index]);
      if (options.port < 1024 || options.port > 65535) throw new Error("Port must be between 1024 and 65535.");
    } else throw new Error("Unknown or invalid argument. Use --help, --self-test, --prepaid, --deferred, or --port NUMBER.");
  }
  if (options.nativeConsent && (!options.selfTest || !options.prepaid)) throw new Error("--native-consent requires --self-test --prepaid.");
  if (options.prepaid && options.deferred) throw new Error("--prepaid and --deferred are mutually exclusive.");
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
  if (!/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET)) throw new Error("STRIPE_WEBHOOK_SECRET must be the sandbox-only webhook signing secret.");
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
  // Presence gates see only this isolated adapter marker. The real process never
  // receives a database URL, and postgres imports remain forbidden below.
  const scopedProcess=Object.create(process);
  scopedProcess.env={...process.env,DATABASE_URL:"postgresql://in-memory-harness.invalid/never-connected"};
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
    new Function("require", "module", "exports", "process", code)(requireSource, loaded, loaded.exports, scopedProcess);
    return loaded.exports;
  }
  return load;
}

async function createFixture(origin, { paidRegistration = false } = {}) {
  const engine = new PGlite();
  try {
    await engine.exec("create role anon; create role authenticated; create role service_role;");
    const migrations = [...read("scripts/migrate-platform.mjs").matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)];
    assert.ok(migrations.length > 40, "Missing full application migration list.");
    for (const migration of migrations) await engine.exec(read(migration[1]));
    const fixture = { memberId: randomUUID(), authUserId: randomUUID(), acceptanceId: randomUUID(), attemptId: randomUUID() };
    fixture.email = `stripe-smoke-${fixture.memberId}@example.test`;
    const termsId = randomUUID();
    const agreementNumber = process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION === "ruined_membership-v3" ? 3 : 2;
    const terms = (agreementNumber === 3 ? "PREPAID COHORT: first period paid now, service begins at the accepted first call, with full initial-payment refund before service begins. " : "") + "SANDBOX TEST ONLY. Synthetic adult member consents to the selected test recurring membership amount. No real membership or legal agreement is created.";
    const hash = createHash("sha256").update(terms).digest("hex");
    await engine.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)", [fixture.memberId, fixture.email]);
    fixture.personId = (await engine.query("select person_id from ruined_members where id=$1", [fixture.memberId])).rows[0].person_id;
    await engine.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1", [fixture.personId]);
    await engine.query("insert into member_lifecycle(member_id,account_state) values($1,'active')", [fixture.memberId]);
    await engine.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [fixture.authUserId, fixture.memberId, fixture.personId, fixture.email]);
    await engine.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [fixture.authUserId]);
    await engine.query("insert into person_profiles(person_id,display_name) values($1,'Sandbox Test Member') on conflict(person_id) do update set display_name=excluded.display_name", [fixture.personId]);
    await engine.query("insert into person_private_profiles(person_id,birth_date,default_fulfillment_address) values($1,'1990-01-01','{\"countryCode\":\"US\"}'::jsonb) on conflict(person_id) do update set birth_date=excluded.birth_date,default_fulfillment_address=excluded.default_fulfillment_address",[fixture.personId]);
    await engine.query("update person_profiles set preferred_name='Sandbox Test Member' where person_id=$1",[fixture.personId]);
    await engine.query("update person_private_profiles set legal_name='Sandbox Test Member',mobile_e164='+12025550123',default_fulfillment_address=$2::jsonb,apparel_sizing='{\"top\":\"M\"}'::jsonb where person_id=$1",[fixture.personId,JSON.stringify({addressLine1:"123 Test Street",city:"Denver",region:"CO",postalCode:"80202",countryCode:"US"})]);
    await engine.query("update member_onboardings set billing_plan='monthly',profile_completed_at=now() where member_id=$1", [fixture.memberId]);
    await engine.query(`insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',${agreementNumber},'Sandbox paid terms',$2,$3,'published',now())`, [termsId, terms, hash]);
    const ageId = (await engine.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key) values($1,'age_attestation','sandbox-age18',now(),$2) returning id", [fixture.memberId, `smoke-age:${fixture.memberId}`])).rows[0].id;
    await engine.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      values($1,$2,$3,$4,$5,$6,'Sandbox Test Member',$7,'checkbox_and_submit',now(),'ruined_membership',${agreementNumber},'Sandbox paid terms',$8,$9,$10)`,
    [fixture.acceptanceId, termsId, fixture.personId, fixture.memberId, fixture.authUserId, ageId, fixture.email, hash, terms, `smoke-agreement:${fixture.memberId}`]);
    // Preserve PostgreSQL timestamp precision and order: the checkpoint must
    // refer to an acceptance that already exists, just as the real signup does.
    await engine.query("update member_onboardings set agreement_completed_at=(select accepted_at from membership_agreement_acceptances where id=$1) where member_id=$2", [fixture.acceptanceId, fixture.memberId]);
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
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ stripeCheckoutReady: true, stripeActivationReady: true, membershipRegistrationOnly: paidRegistration, membershipPrepaymentRequired: paidRegistration, minimumAge: 18, mode: "connected" }),
        getStripePublishableKey: () => process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY },
      "@/lib/membership/registration-message-delivery": { getRegistrationMessageConfiguration:()=>({ready:false}),processRegistrationMessageBatch:async()=>{throw new Error("Communications disabled");} },
      "@/lib/workflows/worker": { processWorkflowBatch: async () => { workerCalls++; } },
      "@/lib/google/calendar": noCommunication,
      "@/lib/support/delivery": noCommunication,
    });
    const registration = load("src/lib/membership/registration-repository.ts");
    async function enrollPaidRegistration(person) {
      await sql.begin(tx => registration.enrollNewMemberRegistration(tx, person.memberId));
      await engine.query(`insert into member_consents(member_id,consent_type,policy_version,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
        values($1,'privacy','offline-registration',now(),'member',$2,$3::jsonb,$4)`, [person.memberId,person.authUserId,
        JSON.stringify({context:"registration_documents_v1",affirmativeAction:"checkbox_and_submit",membershipTerms:{key:"ruined_registration",sha256:"a".repeat(64)},registrationTermsAccepted:true,paidAgreementAccepted:false,chargeAuthorized:false}),
        `offline-registration:${person.memberId}`]);
    }
    if (paidRegistration) await enrollPaidRegistration(fixture);
    const checkout = load("app/api/stripe/checkout/route.ts");
    const offer = load("app/api/stripe/membership-offer/route.ts");
    const cancellation = load("app/api/stripe/cancellation/route.ts");
    const webhook = load("app/api/stripe/webhook/route.ts");
    const server = load("src/lib/stripe/server.ts");
    const identity = load("src/lib/membership/repository.ts");
    const platform = load("src/lib/platform/repository.ts");
    // Exercise actual application identity guards before making any Stripe call.
    assert.equal((await identity.getMemberIdentity(fixture.authUserId)).billingState, "pending");
    assert.equal((await platform.requireActivePlatformMemberLink(fixture)).memberId, fixture.memberId);
    let accountVerified = false;
    return { engine, fixture, checkout, offer, cancellation, webhook, server, load, origin, registration, enrollPaidRegistration, workerCalls: () => workerCalls,
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
        const commitments=(await engine.query("select terms_snapshot->>'startsAt' as starts_at,terms_snapshot->>'initialTermEndsAt' as ends_at,status from stripe_membership_commitments where member_id=$1",[fixture.memberId])).rows;
        const reservations=(await engine.query("select id,status,first_charge_at,billing_schedule,stripe_subscription_id from membership_commercial_reservations where payer_member_id=$1",[fixture.memberId])).rows;
        const events = (await engine.query("select event_id,event_type,status,attempts from stripe_webhook_events order by received_at desc limit 20")).rows;
        return { sandboxAccount: expectedAccount, accountVerified, fixtureMemberId: fixture.memberId, member, attempts, reservations, commitments, invoices, events,
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
    acceptanceId: app.fixture.acceptanceId, attemptId: app.fixture.attemptId, firstChargeAt:process.env.STRIPE_MEMBERSHIP_FIRST_CHARGE_AT??null, token }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ruined Stripe sandbox test</title><style>body{font:16px system-ui;margin:24px auto;padding:0 16px;max-width:960px;color:#202020;background:#f3f1eb}h1{font-size:26px}p{line-height:1.5}label{display:block;margin:16px 0}button,select{font:inherit;padding:10px}button{cursor:pointer}pre{font-size:12px;padding:16px;background:white;overflow:auto}#error{color:#a01515;white-space:pre-wrap}#checkout{margin:24px 0;min-height:20px}.note{background:#f7df97;padding:16px}</style>
<h1>Ruined · Stripe sandbox test</h1><p class="note">Development harness for ${expectedAccount}. Synthetic member, test payments, in-memory database. Email verification and the app signup screens are not part of this test. Closing this process erases its local records; Stripe sandbox objects remain.</p>
<form id="form"><label>Plan <select id="plan"><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
<p id="offer">Review the server-issued offer before confirming.</p><label><input type="checkbox" id="consent"> I authorize the selected recurring sandbox payment. This is a test-only agreement.</label>
<button type="submit" id="start">Review sandbox offer</button></form><button id="replay" type="button">Verify signed Stripe events</button><button id="snapshots" type="button">Verify current Stripe snapshots</button><button id="cancel" type="button">Cancel scheduled membership before start</button><p id="error" role="alert"></p><div id="checkout"></div>
<h2>Verified local billing state</h2><p>Only the signed webhook can update these records. A return from Checkout is not proof of payment.</p><pre id="state" aria-live="polite">Loading fixture…</pre>
<script src="https://js.stripe.com/dahlia/stripe.js"></script><script>
const config=${config}; let checkout; let quote; let busy=false;
const error=document.getElementById('error'); const button=document.getElementById('start');
const plan=document.getElementById('plan'); const consent=document.getElementById('consent');
const headers={'Content-Type':'application/json','X-Ruined-Smoke':config.token};
document.addEventListener('securitypolicyviolation',event=>{let source='inline content';try{source=new URL(event.blockedURI).origin;}catch{}error.textContent='Browser policy blocked '+event.effectiveDirective+' from '+source;});
plan.addEventListener('change',()=>{quote=null;consent.checked=false;error.textContent='';if(checkout){checkout.destroy();checkout=null;}button.textContent='Review sandbox offer';});
async function refresh(){try{const response=await fetch('/status',{cache:'no-store'});if(!response.ok)throw Error('Status unavailable');document.getElementById('state').textContent=JSON.stringify(await response.json(),null,2);}catch{document.getElementById('state').textContent='Harness stopped or unavailable.';}}
document.getElementById('form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;button.disabled=true;plan.disabled=true;consent.disabled=true;error.textContent='';try{
 if(!quote){const offerResponse=await fetch('/api/stripe/membership-offer',{method:'POST',headers,body:JSON.stringify({requestId:crypto.randomUUID(),kind:'individual',plan:plan.value})});const offerResult=await offerResponse.json();if(!offerResponse.ok)throw Error(offerResult.error||'Offer unavailable');quote=offerResult.quote;document.getElementById('offer').textContent=JSON.stringify({amount:quote.offer.amount/100,currency:quote.offer.currency,plan:quote.offer.plan,firstChargeAt:quote.firstChargeAt,dueToday:quote.firstChargeAt?0:quote.offer.amount/100,billingSchedule:quote.billingSchedule??null});consent.checked=false;button.textContent='Confirm and open sandbox Checkout';return;}
 if(!consent.checked)throw Error('Confirm the displayed payment terms first.');
 if(quote.billingSchedule&&Date.now()>=Math.min(Date.parse(quote.expiresAt),Date.parse(quote.billingSchedule.cutoffAt))){quote=null;consent.checked=false;throw Error('Offer expired. Review the next eligible cohort before payment.');}
 const response=await fetch('/api/stripe/checkout',{method:'POST',headers,body:JSON.stringify({plan:plan.value,recurringPaymentAccepted:consent.checked,acceptanceId:config.acceptanceId,attemptId:quote.id,commercialReservationId:quote.id,firstChargeAt:quote.firstChargeAt,...(quote.billingSchedule?{billingSchedule:quote.billingSchedule}:{})})});
 const result=await response.json();if(!response.ok){if(result.plan){plan.value=result.plan;consent.checked=false;}throw Error(result.error||'Checkout could not open');}
 plan.value=result.plan;
 if(checkout)checkout.destroy();checkout=await Stripe(config.publishableKey).createEmbeddedCheckoutPage({clientSecret:result.clientSecret});checkout.mount('#checkout');button.textContent='Resume sandbox Checkout';
 }catch(problem){error.textContent=problem.message||'Checkout could not open';}finally{busy=false;button.disabled=false;plan.disabled=false;consent.disabled=false;refresh();}});
document.getElementById('replay').addEventListener('click',async()=>{try{const r=await fetch('/replay-events',{method:'POST',headers,body:'{}'});error.textContent=JSON.stringify(await r.json());refresh();}catch{error.textContent='Signed event replay failed';}});
document.getElementById('snapshots').addEventListener('click',async()=>{try{const r=await fetch('/replay-snapshots',{method:'POST',headers,body:'{}'});error.textContent=JSON.stringify(await r.json());refresh();}catch{error.textContent='Signed snapshot replay failed';}});
document.getElementById('cancel').addEventListener('click',async()=>{try{const q=await fetch('/api/stripe/cancellation',{method:'POST',headers,body:JSON.stringify({action:'quote',intent:'cancel_before_start'})});const b=await q.json();if(!q.ok)throw Error(b.error);if(b.quote.feeTotal!==0)throw Error('Expected no fee');if(!confirm(b.quote.refundAmount?'Cancel this test membership before service begins and refund $'+(b.quote.refundAmount/100).toFixed(2)+'? $0 fee.':'Cancel this test membership before its first payment? $0 fee.'))return;const r=await fetch('/api/stripe/cancellation',{method:'POST',headers,body:JSON.stringify({action:'confirm',quoteId:b.quote.id,confirmed:true})});error.textContent=JSON.stringify(await r.json());refresh();}catch(e){error.textContent=e.message;}});
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
  const safeReturn = request.method === "GET" && ["/my/join/complete","/my/activate"].includes(url.pathname);
  if (request.headers.get("sec-fetch-site") === "cross-site" && !safeReturn) return response({ error: "Cross-site access is forbidden." }, 403);
  if (request.method === "POST" && url.pathname === "/api/stripe/webhook") return app.webhook.POST(request);
  if (request.method === "POST" && ["/api/stripe/checkout","/api/stripe/membership-offer","/api/stripe/cancellation","/replay-events","/replay-snapshots"].includes(url.pathname)) {
    if (request.headers.get("origin") !== app.origin || request.headers.get("x-ruined-smoke") !== token) return response({ error: "Open the local harness before starting Checkout." }, 403);
    try { await app.verifyAccount(); }
    catch { return response({ error: "Sandbox account verification failed. Check the key account and Account read permission." }, 502); }
    if(url.pathname==="/api/stripe/membership-offer") return app.offer.POST(request);
    if(url.pathname==="/api/stripe/cancellation") return app.cancellation.POST(request);
    if(url.pathname==="/replay-snapshots") return response(await replayCurrentSnapshots(app));
    if(url.pathname==="/replay-events") {
      const result=[];
      const known=(await app.engine.query("select stripe_session_id,stripe_subscription_id from stripe_checkout_attempts where member_id=$1",[app.fixture.memberId])).rows;
      const events=await app.server.getStripe().events.list({limit:100});
      for(const event of [...events.data].sort((a,b)=>a.created-b.created)){
        const object=event.data.object;
        if(event.livemode || !(object.metadata?.ruined_member_id===app.fixture.memberId || known.some(row=>[row.stripe_session_id,row.stripe_subscription_id].includes(object.id)))) continue;
        const payload=JSON.stringify(event),signature=app.server.getStripe().webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
        const replay=await app.webhook.POST(new Request(`${app.origin}/api/stripe/webhook`,{method:"POST",headers:{"stripe-signature":signature},body:payload}));
        result.push({id:event.id,type:event.type,apiVersion:event.api_version,status:replay.status,result:await replay.json()});
      }
      return response({replayed:result});
    }
    return app.checkout.POST(request);
  }
  if (request.method === "GET" && url.pathname === "/status") return response(await app.status());
  if (request.method === "GET" && url.pathname === "/api/stripe/cancellation") return app.cancellation.GET();
  if (request.method === "GET" && ["/", "/my/join/complete", "/my/activate"].includes(url.pathname)) return response(html(app, token), 200, "text/html; charset=utf-8");
  return response({ error: "Not found." }, 404);
}

// Explicit diagnostic replay for sandbox accounts whose original event schema is
// older than the app's pinned version. Never change an original Event's version:
// retrieve fresh provider objects and name the locally signed snapshots separately.
async function replayCurrentSnapshots(app) {
  const stripe=app.server.getStripe(),result=[];
  const attempts=(await app.engine.query("select stripe_session_id from stripe_checkout_attempts where member_id=$1 and stripe_session_id is not null",[app.fixture.memberId])).rows;
  const deliver=async(type,object)=>{
    if(object.livemode) throw new Error("Live snapshot forbidden");
    const id="evt_local_snapshot_"+createHash("sha256").update(type+JSON.stringify(object)).digest("hex").slice(0,40);
    const payload=JSON.stringify({id,object:"event",api_version:app.server.STRIPE_API_VERSION,created:Math.floor(Date.now()/1000),livemode:false,type,data:{object}});
    const signature=stripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
    const replay=await app.webhook.POST(new Request(`${app.origin}/api/stripe/webhook`,{method:"POST",headers:{"stripe-signature":signature},body:payload}));
    result.push({id,type,status:replay.status,result:await replay.json()});
  };
  for(const attempt of attempts){
    const session=await stripe.checkout.sessions.retrieve(attempt.stripe_session_id);
    if(session.livemode || session.metadata?.ruined_member_id!==app.fixture.memberId) throw new Error("Wrong synthetic member snapshot");
    if(session.status!=="complete" || !session.subscription) continue;
    const subscription=await stripe.subscriptions.retrieve(typeof session.subscription==="string"?session.subscription:session.subscription.id);
    if(subscription.livemode || subscription.metadata?.ruined_member_id!==app.fixture.memberId) throw new Error("Wrong synthetic subscription snapshot");
    await deliver(subscription.status==="canceled"?"customer.subscription.deleted":"customer.subscription.updated",subscription);
    await deliver("checkout.session.completed",session);
    if(subscription.latest_invoice){
      const invoice=await stripe.invoices.retrieve(typeof subscription.latest_invoice==="string"?subscription.latest_invoice:subscription.latest_invoice.id);
      if(invoice.status==="paid") await deliver("invoice.paid",invoice);
    }
  }
  return {scope:"Fresh provider objects retrieved using the pinned API and replayed as locally signed snapshots; not original Stripe-delivered Events.",replayed:result};
}

async function selfTest() {
  const fake={STRIPE_SECRET_KEY:"sk_test_local_fixture",NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:"pk_test_local_fixture",
    STRIPE_WEBHOOK_SECRET:"whsec_local_fixture",STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID:"price_monthly",STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID:"price_annual"};
  assert.throws(()=>validateEnvironment({...fake,STRIPE_SECRET_KEY:"sk_live_forbidden"}),/Live Stripe/);
  assert.throws(()=>validateEnvironment({...fake,DATABASE_URL:"forbidden"}),/DATABASE_URL/);
  assert.throws(()=>validateEnvironment({...fake,NEXT_PUBLIC_SUPABASE_URL:"forbidden"}),/Supabase/);
  assert.throws(()=>optionsFrom(["--host","0.0.0.0"]),/Unknown/);
  Object.assign(process.env,fake,{STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID:"bpc_fixture",
    STRIPE_MEMBERSHIP_FIRST_CHARGE_AT:new Date(Math.floor(Date.now()/1000)*1000+7*86400000).toISOString(),
    STRIPE_MEMBERSHIP_FOUNDING_INDIVIDUAL_MONTHLY_PRICE_ID:"price_foundingmonthly"});
  for(const cancel of [false,true]){
    const app=await createFixture("http://127.0.0.1:3233");
    const stripe=app.server.getStripe(),firstAt=Date.parse(process.env.STRIPE_MEMBERSHIP_FIRST_CHARGE_AT)/1000;
    const now=Math.floor(Date.now()/1000),realNow=Date.now;
    let session,subscription,invoice;
    const post=(handler,path,body)=>handler.POST(new Request(`${app.origin}${path}`,{method:"POST",headers:{origin:app.origin},body:JSON.stringify(body)}));
    const price={id:"price_foundingmonthly",active:true,livemode:false,type:"recurring",billing_scheme:"per_unit",transform_quantity:null,
      tax_behavior:"exclusive",currency:"usd",unit_amount:34900,recurring:{interval:"month",interval_count:1,usage_type:"licensed"}};
    stripe.prices.retrieve=async id=>{assert.equal(id,price.id);return price;};
    stripe.billingPortal.configurations.retrieve=async()=>({id:"bpc_fixture",active:true,livemode:false,
      features:{invoice_history:{enabled:true},payment_method_update:{enabled:true},subscription_cancel:{enabled:false},subscription_update:{enabled:false}}});
    stripe.checkout.sessions.create=async(params)=>{
      assert.equal(params.subscription_data.billing_cycle_anchor,firstAt);assert.equal(params.subscription_data.proration_behavior,"none");
      subscription={id:`sub_${app.fixture.memberId.replaceAll("-","")}`,status:"active",customer:"cus_fixture",livemode:false,
        start_date:now,billing_cycle_anchor:firstAt,trial_end:null,cancel_at_period_end:false,cancel_at:null,canceled_at:null,
        automatic_tax:{enabled:false,disabled_reason:null},latest_invoice:null,metadata:params.subscription_data.metadata,
        items:{has_more:false,data:[{id:"si_fixture",quantity:1,price,current_period_start:now,current_period_end:firstAt}]}};
      session={id:"cs_fixture",...params,client_secret:"sandbox_local_secret",status:"open",amount_subtotal:0,amount_total:0,currency:"usd",livemode:false,
        payment_status:"unpaid",customer:"cus_fixture",subscription:subscription.id,customer_details:{email:app.fixture.email}};
      return session;
    };
    stripe.checkout.sessions.retrieve=async()=>session;
    stripe.subscriptions.retrieve=async()=>subscription;
    stripe.customers.retrieve=async()=>({id:"cus_fixture",email:app.fixture.email,livemode:false,balance:0,invoice_credit_balance:{usd:0},cash_balance:{available:{usd:0}}});
    stripe.invoices.list=()=>({data:invoice?[invoice]:[],has_more:false,async *[Symbol.asyncIterator](){if(invoice)yield invoice;}});
    stripe.invoices.retrieve=async()=>invoice;
    stripe.invoiceItems.list=async()=>({data:[],has_more:false});
    stripe.invoicePayments.list=async()=>({has_more:false,data:[{invoice:invoice.id,livemode:false,currency:"usd",status:"paid",amount_paid:34900,payment:{type:"payment_intent",payment_intent:"pi_fixture"}}]});
    stripe.paymentIntents.retrieve=async()=>({status:"succeeded",livemode:false,customer:"cus_fixture",latest_charge:"ch_fixture"});
    stripe.charges.retrieve=async()=>({id:"ch_fixture",status:"succeeded",paid:true,captured:true,refunded:false,amount_refunded:0,disputed:false,amount:34900,currency:"usd",livemode:false,customer:"cus_fixture"});
    stripe.refunds.list=async()=>({data:[],has_more:false});
    stripe.subscriptions.cancel=async()=>{subscription.status="canceled";subscription.canceled_at=now;return subscription;};
    const deliver=async(type,object,eventId)=>{
      const payload=JSON.stringify({id:eventId,object:"event",api_version:app.server.STRIPE_API_VERSION,created:Math.floor(Date.now()/1000),livemode:false,type,data:{object}});
      const signature=stripe.webhooks.generateTestHeaderString({payload,secret:fake.STRIPE_WEBHOOK_SECRET});
      return app.webhook.POST(new Request(`${app.origin}/api/stripe/webhook`,{method:"POST",headers:{"stripe-signature":signature},body:payload}));
    };
    try{
      const quoteResponse=await post(app.offer,"/api/stripe/membership-offer",{requestId:app.fixture.attemptId,kind:"individual",plan:"monthly"});
      assert.equal(quoteResponse.status,200,JSON.stringify(await quoteResponse.clone().json()));
      const quote=(await quoteResponse.json()).quote;
      const input={attemptId:quote.id,commercialReservationId:quote.id,acceptanceId:app.fixture.acceptanceId,plan:"monthly",firstChargeAt:quote.firstChargeAt,recurringPaymentAccepted:true};
      assert.equal((await post(app.checkout,"/api/stripe/checkout",{...input,recurringPaymentAccepted:false})).status,400);
      assert.equal((await post(app.checkout,"/api/stripe/checkout",input)).status,200);
      assert.equal((await post(app.checkout,"/api/stripe/checkout",input)).status,200,"resume uses the stored zero-due session");
      assert.equal((await deliver("customer.subscription.updated",subscription,"evt_before_checkout")).status,200);
      assert.equal((await app.status()).member.billing_state,"pending");
      session={...session,status:"complete",payment_status:"no_payment_required",consent:{terms_of_service:"accepted"}};
      assert.equal((await deliver("checkout.session.completed",session,"evt_checkout")).status,200);
      assert.equal((await (await deliver("checkout.session.completed",session,"evt_checkout")).json()).duplicate,true);
      let status=await app.status();
      assert.equal(status.member.billing_state,"pending");assert.equal(status.invoices.length,0);
      assert.equal(status.commitments.length,1);assert.equal(new Date(status.commitments[0].starts_at).getTime(),firstAt*1000);
      assert.equal(status.reservations[0].status,"reserved");
      if(cancel){
        const quoted=await post(app.cancellation,"/api/stripe/cancellation",{action:"quote",intent:"cancel_before_start"});
        assert.equal(quoted.status,200,JSON.stringify(await quoted.clone().json()));
        const cancellationQuote=(await quoted.json()).quote;assert.equal(cancellationQuote.feeTotal,0);
        const confirmed=await post(app.cancellation,"/api/stripe/cancellation",{action:"confirm",quoteId:cancellationQuote.id,confirmed:true});
        assert.equal(confirmed.status,200,JSON.stringify(await confirmed.clone().json()));
        assert.equal((await deliver("customer.subscription.deleted",subscription,"evt_cancel")).status,200);
        assert.equal((await deliver("checkout.session.completed",session,"evt_late_checkout")).status,200,"late completion must not recreate the canceled reservation");
        status=await app.status();assert.equal(status.member.billing_state,"pending");assert.equal(status.reservations[0].status,"released");assert.equal(status.invoices.length,0);
      }else{
        Date.now=()=>firstAt*1000+1000;
        const periodEnd=firstAt+30*86400;subscription.latest_invoice="in_fixture";
        subscription.items.data[0].current_period_start=firstAt;subscription.items.data[0].current_period_end=periodEnd;
        invoice={id:"in_fixture",livemode:false,status:"paid",billing_reason:"subscription_cycle",customer:"cus_fixture",customer_email:app.fixture.email,currency:"usd",
          total:34900,amount_due:34900,amount_paid:34900,amount_remaining:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,
          starting_balance:0,ending_balance:0,customer_address:{country:"US"},status_transitions:{paid_at:firstAt},metadata:{},
          parent:{subscription_details:{subscription:subscription.id,metadata:subscription.metadata}},
          lines:{has_more:false,data:[{id:"il_fixture",livemode:false,currency:"usd",quantity:1,subtotal:34900,period:{start:firstAt,end:periodEnd},
            pricing:{price_details:{price:price.id}},parent:{type:"subscription_item_details",subscription_item_details:{subscription:subscription.id,subscription_item:"si_fixture",proration:false}}}]}};
        assert.equal((await deliver("invoice.paid",invoice,"evt_paid")).status,200);
        status=await app.status();assert.equal(status.member.billing_state,"active");assert.equal(status.reservations[0].status,"activated");assert.equal(status.invoices[0].amount_paid,34900);
        assert.equal((await (await deliver("invoice.paid",invoice,"evt_paid")).json()).duplicate,true);
      }
      const snapshots=await replayCurrentSnapshots(app);
      assert.ok(snapshots.replayed.length>=2);
      assert.ok(snapshots.replayed.every(event=>event.status===200),JSON.stringify(snapshots));
      const snapshotsAgain=await replayCurrentSnapshots(app);
      assert.ok(snapshotsAgain.replayed.every(event=>event.result.duplicate===true),"Stable current-snapshot IDs deduplicate replays");
      assert.equal((await app.status()).member.billing_state,cancel?"pending":"active");
      const unsigned=new Request(`${app.origin}/api/stripe/webhook`,{method:"POST",body:"{}"});assert.equal((await app.webhook.POST(unsigned)).status,400);
      assert.equal((await dispatch(app,"token",new Request(`${app.origin}/status`,{headers:{host:"attacker.example"}}))).status,403);
      const page=html(app,"fixture-token");assert.ok(!page.includes(fake.STRIPE_SECRET_KEY)&&!page.includes(fake.STRIPE_WEBHOOK_SECRET));
    }finally{Date.now=realNow;await app.engine.close();}
  }
  console.log("Offline self-test passed: full migration schema, real commercial offer and Checkout routes, immutable first-charge consent, signed out-of-order webhooks, pending future commitment, full paid invoice activation, free prestart cancellation, late completion and replay idempotency. In-memory database only; no external communication or provider network calls.");
}

async function selfTestPrepaid() {
  const fake = { STRIPE_SECRET_KEY: "sk_test_local_prepaid", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_local_prepaid",
    STRIPE_WEBHOOK_SECRET: "whsec_local_prepaid", STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID: "price_monthly", STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual",
    STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID: "bpc_fixture",
    STRIPE_MEMBERSHIP_FOUNDING_INDIVIDUAL_MONTHLY_PRICE_ID: "price_foundingmonthly", STRIPE_MEMBERSHIP_FOUNDING_INDIVIDUAL_ANNUAL_PRICE_ID: "price_foundingannual",
    STRIPE_MEMBERSHIP_COUPLE_MONTHLY_PRICE_ID: "price_couplemonthly", STRIPE_MEMBERSHIP_COUPLE_ANNUAL_PRICE_ID: "price_coupleannual",
    STRIPE_PAYMENT_SETUP_ACCOUNT_ID: "acct_PrepaidRegistrationTest" };
  assert.throws(() => optionsFrom(["--prepaid", "--deferred"]), /mutually exclusive/);
  assert.equal(optionsFrom(["--self-test", "--prepaid"]).prepaid, true);
  assert.throws(() => validateEnvironment({ ...fake, STRIPE_SECRET_KEY: "sk_live_forbidden" }), /Live Stripe/);
  Object.assign(process.env, fake);
  for (const [plan, kind, existingCount] of [["monthly", "individual",49], ["annual", "individual",49], ["monthly", "couple",48], ["monthly", "couple",49]]) {
    const app = await createFixture("http://127.0.0.1:3233", { paidRegistration: true });
    let partner = null;
    if (kind === "couple") {
      partner = {memberId:randomUUID(),authUserId:randomUUID(),email:`partner-${randomUUID()}@example.test`};
      await app.engine.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)",[partner.memberId,partner.email]);
      partner.personId=(await app.engine.query("select person_id from ruined_members where id=$1",[partner.memberId])).rows[0].person_id;
      await app.engine.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1",[partner.personId]);
      await app.engine.query("insert into member_lifecycle(member_id,account_state) values($1,'active')",[partner.memberId]);
      await app.engine.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')",[partner.authUserId,partner.memberId,partner.personId,partner.email]);
      await app.engine.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[partner.authUserId]);
      await app.engine.query("insert into person_profiles(person_id,preferred_name,display_name) values($1,'Second Adult','Second Adult')",[partner.personId]);
      await app.engine.query("insert into person_private_profiles(person_id,birth_date,default_fulfillment_address,legal_name,mobile_e164,apparel_sizing) select $1,birth_date,default_fulfillment_address,'Second Adult',mobile_e164,apparel_sizing from person_private_profiles where person_id=$2",[partner.personId,app.fixture.personId]);
      await app.engine.query("update member_onboardings set billing_plan='monthly',profile_completed_at=now() where member_id=$1",[partner.memberId]);
      const ageId=(await app.engine.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key) values($1,'age_attestation','sandbox-age18',now(),$2) returning id",[partner.memberId,`age:${partner.memberId}`])).rows[0].id;
      const acceptanceId=randomUUID();
      await app.engine.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
        select $1,agreement_version_id,$2,$3,$4,$5,'Second Adult',$6,'checkbox_and_submit',now(),agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,$7 from membership_agreement_acceptances where id=$8`,
        [acceptanceId,partner.personId,partner.memberId,partner.authUserId,ageId,partner.email,`agreement:${partner.memberId}`,app.fixture.acceptanceId]);
      await app.engine.query("update member_onboardings set agreement_completed_at=(select accepted_at from membership_agreement_acceptances where id=$1) where member_id=$2",[acceptanceId,partner.memberId]);
      await app.enrollPaidRegistration(partner);
      await app.engine.query("insert into membership_couple_authorizations(id,payer_member_id,partner_member_id,accepted_by_auth_user_id,accepted_at) values($1,$2,$3,$4,now())",[randomUUID(),app.fixture.memberId,partner.memberId,partner.authUserId]);
    }
    const stripe = app.server.getStripe();
    // Any accidentally unmocked provider operation must fail locally, never reach Stripe.
    stripe._requestSender._request = () => { throw new Error("Provider network forbidden in offline prepaid test."); };
    const amount = kind === "couple" ? 69900 : plan === "monthly" ? 34900 : 349000;
    const price = { id: `price_${kind === "couple" ? "couple" : "founding"}${plan}`, product: "prod_fixture", active: true, livemode: false, type: "recurring", billing_scheme: "per_unit", transform_quantity: null,
      tax_behavior: "exclusive", currency: "usd", unit_amount: amount, recurring: { interval: plan === "monthly" ? "month" : "year", interval_count: 1, usage_type: "licensed" } };
    let session, expectedSchedule, creations = 0;
    const post = (handler, path, body) => handler.POST(new Request(`${app.origin}${path}`, { method: "POST", headers: { origin: app.origin }, body: JSON.stringify(body) }));
    stripe.accounts.retrieve = async () => ({id:fake.STRIPE_PAYMENT_SETUP_ACCOUNT_ID});
    stripe.prices.retrieve = async id => { assert.equal(id, price.id); return price; };
    stripe.billingPortal.configurations.retrieve = async () => ({ id: "bpc_fixture", active: true, livemode: false,
      features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: false }, subscription_update: { enabled: false } } });
    stripe.checkout.sessions.create = async (params, options) => {
      creations++;
      assert.equal(params.mode, "subscription");
      assert.deepEqual(params.line_items, [{ price: price.id, quantity: 1 }, { price_data: { currency: "usd", unit_amount: amount, tax_behavior: "exclusive", product: "prod_fixture" }, quantity: 1 }]);
      assert.equal(params.subscription_data.trial_end, Date.parse(expectedSchedule.prepaidThrough) / 1000);
      assert.equal(params.subscription_data.billing_cycle_anchor, undefined);
      assert.equal(params.subscription_data.proration_behavior, undefined);
      assert.equal(params.subscription_data.trial_settings.end_behavior.missing_payment_method, "cancel");
      assert.equal(params.metadata.ruined_billing_schedule_version, "foundations-prepaid-v1");
      assert.equal(params.metadata.ruined_cohort_month, expectedSchedule.cohortMonth);
      assert.equal(params.metadata.ruined_service_starts_at, expectedSchedule.serviceStartsAt);
      assert.equal(params.metadata.ruined_first_charge_at, undefined);
      assert.equal(params.metadata.billing_terms_version, "membership-billing-v2");
      assert.match(params.custom_text.terms_of_service_acceptance.message, /ruined_membership-v3/);
      assert.match(params.custom_text.submit.message, /Pay your first (month|year) today/);
      assert.equal(params.return_url, `${app.origin}/my/activate?checkout=returned`);
      assert.ok(options.idempotencyKey);
      session = { id: "cs_prepaid_fixture", ...params, client_secret: "sandbox_prepaid_secret", status: "open", amount_subtotal: amount, amount_total: amount, currency: "usd", livemode: false, payment_status: "unpaid" };
      return session;
    };
    stripe.checkout.sessions.retrieve = async () => session;
    try {
      // Fill the confirmed population up to the last founding place(s). These
      // existing adults have active service; the new fixture must count after
      // payment even though its own service and profile remain held.
      async function capacityMember(active = false) {
        const person = {memberId:randomUUID(),authUserId:randomUUID(),email:`capacity-${randomUUID()}@example.test`};
        await app.engine.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)",[person.memberId,person.email]);
        person.personId=(await app.engine.query("select person_id from ruined_members where id=$1",[person.memberId])).rows[0].person_id;
        await app.engine.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1",[person.personId]);
        await app.engine.query("insert into member_lifecycle(member_id,account_state) values($1,'active')",[person.memberId]);
        await app.engine.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')",[person.authUserId,person.memberId,person.personId,person.email]);
        await app.engine.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[person.authUserId]);
        await app.engine.query("insert into person_profiles(person_id,preferred_name,display_name) values($1,'Existing Member','Existing Member')",[person.personId]);
        await app.engine.query("insert into person_private_profiles(person_id,birth_date,default_fulfillment_address) select $1,birth_date,default_fulfillment_address from person_private_profiles where person_id=$2",[person.personId,app.fixture.personId]);
        const ageId=(await app.engine.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key) values($1,'age_attestation','sandbox-age18',now(),$2) returning id",[person.memberId,`age:${person.memberId}`])).rows[0].id;
        const acceptanceId=randomUUID();
        await app.engine.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
          select $1,agreement_version_id,$2,$3,$4,$5,'Existing Member',$6,'checkbox_and_submit',now(),agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,$7 from membership_agreement_acceptances where id=$8`,
          [acceptanceId,person.personId,person.memberId,person.authUserId,ageId,person.email,`agreement:${person.memberId}`,app.fixture.acceptanceId]);
        await app.engine.query("update member_onboardings set profile_completed_at=now(),agreement_completed_at=(select accepted_at from membership_agreement_acceptances where id=$1) where member_id=$2",[acceptanceId,person.memberId]);
        if(active){
          await app.engine.query("update member_lifecycle set billing_state='active' where member_id=$1",[person.memberId]);
          await app.engine.query("update member_onboardings set state='completed',billing_confirmed_at=now() where member_id=$1",[person.memberId]);
          await app.engine.query("update member_lifecycle set administrative_onboarding_state='completed',standing_state='active',program_state='onboarding',access_started_at=now() where member_id=$1",[person.memberId]);
        }
        return person;
      }
      const confirmedCount=existingCount+(kind==='couple'?2:1);
      for(let i=0;i<existingCount;i++) await capacityMember(true);
      const nextPerson=await capacityMember(), commercial=app.load("src/lib/membership/commercial-repository.ts");
      const registeredCount=async()=>(await app.engine.query("select count(*)::int n from private.ruined_commercial_registered_people()")).rows[0].n;
      const reserveNext=()=>commercial.reserveCommercialMembership({requestId:randomUUID(),memberId:nextPerson.memberId,kind:'individual',plan:'monthly',expiresAt:new Date(Date.now()+3600000)});
      assert.equal(await registeredCount(),existingCount);
      const agreement = (await app.engine.query("select agreement_version_snapshot from membership_agreement_acceptances where id=$1", [app.fixture.acceptanceId])).rows[0];
      assert.equal(agreement.agreement_version_snapshot, 3);
      const quoted = await post(app.offer, "/api/stripe/membership-offer", { requestId: app.fixture.attemptId, kind, plan });
      assert.equal(quoted.status, 200, JSON.stringify(await quoted.clone().json()));
      const quote = (await quoted.json()).quote;
      expectedSchedule = quote.billingSchedule;
      assert.equal(quote.firstChargeAt, null);
      assert.equal(expectedSchedule.version, "foundations-prepaid-v1");
      assert.equal(expectedSchedule.callStartsAt.length, 4);
      assert.equal(expectedSchedule.serviceStartsAt, expectedSchedule.callStartsAt[0]);
      const nativeConsent = process.argv.includes("--native-consent");
      const input = { attemptId: quote.id, commercialReservationId: quote.id, acceptanceId: app.fixture.acceptanceId, plan, firstChargeAt: null, billingSchedule: expectedSchedule,
        ...(nativeConsent ? { consentSource: "stripe_checkout" } : { recurringPaymentAccepted: true }) };
      assert.equal((await post(app.checkout, "/api/stripe/checkout", { ...input, consentSource: undefined, recurringPaymentAccepted: false })).status, 400);
      assert.equal((await post(app.checkout, "/api/stripe/checkout", { ...input, billingSchedule: null })).status, 409);
      assert.equal((await post(app.checkout, "/api/stripe/checkout", { ...input, billingSchedule: { ...expectedSchedule, serviceStartsAt: expectedSchedule.nextChargeAt } })).status, 409);
      assert.equal(creations, 0);
      const opened = await post(app.checkout, "/api/stripe/checkout", input);
      assert.equal(opened.status, 200, JSON.stringify(await opened.clone().json()));
      assert.equal((await post(app.checkout, "/api/stripe/checkout", input)).status, 200, "stored paid-due session must resume without another provider creation");
      assert.equal(creations, 1);
      if (nativeConsent) {
        const pending = (await app.engine.query("select recurring_payment_accepted_at,billing_consent_evidence,billing_consent_source from stripe_checkout_attempts where id=$1", [quote.id])).rows[0];
        assert.deepEqual(pending, { recurring_payment_accepted_at: null, billing_consent_evidence: null, billing_consent_source: "stripe_checkout" });
        assert.equal(session.metadata.billing_consent_at, undefined, "preparing the form never invents accepted consent");
        await assert.rejects(app.engine.query("update stripe_checkout_attempts set billing_consent_source='member' where id=$1", [quote.id]), /immutable/);
        await assert.rejects(app.engine.query("update stripe_checkout_attempts set recurring_payment_accepted_at=now() where id=$1", [quote.id]), /check constraint/);
        await assert.rejects(app.engine.query("update stripe_checkout_attempts set offer_id='individual_monthly' where id=$1", [quote.id]), /immutable/);
      }
      await assert.rejects(reserveNext(),error=>error.code==='founding_place_pending',"unfinished final founding Checkout stays a temporary hold");
      const status = await app.status();
      assert.equal(status.member.billing_state, "pending");
      assert.equal(status.invoices.length, 0);
      assert.equal(status.commitments.length, 0, "opening Checkout is not confirmed payment");
      assert.deepEqual(status.reservations[0].billing_schedule, expectedSchedule);
      const now = Math.floor(Date.now() / 1000), end = Date.parse(expectedSchedule.prepaidThrough) / 1000;
      const subscription = { id: "sub_prepaid_fixture", status: "trialing", customer: "cus_prepaid_fixture", livemode: false,
        start_date: now, trial_end: end, billing_cycle_anchor: end, cancel_at_period_end: false, cancel_at: null,
        automatic_tax: { enabled: false, disabled_reason: null }, latest_invoice: "in_prepaid_fixture", metadata: session.subscription_data.metadata,
        items: { has_more: false, data: [{ id: "si_prepaid_fixture", quantity: 1, price, current_period_start: now, current_period_end: end }] } };
      const invoice = { id: "in_prepaid_fixture", livemode: false, status: "paid", billing_reason: "subscription_create", customer: subscription.customer,
        customer_email: app.fixture.email, currency: "usd", total: amount, total_excluding_tax: amount, total_discount_amounts: [],
        amount_due: amount, amount_paid: amount, amount_remaining: 0, pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
        starting_balance: 0, ending_balance: 0, customer_address: { country: "US" }, status_transitions: { paid_at: now }, metadata: {},
        parent: { subscription_details: { subscription: subscription.id, metadata: subscription.metadata } },
        lines: { has_more: false, data: [
          { id: "il_upfront", livemode: false, currency: "usd", quantity: 1, subtotal: amount, amount, period: { start: now, end },
            pricing: { type: "price_details", price_details: { price: "price_upfront", product: "prod_fixture" } },
            parent: { type: "invoice_item_details", invoice_item_details: { subscription: subscription.id, invoice_item: "ii_upfront", proration: false } } },
          { id: "il_recurring", livemode: false, currency: "usd", quantity: 1, subtotal: 0, amount: 0, period: { start: now, end },
            pricing: { type: "price_details", price_details: { price: price.id, product: "prod_fixture" } },
            parent: { type: "subscription_item_details", subscription_item_details: { subscription: subscription.id, subscription_item: "si_prepaid_fixture", proration: false } } },
        ] } };
      stripe.customers.retrieve = async () => ({ id: subscription.customer, email: app.fixture.email, livemode: false, balance: 0, invoice_credit_balance: { usd: 0 }, cash_balance: { available: { usd: 0 } } });
      stripe.subscriptions.retrieve = async () => subscription;
      stripe.invoices.retrieve = async () => invoice;
      stripe.invoices.list = () => ({ data: [invoice], has_more: false, async *[Symbol.asyncIterator]() { yield invoice; } });
      stripe.creditNotes.list = async () => ({ data: [], has_more: false });
      stripe.invoicePayments.list = async () => ({ has_more: false, data: [{ invoice: invoice.id, livemode: false, currency: "usd", status: "paid", amount_paid: amount, payment: { type: "payment_intent", payment_intent: "pi_prepaid_fixture" } }] });
      stripe.paymentIntents.retrieve = async () => ({ status: "succeeded", livemode: false, customer: subscription.customer, latest_charge: "ch_prepaid_fixture", amount_received: amount, currency: "usd" });
      stripe.charges.retrieve = async () => ({ id: "ch_prepaid_fixture", status: "succeeded", paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false,
        amount, currency: "usd", livemode: false, customer: subscription.customer, payment_intent: "pi_prepaid_fixture" });
      stripe.refunds.list = async () => ({ data: [], has_more: false });
      const deliver = async (type, object, eventId, expectedStatus = 200, created = now) => {
        const payload = JSON.stringify({ id: eventId, object: "event", api_version: app.server.STRIPE_API_VERSION, created, livemode: false, type, data: { object } });
        const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: fake.STRIPE_WEBHOOK_SECRET });
        const result = await app.webhook.POST(new Request(`${app.origin}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
        assert.equal(result.status, expectedStatus, JSON.stringify({ response: await result.clone().json(), failures: (await app.engine.query("select last_error from stripe_webhook_events where event_id=$1", [eventId])).rows }));
        return result.json();
      };
      await deliver("customer.subscription.updated", subscription, "evt_prepaid_before_checkout", 200, now + 1);
      if (nativeConsent) {
        assert.equal((await app.engine.query("select count(*)::int n from stripe_invoices")).rows[0].n, 0,
          "pending consent must not advance an invoice fence as a price mismatch before an older completion arrives");
        assert.equal((await app.engine.query("select count(*)::int n from stripe_membership_commitments")).rows[0].n, 0);
      }
      assert.equal((await app.status()).member.billing_state, "pending");
      for (const person of [app.fixture,partner].filter(Boolean)) {
        const before = await app.registration.completeMemberRegistration(person.authUserId);
        assert.equal(before.state,"collecting","paid proof without completed Checkout cannot finish registration");
        assert.equal((await app.engine.query("select count(*)::int n from member_registration_messages where member_id=$1",[person.memberId])).rows[0].n,0);
      }
      session = { ...session, status: "complete", payment_status: "paid", customer: subscription.customer, subscription: subscription.id,
        customer_details: { email: app.fixture.email }, consent: { terms_of_service: "accepted" },
        line_items: { has_more: false, data: [
          { quantity: 1, currency: "usd", amount_subtotal: 0, price },
          { quantity: 1, currency: "usd", amount_subtotal: amount, price: { id: "price_upfront", unit_amount: amount, currency: "usd", tax_behavior: "exclusive", product: "prod_fixture", recurring: null } },
        ] } };
      if (nativeConsent) {
        const cleanSession = session;
        if (kind === "individual" && plan === "monthly") {
          for (const [name, change] of Object.entries({
            missingConsent: { consent: null }, missingRequiredTerms: { consent_collection: null },
            wrongCurrency: { currency: "eur" }, wrongAmount: { amount_subtotal: amount + 1 },
            wrongCustomer: { customer: "cus_someone_else" }, wrongSubscription: { subscription: "sub_someone_else" },
            wrongMode: { livemode: true }, wrongMember: { metadata: { ...cleanSession.metadata, ruined_member_id: randomUUID() } },
            wrongAgreement: { metadata: { ...cleanSession.metadata, agreement_acceptance_id: randomUUID() } },
            wrongPrice: { metadata: { ...cleanSession.metadata, ruined_price_id: "price_forged" } },
            wrongLine: { line_items: { ...cleanSession.line_items, data: [{ ...cleanSession.line_items.data[0], price: { ...price, id: "price_forged" } }, cleanSession.line_items.data[1]] } },
          })) {
            session = { ...cleanSession, ...change };
            await deliver("invoice.paid", invoice, `evt_native_reject_${name}`, 500);
            assert.equal((await app.engine.query("select recurring_payment_accepted_at from stripe_checkout_attempts where id=$1", [quote.id])).rows[0].recurring_payment_accepted_at, null);
            assert.equal((await app.engine.query("select count(*)::int n from stripe_membership_prepaid_proofs")).rows[0].n, 0);
          }
        }
        session = cleanSession;
        // Simulate a completed session beating the API's session-binding write.
        await app.engine.query("update stripe_checkout_attempts set stripe_session_id=null where id=$1", [quote.id]);
        stripe.checkout.sessions.list = async () => ({ data: [session], has_more: false });
        await deliver("invoice.paid", invoice, "evt_native_invoice_first");
        const confirmed = (await app.engine.query("select recurring_payment_accepted_at,billing_consent_evidence from stripe_checkout_attempts where id=$1", [quote.id])).rows[0];
        assert.ok(confirmed.recurring_payment_accepted_at);
        assert.equal(confirmed.billing_consent_evidence.sessionId, session.id);
        assert.equal(confirmed.billing_consent_evidence.providerEventId, "evt_native_invoice_first");
        await assert.rejects(app.engine.query("update stripe_checkout_attempts set recurring_payment_accepted_at=now() where id=$1", [quote.id]), /immutable/);
        await assert.rejects(app.engine.query("update stripe_checkout_attempts set billing_consent_evidence=null where id=$1", [quote.id]), /immutable/);
        const replay = await deliver("invoice.paid", invoice, "evt_native_invoice_first");
        assert.equal(replay.duplicate, true);
      }
      await deliver("checkout.session.completed", session, "evt_prepaid_checkout");
      await deliver("invoice.paid", invoice, "evt_prepaid_invoice");
      assert.equal((await deliver("invoice.paid", invoice, "evt_prepaid_invoice")).duplicate, true);
      const paidStatus = await app.status();
      assert.equal(paidStatus.member.billing_state, "pending", "prepaid cash never opens service before the accepted cohort begins");
      assert.equal(paidStatus.reservations[0].status, "reserved");
      assert.equal(paidStatus.commitments.length, 1);
      assert.equal(new Date(paidStatus.commitments[0].starts_at).toISOString(), expectedSchedule.serviceStartsAt);
      assert.equal(paidStatus.invoices[0].amount_paid, amount);
      const proofs = (await app.engine.query("select amount_paid,service_starts_at,prepaid_through,refund_state,activated_at from stripe_membership_prepaid_proofs where member_id=$1", [app.fixture.memberId])).rows;
      assert.equal(proofs.length, 1);
      assert.equal(proofs[0].amount_paid, amount);
      assert.equal(new Date(proofs[0].service_starts_at).toISOString(), expectedSchedule.serviceStartsAt);
      assert.equal(new Date(proofs[0].prepaid_through).toISOString(), expectedSchedule.prepaidThrough);
      assert.equal(proofs[0].refund_state, "none");
      assert.equal(proofs[0].activated_at, null);
      assert.equal(await registeredCount(),confirmedCount,"settled pre-service registrations count both adults once toward confirmed founding capacity");
      for(const person of [app.fixture,partner].filter(Boolean)) {
        const decision=(await app.engine.query("select founding_eligible,completion_basis,monthly_amount_cents,annual_amount_cents from member_registration_pricing_decisions where member_id=$1",[person.memberId])).rows[0];
        assert.equal(decision.founding_eligible,person.memberId===app.fixture.memberId || existingCount<49,'each adult retains their own accepted founding flag, including a couple crossing the 50-person boundary');assert.equal(decision.completion_basis,'paid_membership');
        assert.equal(decision.monthly_amount_cents,null);assert.equal(decision.annual_amount_cents,null,"paid receipt pricing comes from the original accepted offer, including couples");
      }
      const standardQuote=await reserveNext();
      assert.equal(standardQuote.offerId,'individual_monthly',"the 51st person gets standard pricing instead of an indefinite temporary hold");
      await commercial.releaseCommercialMembershipReservation({reservationId:standardQuote.id,reason:'before_checkout_abandoned'});
      const messageRepository = app.load("src/lib/membership/registration-message-repository.ts"), claims = [];
      for (const person of [app.fixture,partner].filter(Boolean)) {
        const registered = await app.registration.getMemberRegistration(person.authUserId);
        assert.equal(registered.state,"registered");assert.equal(registered.completionBasis,"paid_membership");
        assert.equal(registered.profileActivatedAt,null);assert.equal(registered.initialPayment.amountPaid,amount);
        assert.deepEqual(registered.initialPayment.billingSchedule,expectedSchedule);
        assert.equal(registered.initialPayment.isPayer,person.memberId===app.fixture.memberId);
        const lease=randomUUID(), claim=await messageRepository.claimRegistrationMessage(lease,person.memberId);
        assert.ok(claim);claims.push({lease,claim});
        const delivery=await messageRepository.withRegistrationMessage(claim,lease,async (_tx,row)=>row.paid_membership);
        assert.equal(delivery.kind,"ok");assert.equal(delivery.value.amountPaidCents,amount);
        assert.equal(delivery.value.isPayer,person.memberId===app.fixture.memberId);
        assert.deepEqual(delivery.value.billingSchedule,expectedSchedule);
        assert.equal((await app.engine.query("select count(*)::int n from member_registration_messages where member_id=$1 and kind='welcome'",[person.memberId])).rows[0].n,1);
        assert.equal((await app.engine.query("select count(*)::int n from member_payment_method_accounts where member_id=$1",[person.memberId])).rows[0].n,0,"paid registration never requires a separate setup checkout");
      }
      if(plan==='monthly' && kind==='individual') {
        let refund=null;
        stripe.invoiceItems.list=async()=>({data:[],has_more:false});
        stripe.subscriptions.cancel=async()=>{subscription.status='canceled';subscription.canceled_at=Math.floor(Date.now()/1000);return subscription;};
        stripe.refunds.create=async(input)=>{
          assert.equal(subscription.status,'canceled');
          refund={id:'re_prepaid_fixture',status:'succeeded',amount:input.amount,currency:'usd',livemode:false,
            payment_intent:'pi_prepaid_fixture',charge:'ch_prepaid_fixture',metadata:input.metadata};
          return refund;
        };
        stripe.refunds.list=async()=>({data:refund?[refund]:[],has_more:false});
        stripe.charges.retrieve=async()=>({id:'ch_prepaid_fixture',status:'succeeded',paid:true,captured:true,refunded:!!refund,
          amount_refunded:refund?amount:0,disputed:false,amount,currency:'usd',livemode:false,
          customer:subscription.customer,payment_intent:'pi_prepaid_fixture'});
        const cancelQuoteResult=await post(app.cancellation,'/api/stripe/cancellation',{action:'quote',intent:'cancel_before_start'});
        assert.equal(cancelQuoteResult.status,200,JSON.stringify(await cancelQuoteResult.clone().json()));
        const cancelQuote=(await cancelQuoteResult.json()).quote;
        assert.equal(cancelQuote.refundAmount,amount);
        const cancelResult=await post(app.cancellation,'/api/stripe/cancellation',{action:'confirm',quoteId:cancelQuote.id,confirmed:true});
        assert.equal(cancelResult.status,200,JSON.stringify(await cancelResult.clone().json()));
        assert.equal((await cancelResult.json()).cancellation.refundStatus,'succeeded');
        await deliver('customer.subscription.deleted',subscription,'evt_prepaid_refund_cancelled',200,now+2);
        assert.equal(await registeredCount(),50,JSON.stringify({reason:'fully settled pre-service refund retains the completed registration reservation',
          diagnostics:(await app.engine.query(`select private.ruined_paid_registration_never_started($1) never_started,
          private.ruined_paid_registration_refund_reserved($1) refund_reserved,private.ruined_registration_pricing_end_reason($1) end_reason,
          private.ruined_registration_pricing_is_current($1) current,registration.registered_at,proof.refund_state,
          proof.provider_canceled_at,proof.activated_at,cancellation.status cancellation_status,reservation.status reservation_status,
          reservation.release_reason,ending.reason ending_reason from member_registration_access registration
          join stripe_membership_prepaid_proofs proof on proof.reservation_id=registration.payment_reservation_id
          join membership_commercial_reservations reservation on reservation.id=proof.reservation_id
          left join stripe_membership_cancellations cancellation on cancellation.id=proof.cancellation_id
          left join member_registration_pricing_endings ending on ending.member_id=registration.member_id where registration.member_id=$1`,[app.fixture.memberId])).rows}));
        assert.equal((await app.engine.query("select count(*)::int n from member_registration_pricing_endings where member_id=$1",[app.fixture.memberId])).rows[0].n,0,'intermediate provider cancellation cannot prematurely end a pre-service award');
        assert.equal((await app.registration.getMemberRegistration(app.fixture.authUserId)).ready,false,'retained pricing never substitutes for a paid registration receipt');
        await capacityMember(true);
        assert.equal(await registeredCount(),51);
        const rejoinResult=await post(app.offer,'/api/stripe/membership-offer',{requestId:randomUUID(),kind,plan});
        assert.equal(rejoinResult.status,200,JSON.stringify(await rejoinResult.clone().json()));
        const rejoinQuote=(await rejoinResult.json()).quote;
        assert.equal(rejoinQuote.offer.id,'founding_individual_monthly','completed pre-service founding registration retains its actual rate even after capacity fills');
        assert.equal(await registeredCount(),51,'rejoin quote must not count the same person again');
        await commercial.releaseCommercialMembershipReservation({reservationId:rejoinQuote.id,reason:'before_checkout_abandoned'});
        // Represent a later enrollment whose service actually began and ended.
        // This is a schema-policy fixture, not a simulated extra provider charge.
        await app.engine.query("insert into membership_enrollment_episodes(member_id,person_id,source,founding_eligible,started_at,ended_at,end_reason) values($1,$2,'paid',true,clock_timestamp(),clock_timestamp(),'fixture_after_service_departure')",[app.fixture.memberId,app.fixture.personId]);
        await app.engine.query("select private.ruined_end_registration_pricing()");
        assert.equal((await app.engine.query("select private.ruined_registration_pricing_is_current($1) current",[app.fixture.memberId])).rows[0].current,false,'an old pre-service refund cannot revive pricing after later service departure');
        assert.equal(await registeredCount(),50);
        const departedQuote=await commercial.reserveCommercialMembership({requestId:randomUUID(),memberId:app.fixture.memberId,kind,plan,expiresAt:new Date(Date.now()+3600000)});
        assert.equal(departedQuote.offerId,'individual_monthly');
        await commercial.releaseCommercialMembershipReservation({reservationId:departedQuote.id,reason:'before_checkout_abandoned'});
      } else {
      await app.engine.query("update stripe_membership_prepaid_proofs set refund_state='review_required',review_reason='payment_adjustment' where member_id=$1",[app.fixture.memberId]);
      await deliver("invoice.paid",invoice,"evt_prepaid_adjustment_replay");
      assert.equal(await registeredCount(),existingCount,"a payment under refund/adjustment review is not a confirmed founding person");
      for (const person of [app.fixture,partner].filter(Boolean)) {
        const held = await app.registration.getMemberRegistration(person.authUserId);
        assert.equal(held.ready,false);assert.equal(held.initialPayment,null,"adjusted proof cannot appear as a successful payment receipt");
        assert.equal(held.profileActivatedAt,null);
        assert.equal((await app.engine.query("select count(*)::int n from member_registration_messages where member_id=$1 and kind='welcome'",[person.memberId])).rows[0].n,1,"adjustment/replay cannot enqueue duplicate welcomes");
      }
      for (const {claim,lease} of claims) {
        const heldDelivery=await messageRepository.withRegistrationMessage(claim,lease,async()=>{throw new Error("Adjusted payment must never reach email rendering/sending");});
        assert.equal(heldDelivery.kind,"deferred");
      }
      }
      const page = html(app, "fixture-token");
      assert.match(page, /billingSchedule:quote.billingSchedule/);
      assert.ok(!page.includes(fake.STRIPE_SECRET_KEY) && !page.includes(fake.STRIPE_WEBHOOK_SECRET));
    } finally { await app.engine.close(); }
  }
  console.log("Offline prepaid self-test passed: full migration schema, synthetic v3 agreement, monthly/annual/couple paid onboarding, immutable schedules and consent, signed webhook settlement, one welcome per adult, held profiles, 50th/51st founding capacity, per-adult couple boundary flags, actual cancellation/refund routes plus canceled-subscription reconciliation, retained pre-service founding rejoin and post-service-departure policy fixture, adjustment suppression and replay. No provider network calls or live changes. Real provider collection/refunds and due service activation require separate runtime and sandbox checks.");
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/stripe-sandbox-smoke.mjs [--deferred | --prepaid] [--port 3233]\n       node scripts/stripe-sandbox-smoke.mjs --self-test [--prepaid]\n\nOnly 127.0.0.1; Ruined sandbox only. Read docs/stripe-sandbox-smoke.md. Never load an app .env file.");
    return;
  }
  // Make origin and paid agreement independent of any deployed environment.
  process.env.NODE_ENV = "development";
  process.env.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = options.prepaid ? "ruined_membership-v3" : "ruined_membership-v2";
  process.env.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED = String(options.prepaid);
  if (options.prepaid) delete process.env.STRIPE_MEMBERSHIP_FIRST_CHARGE_AT;
  process.env.STRIPE_MEMBERSHIP_LIVE_ENABLED = "false";
  process.env.STRIPE_TAX_ENABLED = "false";
  process.env.MEMBER_REGISTRATION_EMAILS_ENABLED="false";
  if(options.deferred) process.env.STRIPE_MEMBERSHIP_FIRST_CHARGE_AT ||= "2026-11-01T06:00:00Z";
  delete globalThis.ruinedStripeClient;
  if (options.selfTest) {
    if (process.env.DATABASE_URL || Object.keys(process.env).some(name => /SUPABASE/.test(name) && process.env[name])) throw new Error("Remove database and Supabase environment variables before running this test.");
    if (/^(?:sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "") || /^pk_live_/.test(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "")) throw new Error("Remove live Stripe credentials before running this test.");
    return options.prepaid ? selfTestPrepaid() : selfTest();
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
  console.log(`Sandbox harness ready: ${origin}\nAccount: ${expectedAccount}\nWebhook: ${origin}/api/stripe/webhook\nNo Stripe requests have been made. Explicit offer, Checkout, cancellation or replay actions contact the sandbox.`);
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
