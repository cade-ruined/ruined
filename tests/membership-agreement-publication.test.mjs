import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { agreementSha256, publishMembershipAgreement, validatePublication } from "../scripts/publish-membership-agreement.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const pilotBody = "# Pilot membership agreement\n\nMembership in this pilot has no fee and does not authorize a future payment. Members agree to respect one another, protect private conversations, and contact support when they need help. Participation remains voluntary.\n";
const paidBody = "# Ruined Membership Agreement\n\n## Price and renewal\nMembers choose their disclosed monthly or annual recurring plan and separately authorize payment.\n\n## Cancellation and refunds\nCancel future renewals before the next renewal date. Access continues through the paid term. Refund requests receive individual review; applicable rights remain unchanged.\n";
const input = {
  body: paidBody, title: "Ruined Membership Agreement", version: 2,
  expectedBodySha256: agreementSha256(paidBody), predecessorId: id(1),
  predecessorVersion: 1, predecessorSha256: agreementSha256(pilotBody),
};

function adapter(engine, failInsert = false) {
  return { transaction: (fn, { readOnly }) => engine.transaction(async tx => {
    if (readOnly) await tx.query("set transaction read only");
    return fn({ query: async (text, parameters = []) => {
      if (failInsert && /insert into public\.membership_agreement_versions/.test(text)) throw new Error("Injected insert failure");
      return (await tx.query(text, parameters)).rows;
    } });
  }) };
}

test("publication rejects the internal draft file and changed reviewed bytes before database access", async () => {
  const draft = await read("docs/membership-paid-agreement-draft.md");
  assert.throws(() => validatePublication({ ...input, body: draft, expectedBodySha256: agreementSha256(draft) }), /Internal notes/);
  assert.throws(() => validatePublication({ ...input, body: `${paidBody}\n` }), /reviewed SHA-256/);
  assert.throws(() => validatePublication({ ...input, body: `\ufeff${paidBody}` }), /invalid text/);
  assert.throws(() => validatePublication({ ...input, predecessorId: undefined }), /predecessor agreement ID/);
  assert.throws(() => validatePublication({ ...input, predecessorSha256: undefined }), /predecessor SHA-256/);
});

test("publishing a new agreement atomically preserves five pilot acceptances, receipts, and immutable content", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  // Real production migrations and their append-only/immutability triggers.
  for (const match of (await read("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)) {
    await db.exec(await read(match[1]));
  }
  await db.query(`insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at,effective_at)
    values($1,'ruined_membership',1,'Pilot membership agreement',$2,$3,'published',now(),now())`,
  [id(1), pilotBody, agreementSha256(pilotBody)]);
  for (let index = 0; index < 5; index++) {
    const member = id(10 + index), actor = id(20 + index), acceptance = id(30 + index);
    const email = `member-${index}@example.test`;
    await db.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)", [member, email]);
    const person = (await db.query("select person_id from ruined_members where id=$1", [member])).rows[0].person_id;
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [actor, member, person, email]);
    await db.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,
      signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,
      agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      values($1,$2,$3,$4,$5,'Pilot member',$6,'checkbox_and_submit',now(),'ruined_membership',1,'Pilot membership agreement',$7,$8,$9)`,
    [acceptance, id(1), person, member, actor, email, agreementSha256(pilotBody), pilotBody, `pilot-acceptance-${index}`]);
    await db.query(`insert into membership_agreement_receipts(acceptance_id,byte_size,content_sha256,generator_version,generated_at)
      values($1,200,$2,'test-pilot-receipt',now())`, [acceptance, agreementSha256(`receipt-${index}`)]);
  }
  const before = {
    agreements: (await db.query("select * from membership_agreement_versions order by id")).rows,
    acceptances: (await db.query("select * from membership_agreement_acceptances order by id")).rows,
    receipts: (await db.query("select * from membership_agreement_receipts order by id")).rows,
  };
  const database = adapter(db);
  const dryRun = await publishMembershipAgreement(database, input);
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.changesCommitted, false);
  assert.equal(dryRun.evidence.acceptances.count, 5);
  assert.equal(dryRun.evidence.receipts.count, 5);
  assert.deepEqual((await db.query("select * from membership_agreement_versions order by id")).rows, before.agreements);

  await assert.rejects(publishMembershipAgreement(database, { ...input, predecessorSha256: "a".repeat(64) }, { apply: true }), /predecessor ID, version, or immutable content hash/);
  assert.deepEqual((await db.query("select * from membership_agreement_versions order by id")).rows, before.agreements);
  // Fail after retiring v1: the transaction must restore its published state.
  await assert.rejects(publishMembershipAgreement(adapter(db, true), input, { apply: true }), /Injected insert failure/);
  assert.deepEqual((await db.query("select * from membership_agreement_versions order by id")).rows, before.agreements);

  const published = await publishMembershipAgreement(database, input, { apply: true });
  assert.equal(published.status, "published");
  assert.equal(published.previousEvidenceUnchanged, true);
  assert.equal(published.actorProvided, false);
  assert.deepEqual((await db.query("select * from membership_agreement_acceptances order by id")).rows, before.acceptances);
  assert.deepEqual((await db.query("select * from membership_agreement_receipts order by id")).rows, before.receipts);
  const versions = (await db.query("select * from membership_agreement_versions order by version")).rows;
  assert.equal(versions[0].status, "retired");
  assert.equal(versions[0].body_text, pilotBody);
  assert.equal(versions[0].content_sha256, input.predecessorSha256);
  assert.equal(versions[1].status, "published");
  assert.equal(versions[1].body_text, paidBody);
  assert.equal(versions[1].created_by_auth_user_id, null, "never infer a publishing actor from the previous version");
  await assert.rejects(db.query("update membership_agreement_versions set body_text='replaced' where id=$1", [id(1)]), /immutable/);

  const repeated = await publishMembershipAgreement(database, input, { apply: true });
  assert.equal(repeated.status, "already-published");
  assert.equal(repeated.agreementId, published.agreementId);
  const conflictingBody = `${paidBody}\nAn additional clause.\n`;
  await assert.rejects(publishMembershipAgreement(database, { ...input, body: conflictingBody, expectedBodySha256: agreementSha256(conflictingBody) }, { apply: true }), /conflicting content/);
  assert.equal((await db.query("select count(*)::integer as count from membership_agreement_versions")).rows[0].count, 2);
  assert.deepEqual((await db.query("select * from membership_agreement_acceptances order by id")).rows, before.acceptances);
});
