import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const ORIGIN = "https://members.theruinedproject.com";
const actor = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const reviewId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";

function fixture() {
  const state = { viewer: { authUserId: actor }, failure: null };
  const calls = { search: [], review: [], send: [], deliveries: 0, errors: [] };
  const dependencies = {
    "server-only": {},
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => state.viewer },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: class extends Error {} },
  };
  const cache = new Map();
  function load(path) {
    const absolute = resolve(root, path);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const output = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", "process", "console", "fetch", output)(name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith(".")) return load(`${resolve(dirname(absolute), name)}.ts`);
      assert.equal(name, "next/server", `Unexpected route dependency: ${name}`);
      return nativeRequire(name);
    }, mod, mod.exports, { env: { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: ORIGIN } },
    { error: (...args) => calls.errors.push(args) }, () => assert.fail("API boundary tests must not make network requests"));
    return mod.exports;
  }
  const { MemberSmsOneOffError } = load("src/lib/communications/member-sms-one-off-model.ts");
  dependencies["@/lib/communications/member-sms-one-off"] = {
    async searchMemberSmsOneOffRecipients(receivedActor, query) {
      calls.search.push({ actor: receivedActor, query });
      if (state.failure) throw state.failure;
      return { recipients: [], hasMore: false, configuration: { enabled: true, ready: true, issues: [] } };
    },
    async reviewMemberSmsOneOff(receivedActor, value) {
      calls.review.push({ actor: receivedActor, value });
      if (state.failure) throw state.failure;
      return { review: { id: reviewId, body: "Ruined: Reviewed text", status: "reviewed" }, configuration: { enabled: true, ready: true, issues: [] } };
    },
    async sendMemberSmsOneOff(receivedActor, value) {
      calls.send.push({ actor: receivedActor, value });
      if (state.failure) throw state.failure;
      // The service owns this validation; the route must preserve the client's
      // explicit choice instead of adding an acknowledgement on their behalf.
      if (value?.confirm !== true || value?.reviewId !== reviewId) throw new MemberSmsOneOffError(400, "Confirm this exact reviewed text before sending.");
      calls.deliveries++;
      return { reviewId, status: "accepted", attemptId: "attempt", message: "Accepted by provider", deliveryStatus: null };
    },
  };
  return { state, calls, MemberSmsOneOffError,
    search: load("app/api/ops/messages/texts/one-off/recipients/route.ts"),
    review: load("app/api/ops/messages/texts/one-off/review/route.ts"),
    send: load("app/api/ops/messages/texts/one-off/send/route.ts"),
  };
}

function mutation(path, body, headers = {}) {
  return new Request(`${ORIGIN}/api/ops/messages/texts/one-off/${path}`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const reviewBody = { memberId, message: "Your call details have been updated.", requestId };
const sendBody = { reviewId, confirm: true };

async function expectNoStore(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("cache-control"), /no-store/);
  return response.json();
}

test("one-off mutation routes enforce sign-in, origin and JSON before reaching the service", async () => {
  const f = fixture();
  for (const [path, route, payload] of [["review", f.review, reviewBody], ["send", f.send, sendBody]]) {
    f.state.viewer = null;
    assert.equal((await expectNoStore(await route.POST(mutation(path, payload)), 401)).sendStarted, false);
    f.state.viewer = { authUserId: actor };
    assert.equal((await expectNoStore(await route.POST(mutation(path, payload, { Origin: "https://outside.example" })), 403)).sendStarted, false);
    assert.equal((await expectNoStore(await route.POST(mutation(path, payload, { "Content-Type": "text/plain" })), 415)).sendStarted, false);
    const missingOrigin = mutation(path, payload); missingOrigin.headers.delete("origin");
    assert.equal((await expectNoStore(await route.POST(missingOrigin), 403)).sendStarted, false);
  }
  assert.equal(f.calls.review.length, 0); assert.equal(f.calls.send.length, 0); assert.equal(f.calls.deliveries, 0);
});

test("review is a separate no-send request and final send forwards only the explicit reviewed payload", async () => {
  const f = fixture();
  const prepared = await expectNoStore(await f.review.POST(mutation("review", reviewBody)), 200);
  assert.equal(prepared.review.id, reviewId);
  assert.deepEqual(f.calls.review, [{ actor, value: reviewBody }]);
  assert.equal(f.calls.send.length, 0); assert.equal(f.calls.deliveries, 0);

  const declined = { reviewId, confirm: false };
  assert.equal((await expectNoStore(await f.send.POST(mutation("send", declined)), 400)).sendStarted, false);
  assert.deepEqual(f.calls.send[0], { actor, value: declined });
  assert.equal(f.calls.deliveries, 0);
  const sent = await expectNoStore(await f.send.POST(mutation("send", sendBody)), 200);
  assert.equal(sent.status, "accepted");
  assert.deepEqual(f.calls.send[1], { actor, value: sendBody });
  assert.equal(f.calls.deliveries, 1);
  assert.equal(f.send.GET, undefined); assert.equal(f.review.GET, undefined);
});

test("JSON reader bounds actual request bytes, including streamed requests without Content-Length", async () => {
  const f = fixture();
  const declared = await expectNoStore(await f.review.POST(mutation("review", reviewBody, { "Content-Length": "4097" })), 413);
  assert.equal(declared.sendStarted, false);

  const utf8 = mutation("review", { ...reviewBody, message: "😀".repeat(1100) });
  assert.equal(utf8.headers.get("content-length"), null);
  assert.equal((await expectNoStore(await f.review.POST(utf8), 413)).sendStarted, false, "bytes, not JS string length, bound the body");

  let cancelled = false;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(" ".repeat(3000)));
    controller.enqueue(new TextEncoder().encode(" ".repeat(2000)));
    controller.enqueue(new TextEncoder().encode("{}"));
    controller.close();
  }, cancel() { cancelled = true; } });
  const chunked = new Request(`${ORIGIN}/api/ops/messages/texts/one-off/review`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: stream, duplex: "half",
  });
  assert.equal(chunked.headers.get("content-length"), null);
  assert.equal((await expectNoStore(await f.review.POST(chunked), 413)).sendStarted, false);
  assert.equal(cancelled, true);
  assert.equal(f.calls.review.length, 0);

  const json = JSON.stringify(reviewBody);
  const exactlyAtLimit = json + " ".repeat(4096 - new TextEncoder().encode(json).byteLength);
  await expectNoStore(await f.review.POST(mutation("review", exactlyAtLimit)), 200);
  assert.deepEqual(f.calls.review[0].value, reviewBody);
  assert.equal(f.calls.deliveries, 0);
});

test("malformed JSON and known preclaim errors say sending did not start; unknown failures do not make that claim", async () => {
  const f = fixture();
  assert.equal((await expectNoStore(await f.send.POST(mutation("send", "{bad json")), 400)).sendStarted, false);
  assert.equal(f.calls.send.length, 0);
  for (const status of [403, 404, 409, 429, 503]) {
    f.state.failure = new f.MemberSmsOneOffError(status, "Safe preclaim explanation.");
    const body = await expectNoStore(await f.send.POST(mutation("send", sendBody)), status);
    assert.equal(body.sendStarted, false); assert.equal(body.error, "Safe preclaim explanation.");
  }
  f.state.failure = new Error("private provider credential and phone must never escape");
  const unknown = await expectNoStore(await f.send.POST(mutation("send", sendBody)), 503);
  assert.equal(Object.hasOwn(unknown, "sendStarted"), false);
  assert.match(unknown.error, /Check Activity/);
  assert.doesNotMatch(JSON.stringify(unknown), /credential|phone/);
  assert.deepEqual(f.calls.errors, [["One-off text operation unavailable", { errorType: "Error" }]]);
  assert.equal(f.calls.deliveries, 0);
});

test("recipient lookup requires sign-in, validates its exact query surface, and never sends", async () => {
  const f = fixture();
  const request = query => new Request(`${ORIGIN}/api/ops/messages/texts/one-off/recipients${query}`);
  f.state.viewer = null;
  await expectNoStore(await f.search.GET(request("?q=Alex")), 401);
  f.state.viewer = { authUserId: actor };
  for (const query of ["", "?q=Alex&q=Other", "?q=Alex&send=true", "?memberId=anything"]) {
    await expectNoStore(await f.search.GET(request(query)), 400);
  }
  assert.equal(f.calls.search.length, 0);
  await expectNoStore(await f.search.GET(request("?q=Alex%20Example")), 200);
  assert.deepEqual(f.calls.search, [{ actor, query: "Alex Example" }]);
  f.state.failure = new f.MemberSmsOneOffError(403, "Administrator access is required.");
  await expectNoStore(await f.search.GET(request("?q=Alex")), 403);
  assert.equal(f.search.POST, undefined);
  assert.equal(f.calls.review.length, 0); assert.equal(f.calls.send.length, 0); assert.equal(f.calls.deliveries, 0);
});
