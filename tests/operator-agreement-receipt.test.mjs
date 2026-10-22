import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

async function load(path, dependencies = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}
const receipts = await load("src/lib/membership/agreement-receipt.ts", { "node:crypto": crypto });
const source = {
  acceptanceId: "00000000-0000-4000-8000-000000000001",
  acceptedAt: "2026-10-22T19:00:00.000Z",
  affirmativeAction: "checkbox_and_submit",
  agreementBody: "These are the exact membership terms.\nSecond paragraph.",
  agreementContentSha256: "a".repeat(64),
  agreementKey: "membership",
  agreementTitle: "Ruined Membership Agreement",
  agreementVersion: 5,
  signerEmail: "signer@example.test",
  signerName: "Actual Signer",
};
const delegation = {
  authorizationId: "00000000-0000-4000-8000-000000000002",
  authorizedAt: "2026-10-22T18:59:00.000Z",
  memberName: "Beneficiary Member",
  memberEmail: "member@example.test",
  authorityVersion: "operator-membership-v1",
  authorityText: "I am authorized to accept these membership terms on behalf of this member.",
};

test("historical v1 receipts reproduce their original bytes even when delegated evidence is present", () => {
  const expected = `RUINED MEMBERSHIP\nAGREEMENT ACCEPTANCE RECEIPT\n\nAgreement: Ruined Membership Agreement\nAgreement key: membership\nAgreement version: 5\nAccepted at: 2026-10-22T19:00:00.000Z\nAccepted by: Actual Signer\nAccount email: signer@example.test\nAcceptance method: checkbox_and_submit\nAcceptance ID: 00000000-0000-4000-8000-000000000001\nAgreement content SHA-256: ${"a".repeat(64)}\n\n--- AGREEMENT AS ACCEPTED ---\n\nThese are the exact membership terms.\nSecond paragraph.\n\n--- END AGREEMENT ---\n\nThis receipt is generated from Ruined's immutable acceptance record.\n`;
  assert.equal(receipts.renderAgreementReceiptForVersion("membership-agreement-text-v1", source), expected);
  assert.equal(receipts.renderAgreementReceiptForVersion("membership-agreement-text-v1", { ...source, delegation }), expected);
  assert.equal(receipts.renderAgreementReceipt(source), expected);
  assert.equal(receipts.agreementReceiptGeneratorVersion(source), "membership-agreement-text-v1");
  assert.equal(receipts.agreementReceiptSha256(expected), crypto.createHash("sha256").update(expected).digest("hex"));
});

test("v2 identifies the real signer, beneficiary, and immutable authority separately", () => {
  const receipt = receipts.renderAgreementReceipt({ ...source, delegation });
  assert.equal(receipts.agreementReceiptGeneratorVersion({ ...source, delegation }), "membership-agreement-text-v2");
  assert.match(receipt, /Accepted by: Actual Signer\nSigner email: signer@example.test/);
  assert.match(receipt, /On behalf of: Beneficiary Member\nMember account email: member@example.test/);
  for (const value of Object.values(delegation)) assert.ok(receipt.includes(value));
  assert.ok(receipt.includes(source.agreementBody));
  assert.doesNotMatch(receipt, /Accepted by: Beneficiary Member/);
  assert.notEqual(receipts.agreementReceiptSha256(receipt), receipts.agreementReceiptSha256(receipts.renderAgreementReceipt(source)));
  assert.throws(() => receipts.renderAgreementReceiptForVersion("membership-agreement-text-v2", source), /authority is incomplete/);
  assert.throws(() => receipts.renderAgreementReceiptForVersion("membership-agreement-text-v3", source), /not available/);
});

async function workflowFixture(row) {
  const inserts = [];
  const queries = [];
  const sql = async (parts, ...values) => {
    const text = parts.join("?"); queries.push(text);
    if (text.includes("from membership_agreement_acceptances acceptance")) return row ? [row] : [];
    if (text.includes("insert into membership_agreement_receipts")) { inserts.push(values); return [{ id: "receipt-id" }]; }
    throw new Error(`Unexpected query ${text}`);
  };
  sql.begin = fn => fn(sql);
  const workflow = await load("src/lib/workflows/repository.ts", {
    "node:crypto": crypto, "@/lib/membership/agreement-receipt": receipts,
    "@/lib/database/server": { getApplicationDatabase: () => sql },
  });
  return { inserts, queries, run: () => workflow.executeWorkflowAction({ actionType: "generate_agreement_receipt", targetType: "membership_agreement_acceptance", targetId: source.acceptanceId, payload: {} }) };
}

test("receipt workflow persists the matching generator and hashes the full delegated evidence", async () => {
  const f = await workflowFixture({ ...source, operatorAuthorizationId: delegation.authorizationId, delegation: { ...delegation, authorizedAt: "2026-10-22T12:59:00-06:00" } });
  assert.deepEqual(await f.run(), { receiptId: "receipt-id", created: true });
  const text = receipts.renderAgreementReceipt({ ...source, delegation });
  assert.deepEqual(f.inserts[0], [source.acceptanceId, Buffer.byteLength(text, "utf8"), receipts.agreementReceiptSha256(text), "membership-agreement-text-v2"]);
  assert.match(f.queries[0], /authority\.member_id=acceptance\.member_id/);
  assert.match(f.queries[0], /authority\.person_id=acceptance\.person_id/);
  assert.match(f.queries[0], /authority\.actor_auth_user_id=acceptance\.accepted_by_auth_user_id/);
  assert.match(f.queries[0], /for share of acceptance/);
  const historical = await workflowFixture({ ...source, delegation: null, operatorAuthorizationId: null });
  await historical.run();
  assert.equal(historical.inserts[0].at(-1), "membership-agreement-text-v1");
});

test("receipt workflow cannot silently turn missing operator authority into a self-signed receipt", async () => {
  const f = await workflowFixture({ ...source, operatorAuthorizationId: delegation.authorizationId, delegation: null });
  await assert.rejects(f.run(), /authorization evidence is unavailable/);
  assert.equal(f.inserts.length, 0);
});

test("receipt workflow SQL reads the bound authorization and preserves its first receipt on retry", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table operator_membership_authorizations (
      id uuid primary key, member_id uuid, person_id uuid, actor_auth_user_id uuid,
      authorized_at timestamptz, member_name_snapshot text, member_email_snapshot text, authority_version text, authority_text text
    );
    create table membership_agreement_acceptances (
      id uuid primary key, member_id uuid, person_id uuid, accepted_by_auth_user_id uuid, operator_authorization_id uuid,
      accepted_at timestamptz, affirmative_action text, agreement_body_snapshot text, agreement_content_sha256 text,
      agreement_key_snapshot text, agreement_title_snapshot text, agreement_version_snapshot int, signer_email_snapshot text, signer_name_snapshot text
    );
    create table membership_agreement_receipts (
      id uuid primary key default gen_random_uuid(), acceptance_id uuid unique, delivery_method text, storage_bucket text,
      storage_path text, mime_type text, byte_size int, content_sha256 text, generator_version text, generated_at timestamptz
    );
  `);
  const memberId = "00000000-0000-4000-8000-000000000010", personId = "00000000-0000-4000-8000-000000000011", actorId = "00000000-0000-4000-8000-000000000012";
  await db.query("insert into operator_membership_authorizations values($1,$2,$3,$4,$5,$6,$7,$8,$9)", [delegation.authorizationId, memberId, personId, actorId, delegation.authorizedAt, delegation.memberName, delegation.memberEmail, delegation.authorityVersion, delegation.authorityText]);
  await db.query("insert into membership_agreement_acceptances values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)", [source.acceptanceId, memberId, personId, actorId, delegation.authorizationId, source.acceptedAt, source.affirmativeAction, source.agreementBody, source.agreementContentSha256, source.agreementKey, source.agreementTitle, source.agreementVersion, source.signerEmail, source.signerName]);
  function wrap(engine) {
    const sql = async (parts, ...values) => (await engine.query(parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows;
    sql.begin = fn => engine.transaction(tx => fn(wrap(tx)));
    return sql;
  }
  const workflow = await load("src/lib/workflows/repository.ts", { "node:crypto": crypto, "@/lib/membership/agreement-receipt": receipts, "@/lib/database/server": { getApplicationDatabase: () => wrap(db) } });
  const run = () => workflow.executeWorkflowAction({ actionType: "generate_agreement_receipt", targetType: "membership_agreement_acceptance", targetId: source.acceptanceId, payload: {} });
  const first = await run();
  assert.equal(first.created, true);
  assert.deepEqual(await run(), { receiptId: first.receiptId, created: false });
  const rows = (await db.query("select * from membership_agreement_receipts")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].generator_version, "membership-agreement-text-v2");
  assert.equal(rows[0].content_sha256, receipts.agreementReceiptSha256(receipts.renderAgreementReceipt({ ...source, delegation })));
  await db.query("update operator_membership_authorizations set actor_auth_user_id=$1", [memberId]);
  await assert.rejects(run(), /authorization evidence is unavailable/);
});

async function downloadFixture({ version = "membership-agreement-text-v2", tamper = false } = {}) {
  const evidence = { ...source, delegation };
  const text = receipts.renderAgreementReceiptForVersion(version, evidence);
  const download = {
    acceptance: { ...evidence, id: source.acceptanceId },
    receipt: { deliveryMethod: "database_snapshot", generatorVersion: version, byteSize: Buffer.byteLength(text, "utf8"), contentSha256: receipts.agreementReceiptSha256(text), id: "receipt-id" },
  };
  if (tamper) download.acceptance.delegation = { ...delegation, memberName: "Someone Else" };
  class NextResponse extends Response {
    static json(body, options) { return new Response(JSON.stringify(body), options); }
  }
  const route = await load("app/api/my/agreement/receipt/route.ts", {
    "next/server": { NextResponse },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: "member-auth" }) },
    "@/lib/membership/agreement-receipt": receipts,
    "@/lib/membership/repository": { getAgreementReceiptDownload: async actor => { assert.equal(actor, "member-auth"); return download; }, MembershipAccessDeniedError: class extends Error {} },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/supabase/server": { createSupabaseServerClient: () => assert.fail("Database snapshot must not read object storage") },
  });
  return { route, text };
}

test("member receipt download reproduces both versions and rejects tampered delegated authority", async () => {
  for (const version of ["membership-agreement-text-v1", "membership-agreement-text-v2"]) {
    const f = await downloadFixture({ version });
    const response = await f.route.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(await response.text(), f.text);
  }
  const tampered = await downloadFixture({ tamper: true });
  assert.equal((await tampered.route.GET()).status, 502);
});
