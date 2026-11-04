import assert from "node:assert/strict";
import { operationsFixture } from "./member-sms-operations-fixture.mjs";
import { id, loader, sid } from "./member-sms-fixture.mjs";

// Transactions and SQL fragments behave like postgres.js; all data stays in PGlite.
function bridge(engine, queries, hooks, root = true) {
  class Query {
    constructor(strings, values) { this.strings = strings; this.values = values; }
    compile(parameters) {
      let query = this.strings[0];
      this.values.forEach((value, index) => {
        if (value instanceof Query) query += value.compile(parameters);
        else { parameters.push(value instanceof Date ? value.toISOString() : value); query += `$${parameters.length}`; }
        query += this.strings[index + 1];
      });
      return query;
    }
    then(resolve, reject) {
      const parameters = [], query = this.compile(parameters); queries.push(query);
      return engine.query(query, parameters).then(result => result.rows).then(resolve, reject);
    }
  }
  const sql = (strings, ...values) => new Query(strings, values);
  sql.json = JSON.stringify;
  sql.begin = async (options, callback) => {
    assert.equal(root, true);
    const run = callback ?? options;
    const result = await engine.transaction(async tx => {
      if (typeof options === "string") {
        assert.equal(options, "read only"); await tx.exec("set transaction read only");
      }
      return run(bridge(tx, queries, hooks, false));
    });
    if (hooks.afterTransaction) await hooks.afterTransaction();
    return result;
  };
  return sql;
}
export async function oneOffFixture() {
  const fixture = await operationsFixture(), { db, env, admin } = fixture;
  await db.exec(`create table operator_audit_events(id uuid primary key default gen_random_uuid(),actor_auth_user_id uuid,
    action text,subject_type text,subject_id text,member_id uuid,metadata jsonb)`);
  const queries = [], hooks = {}, calls = [], provider = { error: null }, sql = bridge(db, queries, hooks);
  let request = 1000;
  const overrides = {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    twilio: () => ({ messages: { create: async message => {
      calls.push(message); if (provider.error) throw provider.error; return { sid: sid(calls.length) };
    } } }),
  };
  const load = loader(env, overrides), service = load("src/lib/communications/member-sms-one-off.ts");
  const review = (member, message = "Your membership call has moved to tomorrow.", requestId = id(request++)) =>
    service.reviewMemberSmsOneOff(admin, { memberId: member.memberId, message, requestId });
  const send = reviewed => service.sendMemberSmsOneOff(admin, { reviewId: reviewed.review.id, confirm: true });
  const row = async reviewed => (await db.query("select * from private.member_sms_one_off_reviews where id=$1", [reviewed.review.id])).rows[0];
  return { ...fixture, sql, queries, hooks, calls, provider, overrides, load, service, review, send, row };
}
