import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import {
  REGISTRATION_LEGAL_CONTEXT, REGISTRATION_LEGAL_NOTICE, REGISTRATION_LEGAL_UNAVAILABLE,
  REGISTRATION_PRIVACY_VERSION, type RegistrationLegalAcknowledgment, type RegistrationLegalNotice,
} from "./registration-legal-model";

export class RegistrationLegalError extends Error {
  constructor(readonly status: number, message: string, readonly code?: "registration_documents_changed") { super(message); this.name = "RegistrationLegalError"; }
}
type Agreement = { id: string; version: number; title: string; body_text: string; content_sha256: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentRegistrationAgreement(tx: TransactionSql): Promise<Agreement | null> {
  const configuredVersion = /^ruined_registration-v([1-9]\d{0,8})$/.exec(process.env.MEMBERSHIP_REGISTRATION_TERMS_VERSION?.trim() ?? "");
  if (!configuredVersion) return null;
  const [agreement] = await tx<Array<Agreement>>`select id,version,title,body_text,content_sha256
    from membership_agreement_versions where agreement_key='ruined_registration' and status='published'
      and version=${Number(configuredVersion[1])} and published_at is not null and published_at<=statement_timestamp()
      and (effective_at is null or effective_at<=statement_timestamp()) for share`;
  return agreement ?? null;
}

function notice(agreement: Agreement): RegistrationLegalNotice {
  return { state: "required", privacyVersion: REGISTRATION_PRIVACY_VERSION, privacyHref: "/privacy",
    agreementVersionId: agreement.id, agreementVersion: agreement.version, agreementTitle: agreement.title,
    agreementHref: `/membership/agreement/ruined_registration-v${agreement.version}`, noticeText: REGISTRATION_LEGAL_NOTICE };
}

/** Public legal metadata only, never member identity or acceptance evidence. */
export async function getCurrentRegistrationLegalNotice(): Promise<RegistrationLegalNotice> {
  if (!process.env.DATABASE_URL?.trim()) return { state: "unavailable", message: REGISTRATION_LEGAL_UNAVAILABLE };
  return getApplicationDatabase().begin(async tx => {
    const agreement = await currentRegistrationAgreement(tx);
    return agreement ? notice(agreement) : { state: "unavailable", message: REGISTRATION_LEGAL_UNAVAILABLE };
  });
}

/** Existing completed registrations are not retroactively enrolled. */
export async function getMemberRegistrationLegalNotice(authUserId: string): Promise<RegistrationLegalNotice | null> {
  if (!UUID.test(authUserId)) throw new RegistrationLegalError(403, "Verify your email before completing registration.");
  return getApplicationDatabase().begin(async tx => {
    const [registration] = await tx<Array<{ complete: boolean }>>`select private.ruined_registration_legal_complete(member.id) as complete
      from platform_users identity join ruined_members member on member.person_id=identity.person_id
        and (identity.member_id is null or identity.member_id=member.id)
      join member_registration_access registration on registration.member_id=member.id
      where identity.auth_user_id=${authUserId}::uuid and identity.status='active' and member.deleted_at is null
        and exists(select 1 from platform_role_grants role where role.auth_user_id=identity.auth_user_id
          and role.role_slug='member' and role.revoked_at is null)`;
    if (!registration || registration.complete) return null;
    const agreement = await currentRegistrationAgreement(tx);
    return agreement ? notice(agreement) : { state: "unavailable", message: REGISTRATION_LEGAL_UNAVAILABLE };
  });
}

/** Called under the member lock, in the same transaction that saves details. */
export async function recordRegistrationLegalAcknowledgment(tx: TransactionSql, memberId: string, authUserId: string,
  acknowledgment: RegistrationLegalAcknowledgment | undefined): Promise<void> {
  const [registration] = await tx<Array<{ complete: boolean }>>`select private.ruined_registration_legal_complete(member_id) as complete
    from member_registration_access where member_id=${memberId}::uuid for update`;
  if (!registration || registration.complete) return;
  if (!acknowledgment || acknowledgment.acknowledged !== true) {
    throw new RegistrationLegalError(400, "Review the Privacy Policy and Membership Terms before continuing.");
  }
  const agreement = await currentRegistrationAgreement(tx);
  if (!agreement) throw new RegistrationLegalError(503, REGISTRATION_LEGAL_UNAVAILABLE);
  if (acknowledgment.privacyVersion !== REGISTRATION_PRIVACY_VERSION || acknowledgment.agreementVersionId !== agreement.id) {
    throw new RegistrationLegalError(409, "The registration documents have changed. Reload and review them before continuing.", "registration_documents_changed");
  }
  await tx`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
    values(${memberId}::uuid,'privacy',${REGISTRATION_PRIVACY_VERSION},'accepted',statement_timestamp(),'member',${authUserId}::uuid,
      ${tx.json({ context: REGISTRATION_LEGAL_CONTEXT, affirmativeAction: "checkbox_and_submit", noticeText: REGISTRATION_LEGAL_NOTICE,
        privacy: { version: REGISTRATION_PRIVACY_VERSION, href: "/privacy" },
        membershipTerms: { key: "ruined_registration", id: agreement.id, version: agreement.version, title: agreement.title,
          href: `/membership/agreement/ruined_registration-v${agreement.version}`, sha256: agreement.content_sha256, body: agreement.body_text },
        registrationTermsAccepted: true, paidAgreementAccepted: false, chargeAuthorized: false })}::jsonb,${`registration-documents:${memberId}`})
    on conflict(dedupe_key) do nothing`;
  const [recorded] = await tx<Array<{ complete: boolean }>>`select private.ruined_registration_legal_complete(${memberId}::uuid) as complete`;
  if (!recorded?.complete) throw new RegistrationLegalError(409, "Your document acknowledgment could not be recorded. Please try again.");
}
