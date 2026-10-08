import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, deps, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((name) => {
    if (name in deps) return deps[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const content = { subject: "A considered update", preheader: "What comes next.", body: "Hello,\n\nHere are the confirmed details.\n\nRuined" };
function completion(draft = content) {
  return { status: "completed", output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(draft) }] }] };
}
async function fixture(response = completion()) {
  const calls = [];
  const ai = await load("src/lib/communications/admin-email-ai.ts", {
    "server-only": {},
    "@/lib/communications/admin-email-config": { getAdminEmailDeliveryConfiguration: () => ({ ready: true, marketingReady: true, missing: [], marketingMissing: [] }) },
  }, {
    process: { env: { OPENAI_API_KEY: "test-only", OPENAI_EMAIL_MODEL: "fixture-model", RESEND_MARKETING_ENABLED: "true", RESEND_TOPIC_UPDATES_ID: "topic" } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : Response.json(response);
    },
  });
  return { ai, calls };
}

test("draft generation uses a bounded structured Responses request with no recipients or sending tools", async () => {
  const { ai, calls } = await fixture();
  const input = ai.validateGenerationInput({ prompt: "Shorten this.", currentDraft: { ...content, recipients: ["private@example.com"] }, recipients: ["secret@example.com"] });
  assert.deepEqual(await ai.generateAdminEmail(input), content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.model, "fixture-model");
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.tools, undefined);
  assert.equal(request.max_output_tokens, 4500);
  assert.equal(request.input.includes("@example.com"), false);
  assert.deepEqual(JSON.parse(request.input).currentDraft, content);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("generation refuses invalid, incomplete, oversized and header-injection outputs", async () => {
  const outputs = [
    { ...completion(), status: "incomplete" },
    completion({ ...content, subject: "Hello\r\nBcc: victim@example.com" }),
    completion({ ...content, body: "x".repeat(12001) }),
    completion({ ...content, preheader: null }),
    completion({ ...content, body: "" }),
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] },
  ];
  for (const output of outputs) {
    const { ai } = await fixture(output);
    await assert.rejects(ai.generateAdminEmail({ prompt: "Draft a note" }), { status: 502 });
  }
});

test("refusal and provider failures return safe errors without exposing provider response", async () => {
  const { ai } = await fixture({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "provider detail" }] }] });
  await assert.rejects(ai.generateAdminEmail({ prompt: "Draft a note" }), { status: 422 });
  for (const response of [new Error("secret_key"), new Response("secret_key", { status: 401 }), new Response("secret_key", { status: 429 })]) {
    const { ai: failed } = await fixture(response);
    await assert.rejects(failed.generateAdminEmail({ prompt: "Draft a note" }), (error) => error.status === 503 && !error.message.includes("secret_key"));
  }
});

test("generation rejects oversized prompts and current draft before any provider call", async () => {
  const { ai, calls } = await fixture();
  for (const input of [null, {}, { prompt: "" }, { prompt: "x".repeat(6001) }, { prompt: "revise", currentDraft: { ...content, body: "x".repeat(12001) } }]) {
    assert.throws(() => ai.validateGenerationInput(input), { status: 400 });
  }
  assert.equal(calls.length, 0);
});

test("generation API authorizes before parsing or calling model and enforces the database allowance", async () => {
  for (const mode of ["denied", "limited", "allowed"]) {
    const calls = [];
    const denied = new Response("Denied", { status: 403 });
    const { ai } = await fixture();
    const route = await load("app/api/ops/emails/generate/route.ts", {
      "@/lib/communications/admin-email-ai": { ...ai, generateAdminEmail: async () => { calls.push("generate"); return content; } },
      "@/lib/communications/admin-email-api": {
        requireAdminEmailMutation: async () => { calls.push("authorize"); return mode === "denied" ? { response: denied } : { viewer: { authUserId: "admin" } }; },
        readAdminEmailJson: async () => { calls.push("read"); return { prompt: "Write a note" }; },
        adminEmailErrorResponse: () => Response.json({ error: "failed" }, { status: 503 }),
      },
      "@/lib/communications/admin-email-repository": { consumeAdminEmailGeneration: async () => { calls.push("allowance"); return mode !== "limited"; } },
      "@/lib/platform/ops-api": { opsJson: (body, status = 200) => Response.json(body, { status }) },
    }, { process: { env: { OPENAI_API_KEY: "test-only" } } });
    const result = await route.POST(new Request("https://example.com", { method: "POST" }));
    assert.equal(result.status, mode === "denied" ? 403 : mode === "limited" ? 429 : 200);
    assert.deepEqual(calls, mode === "denied" ? ["authorize"] : mode === "limited" ? ["authorize", "read", "allowance"] : ["authorize", "read", "allowance", "generate"]);
  }
});

test("JSON reader enforces actual stream byte count when Content-Length is absent", async () => {
  const { ai } = await fixture();
  const api = await load("src/lib/communications/admin-email-api.ts", {
    "server-only": {},
    "@/lib/communications/admin-email-ai": ai,
    "@/lib/communications/admin-email-model": {},
    "@/lib/communications/admin-email-repository": {},
    "@/lib/platform/ops-api": {},
    "@/lib/platform/ops-operating-repository": {},
  });
  await assert.rejects(api.readAdminEmailJson(new Request("https://example.com", { method: "POST", body: JSON.stringify({ body: "é".repeat(33000) }) })), { status: 413 });
  await assert.rejects(api.readAdminEmailJson(new Request("https://example.com", { method: "POST", body: "[]" })), { status: 400 });
  assert.deepEqual(await api.readAdminEmailJson(new Request("https://example.com", { method: "POST", body: '{"subject":"Hi"}' })), { subject: "Hi" });
});


test("repository errors preserve forbidden, invalid-input and stale-review status codes", async () => {
  const { ai } = await fixture();
  const model = await load("src/lib/communications/admin-email-model.ts", {});
  const api = await load("src/lib/communications/admin-email-api.ts", {
    "server-only": {},
    "@/lib/communications/admin-email-ai": ai,
    "@/lib/communications/admin-email-model": model,
    "@/lib/communications/admin-email-repository": {},
    "@/lib/platform/ops-api": { opsJson: (body, status) => Response.json(body, { status }) },
    "@/lib/platform/ops-operating-repository": {},
  });
  for (const status of [400, 403, 404, 409, 429]) {
    const response = api.adminEmailErrorResponse(new model.AdminEmailError(status, "Safe error"));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, "Safe error");
  }
});

test("unsubscribe allows token-authorized one-click POST, but never changes state for an oversized request", async () => {
  const tokens = [];
  const route = await load("app/api/communications/unsubscribe/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options), redirect: (url, options) => new Response(null, { ...options, headers: { ...options.headers, location: url.toString() } }) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: request => request.headers.get("origin") === "https://example.com" },
    "@/lib/communications/admin-email-repository": { unsubscribeAdminEmail: async token => { tokens.push(token); return true; } },
  });
  const token = "x".repeat(43);
  const request = (body, origin) => new Request(`https://example.com/api/communications/unsubscribe?token=${token}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) }, body,
  });
  assert.equal((await route.POST(request("List-Unsubscribe=One-Click"))).status, 200);
  assert.deepEqual(tokens, [token]);
  assert.equal((await route.POST(request(`token=${token}`))).status, 403);
  assert.equal((await route.POST(request(`token=${token}`, "https://example.com"))).status, 303);
  assert.equal((await route.POST(request(`token=${token}&padding=${"x".repeat(3000)}`))).status, 413);
  assert.equal(tokens.length, 2);
});
