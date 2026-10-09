import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/membership-modal.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function load(env = {}) {
  const loaded = { exports: {} };
  new Function("module", "exports", "process", compiled)(loaded, loaded.exports, { env });
  return loaded.exports;
}
const { MEMBERSHIP_ORIGIN: origin, membershipDestination, readMembershipMessage } = load();

test("only clean member destinations can leave the preview", () => {
  for (const path of ["/my", "/my/join", "/my/activate", "/my/payment-method", "/ops", "/access", "/membership#your-invitation"]) {
    assert.equal(membershipDestination(path, origin), `${origin}${path}`);
  }
  for (const path of [null, {}, "https://evil.example/my", "//evil.example", "/my/../redirect", "/my%2fjoin", "/my\\evil", "/api/delete", "/my?email=private@example.com", "/my#token", "/membership#your-invitation#x"]) {
    assert.equal(membershipDestination(path, origin), null, String(path));
  }
});

test("messages must come from both the expected origin and this exact iframe", () => {
  const frame = {};
  const event = { origin, source: frame, data: { type: "ruined:membership:navigate", path: "/my/join" } };
  assert.deepEqual(readMembershipMessage(event, frame, origin), { type: "navigate", destination: `${origin}/my/join` });
  assert.equal(readMembershipMessage({ ...event, origin: "https://evil.example" }, frame, origin), null);
  assert.equal(readMembershipMessage({ ...event, source: {} }, frame, origin), null);
  assert.equal(readMembershipMessage(event, null, origin), null);
  assert.equal(readMembershipMessage({ ...event, data: { ...event.data, path: "//evil.example" } }, frame, origin), null);
  for (const type of ["ready", "close"]) {
    assert.deepEqual(readMembershipMessage({ ...event, data: { type: `ruined:membership:${type}` } }, frame, origin), { type });
  }
  for (const data of [null, "close", { type: "navigate", path: "/my" }]) {
    assert.equal(readMembershipMessage({ ...event, data }, frame, origin), null);
  }
});

test("production never accepts an environment override of the embedded origin", () => {
  assert.equal(load({ NODE_ENV: "production", NEXT_PUBLIC_MEMBERSHIP_EMBED_ORIGIN: "http://localhost:3301" }).getMembershipEmbedOrigin(), origin);
  assert.equal(load({ NODE_ENV: "development", NEXT_PUBLIC_MEMBERSHIP_EMBED_ORIGIN: "https://evil.example" }).getMembershipEmbedOrigin(), origin);
  assert.equal(load({ NODE_ENV: "development", NEXT_PUBLIC_MEMBERSHIP_EMBED_ORIGIN: "http://127.0.0.1:3301" }).getMembershipEmbedOrigin(), "http://127.0.0.1:3301");
});
