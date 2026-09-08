import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const adminId = "11111111-1111-4111-8111-111111111111";
const circleId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const repositorySource = readFileSync(new URL("../src/lib/platform/ops-repository.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(repositorySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ allowed = true, rows = [] } = {}) {
  const queries = [];
  let transactions = 0;
  let connections = 0;
  const sql = async (parts, ...parameters) => {
    const statement = parts.join("?").trim();
    queries.push({ statement, parameters });
    assert.match(statement, /^select\s/i);
    assert.doesNotMatch(statement, /\b(insert|update|delete|alter|grant|truncate)\b/i);
    if (statement.includes("from platform_users platform_user")) {
      assert.deepEqual(parameters, [adminId]);
      assert.match(statement, /platform_user\.auth_user_id = \?::uuid/);
      assert.match(statement, /platform_user\.status = 'active'/);
      assert.match(statement, /grant_row\.role_slug = 'ops_admin'/);
      assert.match(statement, /grant_row\.revoked_at is null/);
      assert.doesNotMatch(statement, /user_metadata|app_metadata/);
      return allowed ? [{ auth_user_id: adminId }] : [];
    }
    assert.equal(queries.length, 2, "authorization must finish before any roster is read");
    assert.equal(allowed, true);
    assert.deepEqual(parameters, []);
    assert.match(statement, /from circle_member_assignments assignment/);
    assert.match(statement, /assignment\.circle_id/);
    assert.match(statement, /assignment\.member_id/);
    assert.match(statement, /assignment\.id::text as assignment_id/);
    assert.match(statement, /where assignment\.ended_at is null\s+order by assignment\.circle_id, assignment\.assigned_at, assignment\.id$/);
    assert.doesNotMatch(statement, /\blimit\b|\boffset\b|circle\.name|dashboard|member_private_profiles|profile_json|user_metadata/i);
    assert.match(statement, /left join member_lifecycle lifecycle on lifecycle\.member_id = member\.id/);
    assert.match(statement, /left join person_profiles person_profile on person_profile\.person_id = member\.person_id/);
    assert.match(statement, /left join platform_users platform_user on platform_user\.person_id = member\.person_id/);
    return rows;
  };
  sql.begin = async (mode, callback) => {
    transactions++;
    assert.equal(mode, "isolation level repeatable read read only");
    return callback(sql);
  };
  const noSideEffect = () => { throw new Error("Unexpected write/provider/identity action in roster reader"); };
  const dependencies = {
    "server-only": {},
    "node:crypto": { randomUUID: noSideEffect },
    "@/lib/identity/repository": { ensurePersonForEmail: noSideEffect },
    "@/lib/platform/calendar-audience-invalidation": {
      markCalendarAudiencesPendingForBlock: noSideEffect,
      markCalendarAudiencesPendingForCircle: noSideEffect,
    },
    "@/lib/stripe/database": { getBillingDatabase: () => { connections++; return sql; } },
    "@/lib/stripe/membership-state": {},
  };
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return {
    read: cjsModule.exports.getOpsCircleMemberAssignments,
    queries,
    counts: () => ({ connections, transactions }),
  };
}

const assignment = {
  account_state: "active",
  assigned_at: new Date("2026-09-08T12:00:00.000Z"),
  assignment_id: "9007199254740993",
  billing_state: "active",
  circle_id: circleId,
  email: "member@example.test",
  member_id: memberId,
  name: "Example Member",
  program_state: "onboarding",
};

test("Circle roster reads authorize active Administrator access in a read-only snapshot before selecting member data", async () => {
  const reader = fixture({ rows: [assignment] });
  assert.deepEqual(await reader.read(adminId), [{
    accountState: "active",
    assignedAt: "2026-09-08T12:00:00.000Z",
    assignmentId: "9007199254740993",
    billingState: "active",
    circleId,
    email: "member@example.test",
    memberId,
    name: "Example Member",
    programState: "onboarding",
  }]);
  assert.deepEqual(reader.counts(), { connections: 1, transactions: 1 });
  assert.equal(reader.queries.length, 2);
});

test("complete Circle rosters retain assignments beyond the dashboard's first 100 members", async () => {
  const rows = Array.from({ length: 135 }, (_, index) => ({
    ...assignment,
    assignment_id: String(index + 1),
    circle_id: `22222222-2222-4222-8222-${String(Math.floor(index / 10) + 1).padStart(12, "0")}`,
    member_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    // Shared names must never merge records or infer a Circle.
    name: "Same Name",
  }));
  const reader = fixture({ rows });
  const result = await reader.read(adminId);
  assert.equal(result.length, 135);
  assert.equal(new Set(result.map((member) => member.assignmentId)).size, 135);
  assert.equal(new Set(result.map((member) => member.memberId)).size, 135);
  assert.equal(new Set(result.map((member) => member.circleId)).size, 14);
  assert.equal(result.at(-1).memberId, rows.at(-1).member_id);
});

test("occupied seats stay visible for inactive billing, suspended accounts, and missing legacy lifecycle rows", async () => {
  const rows = [
    { ...assignment, account_state: "suspended", billing_state: "ended", program_state: "withdrawn" },
    { ...assignment, assignment_id: "2", account_state: null, billing_state: null, program_state: null, assigned_at: "2026-09-08T13:00:00+01:00" },
  ];
  const result = await fixture({ rows }).read(adminId);
  assert.equal(result.length, 2);
  assert.equal(result[0].accountState, "suspended");
  assert.equal(result[0].billingState, "ended");
  assert.equal(result[0].programState, "withdrawn");
  assert.equal(result[1].accountState, null, "missing lifecycle data is not presented as an active account");
  assert.equal(result[1].assignedAt, "2026-09-08T12:00:00.000Z");
});

test("missing active Administrator authority denies the roster before any membership query", async () => {
  const reader = fixture({ allowed: false });
  await assert.rejects(reader.read(adminId), (error) => error.code === "forbidden");
  assert.equal(reader.queries.length, 1);
});

test("invalid operator IDs fail before opening a database connection, and an empty roster stays empty", async () => {
  for (const actorId of ["", "invalid", "' or true --"]) {
    const reader = fixture();
    await assert.rejects(reader.read(actorId), (error) => error.code === "invalid_request");
    assert.equal(reader.queries.length, 0);
    assert.deepEqual(reader.counts(), { connections: 0, transactions: 0 });
  }
  assert.deepEqual(await fixture().read(adminId), []);
});
