import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const member = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";

test("confirmation support signal is read-only, owner-scoped and follows the latest checkout", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table stripe_checkout_attempts(id uuid primary key,member_id uuid,stripe_session_id text,created_at timestamptz);
    create table stripe_webhook_events(event_id text primary key,object_id text,event_type text,status text);`);
  const sql = async (strings, ...values) => (await db.query(strings.reduce((query,part,i) => query+(i?`$${i}`:"")+part, ""), values)).rows;
  const source = await readFile(new URL("../src/lib/membership/checkout-confirmation-repository.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "server-only") return {};
    assert.equal(name, "@/lib/database/server");
    return { getApplicationDatabase: () => sql };
  }, loaded, loaded.exports);
  const { memberCheckoutConfirmationNeedsSupport: needsSupport } = loaded.exports;
  assert.equal(await needsSupport(member), false);
  assert.equal(await needsSupport("invalid-owner"), false);
  await db.query("insert into stripe_checkout_attempts values($1,$2,'cs_first','2026-10-22T00:00:00Z')", [member, member]);
  await db.query("insert into stripe_webhook_events values('evt_wrong','cs_other','checkout.session.completed','failed')");
  assert.equal(await needsSupport(member), false, "Another member's failed event cannot affect this member");
  await db.query("insert into stripe_webhook_events values('evt_own','cs_first','checkout.session.completed','failed')");
  assert.equal(await needsSupport(member), true, "A failed completed-session webhook is exposed as a support need, not a successful payment");
  assert.equal(await needsSupport(other), false);
  await db.query("update stripe_webhook_events set status='processed' where event_id='evt_own'");
  assert.equal(await needsSupport(member), false, "Successful retry clears the temporary support signal");
  await db.query("update stripe_webhook_events set status='failed' where event_id='evt_own'");
  await db.query("insert into stripe_checkout_attempts values($1,$2,'cs_second','2026-10-23T00:00:00Z')", [other, member]);
  assert.equal(await needsSupport(member), false, "A historical failed attempt cannot mark the newer session as broken");
  await db.query("insert into stripe_webhook_events values('evt_unrelated','cs_second','checkout.session.expired','failed')");
  assert.equal(await needsSupport(member), false, "Failed expiration is not a completed-payment fulfillment error");
  await db.query("insert into stripe_webhook_events values('evt_async','cs_second','checkout.session.async_payment_succeeded','failed')");
  await db.exec("begin read only");
  assert.equal(await needsSupport(member), true, "The actual query executes inside a read-only transaction");
  await db.exec("rollback");
});
