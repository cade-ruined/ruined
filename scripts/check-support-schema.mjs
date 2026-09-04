import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const supportMigrationUrl = new URL("../db/migrations/20260903183622_support_ticketing.sql", import.meta.url);

// This harness only accepts an in-memory PGlite engine. It never reads
// DATABASE_URL and cannot accidentally run fixtures against a member database.
export async function checkSupportSchema(PGlite) {
  const db = new PGlite();
  const checks = [];
  const requester = randomUUID();
  const secondRequester = randomUUID();
  const operator = randomUUID();
  const tables = ["support_tickets", "support_messages", "support_email_deliveries"];
  const categories = ["account", "billing", "circle", "foundations", "academy", "experiences", "artifacts", "other"];
  const ticketStatuses = ["open", "in_progress", "waiting_on_member", "resolved"];

  async function rejects(query, parameters, code) {
    await assert.rejects(() => db.query(query, parameters), (error) => (Array.isArray(code) ? code.includes(error.code) : error.code === code));
  }

  async function insertTicket(overrides = {}) {
    const values = {
      requester,
      email: "member@example.test",
      name: "Test member",
      category: "circle",
      subject: "Help finding a Circle",
      status: "open",
      requestKey: randomUUID(),
      ...overrides,
    };
    const result = await db.query(`
      insert into public.support_tickets
        (requester_auth_user_id, requester_email, requester_name, category, subject, status, request_key, request_fingerprint)
      values ($1, $2, $3, $4, $5, $6, $7, $8) returning *
    `, [values.requester, values.email, values.name, values.category, values.subject, values.status, values.requestKey, "fixture-fingerprint"]);
    return result.rows[0];
  }

  async function insertMessage(ticketId, overrides = {}) {
    const values = { author: requester, type: "member", body: "Can I join a Circle?", requestKey: randomUUID(), ...overrides };
    const result = await db.query(`
      insert into public.support_messages (ticket_id, author_auth_user_id, author_type, body, request_key)
      values ($1, $2, $3, $4, $5) returning *
    `, [ticketId, values.author, values.type, values.body, values.requestKey]);
    return result.rows[0];
  }

  async function insertDelivery(ticketId, messageId, overrides = {}) {
    const values = { audience: "operator", status: "pending", attempts: 0, ...overrides };
    return db.query(`
      insert into public.support_email_deliveries (ticket_id, message_id, audience, status, attempts)
      values ($1, $2, $3, $4, $5) returning *
    `, [ticketId, messageId, values.audience, values.status, values.attempts]);
  }

  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role support_public_probe nologin;
      grant usage on schema public to public;
      alter default privileges in schema public grant all on tables to public, anon, authenticated;
      alter default privileges in schema public grant all on sequences to public, anon, authenticated;
      create table public.platform_users (auth_user_id uuid primary key);
    `);
    await db.query("insert into public.platform_users values ($1), ($2), ($3)", [requester, secondRequester, operator]);
    await db.exec(await readFile(supportMigrationUrl, "utf8"));
    checks.push("The complete migration executes on an isolated PostgreSQL engine.");

    const original = await insertTicket();
    const other = await insertTicket({ requester: secondRequester });
    assert.equal(typeof original.id, "string");
    assert.equal(Number(other.ticket_number), Number(original.ticket_number) + 1);
    assert.ok(original.created_at);
    assert.ok(original.updated_at);
    for (const category of categories) await insertTicket({ category });
    for (const status of ticketStatuses) await insertTicket({ status });
    await insertTicket({ subject: "a".repeat(120), name: "a".repeat(254), email: `${"a".repeat(249)}@a.co` });
    for (const overrides of [
      { category: "anything" }, { status: "closed" }, { subject: "ab" }, { subject: "a".repeat(121) },
      { subject: "   " }, { email: "Member@example.test" }, { email: " member@example.test " },
      { email: "a" }, { email: "a".repeat(255) }, { name: "" }, { name: "a".repeat(255) },
    ]) {
      await assert.rejects(() => insertTicket(overrides), (error) => error.code === "23514");
    }
    await assert.rejects(() => insertTicket({ requester: randomUUID() }), (error) => error.code === "23503");
    await assert.rejects(() => insertTicket({ requester: null }), (error) => error.code === "23502");
    checks.push("Ticket identity, categories, states, normalization, and field-length constraints hold.");

    await assert.rejects(() => insertTicket({ requestKey: original.request_key }), (error) => error.code === "23505");
    await insertTicket({ requester: secondRequester, requestKey: original.request_key });
    const message = await insertMessage(original.id);
    await assert.rejects(() => insertMessage(original.id, { requestKey: message.request_key }), (error) => error.code === "23505");
    await insertMessage(original.id, { author: operator, type: "operator", requestKey: message.request_key });
    await insertMessage(other.id, { requestKey: message.request_key });
    for (const overrides of [{ body: "" }, { body: "  " }, { body: "a".repeat(5001) }, { type: "anonymous" }]) {
      await assert.rejects(() => insertMessage(original.id, overrides), (error) => error.code === "23514");
    }
    await insertMessage(original.id, { body: "a".repeat(5000) });
    await assert.rejects(() => insertMessage(randomUUID()), (error) => error.code === "23503");
    await assert.rejects(() => insertMessage(original.id, { author: randomUUID() }), (error) => error.code === "23503");
    checks.push("Creation and reply idempotency are correctly scoped; invalid messages are rejected.");

    await insertDelivery(original.id, message.id);
    await assert.rejects(() => insertDelivery(original.id, message.id), (error) => error.code === "23505");
    await insertDelivery(original.id, message.id, { audience: "member" });
    const unmatchedMessage = await insertMessage(other.id);
    await assert.rejects(() => insertDelivery(original.id, unmatchedMessage.id), (error) => error.code === "23503");
    for (const overrides of [{ audience: "public" }, { status: "unknown" }, { attempts: -1 }, { attempts: 6 }]) {
      await assert.rejects(() => insertDelivery(other.id, unmatchedMessage.id, overrides), (error) => error.code === "23514");
    }
    for (const status of ["pending", "processing", "sent", "failed", "dead_letter"]) {
      const freshMessage = await insertMessage(original.id);
      await insertDelivery(original.id, freshMessage.id, { status, attempts: 5 });
    }
    // PostgreSQL 18 distinguishes RESTRICT violations from generic FK failures.
    await rejects("delete from public.support_tickets where id = $1", [original.id], ["23503", "23001"]);
    await rejects("delete from public.support_messages where id = $1", [message.id], ["23503", "23001"]);
    checks.push("Delivery retries are bounded, deduplicated, and cannot be paired with another ticket's message.");

    const rls = await db.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)", [tables]);
    assert.equal(rls.rows.length, 3);
    assert.ok(rls.rows.every((row) => row.relrowsecurity));
    for (const role of ["anon", "authenticated", "support_public_probe"]) {
      for (const table of tables) {
        const acl = await db.query(`
          select has_table_privilege($1, $2, 'SELECT') as read,
            has_table_privilege($1, $2, 'INSERT') as insert,
            has_table_privilege($1, $2, 'UPDATE') as update,
            has_table_privilege($1, $2, 'DELETE') as delete,
            has_table_privilege($1, $2, 'TRUNCATE') as truncate,
            has_table_privilege($1, $2, 'REFERENCES') as references,
            has_table_privilege($1, $2, 'TRIGGER') as trigger
        `, [role, `public.${table}`]);
        assert.ok(Object.values(acl.rows[0]).every((allowed) => allowed === false), `${role} must not hold privileges on ${table}`);
      }
      const sequenceAcl = await db.query(`
        select has_sequence_privilege($1, 'public.support_tickets_ticket_number_seq', 'USAGE') as usage,
          has_sequence_privilege($1, 'public.support_tickets_ticket_number_seq', 'SELECT') as read,
          has_sequence_privilege($1, 'public.support_tickets_ticket_number_seq', 'UPDATE') as update
      `, [role]);
      assert.ok(Object.values(sequenceAcl.rows[0]).every((allowed) => allowed === false));
      // These role names and table names are fixed test constants, never user input.
      await db.exec(`set role ${role}`);
      try {
        for (const table of tables) {
          await rejects(`select * from public.${table}`, [], "42501");
          await rejects(`insert into public.${table} default values`, [], "42501");
          await rejects(`update public.${table} set id = id`, [], "42501");
          await rejects(`delete from public.${table}`, [], "42501");
        }
        await rejects("select nextval('public.support_tickets_ticket_number_seq')", [], "42501");
      } finally {
        await db.exec("reset role");
      }
    }
    checks.push("PUBLIC, anonymous, and signed-in client roles cannot read, write, or increment support sequences.");

    // Defense in depth: even an accidental future SELECT/INSERT grant must not
    // expose private support messages through the client Data API.
    await db.exec("grant select, insert on public.support_messages to authenticated; set role authenticated;");
    try {
      assert.deepEqual((await db.query("select * from public.support_messages")).rows, []);
      await assert.rejects(() => insertMessage(original.id), (error) => error.code === "42501");
    } finally {
      await db.exec("reset role; revoke all on public.support_messages from authenticated;");
    }
    checks.push("RLS still denies client access if a table grant is accidentally reintroduced.");
    return { checks, engine: (await db.query("select version() as version")).rows[0].version };
  } finally {
    await db.close();
  }
}

export async function loadPGliteForSchemaChecks(modulePath = process.env.PGLITE_MODULE) {
  // The pinned development dependency makes database checks mandatory in a
  // clean checkout. An explicit local module override remains useful for
  // engine comparisons; neither branch reads a database connection string.
  const { PGlite } = modulePath?.trim()
    ? await import(pathToFileURL(resolve(modulePath)).href)
    : await import("@electric-sql/pglite");
  return PGlite;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { checks, engine } = await checkSupportSchema(await loadPGliteForSchemaChecks());
  for (const check of checks) console.log(`PASS ${check}`);
  console.log(`Verified ${checks.length} schema/security groups on ${engine}`);
}
