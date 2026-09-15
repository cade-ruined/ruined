import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const model = await load("src/lib/events/byob-registration-model.ts");
const input = (config = model.BYOB_03_REGISTRATION) => ({
  firstName: " Casey ", lastName: " Example ", email: "CASEY@EXAMPLE.TEST",
  instagramHandle: "@Casey", waiverAccepted: true, waiverVersion: config.waiverVersion,
});

test("Nº.03 has an independent exact waiver identity and preserves the Nº.02 configuration", () => {
  const config02 = model.getByobRegistrationConfig("byob-02");
  const config03 = model.getByobRegistrationConfig("byob-03");
  assert.equal(config02, model.BYOB_02_REGISTRATION);
  assert.equal(config03, model.BYOB_03_REGISTRATION);
  assert.equal(model.getByobRegistrationConfig("byob-04"), null);
  assert.equal(model.getByobRegistrationConfig("../byob-02"), null);
  assert.equal(config02.waiverVersion, "byob-02-risk-acknowledgment-v3");
  assert.equal(config02.waiverSha256, "da7a7bdc16508e8159ae431517c14e724de2f6a2388d3eb32482dc56c61006bd");
  assert.equal(config03.waiverVersion, "byob-03-risk-acknowledgment-v1");
  assert.equal(config03.waiverBody, config02.waiverBody.replace("BYOB Nº 02", "BYOB Nº 03"));
  assert.notEqual(config03.waiverSha256, config02.waiverSha256);
  for (const config of [config02, config03]) {
    assert.equal(createHash("sha256").update(config.waiverBody).digest("hex"), config.waiverSha256);
    assert.equal(config.registrationPath, `/community/${config.eventKey}/register`);
    assert.equal(config.apiPath, `/api/events/${config.eventKey}/register`);
    assert.equal(Object.isFrozen(config), true);
  }
  assert.equal(config02.syncToSheet, true);
  assert.equal(config02.showTankOffer, true);
  assert.equal(config03.syncToSheet, true);
  assert.equal(config03.showTankOffer, false);
});

test("each event accepts only its own waiver while preserving individual participant validation", () => {
  for (const config of [model.BYOB_02_REGISTRATION, model.BYOB_03_REGISTRATION]) {
    const value = input(config);
    const result = model.parseByobRegistrationInput(value, config);
    assert.deepEqual(result, {
      emailNormalized: "casey@example.test", instagramHandle: "casey",
      registrantFirstName: "Casey", registrantLastName: "Example", registrantName: "Casey Example",
      waiverVersion: config.waiverVersion,
    });
    const other = config === model.BYOB_02_REGISTRATION ? model.BYOB_03_REGISTRATION : model.BYOB_02_REGISTRATION;
    for (const invalid of [
      { ...value, waiverVersion: other.waiverVersion },
      { ...value, waiverVersion: "unknown" },
      { ...value, waiverAccepted: false },
      { ...value, firstName: "" },
      { ...value, lastName: "" },
      { ...value, guestNames: [] },
      { ...value, bringingGuests: false },
    ]) assert.equal(model.parseByobRegistrationInput(invalid, config), null);
  }
  assert.deepEqual(model.parseByob02RegistrationInput(input(model.BYOB_02_REGISTRATION)), model.parseByobRegistrationInput(input(model.BYOB_02_REGISTRATION), model.BYOB_02_REGISTRATION));
  assert.equal(model.parseByob02RegistrationInput(input()), null);
});

class CommunityEventRegistrationClosedError extends Error {
  constructor() { super("Registration is closed for this event."); this.name = "CommunityEventRegistrationClosedError"; }
}

async function routeFixture(t) {
  const previous = { DATABASE_URL: process.env.DATABASE_URL, COMMUNICATION_RATE_LIMIT_SECRET: process.env.COMMUNICATION_RATE_LIMIT_SECRET };
  // These values only enable request guards. Persistence and Sheets are mocked;
  // this fixture cannot open either an application or provider connection.
  process.env.DATABASE_URL = "postgresql://isolated.invalid/test";
  process.env.COMMUNICATION_RATE_LIMIT_SECRET = "local-byob03-test-secret";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls = { registrations: [], rateLimits: [], deferred: [], sheets: [] };
  const state = { allowed: true, error: null };
  const repository = {
    consumeByobRegistrationRateLimit: async (...args) => { calls.rateLimits.push(args); return state.allowed; },
    registerByobParticipant: async (...args) => {
      if (state.error) throw state.error;
      calls.registrations.push(args);
    },
  };
  const handler = await load("src/lib/events/byob-registration-handler.ts", {
    "node:crypto": { createHmac },
    "next/server": {
      after: (callback) => calls.deferred.push(callback),
      NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) },
    },
    "@/lib/auth/request": { isTrustedPlatformOrigin: (request) => request.headers.get("origin") === "https://theruinedproject.com" },
    "@/lib/events/byob-registration-model": model,
    "@/lib/events/byob-registration-repository": repository,
    "@/lib/events/registration-sheet-sync": { processRegistrationSheetOutboxBatch: async (...args) => calls.sheets.push(args) },
    "@/lib/events/community-event-repository": { CommunityEventRegistrationClosedError },
  });
  const routes = {};
  for (const eventKey of ["byob-02", "byob-03"]) {
    routes[eventKey] = await load(`app/api/events/${eventKey}/register/route.ts`, {
      "@/lib/events/byob-registration-model": model,
      "@/lib/events/byob-registration-handler": handler,
    });
  }
  const request = (body = input(), overrides = {}) => new Request("https://theruinedproject.com/api/events/byob-03/register", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://theruinedproject.com", "x-forwarded-for": "192.0.2.10", ...overrides.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { calls, state, routes, request };
}

test("fixed route configuration ignores submitted event keys and both events schedule shared Sheets work with independent offers", async (t) => {
  const f = await routeFixture(t);
  const response03 = await f.routes["byob-03"].POST(f.request({ ...input(), eventKey: "byob-02", eventId: "byob-02" }));
  assert.equal(response03.status, 200);
  assert.equal(response03.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response03.json(), { ok: true });
  assert.equal(f.calls.registrations.length, 1);
  assert.equal(f.calls.registrations[0][1], model.BYOB_03_REGISTRATION);
  assert.equal(f.calls.registrations[0][0].waiverVersion, model.BYOB_03_WAIVER_VERSION);
  assert.equal("eventKey" in f.calls.registrations[0][0], false);
  assert.equal(f.calls.rateLimits[0][1], "byob-03");
  assert.equal(f.calls.deferred.length, 1);
  assert.equal(f.calls.sheets.length, 0);
  await f.calls.deferred[0]();
  assert.deepEqual(f.calls.sheets, [[3]]);
  const response02 = await f.routes["byob-02"].POST(f.request(input(model.BYOB_02_REGISTRATION)));
  assert.equal(response02.status, 200);
  assert.deepEqual(await response02.json(), { ok: true, tankHref: model.BYOB_02_TANK_HREF });
  assert.equal(f.calls.registrations[1][1], model.BYOB_02_REGISTRATION);
  assert.equal(f.calls.rateLimits[1][1], "byob-02");
  assert.notEqual(f.calls.rateLimits[0][0], f.calls.rateLimits[1][0], "request fingerprints include the event domain");
  assert.equal(f.calls.deferred.length, 2);
  await f.calls.deferred[1]();
  assert.deepEqual(f.calls.sheets, [[3], [3]]);
});

test("Nº.03 retains origin, JSON, size, honeypot and cross-event waiver guards before persistence", async (t) => {
  const f = await routeFixture(t);
  for (const [body, overrides, status] of [
    [input(), { headers: { origin: "https://attacker.example" } }, 403],
    [input(), { headers: { "content-type": "text/plain" } }, 415],
    ["invalid JSON", {}, 400],
    [[], {}, 400],
    [input(model.BYOB_02_REGISTRATION), {}, 400],
    [input(), { headers: { "content-length": "16385" } }, 413],
    ["x".repeat(16385), {}, 413],
  ]) {
    const response = await f.routes["byob-03"].POST(f.request(body, overrides));
    assert.equal(response.status, status);
  }
  const honeypot = await f.routes["byob-03"].POST(f.request({ ...input(), company: "bot" }));
  assert.equal(honeypot.status, 200);
  assert.deepEqual(await honeypot.json(), { ok: true });
  assert.equal(f.calls.registrations.length, 0);
  assert.equal(f.calls.rateLimits.length, 0);
  assert.equal(f.calls.deferred.length, 0);
});

test("Nº.03 rate limits and closed-listing errors remain actionable without exposing server errors", async (t) => {
  const f = await routeFixture(t);
  f.state.allowed = false;
  const limited = await f.routes["byob-03"].POST(f.request());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "3600");
  f.state.allowed = true;
  f.state.error = new CommunityEventRegistrationClosedError();
  const closed = await f.routes["byob-03"].POST(f.request());
  assert.equal(closed.status, 409);
  assert.deepEqual(await closed.json(), { error: "Registration is closed for this event." });
  t.mock.method(console, "error", () => {});
  f.state.error = new Error("Private database connection details");
  const failed = await f.routes["byob-03"].POST(f.request());
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Registration is temporarily unavailable" });
  assert.equal(f.calls.registrations.length, 0);
  assert.equal(f.calls.deferred.length, 0);
  delete process.env.DATABASE_URL;
  assert.equal((await f.routes["byob-03"].POST(f.request())).status, 503);
});
