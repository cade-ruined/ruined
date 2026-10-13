import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

class CadenceDeliveryError extends Error {
  constructor(code, terminal = false) { super(code); this.code = code; this.terminal = terminal; }
}
const source = await readFile(new URL("../src/lib/communications/member-email-cadence-provider.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(responses = [], options = {}) {
  let now = 1_000_000;
  const requests = [], timeouts = [], actors = [];
  const loaded = { exports: {} };
  const dependencies = { "server-only": {}, "./member-email-cadence-repository": { CadenceDeliveryError },
    "./admin-email-repository": { assertAdminEmailAccess: async actor => { actors.push(actor); if (options.denyAdmin) throw new Error("Admin required"); } } };
  const fetch = async (url, request) => {
    requests.push({ url, request, at: now });
    assert.equal(request.method ?? "GET", "GET", "Provider checks must never subscribe or mutate a contact");
    assert.equal(request.cache, "no-store");
    assert.equal(request.headers.Authorization, "Bearer re_fixture_only");
    assert.ok(request.signal);
    assert.ok(responses.length, `Unexpected network request: ${url}`);
    const response = responses.shift();
    if (response.advance) now += response.advance;
    if (response.error) throw response.error;
    if (response.path) assert.equal(new URL(url).pathname + new URL(url).search, response.path);
    return new Response(response.raw ?? JSON.stringify(response.body), { status: response.status ?? 200, headers: { "content-type": "application/json" } });
  };
  const FakeDate = class extends Date { static now() { return now; } };
  new Function("require", "module", "exports", "process", "fetch", "Date", "setTimeout", "AbortSignal", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { env: options.noKey ? {} : { RESEND_API_KEY: "re_fixture_only" } }, fetch, FakeDate,
  (callback, delay) => { now += delay + (options.sleepExtra ?? 0); queueMicrotask(callback); return 1; },
  { timeout: milliseconds => { timeouts.push(milliseconds); return new AbortController().signal; } });
  return { ...loaded.exports, requests, timeouts, actors, now: () => now };
}
const page = (data = [], has_more = false) => ({ body: { data, has_more } });
const contact = (unsubscribed = false) => ({ body: { id: "contact-one", email: "member@example.test", unsubscribed } });
const recipient = (overrides = {}) => ({ memberId: "member-one", name: "Jamie", email: "member@example.test", eligible: true, reason: "Qualified", registeredAt: "2026-10-01T18:00:00Z", consentId: "1", ...overrides });
const providerError = error => error instanceof CadenceDeliveryError && ["provider_preferences_unavailable", "provider_review_limit", "delivery_budget"].includes(error.code);

test("all suppression pages are read and matching is case-insensitive before contact lookup", async () => {
  const f = fixture([{ ...page([{ id: "suppression-one", email: "someone@example.test" }], true), path: "/suppressions?limit=100" },
    { ...page([{ id: "suppression-two", email: "MEMBER@EXAMPLE.TEST" }]), path: "/suppressions?limit=100&after=suppression-one" }]);
  await assert.rejects(f.assertCadenceRecipientDeliverable("member@example.test"), error => error.code === "recipient_suppressed" && error.terminal);
  assert.equal(f.requests.length, 2);
});

test("a missing provider contact allows a qualified application recipient without creating or subscribing it", async () => {
  const f = fixture([page(), { status: 404, body: { message: "Not found" }, path: "/contacts/member%40example.test" }]);
  await f.assertCadenceRecipientDeliverable("member@example.test");
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(({ request }) => !request.body && (request.method ?? "GET") === "GET"));
});

test("global unsubscribe blocks delivery while a readable false value permits it", async () => {
  const blocked = fixture([page(), contact(true)]);
  await assert.rejects(blocked.assertCadenceRecipientDeliverable("member@example.test"), error => error.code === "recipient_suppressed" && error.terminal);
  const allowed = fixture([page(), contact(false)]);
  await allowed.assertCadenceRecipientDeliverable("member@example.test");
});

test("malformed suppression pages, records and incomplete pagination fail closed", async () => {
  const cases = [
    [{ body: null }], [{ body: {} }], [{ body: { data: [], has_more: "false" } }], [page([], true)],
    [page([null])], [page([{ id: 1, email: "someone@example.test" }])], [page([{ id: "one" }])], [page([{ id: "one", email: "" }])],
    [page([{ id: "one", email: "not-an-email" }])], [page([{ id: "one", email: "someone@example.test" }], true), page([{ id: "one", email: "someone@example.test" }])],
  ];
  for (const responses of cases) {
    const f = fixture([...responses, contact(false)]);
    await assert.rejects(f.assertCadenceRecipientDeliverable("member@example.test"), providerError, JSON.stringify(responses));
    assert.equal(f.requests.some(({ url }) => new URL(url).pathname.startsWith("/contacts/")), false);
  }
});

test("HTTP200 null or incomplete contact data never masquerades as an allowed404", async () => {
  for (const body of [null, {}, [], { unsubscribed: "false" }, { unsubscribed: 0 }]) {
    const f = fixture([page(), { body }]);
    await assert.rejects(f.assertCadenceRecipientDeliverable("member@example.test"), providerError, JSON.stringify(body));
  }
});

test("network errors, invalid JSON and non404 errors stop before delivery", async () => {
  for (const response of [{ error: new Error("private network detail") }, { status: 500, body: {} }, { status: 401, body: {} }, { raw: "not-json" }]) {
    const f = fixture([response]);
    await assert.rejects(f.assertCadenceRecipientDeliverable("member@example.test"), error => providerError(error) && !error.message.includes("private network detail"));
  }
  const f = fixture([page(), { status: 503, body: {} }]);
  await assert.rejects(f.assertCadenceRecipientDeliverable("member@example.test"), providerError);
});

test("review preserves prior exclusions and annotates suppression or unsubscribe without mutating preferences", async () => {
  const alreadyExcluded = recipient({ memberId: "excluded", email: "excluded@example.test", eligible: false, reason: "No current call access" });
  const missing = recipient({ memberId: "missing", email: "missing@example.test" });
  const suppressed = recipient({ memberId: "suppressed", email: "suppressed@example.test" });
  const f = fixture([page([{ id: "suppression-one", email: suppressed.email }]), contact(true), { status: 404, body: {} }]);
  const result = await f.reviewCadenceProviderRecipients([alreadyExcluded, recipient(), suppressed, missing]);
  assert.strictEqual(result[0], alreadyExcluded);
  assert.equal(result[1].eligible, false); assert.match(result[1].reason, /Unsubscribed or suppressed/);
  assert.equal(result[2].eligible, false); assert.strictEqual(result[3], missing);
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests.some(({ url }) => url.includes("excluded%40") || url.includes("suppressed%40")), false);
  const idle = fixture();
  const excludedOnly = [alreadyExcluded];
  assert.strictEqual(await idle.reviewCadenceProviderRecipients(excludedOnly), excludedOnly);
  assert.equal(idle.requests.length, 0);
});

test("provider calls obey request budgets, bounded abort timeouts and missing-key guards", async () => {
  const expired = fixture();
  await assert.rejects(expired.assertCadenceRecipientDeliverable("member@example.test", { deadline: expired.now() }), error => error.code === "delivery_budget");
  assert.equal(expired.requests.length, 0);
  const throttled = fixture([page()]);
  await assert.rejects(throttled.assertCadenceRecipientDeliverable("member@example.test", { deadline: throttled.now() + 500 }), error => error.code === "delivery_budget");
  assert.equal(throttled.requests.length, 1); assert.deepEqual(throttled.timeouts, [500]);
  const normal = fixture([page(), contact(false)]);
  await normal.assertCadenceRecipientDeliverable("member@example.test");
  assert.ok(normal.timeouts.every(value => value > 0 && value <= 6000));
  const unconfigured = fixture([], { noKey: true });
  await assert.rejects(unconfigured.assertCadenceRecipientDeliverable("member@example.test"), error => error.code === "provider_unconfigured");
  assert.equal(unconfigured.requests.length, 0);
});

test("template listing authorizes the administrator before reading provider metadata", async () => {
  const denied = fixture([], { denyAdmin: true });
  await assert.rejects(denied.listCadenceTemplates("not-an-admin"), /Admin required/);
  assert.equal(denied.requests.length, 0);
  const allowed = fixture([page([{ id: "published", name: "Member note", status: "published" }, { id: "draft", name: "Unfinished", status: "draft" }])]);
  assert.deepEqual(await allowed.listCadenceTemplates("admin"), [{ id: "published", name: "Member note", status: "published" }]);
  assert.deepEqual(allowed.actors, ["admin"]);
});

test("send slots share the same pacing as provider reads and respect a delayed timer deadline", async () => {
  const f = fixture([page(), contact(false), page(), contact(false)]);
  const started = f.now();
  await f.assertCadenceRecipientDeliverable("member@example.test");
  await f.reserveCadenceProviderSlot(started + 10000);
  assert.equal(f.now() - started, 1100);
  await f.assertCadenceRecipientDeliverable("member@example.test");
  assert.deepEqual(f.requests.map(request => request.at - started), [0, 550, 1650, 2200]);
  const delayed = fixture([page(), contact(false)], { sleepExtra: 1000 });
  await assert.rejects(delayed.assertCadenceRecipientDeliverable("member@example.test", { deadline: delayed.now() + 1000 }), error => error.code === "delivery_budget");
  assert.equal(delayed.requests.length, 1);
});
