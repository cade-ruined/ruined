import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const expiry = await load("src/lib/membership/invitation-expiry.ts");
const email = await load("src/lib/membership/personal-invitation-email.ts", { "./invitation-expiry": expiry });
const input = {
  recipientName: "Alex <script>&", inviterName: "Cade Mangelson", inviterTag: "cade",
  invitationUrl: `https://members.example.test/invitation/${"A".repeat(43)}`,
  expiresAt: "2026-09-23T18:00:00Z", siteUrl: new URL("https://members.example.test"),
};

test("personal invitation email escapes names, uses the fixed deadline and makes no signup claims", () => {
  const message = email.createPersonalInvitationEmail(input);
  assert.match(message.html, /Alex &lt;script&gt;&amp;/);
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.text, /Cade Mangelson @cade/);
  assert.match(message.text, /SEP\. 23 12:00PM MDT/);
  assert.match(message.text, /haven’t been subscribed/);
  assert.ok(message.html.includes(input.invitationUrl));
  assert.match(email.createPersonalInvitationEmail({ ...input, inviterName: "@cade", inviterTag: "cade" }).text, /@cade has sent/);
  assert.doesNotMatch(email.createPersonalInvitationEmail({ ...input, inviterName: "@cade", inviterTag: "cade" }).text, /@cade @cade/);
});

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), pg = new PGlite();
  const member = crypto.randomUUID(), id = crypto.randomUUID();
  const names = await readdir(new URL("../db/migrations/", import.meta.url));
  const migrationName = names.find(name => name.includes("personal_member_invitation"));
  const migration = await readFile(new URL(`../db/migrations/${migrationName}`, import.meta.url), "utf8");
  const table = migration.match(/create table public\.member_personal_invitations \([\s\S]+?\n\);/)[0];
  await pg.exec(`create schema private;
    create table ruined_members(id uuid primary key, deleted_at timestamptz);
    create table member_lifecycle(member_id uuid primary key, eligible boolean default true);
    create function private.ruined_member_can_share_invitation(uuid) returns boolean language sql as
      'select eligible from member_lifecycle where member_id=$1';
    ${table}`);
  await pg.query("insert into ruined_members(id) values($1)", [member]);
  await pg.query("insert into member_lifecycle(member_id) values($1)", [member]);
  await pg.query(`insert into member_personal_invitations(id,member_id,request_id,public_token,recipient_name,
    recipient_email_normalized,inviter_name,inviter_tag,email_requested,delivery_status,next_attempt_at)
    values($1,$2,$3,$4,'Alex','alex@example.test','Cade Mangelson','cade',true,'queued',now())`,
  [id, member, crypto.randomUUID(), "A".repeat(43)]);
  const sends = [], responses = [], faults = [], hooks = [], lockedRows = [];
  function wrap(client) {
    const tag = (strings, ...params) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      const fault = faults.findIndex(pattern => query.includes(pattern));
      if (fault >= 0) { faults.splice(fault, 1); throw new Error("Injected database failure"); }
      return client.query(query, params).then(result => {
        if (query.includes("select invitation.*")) lockedRows.push(result.rows[0]);
        return result.rows;
      });
    };
    tag.json = JSON.stringify;
    tag.begin = async callback => {
      const result = await client.transaction(tx => callback(wrap(tx)));
      const hook = hooks.shift(); if (hook) await hook();
      return result;
    };
    return tag;
  }
  const worker = await load("src/lib/membership/personal-invitation-delivery.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/database/server": { getApplicationDatabase: () => wrap(pg) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/support/model": { SUPPORT_EMAIL: "connect@theruinedproject.com" },
    "./personal-invitation-email": email,
    resend: { Resend: class { emails = { send: async (payload, options) => {
      const locked = lockedRows.at(-1);
      assert.equal(locked.delivery_status, "sending");
      assert.ok(locked.first_attempt_at);
      assert.deepEqual(payload, locked.delivery_payload, "payload was committed before send");
      assert.equal(payload.to, locked.recipient_email_normalized, "recipient is canonical");
      sends.push({ payload, options });
      const result = responses.shift();
      if (result instanceof Error) throw result;
      return result ? { error: result, data: null } : { data: { id: "accepted-provider-id" }, error: null };
    } }; } },
  });
  const settings = { RESEND_API_KEY: "fake-no-network", RESEND_FROM_EMAIL: "Ruined <connect@theruinedproject.com>", NEXT_PUBLIC_SITE_URL: "https://members.example.test", NODE_ENV: "test" };
  const original = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(async () => {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await pg.close();
  });
  return { pg, id, member, worker, sends, responses, faults, hooks,
    row: async () => (await pg.query("select * from member_personal_invitations where id=$1", [id])).rows[0],
    due: () => pg.query("update member_personal_invitations set next_attempt_at=now()-interval '1 minute' where id=$1", [id]),
  };
}

test("queued invitation sends once with canonical address; a repeated batch is harmless", async t => {
  const f = await fixture(t);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).sent, 1);
  const row = await f.row();
  assert.equal(row.delivery_status, "sent");
  assert.equal(row.resend_email_id, "accepted-provider-id");
  assert.equal(row.version, 1, "delivery does not change owner version");
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).claimed, 0);
  assert.equal(f.sends.length, 1);
});

test("link-only invitations never send even if a queue flag is inconsistent", async t => {
  const f = await fixture(t);
  await f.pg.query("update member_personal_invitations set email_requested=false,delivery_status='not_requested' where id=$1", [f.id]);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).claimed, 0);
  await f.pg.query("update member_personal_invitations set delivery_status='queued' where id=$1", [f.id]);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).cancelled, 1);
  assert.equal(f.sends.length, 0);
});

test("uncertain retries reuse the identical payload and provider key after configuration changes", async t => {
  const f = await fixture(t);
  f.responses.push(new Error("Connection lost after request"));
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).failed, 1);
  const first = await f.row();
  process.env.RESEND_FROM_EMAIL = "Changed <other@example.test>";
  process.env.NEXT_PUBLIC_SITE_URL = "https://changed.example.test";
  await f.due();
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).sent, 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
  assert.equal(new Date((await f.row()).first_attempt_at).getTime(), new Date(first.first_attempt_at).getTime());
});

test("a lost database acknowledgement after provider acceptance keeps the same replay key", async t => {
  const f = await fixture(t);
  f.faults.push("set delivery_status = 'sent'");
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).failed, 1);
  await f.due();
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).sent, 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
});

test("expiry, revocation and lost member eligibility prevent queued sends", async t => {
  const f = await fixture(t);
  await f.pg.query("update member_personal_invitations set revoked_at=now() where id=$1", [f.id]);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).cancelled, 1);
  assert.equal(f.sends.length, 0);
  await f.pg.query("update member_personal_invitations set revoked_at=null,delivery_status='queued',next_attempt_at=now(),issued_at=now()-interval '49 hours',expires_at=now()-interval '1 hour' where id=$1", [f.id]);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).cancelled, 1);
  await f.pg.query("update member_personal_invitations set delivery_status='queued',next_attempt_at=now(),issued_at=now(),expires_at=now()+interval '48 hours' where id=$1", [f.id]);
  await f.pg.query("update member_lifecycle set eligible=false");
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).cancelled, 1);
  assert.equal(f.sends.length, 0);
});

test("a revoke between payload preparation and send is rechecked", async t => {
  const f = await fixture(t);
  f.hooks.push(() => f.pg.query("update member_personal_invitations set revoked_at=now() where id=$1", [f.id]));
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).cancelled, 1);
  assert.equal(f.sends.length, 0);
});

test("stale attempts are held after 23 hours and unknown first-attempt timestamps fail closed", async t => {
  const f = await fixture(t);
  await f.pg.query("update member_personal_invitations set delivery_status='failed',delivery_attempts=1,first_attempt_at=now()-interval '23 hours' where id=$1", [f.id]);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).failed, 1);
  assert.equal((await f.row()).next_attempt_at, null);
  await f.pg.query("update member_personal_invitations set delivery_status='sending',delivery_attempts=1,first_attempt_at=null,delivery_locked_at=now()-interval '10 minutes' where id=$1", [f.id]);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).failed, 1);
  assert.equal(f.sends.length, 0);
});

test("five failures stop automatic retries and unavailable email configuration never claims a row", async t => {
  const f = await fixture(t);
  delete process.env.RESEND_API_KEY;
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).ready, false);
  assert.equal((await f.row()).delivery_attempts, 0);
  process.env.RESEND_API_KEY = "fake-no-network";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    f.responses.push({ statusCode: 429 }); await f.due();
    assert.equal((await f.worker.processPersonalInvitationEmailBatch()).failed, 1);
  }
  assert.equal((await f.row()).next_attempt_at, null);
  assert.equal((await f.row()).delivery_attempts, 5);
  assert.equal((await f.worker.processPersonalInvitationEmailBatch()).claimed, 0);
});
