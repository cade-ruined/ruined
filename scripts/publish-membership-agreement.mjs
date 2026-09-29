import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const AGREEMENT_KEY = "ruined_membership";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
export const agreementSha256 = body => createHash("sha256").update(body, "utf8").digest("hex");

export class AgreementPublicationError extends Error {}
function requireCondition(condition, message) {
  if (!condition) throw new AgreementPublicationError(message);
}

/** No extraction or normalization: the separately reviewed file is the exact stored body. */
export function validatePublication(input) {
  requireCondition(typeof input.title === "string" && input.title.trim() === input.title && input.title.length > 0 && input.title.length <= 200,
    "Supply a final agreement title of 1–200 characters.");
  requireCondition(typeof input.body === "string" && input.body.length >= 200 && Buffer.byteLength(input.body) <= 250_000,
    "Supply a complete member-facing agreement of 200–250,000 bytes.");
  requireCondition(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ufeff]/u.test(input.body), "Agreement contains invalid text or control characters.");
  requireCondition(!/\b(?:draft|proposed)\b/i.test(input.title), "The publication title must not be a draft or proposal.");
  requireCondition(!/^\s*#{1,6}\s+.*\b(?:draft|internal|owner review|review notes|implementation|publication checklist|sources|proposed member-facing)\b/im.test(input.body)
    && !/\b(?:TODO|TBD)\b|\[(?:insert|placeholder)\b|not published, accepted, or in effect|outside the proposed member terms/i.test(input.body),
  "Internal notes, placeholders, or draft headings must not appear in the member-facing file.");
  requireCondition(Number.isSafeInteger(input.predecessorVersion) && input.predecessorVersion > 0
    && Number.isSafeInteger(input.version) && input.version === input.predecessorVersion + 1,
  "The new version must be exactly one after the explicit predecessor version.");
  requireCondition(UUID.test(input.predecessorId || ""), "Supply the exact predecessor agreement ID.");
  requireCondition(HASH.test(input.predecessorSha256 || ""), "Supply the reviewed predecessor SHA-256.");
  requireCondition(HASH.test(input.expectedBodySha256 || "") && agreementSha256(input.body) === input.expectedBodySha256,
    "The member-facing file does not match its explicitly reviewed SHA-256.");
  requireCondition(input.actorId == null || UUID.test(input.actorId), "An explicit publication actor must be a valid authentication ID.");
  return input;
}

async function evidenceFingerprint(tx, table) {
  // Only fixed table names below enter SQL. Member identities and receipt bodies stay in the database.
  const rows = await tx.query(`select count(*)::integer as count,
    md5(coalesce(string_agg(to_jsonb(evidence)::text, E'\\n' order by evidence.id), '')) as fingerprint
    from public.${table} evidence`);
  return rows[0];
}

async function snapshotEvidence(tx) {
  return {
    acceptances: await evidenceFingerprint(tx, "membership_agreement_acceptances"),
    receipts: await evidenceFingerprint(tx, "membership_agreement_receipts"),
  };
}

async function versionContentFingerprints(tx) {
  return tx.query(`select id,
    md5((to_jsonb(agreement) - 'status' - 'retired_at' - 'updated_at')::text) as fingerprint
    from public.membership_agreement_versions agreement order by id`);
}

/** Adapter exposes transaction(fn, { readOnly }) and tx.query(text, parameters) => rows. */
export async function publishMembershipAgreement(database, rawInput, { apply = false } = {}) {
  const input = validatePublication(rawInput);
  return database.transaction(async tx => {
    if (apply) {
      await tx.query("set local lock_timeout = '10s'");
      await tx.query("select pg_advisory_xact_lock(hashtext('ruined-membership-agreement-publication'))");
      await tx.query("lock table public.membership_agreement_versions in share row exclusive mode");
    }
    const versions = await tx.query(`select * from public.membership_agreement_versions
      where agreement_key = $1 order by version${apply ? " for update" : ""}`, [AGREEMENT_KEY]);
    if (apply) {
      // Lock version rows before evidence tables: acceptance first reads the version FOR SHARE.
      // This order lets an in-flight acceptance finish before we briefly hold all evidence writes.
      await tx.query("lock table public.membership_agreement_acceptances, public.membership_agreement_receipts in share mode");
    }
    const predecessor = versions.find(row => row.id === input.predecessorId);
    requireCondition(predecessor && predecessor.version === input.predecessorVersion
      && predecessor.content_sha256 === input.predecessorSha256
      && agreementSha256(predecessor.body_text) === input.predecessorSha256,
    "The predecessor ID, version, or immutable content hash no longer matches the reviewed publication.");
    const current = versions.find(row => row.status === "published");
    const existing = versions.find(row => row.version === input.version);
    const evidenceBefore = await snapshotEvidence(tx);
    const result = {
      mode: apply ? "apply" : "dry-run",
      agreementVersion: `${AGREEMENT_KEY}-v${input.version}`,
      title: input.title,
      bodySha256: input.expectedBodySha256,
      predecessorId: predecessor.id,
      predecessorVersion: predecessor.version,
      evidence: evidenceBefore,
      actorProvided: input.actorId != null,
    };
    if (existing) {
      requireCondition(existing.status === "published" && current?.id === existing.id
        && predecessor.status === "retired" && existing.title === input.title
        && existing.body_text === input.body && existing.content_format === "markdown"
        && existing.content_sha256 === input.expectedBodySha256
        && (input.actorId == null || existing.created_by_auth_user_id === input.actorId),
      "The requested version already exists with conflicting content or publication state.");
      return { ...result, status: "already-published", agreementId: existing.id };
    }
    requireCondition(current?.id === predecessor.id && predecessor.status === "published"
      && versions.every(row => row.version <= input.predecessorVersion),
    "The expected predecessor is not the current latest agreement.");
    if (input.actorId != null) {
      const actors = await tx.query("select auth_user_id from public.platform_users where auth_user_id = $1::uuid and status = 'active'", [input.actorId]);
      requireCondition(actors.length === 1, "The explicitly supplied publication actor is not an active platform identity.");
    }
    if (!apply) return { ...result, status: "ready-to-publish", changesCommitted: false };

    const contentsBefore = await versionContentFingerprints(tx);
    await tx.query(`update public.membership_agreement_versions
      set status = 'retired', retired_at = statement_timestamp(), updated_at = statement_timestamp()
      where id = $1::uuid and status = 'published'`, [predecessor.id]);
    const inserted = await tx.query(`insert into public.membership_agreement_versions
      (agreement_key, version, title, content_format, body_text, content_sha256, status,
       effective_at, published_at, created_by_auth_user_id)
      values ($1, $2, $3, 'markdown', $4, $5, 'published', statement_timestamp(), statement_timestamp(), $6::uuid)
      returning id, title, version, body_text, content_sha256, status`,
    [AGREEMENT_KEY, input.version, input.title, input.body, input.expectedBodySha256, input.actorId ?? null]);
    const published = inserted[0];
    requireCondition(published?.status === "published" && published.title === input.title
      && published.version === input.version && published.body_text === input.body
      && published.content_sha256 === input.expectedBodySha256,
    "The stored agreement does not match the reviewed publication.");
    const evidenceAfter = await snapshotEvidence(tx);
    const contentsAfter = new Map((await versionContentFingerprints(tx)).map(row => [row.id, row.fingerprint]));
    requireCondition(JSON.stringify(evidenceBefore) === JSON.stringify(evidenceAfter),
      "Publication would alter a previous acceptance or receipt; the transaction has been rolled back.");
    requireCondition(contentsBefore.every(row => contentsAfter.get(row.id) === row.fingerprint),
      "Publication would alter a previous agreement's immutable content; the transaction has been rolled back.");
    return { ...result, status: "published", agreementId: published.id, changesCommitted: true, previousEvidenceUnchanged: true };
  }, { readOnly: !apply });
}

async function main() {
  const { values } = parseArgs({ options: {
    file: { type: "string" }, title: { type: "string" }, version: { type: "string" },
    "expected-body-sha256": { type: "string" }, "predecessor-id": { type: "string" },
    "predecessor-version": { type: "string" }, "predecessor-sha256": { type: "string" },
    "actor-id": { type: "string" }, apply: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  }, allowPositionals: false });
  if (values.help) {
    console.log("Usage: node scripts/publish-membership-agreement.mjs --file MEMBER_TERMS.md --title TITLE --version 2 --expected-body-sha256 SHA256 --predecessor-id UUID --predecessor-version 1 --predecessor-sha256 SHA256 [--actor-id UUID] [--apply]\nDry-run is the default. DATABASE_URL must be supplied through the environment. This command never accepts terms for members or enables payments.");
    return;
  }
  requireCondition(Boolean(values.file), "Supply a member-facing Markdown file with --file.");
  let body;
  try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(resolve(values.file))); }
  catch { throw new AgreementPublicationError("The member-facing file could not be read as valid UTF-8."); }
  const input = validatePublication({ body, title: values.title, version: Number(values.version),
    expectedBodySha256: values["expected-body-sha256"], predecessorId: values["predecessor-id"],
    predecessorVersion: Number(values["predecessor-version"]), predecessorSha256: values["predecessor-sha256"],
    actorId: values["actor-id"] });
  requireCondition(Boolean(process.env.DATABASE_URL?.trim()), "DATABASE_URL is required; its value is never printed.");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
  const database = { transaction: (fn, { readOnly }) => sql.begin(
    readOnly ? "isolation level repeatable read read only" : "isolation level serializable",
    tx => fn({ query: (text, parameters = []) => tx.unsafe(text, parameters) }),
  ) };
  try { console.log(JSON.stringify(await publishMembershipAgreement(database, input, { apply: values.apply }), null, 2)); }
  finally { await sql.end({ timeout: 5 }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({ error: error instanceof AgreementPublicationError ? error.message : "Agreement publication did not finish successfully. Verify the current version before retrying.",
      ...(typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? { databaseCode: error.code } : {}) }));
    process.exitCode = 1;
  });
}
