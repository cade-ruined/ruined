import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

class PlatformAccessDeniedError extends Error {}
const ids = {
  auth: "11111111-1111-4111-8111-111111111111",
  member: "22222222-2222-4222-8222-222222222222",
  person: "33333333-3333-4333-8333-333333333333",
};

async function loadRepository(database) {
  const source = await readFile(
    new URL("../src/lib/platform/operator-member-profile.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return { randomUUID: () => ids.member };
    if (name === "@/lib/platform/repository") return { PlatformAccessDeniedError };
    if (name === "@/lib/stripe/database") return { getBillingDatabase: () => database };
    if (name === "@/lib/stripe/membership-state") {
      return {
        isPlausibleEmail: (value) => value.includes("@"),
        normalizeEmail: (value) => value.trim().toLowerCase(),
      };
    }
    throw new Error(`Unexpected dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

function fakeDatabase({ lifecycle = null, member = null, memberGrants = [] } = {}) {
  const queries = [];
  const tx = (strings) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    if (query.includes("select platform_user.email_normalized")) {
      return [{ email_normalized: "operator@example.com", member_id: null, person_id: ids.person, status: "active" }];
    }
    if (query.includes("select person.id as person_id")) return [{ person_id: ids.person }];
    if (query.includes("select revoked_at") && query.includes("platform_role_grants")) return memberGrants;
    if (query.includes("select id, person_id, email_normalized, membership_state")) return member ? [member] : [];
    if (query.includes("select account_state, billing_state")) return lifecycle ? [lifecycle] : [];
    if (query.startsWith("insert into ruined_members")) {
      return [{ id: ids.member, person_id: ids.person, email_normalized: "operator@example.com", membership_state: "pending" }];
    }
    if (query.startsWith("select auth_user_id from platform_users")) return [];
    if (query.startsWith("update platform_users")) return [{ auth_user_id: ids.auth }];
    if (query.startsWith("insert into person_profiles")) return [{ person_id: ids.person }];
    if (query.startsWith("insert into platform_role_grants")) return [{ id: "1" }];
    return [];
  };
  tx.json = (value) => value;
  return {
    queries,
    begin: async (callback) => callback(tx),
  };
}

test("a verified operator gets one entry profile while paid state remains pending", async () => {
  const database = fakeDatabase();
  const repository = await loadRepository(database);
  assert.deepEqual(
    await repository.ensureOperatorMemberProfile({ authUserId: ids.auth, email: "Operator@Example.com" }),
    { memberAccess: true },
  );
  const sql = database.queries.join("\n");
  assert.match(sql, /insert into ruined_members/);
  assert.match(sql, /insert into member_onboardings/);
  assert.match(sql, /insert into member_lifecycle/);
  assert.match(sql, /membership_state \) values \( \?::uuid, \?::uuid, \?, \?, 'pending'/);
  assert.match(sql, /user_type = 'member'/);
  assert.match(sql, /operator_member_profile\.provisioned/);
  assert.doesNotMatch(sql, /billing_state = 'active'|membership_state = 'active'/);
});

test("a closed member record is never revived by operator sign-in", async () => {
  const database = fakeDatabase({
    lifecycle: { account_state: "closed", billing_state: "ended" },
    member: { id: ids.member, person_id: ids.person, email_normalized: "operator@example.com", membership_state: "ended" },
  });
  const repository = await loadRepository(database);
  assert.deepEqual(
    await repository.ensureOperatorMemberProfile({ authUserId: ids.auth, email: "operator@example.com" }),
    { memberAccess: false },
  );
  const afterLifecycleRead = database.queries.slice(
    database.queries.findIndex((query) => query.includes("select account_state, billing_state")) + 1,
  );
  assert.equal(afterLifecycleRead.length, 0);
});

test("a revoked member grant is not silently recreated", async () => {
  const database = fakeDatabase({
    memberGrants: [{ revoked_at: new Date() }],
    member: { id: ids.member, person_id: ids.person, email_normalized: "operator@example.com", membership_state: "pending" },
  });
  const repository = await loadRepository(database);
  assert.deepEqual(
    await repository.ensureOperatorMemberProfile({ authUserId: ids.auth, email: "operator@example.com" }),
    { memberAccess: false },
  );
  assert.doesNotMatch(database.queries.join("\n"), /insert into platform_role_grants/);
});
