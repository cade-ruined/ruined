import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

const ids = {
  action: "11111111-1111-4111-8111-111111111111",
  member: "22222222-2222-4222-8222-222222222222",
  person: "33333333-3333-4333-8333-333333333333",
  acceptance: "44444444-4444-4444-8444-444444444444",
  result: "55555555-5555-4555-8555-555555555555",
};

async function loadModule(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function setup(t, { leaseOwned = true } = {}) {
  // Use the installed driver's real JSON parameter and serializer, but never
  // execute a driver query or connect to a database/provider.
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(() => driver.end());
  const queries = [];
  const evidence = [];
  const tx = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ query, values });
    if (/^insert into (workflow_action_attempts|member_notification_events|operator_task_events)\b/.test(query)) {
      const parameters = values.filter((value) => value?.type === 3802);
      assert.equal(parameters.length, 1, "Evidence must use one explicit JSONB parameter");
      const encoded = driver.options.serializers[3802](parameters[0].value);
      const decoded = JSON.parse(encoded);
      assert.equal(typeof decoded, "object", "Evidence must reach PostgreSQL as an object, not a JSON string");
      assert.ok(decoded && !Array.isArray(decoded));
      evidence.push(decoded);
      return [];
    }
    if (query.startsWith("update workflow_actions")) return leaseOwned ? [{ id: ids.action }] : [];
    if (query.includes('acceptance.id as "acceptanceId"')) {
      return [{
        acceptanceId: ids.acceptance, acceptedAt: new Date("2026-08-26T12:00:00Z"),
        affirmativeAction: "checkbox_and_submit", agreementBody: "Fictional test agreement.",
        agreementContentSha256: "a".repeat(64), agreementKey: "ruined_membership",
        agreementTitle: "Test agreement", agreementVersion: 1,
        signerEmail: "member@example.test", signerName: "Test Member",
      }];
    }
    if (/^insert into (membership_agreement_receipts|member_notifications|operator_tasks)\b/.test(query)) {
      return [{ id: ids.result }];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  tx.json = driver.json;
  const database = { begin: async (callback) => callback(tx) };
  const receipt = await loadModule("src/lib/membership/agreement-receipt.ts", {
    "server-only": {}, "node:crypto": crypto,
  });
  const repository = await loadModule("src/lib/workflows/repository.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/membership/agreement-receipt": receipt,
    "@/lib/database/server": { getApplicationDatabase: () => database },
  });
  return { repository, queries, evidence, driver };
}

function action(actionType, payload = {}) {
  return {
    actionType, attempts: 1, domainEventId: ids.action, eventType: "membership.test",
    id: ids.action, idempotencyKey: "member-entry-test", maxAttempts: 8,
    memberId: ids.member, personId: ids.person, payload,
    targetId: ids.acceptance,
    targetType: actionType === "generate_agreement_receipt" ? "membership_agreement_acceptance" : "member",
  };
}

test("the installed PostgreSQL driver distinguishes JSON objects from pre-stringified JSON", async (t) => {
  const { driver } = await setup(t);
  const expected = { receiptId: ids.result, created: true };
  const serialize = driver.options.serializers[3802];
  assert.equal(typeof JSON.parse(serialize(JSON.stringify(expected))), "string");
  assert.deepEqual(JSON.parse(serialize(driver.json(expected).value)), expected);
});

test("agreement receipt generation can record a successful workflow with object evidence", async (t) => {
  const { repository, queries, evidence } = await setup(t);
  const work = action("generate_agreement_receipt");
  const result = await repository.executeWorkflowAction(work);
  assert.deepEqual(result, { receiptId: ids.result, created: true });
  assert.equal(await repository.markWorkflowActionSucceeded(work, "test-worker", result), true);
  assert.deepEqual(evidence, [result]);
  assert.match(queries[1].query, /on conflict \(acceptance_id\) do nothing/);
  assert.match(queries[2].query, /locked_by = \? and attempts = \?/);
  assert.match(queries[3].query, /on conflict \(workflow_action_id, attempt_number, outcome\) do nothing/);
});

test("a lost workflow lease does not write success evidence", async (t) => {
  const { repository, queries, evidence } = await setup(t, { leaseOwned: false });
  assert.equal(await repository.markWorkflowActionSucceeded(action("generate_agreement_receipt"), "old-worker", {}), false);
  assert.equal(queries.length, 1);
  assert.deepEqual(evidence, []);
});

test("workflow success evidence preserves JSON normalization without double encoding", async (t) => {
  const { repository, evidence } = await setup(t);
  const result = {
    completedAt: new Date("2026-09-03T12:00:00Z"),
    omitted: undefined,
    nested: { created: true, omitted: undefined },
  };
  assert.equal(await repository.markWorkflowActionSucceeded(action("generate_agreement_receipt"), "test-worker", result), true);
  assert.deepEqual(evidence, [{
    completedAt: "2026-09-03T12:00:00.000Z",
    nested: { created: true },
  }]);
});

test("the onboarding welcome notification keeps its delivery evidence as an object", async (t) => {
  const { repository, queries, evidence } = await setup(t);
  const result = await repository.executeWorkflowAction(action("send_notification", {
    title: "Welcome", body: "Your membership is ready.", notification_type: "membership",
    action_label: "Begin Foundations", action_url: "/my/foundations",
  }));
  assert.deepEqual(result, { notificationId: ids.result });
  assert.deepEqual(evidence, [{ channel: "in_app", workflowActionId: ids.action }]);
  assert.match(queries[0].query, /'in_app'.*'delivered'/);
  assert.match(queries[0].query, /on conflict \(dedupe_key\) do update/);
  assert.match(queries[1].query, /on conflict \(dedupe_key\) do nothing/);
});

test("the onboarding operator follow-up keeps its creation evidence as an object", async (t) => {
  const { repository, queries, evidence } = await setup(t);
  const result = await repository.executeWorkflowAction(action("create_operator_task", {
    task_type: "onboarding.follow_up", title: "Follow up after onboarding",
    description: "Check that the member knows the next step.", priority: "normal",
  }));
  assert.deepEqual(result, { operatorTaskId: ids.result });
  assert.deepEqual(evidence, [{ workflowActionId: ids.action }]);
  assert.match(queries[0].query, /on conflict \(idempotency_key\) where idempotency_key is not null do update/);
  assert.match(queries[1].query, /on conflict \(dedupe_key\) do nothing/);
});
