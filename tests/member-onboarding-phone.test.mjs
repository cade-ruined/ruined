import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { checkMemberPhoneSchema, memberPhoneMigrationUrl } from "../scripts/check-member-phone-schema.mjs";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const migration = await readFile(memberPhoneMigrationUrl, "utf8");
const runner = await readFile(new URL("../scripts/migrate-platform.mjs", import.meta.url), "utf8");

test("phone fix is a new bounded atomic migration with escape-independent E.164 validation", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /set local lock_timeout = '10s'/);
  assert.match(migration, /set local statement_timeout = '60s'/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/);
  assert.ok(migration.includes("mobile_e164 ~ '^[+][1-9][0-9]{1,14}$'"));
  assert.match(migration, /validate constraint person_private_profiles_mobile_e164_check/);
  assert.doesNotMatch(migration, /update public\.|delete from|grant |disable row level security/i);
  assert.ok(runner.indexOf("20260903225243_member_phone_e164_constraint.sql") > runner.indexOf("20260903183622_support_ticketing.sql"));
});

class MembershipInputError extends Error {}
class MembershipConflictError extends Error {}
class MembershipAccessDeniedError extends Error {}

async function loadRoute(failure) {
  const logs = [];
  const source = await readFile(new URL("../app/api/my/onboarding/route.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "next/server": { NextResponse },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => true },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: "11111111-1111-4111-8111-111111111111" }) },
    "@/lib/membership/repository": {
      MembershipInputError, MembershipConflictError, MembershipAccessDeniedError,
      saveMemberOnboardingProfile: async () => { throw failure; },
    },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/workflows/worker": {},
  };
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "console", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports, { error: (...values) => logs.push(values) });
  return { ...cjsModule.exports, logs };
}

function request() {
  return new Request("https://members.example.test/api/my/onboarding", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "save_profile", apparelTopSize: "M", birthDate: "1990-01-01",
      legalName: "Test Member", preferredName: "Test", mobile: "+12025550123",
      shippingAddress: { addressLine1: "Test street", addressLine2: null, city: "Test", region: "UT", countryCode: "US", postalCode: "84004" },
    }),
  });
}

test("onboarding logs only SQLSTATE and bounded constraint metadata, never private PostgreSQL details", async () => {
  const failure = Object.assign(new Error("PRIVATE_MEMBER_MESSAGE"), {
    name: "k", code: "23514", constraint_name: "person_private_profiles_mobile_e164_check",
    detail: "PRIVATE_MEMBER_DETAIL", query: "PRIVATE_MEMBER_QUERY", parameters: ["PRIVATE_MEMBER_PARAMETERS"],
  });
  const route = await loadRoute(failure);
  const response = await route.POST(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Membership entry could not be saved." });
  assert.deepEqual(route.logs, [["Member onboarding action failed", {
    errorType: "k", sqlState: "23514", constraint: "person_private_profiles_mobile_e164_check",
  }]]);
  assert.doesNotMatch(JSON.stringify(route.logs), /PRIVATE_MEMBER/);
});

test("onboarding rejects unsafe error metadata and supports the alternative PostgreSQL constraint field", async () => {
  const unsafe = await loadRoute(Object.assign(new Error("private"), {
    name: "private email@example.test", code: "23514 private", constraint_name: "phone=+12025550123",
  }));
  await unsafe.POST(request());
  assert.deepEqual(unsafe.logs[0][1], { errorType: "UnknownError", sqlState: null, constraint: null });
  const alternative = await loadRoute({ code: "23514", constraint: "person_private_profiles_mobile_e164_check" });
  await alternative.POST(request());
  assert.equal(alternative.logs[0][1].constraint, "person_private_profiles_mobile_e164_check");
});

test("expected onboarding validation, conflict, and permission failures keep their existing response boundaries", async () => {
  for (const [Failure, status] of [[MembershipInputError, 400], [MembershipConflictError, 409], [MembershipAccessDeniedError, 403]]) {
    const route = await loadRoute(new Failure("Expected member-facing error"));
    const response = await route.POST(request());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Expected member-facing error" });
    assert.deepEqual(route.logs, []);
  }
});

test("member phone constraint accepts valid international numbers and fails safely in isolated PostgreSQL", async () => {
  const result = await checkMemberPhoneSchema(await loadPGliteForSchemaChecks());
  assert.equal(result.checks.length, 4);
});
