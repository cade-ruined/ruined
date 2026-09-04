import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const viewer = { authUserId: "11111111-1111-4111-8111-111111111111", email: "member@example.com" };
const ticketId = "22222222-2222-4222-8222-222222222222";
const requestKey = "33333333-3333-4333-8333-333333333333";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
const model = await load("src/lib/support/model.ts");

async function fixture(options = {}) {
  const calls = [];
  const queued = [];
  const repository = Object.fromEntries(["createSupportTicket", "replySupportTicket", "updateSupportTicketStatus", "retrySupportEmailDelivery", "getSupportTicket", "listSupportTickets"].map((name) => [name, async (...args) => {
    calls.push({ name, args });
    if (options.denied) throw new model.SupportError(403, "Administrator access required.");
    return { id: ticketId };
  }]));
  const api = await load("src/lib/support/api.ts", {
    "next/server": { NextResponse, after: (callback) => queued.push(callback) },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => options.trusted !== false },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => options.signedOut ? null : viewer },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: options.preview ? "preview" : "connected" }) },
    "@/lib/support/model": model,
    "@/lib/support/repository": repository,
    "@/lib/support/delivery": { processSupportEmailBatch: async () => calls.push({ name: "delivery" }) },
  });
  return { ...api, calls, queued };
}

function request(body = { category: "circle", subject: "Circle placement", message: "Can I join this Circle?" }, method = "POST", headers = {}) {
  return new Request("https://ruined.example/api/my/support", {
    method,
    headers: { "content-type": "application/json", "idempotency-key": requestKey, ...headers },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

test("help topics, statuses and content limits reject invalid or forged values", () => {
  assert.equal(model.SUPPORT_CATEGORIES.length, 8);
  for (const category of model.SUPPORT_CATEGORIES) assert.equal(model.supportCategory(category.value), category.value);
  assert.throws(() => model.supportCategory("admin"), { status: 400 });
  assert.throws(() => model.supportStatus("deleted"), { status: 400 });
  assert.throws(() => model.supportText("a".repeat(121), "Subject", 3, 120), { status: 400 });
  assert.throws(() => model.supportText("  ", "Message", 1, 5000), { status: 400 });
  assert.equal(model.supportText("  Hello there  ", "Message", 10, 5000), "Hello there");
  assert.throws(() => model.supportUuid("not-an-id"), { status: 400 });
  assert.equal(model.supportStatusLabel("waiting_on_member", true), "Waiting for member");
});

test("preview, unauthenticated and cross-origin writes cannot reach ticket repository or email", async () => {
  for (const [options, expected] of [[{ preview: true }, 503], [{ signedOut: true }, 401], [{ trusted: false }, 403]]) {
    const api = await fixture(options);
    assert.equal((await api.handleSupportRequest(request())).status, expected);
    assert.deepEqual(api.calls, []);
    assert.deepEqual(api.queued, []);
  }
});

test("creation derives identity on the server and ignores client ownership/role/recipient fields", async () => {
  const api = await fixture();
  const response = await api.handleSupportRequest(request({
    category: "billing", subject: "Payment question", message: "Please help with this payment.",
    requesterEmail: "attacker@example.com", requesterAuthUserId: ticketId, operator: true,
    to: "thirdparty@example.com", status: "resolved",
  }));
  assert.equal(response.status, 201);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(api.calls, [{ name: "createSupportTicket", args: [viewer, {
    category: "billing", subject: "Payment question", message: "Please help with this payment.", requestKey,
  }] }]);
  assert.equal(api.queued.length, 1);
  await api.queued[0]();
  assert.equal(api.calls[1].name, "delivery");
});

test("member and operator thread routes bind ownership mode on the server", async () => {
  for (const operator of [false, true]) {
    const api = await fixture();
    const response = await api.handleSupportRequest(request({ message: "A reply", operator: !operator }), { ticketId, operator });
    assert.equal(response.status, 200);
    assert.deepEqual(api.calls[0], { name: "replySupportTicket", args: [viewer, ticketId, { message: "A reply", requestKey }, operator] });
  }
  const denied = await fixture({ denied: true });
  assert.equal((await denied.handleSupportRequest(request({ message: "Attempt" }), { ticketId, operator: true })).status, 403);
  assert.equal(denied.queued.length, 0);
});

test("only operator route supports status updates and preserves exact version", async () => {
  const input = { status: "resolved", expectedUpdatedAt: "2026-09-03T18:36:00.123456Z" };
  const memberApi = await fixture();
  assert.equal((await memberApi.handleSupportRequest(request(input, "PATCH"), { ticketId })).status, 405);
  assert.deepEqual(memberApi.calls, []);
  const ops = await fixture();
  assert.equal((await ops.handleSupportRequest(request(input, "PATCH"), { ticketId, operator: true })).status, 200);
  assert.deepEqual(ops.calls[0], { name: "updateSupportTicketStatus", args: [viewer, ticketId, input] });
});

test("oversized, malformed and wrong-content-type bodies are rejected before writes", async () => {
  for (const [body, headers, status] of [["{broken", {}, 400], [[], {}, 400], ["x".repeat(32769), {}, 413], ["hello", { "content-type": "text/plain" }, 415]]) {
    const api = await fixture();
    assert.equal((await api.handleSupportRequest(request(body, "POST", headers))).status, status);
    assert.deepEqual(api.calls, []);
    assert.deepEqual(api.queued, []);
  }
});

test("email retry is operator-route-only and schedules sending only after authorized queueing", async () => {
  const input = { action: "retry_email", deliveryId: requestKey, to: "injected@example.test" };
  const memberApi = await fixture();
  assert.equal((await memberApi.handleSupportRequest(request(input, "PATCH"), { ticketId })).status, 405);
  assert.deepEqual(memberApi.calls, []);
  for (const denied of [true, false]) {
    const api = await fixture({ denied });
    assert.equal((await api.handleSupportRequest(request(input, "PATCH"), { ticketId, operator: true })).status, denied ? 403 : 200);
    assert.deepEqual(api.calls[0], { name: "retrySupportEmailDelivery", args: [viewer, ticketId, requestKey] });
    assert.equal(api.queued.length, denied ? 0 : 1);
  }
});

test("authenticated reads still use repository authorization and never schedule email", async () => {
  const api = await fixture();
  assert.equal((await api.handleSupportRequest(request(null, "GET"), { ticketId })).status, 200);
  assert.deepEqual(api.calls[0], { name: "getSupportTicket", args: [viewer, ticketId, false] });
  assert.deepEqual(api.queued, []);
});
