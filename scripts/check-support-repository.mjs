import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { loadPGliteForSchemaChecks, supportMigrationUrl } from "./check-support-schema.mjs";

const rootUrl = new URL("../", import.meta.url);
const fragmentMarker = Symbol("test-only SQL fragment");
const jsonMarker = Symbol("test-only JSON parameter");

// Translate postgres.js's tagged-template subset into bound PGlite parameters.
// Query text comes from the real repository; no SQL result is mocked here.
function taggedDatabase(db) {
  const tag = (transaction) => {
    const sql = (strings, ...values) => {
      const fragment = { [fragmentMarker]: true, strings, values };
      fragment.then = (onFulfilled, onRejected) => {
        const parameters = [];
        function compile(part) {
          return part.strings.reduce((query, text, index) => {
            query += text;
            if (index === part.values.length) return query;
            const value = part.values[index];
            if (value?.[fragmentMarker]) return query + compile(value);
            parameters.push(value?.[jsonMarker] ? JSON.stringify(value.value) : value);
            return `${query}$${parameters.length}`;
          }, "");
        }
        return transaction.query(compile(fragment), parameters).then((result) => result.rows).then(onFulfilled, onRejected);
      };
      return fragment;
    };
    sql.json = (value) => ({ [jsonMarker]: true, value });
    return sql;
  };
  return { begin: (callback) => db.transaction((transaction) => callback(tag(transaction))) };
}

async function loadTypescript(relativePath, dependencies = {}) {
  const source = await readFile(new URL(relativePath, rootUrl), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected support repository dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

export async function checkSupportRepository(PGlite) {
  const db = new PGlite();
  const checks = [];
  const randomUUID = crypto.randomUUID;
  const member = { authUserId: randomUUID(), email: "member@example.test" };
  const other = { authUserId: randomUUID(), email: "other@example.test" };
  const admin = { authUserId: randomUUID(), email: "admin@example.test" };
  const shaper = { authUserId: randomUUID(), email: "shaper@example.test" };
  const body = "I need help finding my next Circle.";
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create table people (id uuid primary key, status text not null default 'active');
      create table ruined_members (id uuid primary key, person_id uuid not null references people(id), membership_state text default 'pending', unique(id, person_id));
      create table platform_users (auth_user_id uuid primary key, person_id uuid not null references people(id), member_id uuid references ruined_members(id), email_normalized text not null, status text not null default 'active');
      create table user_profiles (auth_user_id uuid primary key references platform_users(auth_user_id), display_name text);
      create table person_email_addresses (person_id uuid references people(id), email_normalized text not null, verification_state text not null, retired_at timestamptz);
      create table platform_role_grants (id uuid primary key default gen_random_uuid(), auth_user_id uuid references platform_users(auth_user_id), role_slug text not null, revoked_at timestamptz);
      create table member_announcements (id uuid primary key);
    `);
    // Use the actual existing notification/audit definitions, including their
    // constraints, rather than permissive copies that could conceal failures.
    const operationsMigration = await readFile(new URL("db/migrations/20260826_membership_operating_spine_05_content_operations.sql", rootUrl), "utf8");
    for (const table of ["member_notifications", "operator_audit_events"]) {
      const definition = operationsMigration.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(definition, `Missing existing table definition for ${table}`);
      await db.exec(definition);
    }
    await db.exec(await readFile(supportMigrationUrl, "utf8"));
    for (const viewer of [member, other, admin, shaper]) {
      const personId = randomUUID();
      const memberId = randomUUID();
      await db.query("insert into people(id) values ($1)", [personId]);
      await db.query("insert into ruined_members(id, person_id) values ($1, $2)", [memberId, personId]);
      await db.query("insert into platform_users(auth_user_id, person_id, member_id, email_normalized) values ($1, $2, $3, $4)", [viewer.authUserId, personId, memberId, viewer.email]);
      await db.query("insert into person_email_addresses values ($1, $2, 'verified', null)", [personId, viewer.email]);
    }
    await db.query("insert into platform_role_grants(auth_user_id, role_slug) values ($1, 'ops_admin'), ($2, 'circle_leader')", [admin.authUserId, shaper.authUserId]);
    const model = await loadTypescript("src/lib/support/model.ts");
    const repository = await loadTypescript("src/lib/support/repository.ts", {
      "server-only": {},
      "node:crypto": crypto,
      "@/lib/database/server": { getApplicationDatabase: () => taggedDatabase(db) },
      "@/lib/support/model": model,
    });
    const denied = (operation, status) => assert.rejects(operation, (error) => error instanceof model.SupportError && error.status === status);
    const input = { category: "circle", subject: "Circle placement", message: body, requestKey: randomUUID() };
    const ticket = await repository.createSupportTicket(member, input);
    assert.equal(ticket.number, "R-000001");
    assert.equal(ticket.requesterEmail, member.email);
    assert.equal(ticket.messages[0].body, body);
    assert.match(ticket.updatedAt, /\.\d{6}Z$/);
    assert.equal((await repository.listSupportTickets(member)).length, 1);
    assert.deepEqual(await repository.listSupportTickets(other), []);
    await denied(() => repository.getSupportTicket(other, ticket.id), 404);
    await denied(() => repository.replySupportTicket(other, ticket.id, { message: "Not mine", requestKey: randomUUID() }), 404);
    await denied(() => repository.getSupportTicket(member, randomUUID()), 404);
    await denied(() => repository.listSupportTickets({ ...member, email: other.email }), 403);
    await denied(() => repository.listSupportTickets(member, true), 403);
    await denied(() => repository.listSupportTickets(shaper, true), 403);
    assert.equal((await repository.listSupportTickets(admin, true)).length, 1);
    checks.push("Unpaid accounts can open support; other members and non-admin operators cannot read or reply to it.");

    assert.equal((await repository.createSupportTicket(member, input)).id, ticket.id);
    await denied(() => repository.createSupportTicket(member, { ...input, message: `${body} Changed.` }), 409);
    assert.equal((await db.query("select count(*)::int as count from support_tickets")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int as count from support_messages")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int as count from support_email_deliveries")).rows[0].count, 2);
    checks.push("Replayed creation is idempotent and changed input cannot reuse an existing request key.");

    const operatorReplyInput = { message: "We can help you choose a Circle.", requestKey: randomUUID() };
    const answered = await repository.replySupportTicket(admin, ticket.id, operatorReplyInput, true);
    assert.equal(answered.status, "waiting_on_member");
    assert.equal(answered.messages.length, 2);
    assert.equal(answered.messages[1].authorType, "operator");
    const notification = (await db.query("select * from member_notifications")).rows[0];
    assert.equal(notification.action_url_snapshot, `/my/support/${ticket.id}`);
    assert.equal(notification.notification_type, "system");
    assert.equal(notification.body_snapshot.includes(operatorReplyInput.message), false);
    assert.equal((await repository.replySupportTicket(admin, ticket.id, operatorReplyInput, true)).messages.length, 2);
    assert.equal((await db.query("select count(*)::int as count from member_notifications")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int as count from support_email_deliveries")).rows[0].count, 3);
    await denied(() => repository.replySupportTicket(admin, ticket.id, { ...operatorReplyInput, message: "Changed" }, true), 409);
    assert.equal((await db.query("select count(*)::int as count from operator_audit_events where action = 'support.replied'")).rows[0].count, 1);
    checks.push("An operator reply creates one member notification, one delivery, and one audit event; retries do not duplicate them.");

    await denied(() => repository.updateSupportTicketStatus(admin, ticket.id, { status: "resolved", expectedUpdatedAt: ticket.updatedAt }), 409);
    const resolved = await repository.updateSupportTicketStatus(admin, ticket.id, { status: "resolved", expectedUpdatedAt: answered.updatedAt });
    assert.equal(resolved.status, "resolved");
    await denied(() => repository.updateSupportTicketStatus(member, ticket.id, { status: "open", expectedUpdatedAt: resolved.updatedAt }), 403);
    const reopened = await repository.replySupportTicket(member, ticket.id, { message: "I have another question.", requestKey: randomUUID() });
    assert.equal(reopened.status, "open");
    await db.query("update support_tickets set updated_at = '2026-09-03T18:30:20.123456Z' where id = $1", [ticket.id]);
    const precise = await repository.getSupportTicket(admin, ticket.id, true);
    assert.equal(precise.updatedAt, "2026-09-03T18:30:20.123456Z");
    await denied(() => repository.updateSupportTicketStatus(admin, ticket.id, { status: "in_progress", expectedUpdatedAt: new Date(precise.updatedAt).toISOString() }), 409);
    assert.equal((await repository.updateSupportTicketStatus(admin, ticket.id, { status: "in_progress", expectedUpdatedAt: precise.updatedAt })).status, "in_progress");
    checks.push("Status writes reject stale or truncated versions; member replies reopen resolved requests.");

    await db.query("update platform_role_grants set revoked_at = now() where auth_user_id = $1", [admin.authUserId]);
    await denied(() => repository.getSupportTicket(admin, ticket.id, true), 403);
    await db.query("update person_email_addresses set verification_state = 'unverified' where email_normalized = $1", [member.email]);
    await denied(() => repository.getSupportTicket(member, ticket.id), 403);
    await db.query("update person_email_addresses set verification_state = 'verified' where email_normalized = $1", [member.email]);
    await db.query("update platform_users set status = 'suspended' where auth_user_id = $1", [member.authUserId]);
    await denied(() => repository.getSupportTicket(member, ticket.id), 403);
    await db.query("update platform_users set status = 'active' where auth_user_id = $1", [member.authUserId]);
    for (let index = 0; index < 5; index += 1) await repository.createSupportTicket(member, { ...input, requestKey: randomUUID() });
    await denied(() => repository.createSupportTicket(member, { ...input, requestKey: randomUUID() }), 429);
    assert.equal((await repository.createSupportTicket(member, input)).id, ticket.id);
    checks.push("Revoked permissions and identity changes fail closed, and creation rate limits still permit safe replay.");
    return { checks };
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { checks } = await checkSupportRepository(await loadPGliteForSchemaChecks());
  for (const check of checks) console.log(`PASS ${check}`);
  console.log(`Verified ${checks.length} real repository groups in an isolated database.`);
}
