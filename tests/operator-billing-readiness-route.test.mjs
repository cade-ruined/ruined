import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const offers = ["individual_monthly", "individual_annual", "founding_individual_monthly", "founding_individual_annual", "couple_monthly", "couple_annual"];
const privateDetail = "rk_live_PRIVATE price_PRIVATE bpc_PRIVATE admin@example.com";

function fixture(options = {}) {
  const calls = [];
  const logs = [];
  const invoke = (name, value, argument) => {
    calls.push([name, argument]);
    if (options.failures?.includes(name)) throw new Error(privateDetail);
    return value;
  };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => invoke("viewer", options.signedOut ? null : { authUserId: "trusted-admin", email: "admin@example.com" }) },
    "@/lib/platform/repository": { getOperatorRole: async (id) => invoke("role", Object.hasOwn(options, "role") ? options.role : "ops_admin", id) },
    "@/lib/platform/config": { getPlatformConfiguration: () => invoke("configuration", { stripeActivationReady: options.configured !== false }) },
    "@/lib/membership/pricing": { MEMBERSHIP_OFFERS: Object.fromEntries(offers.map((id) => [id, {}])) },
    "@/lib/membership/published-agreement": { getPublishedMembershipAgreement: async (version) => invoke("agreement", options.unpublished ? null : { title: "Membership", body: privateDetail, version: 3 }, version) },
    "@/lib/stripe/server": {
      getPaidMembershipAgreementVersion: () => invoke("version", options.version ?? "ruined_membership-v3"),
      validateStripeMembershipOfferPrice: async (id) => invoke(`price:${id}`, "price_PRIVATE", id),
    },
    "@/lib/stripe/portal": { validateMembershipPortalConfiguration: async (kind) => invoke("portal", "bpc_PRIVATE", kind) },
  };
  const output = ts.transpileModule(readFileSync(new URL("../app/api/ops/billing/readiness/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "console", output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { env: { STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED: options.prepaid === false ? "false" : "true" } }, {
    error: (...args) => logs.push(args), warn: (...args) => logs.push(args), log: (...args) => logs.push(args),
  });
  return { route: { ...loaded.exports, GET: (request = new Request("https://members.theruinedproject.com/api/ops/billing/readiness")) => loaded.exports.GET(request) }, calls, logs };
}

async function responseBody(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.doesNotMatch(text, /PRIVATE|admin@example\.com|trusted-admin/);
  return JSON.parse(text);
}

test("billing readiness rejects signed-out callers before checking roles or provider settings", async () => {
  const f = fixture({ signedOut: true });
  const response = await f.route.GET();
  assert.equal(response.status, 401);
  assert.deepEqual(await responseBody(response), { ready: false, error: "Sign in required." });
  assert.deepEqual(f.calls.map(([name]) => name), ["viewer"]);
});

test("billing readiness requires the authenticated user's administrator role", async () => {
  for (const role of [null, "member", "circle_leader", "guide", "ops_admin "]) {
    const f = fixture({ role });
    const response = await f.route.GET();
    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { ready: false, error: "Administrator access required." });
    assert.deepEqual(f.calls, [["viewer", undefined], ["role", "trusted-admin"]]);
  }
});

test("billing readiness fails closed and conceals authentication, role, and configuration errors", async () => {
  for (const failure of ["viewer", "role", "configuration"]) {
    const f = fixture({ failures: [failure] });
    const response = await f.route.GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await responseBody(response), { ready: false, error: "Billing readiness could not be checked." });
    assert.ok(f.calls.every(([name]) => ["viewer", "role", "configuration"].includes(name)));
    assert.deepEqual(f.logs, []);
  }
});

test("an unconfigured release makes no provider reads and never reports ready", async () => {
  const f = fixture({ configured: false });
  const response = await f.route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await responseBody(response), { ready: false, checks: { configuration: false, agreement: false, prices: false, portal: false } });
  assert.deepEqual(f.calls.map(([name]) => name), ["viewer", "role", "configuration"]);
});

test("an administrator can verify all six offers, published agreement, and commitment portal through reads only", async () => {
  const f = fixture();
  assert.equal(f.route.runtime, "nodejs");
  assert.equal(f.route.dynamic, "force-dynamic");
  assert.deepEqual(Object.keys(f.route).sort(), ["GET", "dynamic", "runtime"]);
  const response = await f.route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await responseBody(response), { ready: true, checks: { configuration: true, agreement: true, prices: true, portal: true } });
  assert.deepEqual(f.calls.slice(0, 3), [["viewer", undefined], ["role", "trusted-admin"], ["configuration", undefined]]);
  assert.deepEqual(f.calls.filter(([name]) => name.startsWith("price:")).map(([, id]) => id).sort(), offers.toSorted());
  assert.deepEqual(f.calls.filter(([name]) => name === "agreement"), [["agreement", "ruined_membership-v3"]]);
  assert.deepEqual(f.calls.filter(([name]) => name === "portal"), [["portal", "commitment"]]);
  assert.deepEqual(f.logs, []);
});

test("each failed offer invalidates price readiness without skipping any other offer", async () => {
  for (const offer of offers) {
    const f = fixture({ failures: [`price:${offer}`] });
    const body = await responseBody(await f.route.GET());
    assert.deepEqual(body, { ready: false, checks: { configuration: true, agreement: true, prices: false, portal: true } });
    assert.equal(f.calls.filter(([name]) => name.startsWith("price:")).length, 6);
    assert.deepEqual(f.logs, []);
  }
});

test("agreement and portal read failures remain independent and conceal raw provider errors", async () => {
  for (const [failures, agreement, portal] of [[["agreement"], false, true], [["version"], false, true], [["portal"], true, false], [["agreement", "portal"], false, false]]) {
    const f = fixture({ failures });
    assert.deepEqual(await responseBody(await f.route.GET()), { ready: false, checks: { configuration: true, agreement, prices: true, portal } });
    assert.deepEqual(f.logs, []);
  }
});

test("missing or incompatible paid agreements cannot pass readiness", async () => {
  for (const options of [{ unpublished: true }, { version: "ruined_registration-v1" }, { version: "ruined_membership-v1" }, { version: "ruined_membership-v2" }, { version: "" }]) {
    const f = fixture(options);
    assert.deepEqual(await responseBody(await f.route.GET()), { ready: false, checks: { configuration: true, agreement: false, prices: true, portal: true } });
    if (!options.unpublished) assert.ok(!f.calls.some(([name]) => name === "agreement"));
  }
});

test("version checks retain legacy v2 support when cohort prepayment is disabled", async () => {
  const f = fixture({ version: "ruined_membership-v2", prepaid: false });
  assert.equal((await responseBody(await f.route.GET())).ready, true);
  assert.deepEqual(f.calls.filter(([name]) => name === "agreement"), [["agreement", "ruined_membership-v2"]]);
});

const htmlRequest = () => new Request("https://members.theruinedproject.com/api/ops/billing/readiness", { headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });

async function htmlBody(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Accept");
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  const text = await response.text();
  assert.match(text, /^<!doctype html>/);
  assert.doesNotMatch(text, /PRIVATE|admin@example\.com|trusted-admin|<script|<form|<iframe|<img|\son\w+=/i);
  return text;
}

test("browser Accept renders only a script-free boolean summary after administrator authorization", async () => {
  const f = fixture();
  const response = await f.route.GET(htmlRequest());
  assert.equal(response.status, 200);
  const html = await htmlBody(response);
  assert.match(html, /Ready: <strong>true<\/strong>/);
  for (const label of ["Configuration", "Published agreement", "All six membership prices", "Commitment portal"]) {
    assert.ok(html.includes(`<li>${label}: <strong>true</strong></li>`));
  }
  assert.deepEqual(f.calls.slice(0, 3), [["viewer", undefined], ["role", "trusted-admin"], ["configuration", undefined]]);
  assert.equal(f.calls.filter(([name]) => name.startsWith("price:")).length, 6);
});

test("unauthorized HTML requests retain HTTP denial and never read provider settings", async () => {
  for (const [options, status, message, expectedCalls] of [
    [{ signedOut: true }, 401, "Sign in required.", ["viewer"]],
    [{ role: "guide" }, 403, "Administrator access required.", ["viewer", "role"]],
    [{ failures: ["role"] }, 503, "Billing readiness could not be checked.", ["viewer", "role"]],
  ]) {
    const f = fixture(options);
    const response = await f.route.GET(htmlRequest());
    assert.equal(response.status, status);
    const html = await htmlBody(response);
    assert.ok(html.includes(message));
    assert.match(html, /Ready: <strong>false<\/strong>/);
    assert.doesNotMatch(html, /<ul>/);
    assert.deepEqual(f.calls.map(([name]) => name), expectedCalls);
    assert.deepEqual(f.logs, []);
  }
});

test("HTML provider failures show failed booleans without provider objects or error details", async () => {
  const f = fixture({ failures: ["price:couple_annual", "portal"] });
  const response = await f.route.GET(htmlRequest());
  assert.equal(response.status, 200);
  const html = await htmlBody(response);
  assert.match(html, /Ready: <strong>false<\/strong>/);
  assert.match(html, /All six membership prices: <strong>false<\/strong>/);
  assert.match(html, /Commitment portal: <strong>false<\/strong>/);
  assert.deepEqual(f.logs, []);
});

test("API Accept values keep the existing JSON shape and status", async () => {
  for (const accept of ["application/json", "*/*"]) {
    const f = fixture();
    const response = await f.route.GET(new Request("https://members.theruinedproject.com/api/ops/billing/readiness", { headers: { accept } }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await responseBody(response), { ready: true, checks: { configuration: true, agreement: true, prices: true, portal: true } });
  }
});
