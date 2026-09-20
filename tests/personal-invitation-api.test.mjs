import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const invitation = await load("src/lib/membership/invitation-model.ts");
const model = await load("src/lib/membership/personal-invitation-model.ts", { "./invitation-model": invitation });
const id = "11111111-1111-4111-8111-111111111111";
const input = { recipientName: "Alex", recipientEmail: "alex@example.test", requestId: id, sendEmail: true };
async function fixture() {
  const state = { viewer: { authUserId: "owner-id" }, trusted: true, mode: "connected", ready: true };
  const calls = [], jobs = [];
  const snapshot = { invitations: [], counts: { created: 0 } };
  const repository = Object.fromEntries(["getOwnPersonalInvitations", "createOwnPersonalInvitation", "revokeOwnPersonalInvitation", "retryOwnPersonalInvitationEmail"].map(name => [name, async (...args) => { calls.push({ name, args }); return snapshot; }]));
  const api = await load("src/lib/membership/personal-invitation-api.ts", {
    "next/server": { after: job => jobs.push(job), NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => state.trusted },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => state.viewer },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: state.mode }) },
    "./invitation-model": invitation,
    "./personal-invitation-model": model,
    "./personal-invitation-repository": repository,
    "./personal-invitation-delivery": { getPersonalInvitationEmailReady: () => state.ready, processPersonalInvitationEmailBatch: async (...args) => { calls.push({ name: "send", args }); } },
  });
  const request = (method = "GET", body = input) => new Request("https://members.example.test/api/my/invitations", {
    method, ...(method !== "GET" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  return { ...api, state, calls, jobs, request };
}

test("personal invitation owner routes require sign-in, trusted writes and connected mode", async () => {
  const f = await fixture();
  f.state.viewer = null;
  assert.equal((await f.handlePersonalInvitationRequest(f.request())).status, 401);
  f.state.viewer = { authUserId: "owner-id" }; f.state.trusted = false;
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST"))).status, 403);
  f.state.trusted = true; f.state.mode = "preview";
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST"))).status, 503);
  assert.equal(f.calls.length, 0); assert.equal(f.jobs.length, 0);
});

test("owner history is private and exposes only a boolean email readiness value", async () => {
  const f = await fixture();
  const response = await f.handlePersonalInvitationRequest(f.request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(await response.json(), { snapshot: { invitations: [], counts: { created: 0 }, emailReady: true } });
  assert.equal(f.jobs.length, 0);
});

test("email requests queue delivery only after valid persisted creation; copy-only invitations never send", async () => {
  const f = await fixture();
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST", { ...input, sendEmail: false }))).status, 201);
  assert.equal(f.jobs.length, 0);
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST"))).status, 201);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.calls.filter(call => call.name === "send").length, 0, "after response job has not sent yet");
  await f.jobs[0]();
  assert.deepEqual(f.calls.at(-1), { name: "send", args: [4, { invitationId: undefined }] });
});

test("bad input and unavailable provider do not create or send an invitation", async () => {
  const f = await fixture();
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST", { ...input, recipientEmail: "broken" }))).status, 400);
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST", { ...input, extra: "ignored?" }))).status, 400);
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST", { ...input, recipientName: "a".repeat(2000) }))).status, 413);
  f.state.ready = false;
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST"))).status, 503);
  assert.equal(f.calls.length, 0); assert.equal(f.jobs.length, 0);
  assert.equal((await f.handlePersonalInvitationRequest(f.request("POST", { ...input, sendEmail: false }))).status, 201);
});

test("revocation never sends and a requested retry targets only the selected invitation", async () => {
  const f = await fixture();
  assert.equal((await f.handlePersonalInvitationRequest(f.request("PATCH", { action: "revoke", version: 1 }), id)).status, 200);
  assert.equal(f.jobs.length, 0);
  assert.equal((await f.handlePersonalInvitationRequest(f.request("PATCH", { action: "retry_email", version: 1 }), id)).status, 200);
  assert.equal(f.jobs.length, 1);
  await f.jobs[0]();
  assert.deepEqual(f.calls.at(-1), { name: "send", args: [1, { invitationId: id }] });
  assert.equal((await f.handlePersonalInvitationRequest(f.request("PATCH", { action: "email_everyone", version: 1 }), id)).status, 400);
});
