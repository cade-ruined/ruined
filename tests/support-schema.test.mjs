import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkSupportSchema, loadPGliteForSchemaChecks, supportMigrationUrl } from "../scripts/check-support-schema.mjs";
import { checkSupportRepository } from "../scripts/check-support-repository.mjs";

const migration = await readFile(supportMigrationUrl, "utf8");
const runner = await readFile(new URL("../scripts/migrate-platform.mjs", import.meta.url), "utf8");

test("support migration is atomic and registered after existing platform migrations", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /set local lock_timeout = '10s'/);
  assert.match(migration, /set local statement_timeout = '60s'/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/);
  assert.ok(runner.indexOf("20260903183622_support_ticketing.sql") > runner.indexOf("20260829_operator_access_management.sql"));
});

test("support tables and the ticket-number sequence are private to the authorized server", () => {
  for (const table of ["support_tickets", "support_messages", "support_email_deliveries"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /revoke all on public\.support_tickets, public\.support_messages, public\.support_email_deliveries from public, anon, authenticated/);
  assert.match(migration, /revoke all on sequence public\.support_tickets_ticket_number_seq from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy|security definer|grant (all|select|insert|update)/i);
});

test("support has bounded categories, statuses, field sizes, and retry attempts", () => {
  assert.match(migration, /category in \('account', 'billing', 'circle', 'foundations', 'academy', 'experiences', 'artifacts', 'other'\)/);
  assert.match(migration, /status in \('open', 'in_progress', 'waiting_on_member', 'resolved'\)/);
  assert.match(migration, /char_length\(btrim\(subject\)\) between 3 and 120/);
  assert.match(migration, /char_length\(btrim\(body\)\) between 1 and 5000/);
  assert.match(migration, /author_type in \('member', 'operator'\)/);
  assert.match(migration, /attempts between 0 and 5/);
});

test("support idempotency and delivery foreign keys prevent duplicate or mismatched conversations", () => {
  assert.match(migration, /ticket_number bigint generated always as identity unique/);
  assert.match(migration, /unique \(requester_auth_user_id, request_key\)/);
  assert.match(migration, /unique \(ticket_id, author_auth_user_id, request_key\)/);
  assert.match(migration, /unique \(message_id, audience\)/);
  assert.match(migration, /foreign key \(message_id, ticket_id\) references public\.support_messages\(id, ticket_id\) on delete restrict/);
  assert.doesNotMatch(migration, /on delete cascade/);
});

test("support ownership, conversation, and queue queries have supporting indexes", () => {
  assert.match(migration, /support_tickets\(requester_auth_user_id, updated_at desc\)/);
  assert.match(migration, /support_tickets\(status, updated_at desc\)/);
  assert.match(migration, /support_messages\(ticket_id, created_at, id\)/);
  assert.match(migration, /support_messages\(author_auth_user_id, created_at\)/);
  assert.match(migration, /support_email_deliveries\(ticket_id\)/);
  assert.match(migration, /support_email_deliveries\(available_at, created_at\)[\s\S]*where status in \('pending', 'failed', 'processing'\)/);
});

test("isolated schema checks default to the installed engine without database credentials", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  assert.equal(await loadPGliteForSchemaChecks(""), PGlite);
  assert.equal(await loadPGliteForSchemaChecks(fileURLToPath(import.meta.resolve("@electric-sql/pglite"))), PGlite);
});

test("support migration enforces constraints and role permissions in isolated PostgreSQL", async () => {
  const result = await checkSupportSchema(await loadPGliteForSchemaChecks());
  assert.equal(result.checks.length, 6);
});
test("support repository enforces account ownership and administrator actions in isolated PostgreSQL", async () => {
  const result = await checkSupportRepository(await loadPGliteForSchemaChecks());
  assert.equal(result.checks.length, 6);
});
