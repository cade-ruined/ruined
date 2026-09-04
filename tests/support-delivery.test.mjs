import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const ids = { delivery: "11111111-1111-4111-8111-111111111111", ticket: "22222222-2222-4222-8222-222222222222", message: "33333333-3333-4333-8333-333333333333" };
const environment = {
  SUPPORT_EMAIL_ENABLED: "true",
  RESEND_API_KEY: "test-key-no-network",
  RESEND_FROM_EMAIL: "Ruined <connect@theruinedproject.com>",
  NEXT_PUBLIC_SITE_URL: "https://theruinedproject.com",
  NODE_ENV: "test",
  RESEND_MARKETING_ENABLED: "false",
};

async function withEnvironment(overrides, callback) {
  const values = { ...environment, ...overrides };
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await callback(); } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function fixture({ deliveries, memberEmail = "member@example.com", author = "member", sendError, databaseError, acknowledge = true } = {}) {
  const queries = [];
  const sends = [];
  let databaseCalls = 0;
  const pending = deliveries ?? [{
    id: ids.delivery, ticket_id: ids.ticket, message_id: ids.message,
    audience: "operator", attempts: 1, previous_attempts: 0, first_attempt_at: null, previous_status: "pending", previous_error: null,
  }];
  const sql = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ query, values });
    if (databaseError) throw databaseError;
    if (query.startsWith("with next_delivery")) return pending.length ? [pending.shift()] : [];
    if (query.startsWith("select ticket.id")) {
      return [{ ticket_id: ids.ticket, ticket_number: "47", author_type: author, member_email: memberEmail }];
    }
    if (query.startsWith("update support_email_deliveries")) return acknowledge ? [{ id: ids.delivery }] : [];
    throw new Error(`Unexpected query ${query}`);
  };
  const emailModel = await loadModule("../src/lib/support/email-model.ts");
  const worker = await loadModule("../src/lib/support/delivery.ts", {
    "server-only": {},
    "node:crypto": { randomUUID: () => "worker-unique-id" },
    resend: { Resend: class {
      emails = { send: async (payload, options) => {
        sends.push({ payload, options });
        if (sendError instanceof Error) throw sendError;
        return sendError ? { data: null, error: sendError } : { data: { id: "email-id" }, error: null };
      } };
    } },
    "@/lib/database/server": { getApplicationDatabase: () => { databaseCalls += 1; return sql; } },
    "@/lib/support/email-model": emailModel,
    "@/lib/support/model": { SUPPORT_EMAIL: "connect@theruinedproject.com" },
    "@/lib/support/delivery-policy": await loadModule("../src/lib/support/delivery-policy.ts"),
  });
  return { ...worker, queries, sends, databaseCalls: () => databaseCalls };
}

test("support delivery is off by default and leaves queue attempts untouched", async () => withEnvironment({ SUPPORT_EMAIL_ENABLED: undefined }, async () => {
  const worker = await fixture();
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.enabled, false);
  assert.equal(result.ready, false);
  assert.equal(worker.databaseCalls(), 0);
  assert.deepEqual(worker.sends, []);
}));

test("support configuration rejects unsafe site URLs and malformed senders without exposing values", async () => {
  const worker = await fixture();
  for (const url of ["http://example.com", "https://secret:password@example.com", "javascript:alert(1)", "https://example.com?token=secret", "https://example.com/somewhere"]) {
    await withEnvironment({ NEXT_PUBLIC_SITE_URL: url }, async () => {
      const configuration = worker.getSupportEmailConfiguration();
      assert.equal(configuration.ready, false);
      assert.ok(configuration.missing.includes("NEXT_PUBLIC_SITE_URL"));
      assert.ok(!JSON.stringify(configuration).includes("secret"));
    });
  }
  await withEnvironment({ RESEND_FROM_EMAIL: "ok@example.com\r\nBcc: wrong@example.com" }, async () => {
    assert.equal(worker.getSupportEmailConfiguration().ready, false);
  });
  await withEnvironment({ NEXT_PUBLIC_SITE_URL: "http://localhost:3001" }, async () => {
    assert.equal(worker.getSupportEmailConfiguration().ready, true);
  });
  await withEnvironment({ NEXT_PUBLIC_SITE_URL: "http://localhost:3001", NODE_ENV: "production" }, async () => {
    assert.equal(worker.getSupportEmailConfiguration().ready, false);
  });
});

test("operator notifications reach only connect and work with marketing disabled", async () => withEnvironment({ CONTACT_TO_EMAIL: "wrong@example.com" }, async () => {
  const worker = await fixture();
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.sent, 1);
  assert.equal(result.ready, true);
  const [email] = worker.sends;
  assert.equal(email.payload.to, "connect@theruinedproject.com");
  assert.equal(email.payload.replyTo, "connect@theruinedproject.com");
  assert.equal(email.options.idempotencyKey, `ruined-support/${ids.delivery}`);
  assert.match(email.payload.text, new RegExp(`/ops/support/${ids.ticket}`));
  assert.match(email.payload.text, /R-000047/);
  assert.match(email.payload.text, /Replies to this email are not added/);
  assert.doesNotMatch(email.payload.html, /member@example\.com/);
  const sql = worker.queries.map((entry) => entry.query).join("\n");
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /locked_at < now\(\) - interval '5 minutes'/);
  assert.match(sql, /last_error = 'uncertain:send_in_flight'/);
  assert.match(sql, /first_attempt_at = case when \? then first_attempt_at else now\(\) end/);
  assert.match(sql, /and locked_by = \?/);
  assert.doesNotMatch(sql, /message\.body|ticket\.subject|requester_name/);
}));

test("member replies require the current verified email and point to their private thread", async () => withEnvironment({}, async () => {
  const worker = await fixture({ author: "operator", deliveries: [{
    id: ids.delivery, ticket_id: ids.ticket, message_id: ids.message,
    audience: "member", attempts: 1, previous_attempts: 0, first_attempt_at: null, previous_status: "pending", previous_error: null,
  }] });
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.sent, 1);
  assert.equal(worker.sends[0].payload.to, "member@example.com");
  assert.match(worker.sends[0].payload.text, /You have a reply/);
  assert.match(worker.sends[0].payload.text, new RegExp(`/my/support/${ids.ticket}`));
  const query = worker.queries.find((entry) => entry.query.startsWith("select ticket.id")).query;
  assert.match(query, /account\.status = 'active'/);
  assert.match(query, /account\.email_normalized = ticket\.requester_email/);
  assert.match(query, /verification_state = 'verified'/);
  assert.match(query, /retired_at is null/);
}));

test("changed or retired recipient email is not used and is held for manual review", async () => withEnvironment({}, async () => {
  const worker = await fixture({ memberEmail: null, deliveries: [{
    id: ids.delivery, ticket_id: ids.ticket, message_id: ids.message,
    audience: "member", attempts: 1, previous_attempts: 0, first_attempt_at: null, previous_status: "pending", previous_error: null,
  }] });
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.deadLetter, 1);
  assert.equal(worker.sends.length, 0);
  assert.ok(worker.queries.some(({ values }) => values.includes("not_sent:recipient_unavailable_manual_review")));
}));

test("uncertain delivery does not retry outside the provider deduplication window", async () => withEnvironment({}, async () => {
  const worker = await fixture({ deliveries: [{
    id: ids.delivery, ticket_id: ids.ticket, message_id: ids.message,
    audience: "member", attempts: 2, previous_attempts: 1, first_attempt_at: new Date(Date.now() - 23 * 60 * 60 * 1000),
  }] });
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.deadLetter, 1);
  assert.equal(worker.sends.length, 0);
  assert.ok(worker.queries.some(({ values }) => values.includes("uncertain:retry_window_exhausted_manual_review")));
}));

test("provider errors are retryable when appropriate and never persist PII", async () => withEnvironment({}, async () => {
  const worker = await fixture({ sendError: { statusCode: 429, name: "rate_limit_exceeded", message: "private@example.com secret-key" } });
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.failed, 1);
  assert.equal(result.deadLetter, 0);
  assert.ok(worker.queries.some(({ values }) => values.includes("not_sent:provider_http_429")));
  assert.doesNotMatch(JSON.stringify(worker.queries), /private@example|secret-key/);
}));

test("permanent provider failures and exhausted attempts stop automatic sends", async () => withEnvironment({}, async () => {
  const permanent = await fixture({ sendError: { statusCode: 422, name: "validation_error", message: "bad recipient" } });
  assert.equal((await permanent.processSupportEmailBatch()).deadLetter, 1);
  const exhausted = await fixture({ deliveries: [{
    id: ids.delivery, ticket_id: ids.ticket, message_id: ids.message,
    audience: "member", attempts: 5, previous_attempts: 5, first_attempt_at: new Date(),
  }] });
  assert.equal((await exhausted.processSupportEmailBatch()).deadLetter, 1);
  assert.equal(exhausted.sends.length, 0);
}));

test("missing migration returns a safe readiness issue and does not send", async () => withEnvironment({}, async () => {
  const worker = await fixture({ databaseError: Object.assign(new Error("private SQL data"), { code: "42P01" }) });
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["support database migration"]);
  assert.equal(worker.sends.length, 0);
}));

test("a lost lease cannot mark another worker’s delivery completed", async () => withEnvironment({}, async () => {
  const worker = await fixture({ acknowledge: false });
  const result = await worker.processSupportEmailBatch();
  assert.equal(result.sent, 0);
  assert.equal(result.deferred, 1);
}));

test("the protected cron invokes support even when marketing is not configured", async () => {
  const calls = [];
  const routes = await loadModule("../app/api/internal/communications/process/route.ts", {
    "node:crypto": { timingSafeEqual: (a, b) => Buffer.from(a).equals(Buffer.from(b)) },
    "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    "@/lib/communications/worker": { processResendOutboxBatch: async () => { calls.push("marketing"); return { ready: false, missing: ["marketing disabled"] }; } },
    "@/lib/support/delivery": { processSupportEmailBatch: async () => { calls.push("support"); return { ready: true, sent: 1 }; } },
  });
  await withEnvironment({ CRON_SECRET: "test-worker-secret" }, async () => {
    const denied = await routes.GET(new Request("https://example.com/api/internal/communications/process"));
    assert.equal(denied.status, 401);
    assert.deepEqual(calls, []);
    const accepted = await routes.POST(new Request("https://example.com/api/internal/communications/process", { headers: { authorization: "Bearer test-worker-secret" } }));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.support.sent, 1);
    assert.deepEqual(calls.sort(), ["marketing", "support"]);
  });
});
