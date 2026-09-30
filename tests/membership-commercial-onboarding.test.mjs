import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");

test("complimentary onboarding returns a safe retriable founding-place response", async () => {
  const source = await readFile(new URL("../app/api/my/onboarding/route.ts", import.meta.url), "utf8");
  const logs = [], loaded = { exports: {} };
  class MembershipInputError extends Error {}
  class MembershipConflictError extends Error {}
  class MembershipAccessDeniedError extends Error {}
  const dependencies = {
    "next/server": { NextResponse, after: () => assert.fail("No email follow-up after failed onboarding") },
    "@/lib/membership/registration-message-delivery": { getRegistrationMessageConfiguration: () => ({ ready: false }), processRegistrationMessageBatch: () => assert.fail("No registration message work in this error fixture") },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => true },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: "verified-member" }) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/membership/repository": {
      MembershipInputError, MembershipConflictError, MembershipAccessDeniedError,
      completeMemberAdministrativeOnboarding: async () => {
        throw Object.assign(new Error("PRIVATE_DATABASE_DETAIL"), { code: "P4205" });
      },
    },
    "@/lib/workflows/worker": { processWorkflowBatch: () => assert.fail("no completion workflow after a pending admission") },
  };
  new Function("require", "module", "exports", "console", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, loaded, loaded.exports, { error: (...values) => logs.push(values) });
  const response = await loaded.exports.POST(new Request("https://members.example.test/api/my/onboarding", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete" }),
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "A founding place is temporarily reserved in another checkout. Please try again shortly.",
    code: "founding_place_pending",
  });
  assert.deepEqual(logs, []);
});
