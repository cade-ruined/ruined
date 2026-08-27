import "server-only";

import parsePhoneNumber from "libphonenumber-js/min";

import { getApplicationDatabase } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { supportedShippingCountry } from "@/lib/membership/phone";
import type {
  MemberAccountSnapshot,
  MemberArtifactsSnapshot,
  MemberCircleSnapshot,
  MemberExperienceSummary,
  MemberExperiencesSnapshot,
  MemberHomeSnapshot,
  MemberIdentity,
  MemberLearningResourceDetail,
  MemberLearningResourceSummary,
  MemberLearningSnapshot,
  MemberOnboardingSnapshot,
  MemberProfileSnapshot,
  MemberDirectoryPreferences,
  MemberTimelineSnapshot,
  MemberUpdateItem,
  MemberUpdatesSnapshot,
  FoundationSummary,
  MembershipStandingState,
  PrivacySafePersonSummary,
  ProgressionSummary,
} from "@/lib/membership/model";
import type {
  AccountState,
  BillingState,
  FoundationsState,
  ProgramState,
} from "@/lib/platform/model";

export class MembershipAccessDeniedError extends Error {
  constructor(message = "This identity does not have member access.") {
    super(message);
    this.name = "MembershipAccessDeniedError";
  }
}

export class MembershipInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipInputError";
  }
}

export class MembershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipConflictError";
  }
}

type IdentityRow = {
  account_state: AccountState;
  administrative_onboarding_state: MemberIdentity["administrativeOnboardingState"];
  auth_user_id: string;
  billing_state: BillingState;
  cancellation_effective_at: Date | string | null;
  email: string;
  foundations_state: FoundationsState;
  member_id: string;
  person_id: string;
  program_state: ProgramState;
  standing_state: MembershipStandingState;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function identityFromRow(row: IdentityRow): MemberIdentity {
  return {
    accountState: row.account_state,
    administrativeOnboardingState: row.administrative_onboarding_state,
    authUserId: row.auth_user_id,
    billingState: row.billing_state,
    cancellationEffectiveAt: toIso(row.cancellation_effective_at),
    email: row.email,
    foundationsState: row.foundations_state,
    memberId: row.member_id,
    personId: row.person_id,
    programState: row.program_state,
    standingState: row.standing_state,
  };
}

export async function getMemberIdentity(
  authUserId: string,
): Promise<MemberIdentity | null> {
  const sql = getApplicationDatabase();
  const rows = await sql<Array<IdentityRow>>`
    select
      platform_user.auth_user_id,
      member.id as member_id,
      member.person_id,
      coalesce(primary_email.email, member.email) as email,
      lifecycle.account_state,
      lifecycle.billing_state,
      lifecycle.program_state,
      lifecycle.foundations_state,
      lifecycle.administrative_onboarding_state,
      lifecycle.standing_state,
      lifecycle.cancellation_effective_at
    from platform_users platform_user
    join platform_role_grants member_grant
      on member_grant.auth_user_id = platform_user.auth_user_id
      and member_grant.role_slug = 'member'
      and member_grant.revoked_at is null
    join ruined_members member
      on member.person_id = platform_user.person_id
    join member_lifecycle lifecycle
      on lifecycle.member_id = member.id
    left join lateral (
      select email_address.email
      from person_email_addresses email_address
      where email_address.person_id = member.person_id
        and email_address.retired_at is null
      order by email_address.is_primary desc, email_address.created_at
      limit 1
    ) primary_email on true
    where platform_user.auth_user_id = ${authUserId}::uuid
      and platform_user.status = 'active'
      and member.person_id is not null
    limit 1
  `;
  return rows[0] ? identityFromRow(rows[0]) : null;
}

async function requireMemberIdentity(authUserId: string): Promise<MemberIdentity> {
  const identity = await getMemberIdentity(authUserId);
  if (!identity) throw new MembershipAccessDeniedError();
  return identity;
}

function requireMemberCapability(
  identity: MemberIdentity,
  capability: Parameters<typeof memberCan>[1],
) {
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, capability)) throw new MembershipAccessDeniedError();
  return access;
}

type ProgressionRow = {
  assigned_at: Date | string | null;
  display_name: string;
  position: number;
  slug: ProgressionSummary["slug"];
};

export async function getMemberProgression(
  memberId: string,
): Promise<ProgressionSummary> {
  const sql = getApplicationDatabase();
  const rows = await sql<Array<ProgressionRow>>`
    select
      level.slug,
      level.display_name,
      level.position,
      assignment.assigned_at
    from member_lifecycle lifecycle
    join membership_progression_levels level
      on level.slug = lifecycle.current_progression_level_slug
    left join member_progression_assignments assignment
      on assignment.member_id = lifecycle.member_id
      and assignment.ended_at is null
      and assignment.progression_level_slug = lifecycle.current_progression_level_slug
    where lifecycle.member_id = ${memberId}::uuid
    limit 1
  `;
  const row = rows[0];
  return row
    ? {
        assignedAt: toIso(row.assigned_at),
        name: row.display_name,
        position: row.position,
        slug: row.slug,
      }
    : { assignedAt: null, name: "Member", position: 1, slug: "member" };
}

type OnboardingRow = {
  acceptance_id: string | null;
  accepted_at: Date | string | null;
  agreement_body: string | null;
  agreement_id: string | null;
  agreement_published_at: Date | string | null;
  agreement_title: string | null;
  agreement_version: number | null;
  apparel_sizing: Record<string, unknown> | null;
  avatar_storage_path: string | null;
  birth_date: Date | string | null;
  completed_at: Date | string | null;
  legal_name: string | null;
  mobile_e164: string | null;
  preferred_name: string | null;
  receipt_id: string | null;
  shipping_address: Record<string, unknown> | null;
  state: MemberOnboardingSnapshot["state"] | null;
};

function hasRequiredAddress(value: Record<string, unknown> | null): boolean {
  if (!value) return false;
  return ["addressLine1", "city", "region", "postalCode", "countryCode"].every(
    (key) => typeof value[key] === "string" && value[key].trim().length > 0,
  );
}

function hasRequiredSizing(value: Record<string, unknown> | null): boolean {
  return Boolean(
    value && typeof value.top === "string" && value.top.trim().length > 0,
  );
}

function onboardingFieldsComplete(row: OnboardingRow): boolean {
  return Boolean(
    row.legal_name?.trim() &&
      row.preferred_name?.trim() &&
      row.mobile_e164?.trim() &&
      row.birth_date &&
      hasRequiredAddress(row.shipping_address) &&
      hasRequiredSizing(row.apparel_sizing),
  );
}

export async function getMemberOnboarding(
  authUserId: string,
): Promise<MemberOnboardingSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  requireMemberCapability(identity, "profile.read");
  const sql = getApplicationDatabase();
  const rows = await sql<Array<OnboardingRow>>`
    with current_agreement as (
      select agreement.*
      from membership_agreement_versions agreement
      where agreement.status = 'published'
        and agreement.agreement_key = 'ruined_membership'
        and (agreement.effective_at is null or agreement.effective_at <= statement_timestamp())
      order by agreement.effective_at desc nulls last, agreement.published_at desc
      limit 1
    )
    select
      onboarding.state,
      onboarding.completed_at,
      profile.preferred_name,
      profile.avatar_storage_path,
      private_profile.legal_name,
      private_profile.mobile_e164,
      private_profile.birth_date,
      private_profile.default_fulfillment_address as shipping_address,
      private_profile.apparel_sizing,
      agreement.title as agreement_title,
      agreement.id as agreement_id,
      agreement.version as agreement_version,
      agreement.body_text as agreement_body,
      agreement.published_at as agreement_published_at,
      acceptance.id as acceptance_id,
      acceptance.accepted_at,
      receipt.id as receipt_id
    from ruined_members member
    left join person_profiles profile on profile.person_id = member.person_id
    left join person_private_profiles private_profile on private_profile.person_id = member.person_id
    left join member_onboardings onboarding on onboarding.member_id = member.id
    left join current_agreement agreement on true
    left join lateral (
      select accepted.*
      from membership_agreement_acceptances accepted
      where accepted.member_id = member.id
        and accepted.agreement_version_id = agreement.id
      order by accepted.accepted_at desc, accepted.created_at desc
      limit 1
    ) acceptance on true
    left join membership_agreement_receipts receipt
      on receipt.acceptance_id = acceptance.id
    where member.id = ${identity.memberId}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    agreement: {
      acceptanceId: row.acceptance_id,
      acceptedAt: toIso(row.accepted_at),
      body: row.agreement_body,
      id: row.agreement_id,
      publishedAt: toIso(row.agreement_published_at),
      receiptId: row.receipt_id,
      title: row.agreement_title,
      version: row.agreement_version === null ? null : String(row.agreement_version),
    },
    completedAt: toIso(row.completed_at),
    email: identity.email,
    profile: {
      apparelSizing: row.apparel_sizing,
      avatarUrl: row.avatar_storage_path,
      birthDate: row.birth_date ? String(row.birth_date).slice(0, 10) : null,
      fulfillmentAddress: row.shipping_address,
      legalName: row.legal_name,
      mobile: row.mobile_e164,
      preferredName: row.preferred_name,
    },
    requiredFieldsComplete: onboardingFieldsComplete(row),
    state: row.state ?? identity.administrativeOnboardingState,
  };
}

export type MemberOnboardingProfileInput = {
  apparelTopSize: string;
  birthDate: string;
  legalName: string;
  mobile: string;
  preferredName: string;
  shippingAddress: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    countryCode: string;
    postalCode: string;
    region: string;
  };
};

const E164 = /^\+[1-9][0-9]{1,14}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanRequired(value: string, label: string, max: number): string {
  const clean = value.trim();
  if (!clean || clean.length > max) {
    throw new MembershipInputError(`${label} is required.`);
  }
  return clean;
}

function validateOnboardingProfile(input: MemberOnboardingProfileInput) {
  const legalName = cleanRequired(input.legalName, "Legal name", 180);
  const preferredName = cleanRequired(input.preferredName, "Preferred name", 120);
  const mobile = input.mobile.trim();
  const parsedMobile = mobile.startsWith("+")
    ? parsePhoneNumber(mobile, { extract: false })
    : undefined;
  if (
    !E164.test(mobile) ||
    !parsedMobile?.isPossible() ||
    parsedMobile.ext ||
    parsedMobile.number !== mobile
  ) {
    throw new MembershipInputError("Use a complete mobile number with country code.");
  }
  if (!ISO_DATE.test(input.birthDate)) {
    throw new MembershipInputError("A valid birth date is required.");
  }
  const birthDate = new Date(`${input.birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) {
    throw new MembershipInputError("A valid birth date is required.");
  }

  const countryCode = supportedShippingCountry(input.shippingAddress.countryCode);
  if (!countryCode) {
    throw new MembershipInputError("Choose a recognized country.");
  }
  const shippingAddress = {
    addressLine1: cleanRequired(input.shippingAddress.addressLine1, "Address", 160),
    addressLine2: input.shippingAddress.addressLine2?.trim().slice(0, 160) || null,
    city: cleanRequired(input.shippingAddress.city, "City", 100),
    countryCode,
    postalCode: cleanRequired(input.shippingAddress.postalCode, "Postal code", 24),
    region: cleanRequired(input.shippingAddress.region, "State or region", 100),
  };
  const apparelTopSize = cleanRequired(input.apparelTopSize, "Apparel size", 40);

  return { apparelTopSize, birthDate: input.birthDate, legalName, mobile, preferredName, shippingAddress };
}

export async function saveMemberOnboardingProfile(
  authUserId: string,
  input: MemberOnboardingProfileInput,
): Promise<MemberOnboardingSnapshot> {
  const identity = await requireMemberIdentity(authUserId);
  requireMemberCapability(identity, "profile.write");
  const clean = validateOnboardingProfile(input);
  const sql = getApplicationDatabase();

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 41)`;
    await tx`
      insert into person_profiles (person_id, display_name, preferred_name)
      values (${identity.personId}::uuid, ${clean.preferredName}, ${clean.preferredName})
      on conflict (person_id) do update
      set
        display_name = excluded.display_name,
        preferred_name = excluded.preferred_name,
        updated_at = statement_timestamp()
    `;
    await tx`
      insert into person_private_profiles (
        person_id,
        legal_name,
        mobile_e164,
        birth_date,
        default_fulfillment_address,
        apparel_sizing
      ) values (
        ${identity.personId}::uuid,
        ${clean.legalName},
        ${clean.mobile},
        ${clean.birthDate}::date,
        ${JSON.stringify(clean.shippingAddress)}::jsonb,
        ${JSON.stringify({ top: clean.apparelTopSize })}::jsonb
      )
      on conflict (person_id) do update
      set
        legal_name = excluded.legal_name,
        mobile_e164 = excluded.mobile_e164,
        birth_date = excluded.birth_date,
        default_fulfillment_address = excluded.default_fulfillment_address,
        apparel_sizing = excluded.apparel_sizing,
        updated_at = statement_timestamp()
    `;
    await tx`
      insert into member_onboardings (
        member_id,
        state,
        form_version,
        requirements_snapshot,
        profile_completed_at,
        started_at
      ) values (
        ${identity.memberId}::uuid,
        'in_progress',
        'membership-entry-v1',
        ${JSON.stringify({
          agreement: true,
          apparelSizing: true,
          birthDate: true,
          legalName: true,
          mobile: true,
          preferredName: true,
          shippingAddress: true,
        })}::jsonb,
        statement_timestamp(),
        statement_timestamp()
      )
      on conflict (member_id) do update
      set
        state = case
          when member_onboardings.state = 'completed' then 'completed'
          else 'in_progress'
        end,
        profile_completed_at = statement_timestamp(),
        started_at = coalesce(member_onboardings.started_at, statement_timestamp()),
        version = member_onboardings.version + 1,
        updated_at = statement_timestamp()
    `;
    await tx`
      update member_lifecycle
      set
        administrative_onboarding_state = case
          when administrative_onboarding_state = 'completed' then 'completed'
          else 'in_progress'
        end,
        version = version + 1,
        updated_at = statement_timestamp()
      where member_id = ${identity.memberId}::uuid
    `;
    await tx`
      insert into member_onboarding_events (
        member_id,
        event_type,
        field_name,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${identity.memberId}::uuid,
        'field_completed',
        'required_profile',
        ${authUserId}::uuid,
        '{"source":"member"}'::jsonb,
        ${`member-profile:${identity.memberId}:${crypto.randomUUID()}`}
      )
    `;
  });

  const onboarding = await getMemberOnboarding(authUserId);
  if (!onboarding) throw new Error("Saved onboarding could not be reloaded.");
  return onboarding;
}

export type AcceptMembershipAgreementInput = {
  affirmativeAction: "checkbox_and_submit";
  ageConfirmed: true;
  agreementVersionId: string;
  evidence: {
    origin: string | null;
    userAgent: string | null;
  };
  minimumAge: number;
  signerName: string;
  attemptId: string;
};

export type MembershipAgreementAcceptanceResult = {
  acceptance: {
    acceptedAt: string;
    affirmativeAction: string;
    agreementKey: string;
    agreementVersion: number;
    id: string;
  };
  onboarding: MemberOnboardingSnapshot;
};

export async function acceptPublishedMembershipAgreement(
  authUserId: string,
  input: AcceptMembershipAgreementInput,
): Promise<MembershipAgreementAcceptanceResult> {
  if (!UUID.test(input.agreementVersionId)) {
    throw new MembershipInputError("The agreement version is not valid.");
  }
  if (!UUID.test(input.attemptId)) {
    throw new MembershipInputError("Start a new agreement attempt and try again.");
  }
  if (input.ageConfirmed !== true) {
    throw new MembershipInputError("Confirm the current minimum-age policy.");
  }
  if (input.affirmativeAction !== "checkbox_and_submit") {
    throw new MembershipInputError("An affirmative agreement action is required.");
  }
  if (!Number.isInteger(input.minimumAge) || input.minimumAge < 16 || input.minimumAge > 120) {
    throw new MembershipInputError("The minimum-age policy is not valid.");
  }
  const signerName = cleanRequired(input.signerName, "Legal name", 180);
  const identity = await requireMemberIdentity(authUserId);
  requireMemberCapability(identity, "profile.write");
  const sql = getApplicationDatabase();

  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 42)`;
    const profileRows = await tx<Array<{ birth_date: Date | string | null; legal_name: string | null }>>`
      select private_profile.birth_date, private_profile.legal_name
      from person_private_profiles private_profile
      where private_profile.person_id = ${identity.personId}::uuid
      limit 1
      for update
    `;
    const profile = profileRows[0];
    if (!profile?.legal_name || profile.legal_name.trim() !== signerName) {
      throw new MembershipConflictError("The signer name must match the saved legal name.");
    }
    if (!profile.birth_date) {
      throw new MembershipConflictError("Complete the member profile before accepting the agreement.");
    }

    const birthDate = toIso(profile.birth_date)?.slice(0, 10);
    if (!birthDate) {
      throw new MembershipConflictError("Complete the member profile before accepting the agreement.");
    }
    const ageRows = await tx<Array<{ eligible: boolean }>>`
      select ${birthDate}::date
        <= current_date - make_interval(years => ${input.minimumAge}) as eligible
    `;
    if (!ageRows[0]?.eligible) {
      throw new MembershipConflictError(
        `Membership currently requires an age of at least ${input.minimumAge}.`,
      );
    }

    const agreementRows = await tx<
      Array<{
        agreement_key: string;
        body_text: string;
        content_sha256: string;
        id: string;
        title: string;
        version: number;
      }>
    >`
      select id, agreement_key, version, title, body_text, content_sha256
      from membership_agreement_versions
      where id = ${input.agreementVersionId}::uuid
        and agreement_key = 'ruined_membership'
        and status = 'published'
        and (effective_at is null or effective_at <= statement_timestamp())
      limit 1
      for share
    `;
    const agreement = agreementRows[0];
    if (!agreement) {
      throw new MembershipConflictError(
        "This agreement is no longer current. Reload the page before continuing.",
      );
    }

    const ageDedupeKey = `membership-age:${identity.memberId}:${agreement.id}:${input.attemptId}`;
    const ageRowsInserted = await tx<Array<{ id: number }>>`
      insert into member_consents (
        member_id,
        consent_type,
        policy_version,
        decision,
        accepted_at,
        source,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${identity.memberId}::uuid,
        'age_attestation',
        ${`minimum-age-${input.minimumAge}`},
        'accepted',
        statement_timestamp(),
        'member',
        ${authUserId}::uuid,
        ${JSON.stringify({ minimumAge: input.minimumAge, source: "my_ruined" })}::jsonb,
        ${ageDedupeKey}
      )
      on conflict (dedupe_key) do nothing
      returning id
    `;
    const ageAttestationRows = ageRowsInserted.length
      ? ageRowsInserted
      : await tx<Array<{ id: number }>>`
          select id
          from member_consents
          where dedupe_key = ${ageDedupeKey}
            and member_id = ${identity.memberId}::uuid
            and consent_type = 'age_attestation'
            and decision = 'accepted'
          limit 1
        `;
    const ageAttestation = ageAttestationRows[0];
    if (!ageAttestation) throw new Error("The age attestation could not be recorded.");

    const acceptanceDedupeKey =
      `membership-agreement:${identity.memberId}:${agreement.id}:${input.attemptId}`;
    const acceptedRows = await tx<
      Array<{
        accepted_at: Date | string;
        agreement_key_snapshot: string;
        agreement_version_snapshot: number;
        id: string;
      }>
    >`
      insert into membership_agreement_acceptances (
        agreement_version_id,
        person_id,
        member_id,
        accepted_by_auth_user_id,
        age_attestation_id,
        signer_name_snapshot,
        signer_email_snapshot,
        affirmative_action,
        acceptance_context,
        accepted_at,
        agreement_key_snapshot,
        agreement_version_snapshot,
        agreement_title_snapshot,
        agreement_content_sha256,
        agreement_body_snapshot,
        acceptance_evidence,
        dedupe_key
      ) values (
        ${agreement.id}::uuid,
        ${identity.personId}::uuid,
        ${identity.memberId}::uuid,
        ${authUserId}::uuid,
        ${ageAttestation.id},
        ${signerName},
        ${identity.email},
        'checkbox_and_submit',
        'initial_membership',
        statement_timestamp(),
        ${agreement.agreement_key},
        ${agreement.version},
        ${agreement.title},
        ${agreement.content_sha256},
        ${agreement.body_text},
        ${JSON.stringify({
          channel: "my_ruined",
          origin: input.evidence.origin,
          userAgent: input.evidence.userAgent?.slice(0, 500) ?? null,
        })}::jsonb,
        ${acceptanceDedupeKey}
      )
      on conflict (dedupe_key) do nothing
      returning id, accepted_at, agreement_key_snapshot, agreement_version_snapshot
    `;
    const acceptanceRows = acceptedRows.length
      ? acceptedRows
      : await tx<
          Array<{
            accepted_at: Date | string;
            agreement_key_snapshot: string;
            agreement_version_snapshot: number;
            id: string;
          }>
        >`
          select id, accepted_at, agreement_key_snapshot, agreement_version_snapshot
          from membership_agreement_acceptances
          where dedupe_key = ${acceptanceDedupeKey}
            and member_id = ${identity.memberId}::uuid
            and accepted_by_auth_user_id = ${authUserId}::uuid
          limit 1
        `;
    const acceptance = acceptanceRows[0];
    if (!acceptance) {
      throw new MembershipConflictError(
        "This agreement attempt belongs to a different member identity.",
      );
    }

    await tx`
      insert into member_onboardings (
        member_id,
        state,
        form_version,
        requirements_snapshot,
        agreement_completed_at,
        started_at
      ) values (
        ${identity.memberId}::uuid,
        'in_progress',
        'membership-entry-v1',
        ${JSON.stringify({
          agreement: true,
          apparelSizing: true,
          birthDate: true,
          legalName: true,
          mobile: true,
          preferredName: true,
          shippingAddress: true,
        })}::jsonb,
        ${acceptance.accepted_at},
        statement_timestamp()
      )
      on conflict (member_id) do update
      set
        state = case
          when member_onboardings.state = 'completed' then 'completed'
          else 'in_progress'
        end,
        agreement_completed_at = coalesce(
          member_onboardings.agreement_completed_at,
          excluded.agreement_completed_at
        ),
        started_at = coalesce(member_onboardings.started_at, statement_timestamp()),
        version = member_onboardings.version + 1,
        updated_at = statement_timestamp()
    `;
    await tx`
      update member_lifecycle
      set
        administrative_onboarding_state = case
          when administrative_onboarding_state = 'completed' then 'completed'
          else 'in_progress'
        end,
        version = version + 1,
        updated_at = statement_timestamp()
      where member_id = ${identity.memberId}::uuid
    `;

    return {
      acceptedAt: toIso(acceptance.accepted_at)!,
      affirmativeAction: "checkbox_and_submit",
      agreementKey: acceptance.agreement_key_snapshot,
      agreementVersion: acceptance.agreement_version_snapshot,
      id: acceptance.id,
    };
  });

  const onboarding = await getMemberOnboarding(authUserId);
  if (!onboarding) throw new Error("Agreement acceptance could not be reloaded.");
  return { acceptance: result, onboarding };
}

export async function completeMemberAdministrativeOnboarding(
  authUserId: string,
): Promise<MemberOnboardingSnapshot> {
  const identity = await requireMemberIdentity(authUserId);
  requireMemberCapability(identity, "profile.write");
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 43)`;
    const lifecycleRows = await tx<
      Array<{
        administrative_onboarding_state: MemberIdentity["administrativeOnboardingState"];
        program_state: ProgramState;
        standing_state: MembershipStandingState;
      }>
    >`
      select administrative_onboarding_state, program_state, standing_state
      from member_lifecycle
      where member_id = ${identity.memberId}::uuid
      limit 1
      for update
    `;
    const lifecycleBefore = lifecycleRows[0];
    if (!lifecycleBefore) throw new MembershipAccessDeniedError();
    const updated = await tx<Array<{ member_id: string }>>`
      update member_onboardings onboarding
      set
        state = 'completed',
        billing_confirmed_at = coalesce(onboarding.billing_confirmed_at, statement_timestamp()),
        completed_at = coalesce(onboarding.completed_at, statement_timestamp()),
        completion_evidence = onboarding.completion_evidence || '{"source":"member_entry_reconciliation"}'::jsonb,
        version = onboarding.version + 1,
        updated_at = statement_timestamp()
      from member_lifecycle lifecycle
      where onboarding.member_id = ${identity.memberId}::uuid
        and lifecycle.member_id = onboarding.member_id
        and lifecycle.billing_state = 'active'
        and onboarding.profile_completed_at is not null
        and onboarding.agreement_completed_at is not null
      returning onboarding.member_id
    `;
    if (!updated[0]) {
      throw new MembershipConflictError(
        "Profile, agreement, and active payment must all be confirmed first.",
      );
    }
    await tx`
      update member_lifecycle
      set
        administrative_onboarding_state = 'completed',
        program_state = case
          when program_state = 'prospect' then 'onboarding'
          else program_state
        end,
        standing_state = case
          when standing_state = 'pre_active' then 'active'
          else standing_state
        end,
        access_started_at = coalesce(access_started_at, statement_timestamp()),
        version = version + 1,
        updated_at = statement_timestamp()
      where member_id = ${identity.memberId}::uuid
    `;
    const historyRows = [
      lifecycleBefore.administrative_onboarding_state !== "completed"
        ? {
            dimension: "administrative_onboarding",
            next: "completed",
            previous: lifecycleBefore.administrative_onboarding_state,
          }
        : null,
      lifecycleBefore.program_state === "prospect"
        ? { dimension: "program", next: "onboarding", previous: "prospect" }
        : null,
      lifecycleBefore.standing_state === "pre_active"
        ? { dimension: "standing", next: "active", previous: "pre_active" }
        : null,
    ].filter((row): row is { dimension: string; next: string; previous: string } => Boolean(row));
    for (const history of historyRows) {
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          actor_auth_user_id,
          dedupe_key
        ) values (
          ${identity.memberId}::uuid,
          ${history.dimension},
          ${history.previous},
          ${history.next},
          'administrative_onboarding_completed',
          'member',
          ${authUserId}::uuid,
          ${`onboarding-complete:${identity.memberId}:${history.dimension}`}
        )
        on conflict (dedupe_key) do nothing
      `;
    }
    await tx`
      insert into member_onboarding_events (
        member_id,
        event_type,
        previous_state,
        next_state,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${identity.memberId}::uuid,
        'completed',
        'in_progress',
        'completed',
        ${authUserId}::uuid,
        '{"source":"member_entry_reconciliation"}'::jsonb,
        ${`member-onboarding-complete:${identity.memberId}`}
      )
      on conflict (dedupe_key) do nothing
    `;
  });
  const onboarding = await getMemberOnboarding(authUserId);
  if (!onboarding) throw new Error("Completed onboarding could not be reloaded.");
  return onboarding;
}

export async function getMemberAccount(
  authUserId: string,
): Promise<MemberAccountSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = requireMemberCapability(identity, "account.read");
  const rows = await getApplicationDatabase()<
    Array<{
      accepted_at: Date | string | null;
      agreement_title: string | null;
      agreement_version: number | null;
      receipt_id: string | null;
    }>
  >`
    select
      acceptance.accepted_at,
      acceptance.agreement_title_snapshot as agreement_title,
      acceptance.agreement_version_snapshot as agreement_version,
      receipt.id as receipt_id
    from ruined_members member
    left join lateral (
      select accepted.*
      from membership_agreement_acceptances accepted
      where accepted.member_id = member.id
        and accepted.person_id = member.person_id
      order by accepted.accepted_at desc, accepted.created_at desc
      limit 1
    ) acceptance on true
    left join membership_agreement_receipts receipt
      on receipt.acceptance_id = acceptance.id
    where member.id = ${identity.memberId}::uuid
      and member.person_id = ${identity.personId}::uuid
    limit 1
  `;
  const agreement = rows[0];
  return {
    access,
    agreement: {
      acceptedAt: toIso(agreement?.accepted_at),
      receiptId: agreement?.receipt_id ?? null,
      title: agreement?.agreement_title ?? null,
      version:
        agreement?.agreement_version === null || agreement?.agreement_version === undefined
          ? null
          : String(agreement.agreement_version),
    },
    billingState: identity.billingState,
    email: identity.email,
    standingState: identity.standingState,
  };
}

export type AgreementReceiptDownload = {
  acceptance: {
    acceptedAt: string;
    affirmativeAction: string;
    agreementBody: string;
    agreementContentSha256: string;
    agreementKey: string;
    agreementTitle: string;
    agreementVersion: number;
    id: string;
    signerEmail: string;
    signerName: string;
  };
  receipt: {
    byteSize: number;
    contentSha256: string;
    deliveryMethod: "database_snapshot" | "storage";
    generatedAt: string;
    generatorVersion: string;
    id: string;
    mimeType: string;
    storageBucket: string | null;
    storagePath: string | null;
  };
};

export async function getAgreementReceiptDownload(
  authUserId: string,
): Promise<AgreementReceiptDownload | null> {
  const identity = await requireMemberIdentity(authUserId);
  requireMemberCapability(identity, "account.read");
  const sql = getApplicationDatabase();
  const rows = await sql<
    Array<{
      acceptance_id: string;
      accepted_at: Date | string;
      affirmative_action: string;
      agreement_body_snapshot: string;
      agreement_content_sha256: string;
      agreement_key_snapshot: string;
      agreement_title_snapshot: string;
      agreement_version_snapshot: number;
      byte_size: number | string;
      content_sha256: string;
      delivery_method: AgreementReceiptDownload["receipt"]["deliveryMethod"];
      generated_at: Date | string;
      generator_version: string;
      mime_type: string;
      receipt_id: string;
      signer_email_snapshot: string;
      signer_name_snapshot: string;
      storage_bucket: string | null;
      storage_path: string | null;
    }>
  >`
    select
      receipt.id as receipt_id,
      receipt.delivery_method,
      receipt.storage_bucket,
      receipt.storage_path,
      receipt.mime_type,
      receipt.byte_size,
      receipt.content_sha256,
      receipt.generator_version,
      receipt.generated_at,
      acceptance.id as acceptance_id,
      acceptance.accepted_at,
      acceptance.affirmative_action,
      acceptance.signer_name_snapshot,
      acceptance.signer_email_snapshot,
      acceptance.agreement_key_snapshot,
      acceptance.agreement_version_snapshot,
      acceptance.agreement_title_snapshot,
      acceptance.agreement_content_sha256,
      acceptance.agreement_body_snapshot
    from membership_agreement_receipts receipt
    join membership_agreement_acceptances acceptance
      on acceptance.id = receipt.acceptance_id
    where acceptance.member_id = ${identity.memberId}::uuid
      and acceptance.person_id = ${identity.personId}::uuid
    order by receipt.generated_at desc
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    acceptance: {
      acceptedAt: toIso(row.accepted_at)!,
      affirmativeAction: row.affirmative_action,
      agreementBody: row.agreement_body_snapshot,
      agreementContentSha256: row.agreement_content_sha256,
      agreementKey: row.agreement_key_snapshot,
      agreementTitle: row.agreement_title_snapshot,
      agreementVersion: row.agreement_version_snapshot,
      id: row.acceptance_id,
      signerEmail: row.signer_email_snapshot,
      signerName: row.signer_name_snapshot,
    },
    receipt: {
      byteSize: Number(row.byte_size),
      contentSha256: row.content_sha256,
      deliveryMethod: row.delivery_method,
      generatedAt: toIso(row.generated_at)!,
      generatorVersion: row.generator_version,
      id: row.receipt_id,
      mimeType: row.mime_type,
      storageBucket: row.storage_bucket,
      storagePath: row.storage_path,
    },
  };
}

type ProfileRow = {
  accessibility_notes: string | null;
  apparel_sizing: Record<string, unknown> | null;
  avatar_storage_path: string | null;
  avatar_visible: boolean | null;
  bio: string | null;
  bio_visible: boolean | null;
  birth_date: Date | string | null;
  building_now: string | null;
  building_visible: boolean | null;
  default_fulfillment_address: Record<string, unknown> | null;
  directory_status: MemberDirectoryPreferences["directoryStatus"] | null;
  display_name: string | null;
  email_scope: MemberDirectoryPreferences["emailScope"] | null;
  legal_name: string | null;
  location_label: string | null;
  location_visible: boolean | null;
  mobile_e164: string | null;
  phone_scope: MemberDirectoryPreferences["phoneScope"] | null;
  preferred_name: string | null;
  preference_version: number | null;
  timezone: string | null;
};

function safeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("/") || /^https:\/\//i.test(value) ? value : null;
}

export async function getMemberProfile(
  authUserId: string,
): Promise<MemberProfileSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = requireMemberCapability(identity, "profile.read");
  const [progression, rows] = await Promise.all([
    getMemberProgression(identity.memberId),
    getApplicationDatabase()<Array<ProfileRow>>`
      select
        profile.display_name,
        profile.preferred_name,
        profile.avatar_storage_path,
        profile.timezone,
        profile.location_label,
        profile.bio,
        profile.building_now,
        private_profile.legal_name,
        private_profile.mobile_e164,
        private_profile.birth_date,
        private_profile.default_fulfillment_address,
        private_profile.apparel_sizing,
        private_profile.accessibility_notes,
        preference.directory_status,
        preference.avatar_visible,
        preference.location_visible,
        preference.bio_visible,
        preference.building_visible,
        preference.email_scope,
        preference.phone_scope,
        preference.version as preference_version
      from ruined_members member
      left join person_profiles profile on profile.person_id = member.person_id
      left join person_private_profiles private_profile on private_profile.person_id = member.person_id
      left join member_directory_preferences preference on preference.member_id = member.id
      where member.id = ${identity.memberId}::uuid
      limit 1
    `,
  ]);
  const row = rows[0];
  if (!row) return null;
  const displayName = row.display_name?.trim() || row.preferred_name?.trim() || "Member";
  return {
    access,
    directory: {
      avatarUrl: safeAvatarUrl(row.avatar_storage_path),
      bio: row.bio,
      buildingNow: row.building_now,
      displayName,
      location: row.location_label,
      preferredName: row.preferred_name,
      timezone: row.timezone,
    },
    email: identity.email,
    foundationsState: identity.foundationsState,
    memberId: identity.memberId,
    preferences: {
      avatarVisible: row.avatar_visible ?? true,
      bioVisible: row.bio_visible ?? false,
      buildingVisible: row.building_visible ?? false,
      directoryStatus: row.directory_status ?? "hidden",
      emailScope: row.email_scope ?? "none",
      locationVisible: row.location_visible ?? false,
      phoneScope: row.phone_scope ?? "none",
      version: row.preference_version ?? 1,
    },
    privateProfile: {
      accessibilityNotes: row.accessibility_notes,
      apparelSizing: row.apparel_sizing,
      birthDate: row.birth_date ? toIso(row.birth_date)?.slice(0, 10) ?? null : null,
      fulfillmentAddress: row.default_fulfillment_address,
      legalName: row.legal_name,
      mobile: row.mobile_e164,
    },
    progression,
  };
}

export type MemberProfileInput = {
  accessibilityNotes: string;
  bio: string;
  buildingNow: string;
  directory: Omit<MemberDirectoryPreferences, "version">;
  displayName: string;
  location: string;
  preferredName: string;
  timezone: string;
};

export async function saveMemberProfile(
  authUserId: string,
  input: MemberProfileInput,
): Promise<MemberProfileSnapshot> {
  const identity = await requireMemberIdentity(authUserId);
  requireMemberCapability(identity, "profile.write");
  const displayName = cleanRequired(input.displayName, "Display name", 120);
  const preferredName = cleanRequired(input.preferredName, "Preferred name", 120);
  const timezone = input.timezone.trim().slice(0, 100) || "America/Denver";
  const location = input.location.trim().slice(0, 160) || null;
  const bio = input.bio.trim().slice(0, 1200) || null;
  const buildingNow = input.buildingNow.trim().slice(0, 500) || null;
  const accessibilityNotes = input.accessibilityNotes.trim().slice(0, 2000) || null;
  if (!['hidden', 'circle_visible'].includes(input.directory.directoryStatus)) {
    throw new MembershipInputError("The Circle directory choice is not valid.");
  }
  if (!["none", "accountability_partner", "circle"].includes(input.directory.emailScope)) {
    throw new MembershipInputError("The email-sharing choice is not valid.");
  }
  if (!["none", "accountability_partner", "circle"].includes(input.directory.phoneScope)) {
    throw new MembershipInputError("The phone-sharing choice is not valid.");
  }
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 44)`;
    await tx`
      insert into person_profiles (
        person_id,
        display_name,
        preferred_name,
        timezone,
        location_label,
        bio,
        building_now
      ) values (
        ${identity.personId}::uuid,
        ${displayName},
        ${preferredName},
        ${timezone},
        ${location},
        ${bio},
        ${buildingNow}
      )
      on conflict (person_id) do update
      set
        display_name = excluded.display_name,
        preferred_name = excluded.preferred_name,
        timezone = excluded.timezone,
        location_label = excluded.location_label,
        bio = excluded.bio,
        building_now = excluded.building_now,
        updated_at = statement_timestamp()
    `;
    await tx`
      insert into person_private_profiles (person_id, accessibility_notes)
      values (${identity.personId}::uuid, ${accessibilityNotes})
      on conflict (person_id) do update
      set accessibility_notes = excluded.accessibility_notes,
          updated_at = statement_timestamp()
    `;
    const previousRows = await tx<
      Array<{
        avatar_visible: boolean;
        bio_visible: boolean;
        building_visible: boolean;
        directory_status: string;
        email_scope: string;
        location_visible: boolean;
        phone_scope: string;
        version: number;
      }>
    >`
      select *
      from member_directory_preferences
      where member_id = ${identity.memberId}::uuid
      for update
    `;
    const previous = previousRows[0] ?? {
      avatar_visible: true,
      bio_visible: false,
      building_visible: false,
      directory_status: "hidden",
      email_scope: "none",
      location_visible: false,
      phone_scope: "none",
      version: 0,
    };
    const directoryStatus = input.directory.directoryStatus;
    const nextPreferences = {
      avatar_visible: input.directory.avatarVisible,
      bio_visible: input.directory.bioVisible,
      building_visible: input.directory.buildingVisible,
      directory_status: directoryStatus,
      email_scope: input.directory.emailScope,
      location_visible: input.directory.locationVisible,
      phone_scope: input.directory.phoneScope,
    };
    await tx`
      insert into member_directory_preferences (
        member_id,
        directory_status,
        avatar_visible,
        location_visible,
        bio_visible,
        building_visible,
        email_scope,
        phone_scope
      ) values (
        ${identity.memberId}::uuid,
        ${directoryStatus},
        ${input.directory.avatarVisible},
        ${input.directory.locationVisible},
        ${input.directory.bioVisible},
        ${input.directory.buildingVisible},
        ${input.directory.emailScope},
        ${input.directory.phoneScope}
      )
      on conflict (member_id) do update
      set
        directory_status = excluded.directory_status,
        avatar_visible = excluded.avatar_visible,
        location_visible = excluded.location_visible,
        bio_visible = excluded.bio_visible,
        building_visible = excluded.building_visible,
        email_scope = excluded.email_scope,
        phone_scope = excluded.phone_scope,
        version = member_directory_preferences.version + 1,
        updated_at = statement_timestamp()
    `;
    await tx`
      insert into member_directory_preference_events (
        member_id,
        previous_preferences,
        next_preferences,
        actor_auth_user_id,
        source,
        dedupe_key
      ) values (
        ${identity.memberId}::uuid,
        ${JSON.stringify(previous)}::jsonb,
        ${JSON.stringify(nextPreferences)}::jsonb,
        ${authUserId}::uuid,
        'member',
        ${`member-directory:${identity.memberId}:${crypto.randomUUID()}`}
      )
    `;
  });
  const profile = await getMemberProfile(authUserId);
  if (!profile) throw new Error("Saved member profile could not be reloaded.");
  return profile;
}

type ExperienceRow = {
  audience_label: string | null;
  ends_at: Date | string | null;
  external_registration_url: string | null;
  id: string;
  kind: string;
  location_label: string | null;
  registration_mode: "external" | "internal" | "none";
  registration_status: "cancelled" | "external_pending" | "registered" | "waitlisted" | null;
  starts_at: Date | string;
  summary: string | null;
  title: string;
};

function experienceFromRow(row: ExperienceRow): MemberExperienceSummary {
  const registrationState: MemberExperienceSummary["registrationState"] =
    row.registration_status === "waitlisted"
      ? "waitlisted"
      : row.registration_status === "registered"
        ? "registered"
        : row.registration_status === "cancelled"
          ? "cancelled"
          : row.registration_mode === "external"
            ? "external"
            : "none";
  return {
    audienceLabel: row.audience_label ?? "Ruined Membership",
    endsAt: toIso(row.ends_at),
    id: row.id,
    kind: row.kind,
    locationLabel: row.location_label,
    meetingUrl: null,
    registrationHref:
      row.registration_mode === "external"
        ? row.external_registration_url
        : row.registration_mode === "internal"
          ? `/api/my/experiences/${row.id}/register`
          : null,
    registrationState,
    startsAt: toIso(row.starts_at)!,
    summary: row.summary,
    title: row.title,
  };
}

type CircleBaseRow = {
  block_id: string | null;
  block_name: string | null;
  block_status: MemberCircleSnapshot["block"] extends infer T
    ? T extends { status: infer S }
      ? S
      : never
    : never;
  circle_id: string;
  circle_name: string;
  circle_status: NonNullable<MemberCircleSnapshot["circle"]>["status"];
};

type DirectoryRow = {
  avatar_storage_path: string | null;
  bio: string | null;
  building_now: string | null;
  directory_id: string;
  display_name: string | null;
  email: string | null;
  is_partner: boolean;
  is_self: boolean;
  location_label: string | null;
  phone: string | null;
};

function directoryPerson(row: DirectoryRow): PrivacySafePersonSummary {
  return {
    avatarUrl: safeAvatarUrl(row.avatar_storage_path),
    bio: row.bio,
    buildingNow: row.building_now,
    displayName: row.display_name?.trim() || "Member",
    email: row.email,
    id: row.directory_id,
    isSelf: row.is_self,
    location: row.location_label,
    phone: row.phone,
  };
}

export async function getMemberCircle(
  authUserId: string,
): Promise<MemberCircleSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "circle.read")) {
    return {
      access,
      accountabilityPartner: null,
      block: null,
      circle: null,
      leader: null,
      meetings: [],
      members: [],
      resources: [],
    };
  }
  const sql = getApplicationDatabase();
  const circleRows = await sql<Array<CircleBaseRow>>`
    select
      circle.id as circle_id,
      circle.name as circle_name,
      circle.status as circle_status,
      membership_block.id as block_id,
      membership_block.name as block_name,
      membership_block.status as block_status
    from circle_member_assignments member_assignment
    join circles circle on circle.id = member_assignment.circle_id
    left join block_circle_assignments block_assignment
      on block_assignment.circle_id = circle.id
      and block_assignment.ended_at is null
    left join membership_blocks membership_block
      on membership_block.id = block_assignment.block_id
    where member_assignment.member_id = ${identity.memberId}::uuid
      and member_assignment.ended_at is null
    order by member_assignment.assigned_at desc
    limit 1
  `;
  const circle = circleRows[0];
  if (!circle) {
    return {
      access,
      accountabilityPartner: null,
      block: null,
      circle: null,
      leader: null,
      meetings: [],
      members: [],
      resources: [],
    };
  }

  const [directoryRows, leaderRows, meetingRows, resourceRows] = await Promise.all([
    sql<Array<DirectoryRow>>`
      with viewer_partner as (
        select case
          when partner.member_one_id = ${identity.memberId}::uuid then partner.member_two_id
          else partner.member_one_id
        end as member_id
        from accountability_partner_assignments partner
        where partner.circle_id = ${circle.circle_id}::uuid
          and partner.ended_at is null
          and ${identity.memberId}::uuid in (partner.member_one_id, partner.member_two_id)
        limit 1
      )
      select
        assignment.id::text as directory_id,
        target_member.id = ${identity.memberId}::uuid as is_self,
        target_member.id = (select member_id from viewer_partner) as is_partner,
        coalesce(profile.display_name, profile.preferred_name, 'Member') as display_name,
        case
          when target_member.id = ${identity.memberId}::uuid
            or (preference.directory_status = 'circle_visible' and preference.avatar_visible)
          then profile.avatar_storage_path
        end as avatar_storage_path,
        case
          when target_member.id = ${identity.memberId}::uuid
            or (preference.directory_status = 'circle_visible' and preference.location_visible)
          then profile.location_label
        end as location_label,
        case
          when target_member.id = ${identity.memberId}::uuid
            or (preference.directory_status = 'circle_visible' and preference.bio_visible)
          then profile.bio
        end as bio,
        case
          when target_member.id = ${identity.memberId}::uuid
            or (preference.directory_status = 'circle_visible' and preference.building_visible)
          then profile.building_now
        end as building_now,
        case
          when target_member.id = ${identity.memberId}::uuid
            or (
              preference.directory_status = 'circle_visible'
              and (
                preference.email_scope = 'circle'
                or (
                  preference.email_scope = 'accountability_partner'
                  and target_member.id = (select member_id from viewer_partner)
                )
              )
            )
          then primary_email.email
        end as email,
        case
          when target_member.id = ${identity.memberId}::uuid
            or (
              preference.directory_status = 'circle_visible'
              and (
                preference.phone_scope = 'circle'
                or (
                  preference.phone_scope = 'accountability_partner'
                  and target_member.id = (select member_id from viewer_partner)
                )
              )
            )
          then private_profile.mobile_e164
        end as phone
      from circle_member_assignments assignment
      join ruined_members target_member on target_member.id = assignment.member_id
      left join person_profiles profile on profile.person_id = target_member.person_id
      left join person_private_profiles private_profile on private_profile.person_id = target_member.person_id
      left join member_directory_preferences preference on preference.member_id = target_member.id
      left join lateral (
        select email_address.email
        from person_email_addresses email_address
        where email_address.person_id = target_member.person_id
          and email_address.retired_at is null
        order by email_address.is_primary desc, email_address.created_at
        limit 1
      ) primary_email on true
      where assignment.circle_id = ${circle.circle_id}::uuid
        and assignment.ended_at is null
      order by assignment.assigned_at, assignment.id
    `,
    sql<Array<DirectoryRow>>`
      select
        staff_assignment.id::text as directory_id,
        false as is_self,
        false as is_partner,
        coalesce(profile.display_name, profile.preferred_name, 'Circle leader') as display_name,
        null::text as avatar_storage_path,
        null::text as location_label,
        null::text as bio,
        null::text as building_now,
        null::text as email,
        null::text as phone
      from circle_staff_assignments staff_assignment
      join platform_users platform_user
        on platform_user.auth_user_id = staff_assignment.auth_user_id
      left join person_profiles profile on profile.person_id = platform_user.person_id
      where staff_assignment.circle_id = ${circle.circle_id}::uuid
        and staff_assignment.role_slug = 'circle_leader'
        and staff_assignment.ended_at is null
      order by staff_assignment.assigned_at desc
      limit 1
    `,
    sql<Array<ExperienceRow>>`
      select
        experience.id,
        experience.kind,
        experience.title,
        experience.summary,
        experience.starts_at,
        experience.ends_at,
        experience.location_label,
        experience.registration_mode,
        experience.external_registration_url,
        registration.status as registration_status,
        ${circle.circle_name}::text as audience_label
      from experiences experience
      left join experience_registrations registration
        on registration.experience_id = experience.id
        and registration.person_id = ${identity.personId}::uuid
      where experience.circle_id = ${circle.circle_id}::uuid
        and experience.kind = 'circle_meeting'
        and experience.status in ('published', 'completed')
      order by experience.starts_at desc
      limit 12
    `,
    sql<Array<{ description: string | null; href: string; id: string; label: string }>>`
      select
        circle_resource.id,
        resource.title as label,
        resource.summary as description,
        '/my/learn/' || resource.slug as href
      from circle_resources circle_resource
      join learning_resource_versions resource_version
        on resource_version.id = circle_resource.learning_resource_version_id
      join learning_resources resource
        on resource.id = resource_version.learning_resource_id
      where circle_resource.circle_id = ${circle.circle_id}::uuid
        and resource.status = 'published'
      order by circle_resource.is_pinned desc, circle_resource.position, circle_resource.created_at
    `,
  ]);

  const members = directoryRows.map(directoryPerson);
  return {
    access,
    accountabilityPartner:
      directoryRows.find((row) => row.is_partner) ? directoryPerson(directoryRows.find((row) => row.is_partner)!) : null,
    block:
      circle.block_id && circle.block_name && circle.block_status
        ? { id: circle.block_id, name: circle.block_name, status: circle.block_status }
        : null,
    circle: {
      id: circle.circle_id,
      name: circle.circle_name,
      status: circle.circle_status,
    },
    leader: leaderRows[0] ? directoryPerson(leaderRows[0]) : null,
    meetings: meetingRows.map(experienceFromRow),
    members,
    resources: resourceRows,
  };
}

export async function getMemberExperiences(
  authUserId: string,
): Promise<MemberExperiencesSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "experiences.member")) {
    return { access, past: [], upcoming: [] };
  }
  const sql = getApplicationDatabase();
  const rows = await sql<Array<ExperienceRow>>`
    with membership_scope as (
      select
        member_assignment.circle_id,
        block_assignment.block_id,
        lifecycle.current_progression_level_slug
      from member_lifecycle lifecycle
      left join circle_member_assignments member_assignment
        on member_assignment.member_id = lifecycle.member_id
        and member_assignment.ended_at is null
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = member_assignment.circle_id
        and block_assignment.ended_at is null
      where lifecycle.member_id = ${identity.memberId}::uuid
      limit 1
    )
    select
      experience.id,
      experience.kind,
      experience.title,
      experience.summary,
      experience.starts_at,
      experience.ends_at,
      experience.location_label,
      experience.registration_mode,
      experience.external_registration_url,
      registration.status as registration_status,
      case experience.visibility
        when 'circle' then 'Your Circle'
        when 'block' then 'Your Block'
        when 'progression' then 'Your progression'
        when 'public' then 'Ruined community'
        else 'All members'
      end as audience_label
    from experiences experience
    left join experience_registrations registration
      on registration.experience_id = experience.id
      and registration.person_id = ${identity.personId}::uuid
    cross join membership_scope scope
    where experience.status in ('published', 'completed')
      and (
        experience.visibility in ('public', 'all_members')
        or (experience.visibility = 'circle' and experience.circle_id = scope.circle_id)
        or (experience.visibility = 'block' and experience.block_id = scope.block_id)
        or (
          experience.visibility = 'progression'
          and experience.progression_level_slug = scope.current_progression_level_slug
        )
        or (
          experience.visibility = 'invite_only'
          and registration.status in ('external_pending', 'registered', 'waitlisted')
        )
      )
    order by experience.starts_at
  `;
  const now = Date.now();
  const experiences = rows.map(experienceFromRow);
  return {
    access,
    past: experiences
      .filter((experience) => new Date(experience.endsAt ?? experience.startsAt).getTime() < now)
      .reverse(),
    upcoming: experiences.filter(
      (experience) => new Date(experience.endsAt ?? experience.startsAt).getTime() >= now,
    ),
  };
}

export async function setMemberExperienceRegistration(
  authUserId: string,
  experienceId: string,
  action: "cancel" | "register",
): Promise<{ status: "cancelled" | "registered" | "waitlisted" }> {
  if (!UUID.test(experienceId)) {
    throw new MembershipInputError("That experience is not valid.");
  }
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "experiences.member")) throw new MembershipAccessDeniedError();
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${experienceId}), 48)`;
    const experienceRows = await tx<
      Array<{
        capacity: number | null;
        registration_mode: "external" | "internal" | "none";
      }>
    >`
      with membership_scope as (
        select
          member_assignment.circle_id,
          block_assignment.block_id,
          lifecycle.current_progression_level_slug
        from member_lifecycle lifecycle
        left join circle_member_assignments member_assignment
          on member_assignment.member_id = lifecycle.member_id
          and member_assignment.ended_at is null
        left join block_circle_assignments block_assignment
          on block_assignment.circle_id = member_assignment.circle_id
          and block_assignment.ended_at is null
        where lifecycle.member_id = ${identity.memberId}::uuid
        limit 1
      )
      select experience.registration_mode, experience.capacity
      from experiences experience
      cross join membership_scope scope
      where experience.id = ${experienceId}::uuid
        and experience.status = 'published'
        and (
          experience.visibility in ('public', 'all_members')
          or (experience.visibility = 'circle' and experience.circle_id = scope.circle_id)
          or (experience.visibility = 'block' and experience.block_id = scope.block_id)
          or (
            experience.visibility = 'progression'
            and experience.progression_level_slug = scope.current_progression_level_slug
          )
          or (
            experience.visibility = 'invite_only'
            and exists (
              select 1
              from experience_registrations invited_registration
              where invited_registration.experience_id = experience.id
                and invited_registration.person_id = ${identity.personId}::uuid
            )
          )
        )
      limit 1
      for update of experience
    `;
    const experience = experienceRows[0];
    if (!experience) throw new MembershipAccessDeniedError();
    if (experience.registration_mode !== "internal") {
      throw new MembershipConflictError(
        experience.registration_mode === "external"
          ? "This experience uses its own registration page."
          : "This experience does not require registration.",
      );
    }

    if (action === "cancel") {
      const cancelledRows = await tx<Array<{ status: "cancelled" }>>`
        update experience_registrations
        set
          status = 'cancelled',
          cancelled_at = statement_timestamp(),
          updated_at = statement_timestamp()
        where experience_id = ${experienceId}::uuid
          and person_id = ${identity.personId}::uuid
          and member_id = ${identity.memberId}::uuid
          and status <> 'cancelled'
        returning status
      `;
      if (!cancelledRows[0]) {
        throw new MembershipConflictError("There is no current registration to cancel.");
      }
      return { status: "cancelled" as const };
    }

    const countRows = await tx<Array<{ registered_count: number }>>`
      select count(*)::int as registered_count
      from experience_registrations
      where experience_id = ${experienceId}::uuid
        and status = 'registered'
    `;
    const status: "registered" | "waitlisted" =
      experience.capacity !== null &&
      Number(countRows[0]?.registered_count ?? 0) >= experience.capacity
        ? "waitlisted"
        : "registered";
    const registrationRows = await tx<Array<{ status: "registered" | "waitlisted" }>>`
      insert into experience_registrations (
        experience_id,
        person_id,
        member_id,
        status,
        source,
        registered_at
      ) values (
        ${experienceId}::uuid,
        ${identity.personId}::uuid,
        ${identity.memberId}::uuid,
        ${status},
        'member',
        statement_timestamp()
      )
      on conflict (experience_id, person_id) do update
      set
        member_id = excluded.member_id,
        status = excluded.status,
        source = 'member',
        registered_at = statement_timestamp(),
        cancelled_at = null,
        updated_at = statement_timestamp()
      returning status
    `;
    return { status: registrationRows[0]?.status ?? status };
  });
}

function learningResourceType(
  value: string,
): MemberLearningResourceSummary["resourceType"] {
  if (value === "article" || value === "video" || value === "audio") return value;
  if (value === "link") return "external_link";
  return "download";
}

type LearningRow = {
  collection_id: string | null;
  collection_name: string | null;
  collection_slug: string | null;
  collection_summary: string | null;
  content_type: string;
  id: string;
  published_at: Date | string;
  slug: string;
  summary: string | null;
  title: string;
};

export async function getMemberLearning(
  authUserId: string,
): Promise<MemberLearningSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "learn.read")) {
    return { access, collections: [], uncollected: [] };
  }
  const sql = getApplicationDatabase();
  const rows = await sql<Array<LearningRow>>`
    with membership_scope as (
      select
        member_assignment.circle_id,
        block_assignment.block_id,
        lifecycle.current_progression_level_slug
      from member_lifecycle lifecycle
      left join circle_member_assignments member_assignment
        on member_assignment.member_id = lifecycle.member_id
        and member_assignment.ended_at is null
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = member_assignment.circle_id
        and block_assignment.ended_at is null
      where lifecycle.member_id = ${identity.memberId}::uuid
      limit 1
    )
    select
      resource.id,
      resource.slug,
      resource.title,
      resource.summary,
      resource.content_type,
      resource.published_at,
      collection.id as collection_id,
      collection.slug as collection_slug,
      collection.name as collection_name,
      collection.summary as collection_summary
    from learning_resources resource
    left join learning_collections collection
      on collection.id = resource.collection_id
      and collection.status = 'published'
    cross join membership_scope scope
    where resource.status = 'published'
      and exists (
        select 1
        from learning_resource_targets target
        where target.learning_resource_id = resource.id
          and (
            target.audience_type = 'all_members'
            or (target.audience_type = 'circle' and target.circle_id = scope.circle_id)
            or (target.audience_type = 'block' and target.block_id = scope.block_id)
            or (
              target.audience_type = 'progression'
              and target.progression_level_slug = scope.current_progression_level_slug
            )
          )
      )
    order by collection.position nulls last, resource.position, resource.published_at desc
  `;
  const summaries = new Map<string, MemberLearningResourceSummary>();
  for (const row of rows) {
    summaries.set(row.id, {
      collectionName: row.collection_name,
      href: `/my/learn/${row.slug}`,
      id: row.id,
      publishedAt: toIso(row.published_at)!,
      resourceType: learningResourceType(row.content_type),
      summary: row.summary,
      title: row.title,
    });
  }
  const collections = new Map<string, MemberLearningSnapshot["collections"][number]>();
  for (const row of rows) {
    if (!row.collection_id || !row.collection_name || !row.collection_slug) continue;
    const current = collections.get(row.collection_id) ?? {
      description: row.collection_summary,
      id: row.collection_id,
      name: row.collection_name,
      resources: [],
      slug: row.collection_slug,
    };
    current.resources.push(summaries.get(row.id)!);
    collections.set(row.collection_id, current);
  }
  return {
    access,
    collections: [...collections.values()],
    uncollected: rows
      .filter((row) => !row.collection_id)
      .map((row) => summaries.get(row.id)!),
  };
}

export async function getMemberLearningResource(
  authUserId: string,
  slug: string,
): Promise<MemberLearningResourceDetail | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "learn.read")) return null;
  const sql = getApplicationDatabase();
  const rows = await sql<
    Array<{
      body_text: string | null;
      collection_name: string | null;
      content_type: string;
      external_url: string | null;
      published_at: Date | string;
      slug: string;
      storage_bucket: string | null;
      storage_path: string | null;
      summary: string | null;
      title: string;
      version: number;
    }>
  >`
    with membership_scope as (
      select
        member_assignment.circle_id,
        block_assignment.block_id,
        lifecycle.current_progression_level_slug
      from member_lifecycle lifecycle
      left join circle_member_assignments member_assignment
        on member_assignment.member_id = lifecycle.member_id
        and member_assignment.ended_at is null
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = member_assignment.circle_id
        and block_assignment.ended_at is null
      where lifecycle.member_id = ${identity.memberId}::uuid
      limit 1
    )
    select
      resource.title,
      resource.slug,
      resource.summary,
      resource.content_type,
      resource.published_at,
      collection.name as collection_name,
      resource_version.version,
      resource_version.body_text,
      resource_version.external_url,
      resource_version.storage_bucket,
      resource_version.storage_path
    from learning_resources resource
    join learning_resource_versions resource_version
      on resource_version.id = resource.current_version_id
    left join learning_collections collection on collection.id = resource.collection_id
    cross join membership_scope scope
    where resource.slug = ${slug}
      and resource.status = 'published'
      and exists (
        select 1
        from learning_resource_targets target
        where target.learning_resource_id = resource.id
          and (
            target.audience_type = 'all_members'
            or (target.audience_type = 'circle' and target.circle_id = scope.circle_id)
            or (target.audience_type = 'block' and target.block_id = scope.block_id)
            or (
              target.audience_type = 'progression'
              and target.progression_level_slug = scope.current_progression_level_slug
            )
          )
      )
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    access,
    bodyMarkdown: row.body_text,
    collectionName: row.collection_name,
    externalUrl: row.external_url,
    publishedAt: toIso(row.published_at)!,
    resourceType: learningResourceType(row.content_type),
    slug: row.slug,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    summary: row.summary,
    title: row.title,
    version: row.version,
  };
}

export type MemberFoundationRequirements = {
  futureLetter: { completed: boolean; completedAt: string | null };
  timeline: { completed: boolean; completedAt: string | null; entryCount: number };
};

export async function getMemberFoundationRequirements(
  authUserId: string,
): Promise<MemberFoundationRequirements> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "foundations.summary")) {
    return {
      futureLetter: { completed: false, completedAt: null },
      timeline: { completed: false, completedAt: null, entryCount: 0 },
    };
  }
  const sql = getApplicationDatabase();
  const rows = await sql<
    Array<{
      entry_count: number;
      future_letter_completed_at: Date | string | null;
      timeline_completed_at: Date | string | null;
    }>
  >`
    with current_enrollment as (
      select enrollment.id
      from foundation_enrollments enrollment
      where enrollment.member_id = ${identity.memberId}::uuid
      order by
        case enrollment.status
          when 'in_progress' then 0
          when 'not_started' then 1
          when 'paused' then 2
          when 'completed' then 3
          else 4
        end,
        enrollment.enrolled_at desc
      limit 1
    ), current_completion as (
      select distinct on (completion.requirement_slug)
        completion.requirement_slug,
        completion.completed_at
      from member_foundation_requirement_completions completion
      join current_enrollment enrollment
        on enrollment.id = completion.foundation_enrollment_id
      where completion.state = 'completed'
        and not exists (
          select 1
          from member_foundation_requirement_completions revocation
          where revocation.supersedes_completion_id = completion.id
            and revocation.state = 'revoked'
        )
      order by completion.requirement_slug, completion.completion_version desc
    )
    select
      (
        select count(*)::int
        from member_timeline_entries timeline
        where timeline.member_id = ${identity.memberId}::uuid
          and timeline.status = 'active'
      ) as entry_count,
      (
        select completed_at
        from current_completion
        where requirement_slug = 'timeline'
      ) as timeline_completed_at,
      (
        select completed_at
        from current_completion
        where requirement_slug = 'future_letter'
      ) as future_letter_completed_at
  `;
  const row = rows[0] ?? {
    entry_count: 0,
    future_letter_completed_at: null,
    timeline_completed_at: null,
  };
  return {
    futureLetter: {
      completed: Boolean(row.future_letter_completed_at),
      completedAt: toIso(row.future_letter_completed_at),
    },
    timeline: {
      completed: Boolean(row.timeline_completed_at),
      completedAt: toIso(row.timeline_completed_at),
      entryCount: Number(row.entry_count),
    },
  };
}

export async function getMemberHome(
  authUserId: string,
): Promise<MemberHomeSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = requireMemberCapability(identity, "home.read");
  const sql = getApplicationDatabase();
  const foundationSummaryAllowed = memberCan(access, "foundations.summary");
  const foundationRowsPromise = foundationSummaryAllowed
    ? sql<
        Array<{
          completed_units: number;
          progress_percent: number | string;
          total_units: number;
        }>
      >`
        with current_enrollment as (
          select enrollment.id, enrollment.foundation_version_id, enrollment.progress_percent
          from foundation_enrollments enrollment
          where enrollment.member_id = ${identity.memberId}::uuid
          order by
            case enrollment.status
              when 'in_progress' then 0
              when 'not_started' then 1
              when 'paused' then 2
              when 'completed' then 3
              else 4
            end,
            enrollment.enrolled_at desc
          limit 1
        )
        select
          coalesce(enrollment.progress_percent, 0) as progress_percent,
          (
            select count(*)::int
            from foundation_units unit
            where unit.foundation_version_id = enrollment.foundation_version_id
              and unit.is_required
          ) as total_units,
          (
            select count(*)::int
            from foundation_unit_progress progress
            where progress.enrollment_id = enrollment.id
              and progress.status = 'completed'
          ) as completed_units
        from current_enrollment enrollment
      `
    : Promise.resolve([]);
  const [profile, progression, circle, experiences, artifacts, updates, requirements, foundationRows] =
    await Promise.all([
      getMemberProfile(authUserId),
      getMemberProgression(identity.memberId),
      getMemberCircle(authUserId),
      getMemberExperiences(authUserId),
      getMemberArtifacts(authUserId),
      getMemberUpdates(authUserId),
      getMemberFoundationRequirements(authUserId),
      foundationRowsPromise,
    ]);
  if (!profile || !circle || !experiences || !artifacts || !updates) return null;
  const foundationRow = foundationRows[0] ?? {
    completed_units: 0,
    progress_percent: 0,
    total_units: 22,
  };
  const foundations: FoundationSummary = {
    progressPercent: Number(foundationRow.progress_percent),
    requirements: {
      activeCircle: {
        completed: circle.circle?.status === "active",
        name: circle.circle?.name ?? null,
      },
      futureLetter: requirements.futureLetter,
      moments: {
        completed: Number(foundationRow.completed_units),
        total: Number(foundationRow.total_units || 22),
      },
      timeline: requirements.timeline,
    },
    state: foundationSummaryAllowed ? identity.foundationsState : "not_started",
  };
  const suppressPrivateHighlights =
    access.mode === "entry" || access.mode === "limited" || access.mode === "suspended";
  const now = Date.now();
  const nextMeeting = suppressPrivateHighlights
    ? null
    : circle.meetings
        .filter((meeting) => new Date(meeting.endsAt ?? meeting.startsAt).getTime() >= now)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null;
  const nextExperience = suppressPrivateHighlights ? null : experiences.upcoming[0] ?? null;
  const firstArtifact = suppressPrivateHighlights ? null : artifacts.awards[0] ?? null;
  const latestAnnouncement = suppressPrivateHighlights
    ? null
    : updates.items.find((item) => item.kind === "announcement") ?? null;

  let nextAction: MemberHomeSnapshot["nextAction"];
  if (access.mode === "entry") {
    nextAction = {
      body: "Complete the practical member record, exact agreement, and secure payment before the member rooms open.",
      href: "/my/join",
      kind: "onboarding",
      title: "Finish membership entry.",
    };
  } else if (identity.billingState === "attention_required") {
    nextAction = {
      body: "Restore the membership billing record before returning to the active rooms.",
      href: "/my/account",
      kind: "billing",
      title: "Billing needs attention.",
    };
  } else if (access.mode === "limited") {
    nextAction = {
      body: access.reason ?? "Review the membership record before returning to member rooms.",
      href: "/my/account",
      kind: "billing",
      title: "Membership access is limited.",
    };
  } else if (!requirements.timeline.completed) {
    nextAction = {
      body: "Build the durable Timeline with Year, Title, and only the Details you choose to keep.",
      href: "/my/foundations/timeline",
      kind: "timeline",
      title: "Make the Ruined Timeline.",
    };
  } else if (identity.foundationsState !== "completed") {
    nextAction = {
      body: requirements.futureLetter.completed
        ? "Continue from the place you last left it. Completion still waits for an active Circle."
        : "Continue the shared beginning. Your Future Letter remains private; Ruined saves only its completion.",
      href: "/my/foundations",
      kind: "foundations",
      title: identity.foundationsState === "not_started" ? "Begin Foundations." : "Continue Foundations.",
    };
  } else if (!circle.circle) {
    nextAction = {
      body: "Your work is ready. Ruined is still forming the immediate group around it.",
      href: "/my/circle",
      kind: "circle",
      title: "Your Circle is being formed.",
    };
  } else if (firstArtifact?.inputRequired) {
    nextAction = {
      body: "An earned artifact is waiting for the practical details required to make it physical.",
      href: "/my/artifacts",
      kind: "artifact",
      title: "Complete the artifact record.",
    };
  } else if (updates.unreadCount > 0) {
    nextAction = {
      body: "A personal notice or member announcement is waiting in Updates.",
      href: "/my/updates",
      kind: "updates",
      title: "Read what changed.",
    };
  } else if (nextExperience) {
    nextAction = {
      body: nextExperience.summary ?? "The next member experience is ready to enter.",
      href: "/my/experiences",
      kind: "experience",
      title: nextExperience.title,
    };
  } else {
    nextAction = {
      body: "Return to the people closest to the work, or open the member library when something earns a return.",
      href: "/my/circle",
      kind: "circle",
      title: "Stay close to the work.",
    };
  }

  return {
    access,
    announcement: latestAnnouncement
      ? {
          body: latestAnnouncement.body,
          href: latestAnnouncement.href,
          id: latestAnnouncement.id,
          publishedAt: latestAnnouncement.publishedAt,
          title: latestAnnouncement.title,
        }
      : null,
    artifact: firstArtifact,
    avatarUrl: profile.directory.avatarUrl,
    blockName: suppressPrivateHighlights ? null : circle.block?.name ?? null,
    circleName: suppressPrivateHighlights ? null : circle.circle?.name ?? null,
    displayName: profile.directory.preferredName ?? profile.directory.displayName,
    foundations,
    identity,
    nextAction,
    nextExperience,
    nextMeeting,
    partner: suppressPrivateHighlights ? null : circle.accountabilityPartner,
    progression,
    unreadUpdates: suppressPrivateHighlights ? 0 : updates.unreadCount,
  };
}

export async function getMemberTimeline(
  authUserId: string,
): Promise<MemberTimelineSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = requireMemberCapability(identity, "foundations.write");
  const [requirements, rows] = await Promise.all([
    getMemberFoundationRequirements(authUserId),
    getApplicationDatabase()<
      Array<{
        details: string | null;
        entry_year: number;
        id: string;
        position: number;
        title: string;
      }>
    >`
      select id, entry_year, title, details, position
      from member_timeline_entries
      where member_id = ${identity.memberId}::uuid
        and status = 'active'
      order by position, entry_year, created_at
    `,
  ]);
  return {
    access,
    completedAt: requirements.timeline.completedAt,
    entries: rows.map((row) => ({
      details: row.details,
      id: row.id,
      position: row.position,
      title: row.title,
      year: row.entry_year,
    })),
  };
}

export type MemberTimelineInput = Array<{
  details: string | null;
  id: string | null;
  title: string;
  year: number;
}>;

function validateTimelineInput(input: MemberTimelineInput) {
  if (!Array.isArray(input) || input.length > 50) {
    throw new MembershipInputError("A Timeline can hold up to 50 entries.");
  }
  const seen = new Set<string>();
  return input.map((entry, index) => {
    if (entry.id !== null && !UUID.test(entry.id)) {
      throw new MembershipInputError("A Timeline entry identifier is not valid.");
    }
    if (entry.id && seen.has(entry.id)) {
      throw new MembershipInputError("A Timeline entry was included twice.");
    }
    if (entry.id) seen.add(entry.id);
    if (!Number.isInteger(entry.year) || entry.year < 1900 || entry.year > 2200) {
      throw new MembershipInputError("Use a four-digit year between 1900 and 2200.");
    }
    const title = cleanRequired(entry.title, "Timeline title", 200);
    const details = entry.details?.trim() || null;
    if (details && details.length > 4000) {
      throw new MembershipInputError("Timeline details must be 4,000 characters or fewer.");
    }
    return { details, id: entry.id, position: index + 1, title, year: entry.year };
  });
}

export async function saveMemberTimeline(
  authUserId: string,
  input: MemberTimelineInput,
): Promise<MemberTimelineSnapshot> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "foundations.write")) throw new MembershipAccessDeniedError();
  const entries = validateTimelineInput(input);
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 45)`;
    const currentRows = await tx<Array<{ id: string }>>`
      select id
      from member_timeline_entries
      where member_id = ${identity.memberId}::uuid
        and status = 'active'
      for update
    `;
    const currentIds = new Set(currentRows.map((row) => row.id));
    const retainedIds = new Set<string>();
    for (const entry of entries) {
      if (entry.id) {
        if (!currentIds.has(entry.id)) {
          throw new MembershipConflictError("A Timeline entry changed. Reload before saving again.");
        }
        retainedIds.add(entry.id);
        await tx`
          update member_timeline_entries
          set
            entry_year = ${entry.year},
            title = ${entry.title},
            details = ${entry.details},
            position = ${entry.position},
            updated_by_auth_user_id = ${authUserId}::uuid
          where id = ${entry.id}::uuid
            and member_id = ${identity.memberId}::uuid
            and status = 'active'
        `;
      } else {
        const insertedRows = await tx<Array<{ id: string }>>`
          insert into member_timeline_entries (
            member_id,
            entry_year,
            title,
            details,
            position,
            updated_by_auth_user_id
          ) values (
            ${identity.memberId}::uuid,
            ${entry.year},
            ${entry.title},
            ${entry.details},
            ${entry.position},
            ${authUserId}::uuid
          )
          returning id
        `;
        if (insertedRows[0]) retainedIds.add(insertedRows[0].id);
      }
    }
    for (const currentId of currentIds) {
      if (retainedIds.has(currentId)) continue;
      await tx`
        update member_timeline_entries
        set
          status = 'deleted',
          deleted_at = statement_timestamp(),
          updated_by_auth_user_id = ${authUserId}::uuid
        where id = ${currentId}::uuid
          and member_id = ${identity.memberId}::uuid
          and status = 'active'
      `;
    }
  });
  const timeline = await getMemberTimeline(authUserId);
  if (!timeline) throw new Error("Saved Timeline could not be reloaded.");
  return timeline;
}

export async function completeMemberFoundationRequirement(
  authUserId: string,
  requirement: "future_letter" | "timeline",
): Promise<MemberFoundationRequirements> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "foundations.write")) throw new MembershipAccessDeniedError();
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 46)`;
    const enrollmentRows = await tx<Array<{ id: string }>>`
      select id
      from foundation_enrollments
      where member_id = ${identity.memberId}::uuid
        and status in ('not_started', 'in_progress', 'paused')
      order by enrolled_at desc
      limit 1
      for update
    `;
    const enrollment = enrollmentRows[0];
    if (!enrollment) {
      throw new MembershipConflictError("Begin Foundations before completing this requirement.");
    }
    const existingRows = await tx<Array<{ id: string }>>`
      select completion.id
      from member_foundation_requirement_completions completion
      where completion.foundation_enrollment_id = ${enrollment.id}::uuid
        and completion.member_id = ${identity.memberId}::uuid
        and completion.requirement_slug = ${requirement}
        and completion.state = 'completed'
        and not exists (
          select 1
          from member_foundation_requirement_completions revocation
          where revocation.supersedes_completion_id = completion.id
            and revocation.state = 'revoked'
        )
      order by completion.completion_version desc
      limit 1
    `;
    if (existingRows[0]) return;
    const versionRows = await tx<Array<{ next_version: number }>>`
      select coalesce(max(completion_version), 0)::int + 1 as next_version
      from member_foundation_requirement_completions
      where foundation_enrollment_id = ${enrollment.id}::uuid
        and requirement_slug = ${requirement}
    `;
    const completionVersion = versionRows[0]?.next_version ?? 1;
    const evidence =
      requirement === "future_letter"
        ? { interaction: "member_confirmed_completion" }
        : { interaction: "member_confirmed_timeline" };
    await tx`
      insert into member_foundation_requirement_completions (
        member_id,
        foundation_enrollment_id,
        requirement_slug,
        completion_version,
        completed_by_auth_user_id,
        source,
        evidence,
        dedupe_key
      ) values (
        ${identity.memberId}::uuid,
        ${enrollment.id}::uuid,
        ${requirement},
        ${completionVersion},
        ${authUserId}::uuid,
        'member',
        ${JSON.stringify(evidence)}::jsonb,
        ${`foundation-requirement:${enrollment.id}:${requirement}:v${completionVersion}`}
      )
    `;
  });
  return getMemberFoundationRequirements(authUserId);
}

function artifactStateFromStatus(
  awardStatus: string,
  jobStatus: string | null,
): MemberArtifactsSnapshot["awards"][number]["artifactState"] {
  if (awardStatus === "fulfilled" || jobStatus === "fulfilled") return "fulfilled";
  if (
    awardStatus === "in_fulfillment" ||
    ["ready_for_production", "in_production", "review", "ready"].includes(jobStatus ?? "")
  ) {
    return "in_production";
  }
  return "collecting";
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getMemberArtifacts(
  authUserId: string,
): Promise<MemberArtifactsSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "artifacts.read")) return { access, awards: [] };
  const sql = getApplicationDatabase();
  const rows = await sql<
    Array<{
      award_id: string;
      award_name: string;
      award_reason: string | null;
      award_status: string;
      awarded_at: Date | string;
      completed_at: Date | string | null;
      job_status: string | null;
      production_snapshot: Record<string, unknown> | null;
    }>
  >`
    select
      award.id as award_id,
      award.award_name,
      award.award_reason,
      award.status as award_status,
      award.awarded_at,
      job.status as job_status,
      job.production_snapshot,
      job.completed_at
    from artifact_awards award
    left join artifact_jobs job on job.artifact_award_id = award.id
    where award.member_id = ${identity.memberId}::uuid
      and award.person_id = ${identity.personId}::uuid
      and award.status <> 'revoked'
    order by award.awarded_at desc
  `;
  return {
    access,
    awards: rows.map((row) => ({
      artifactState: artifactStateFromStatus(row.award_status, row.job_status),
      awardId: row.award_id,
      earnedAt: toIso(row.awarded_at)!,
      earnedReason: row.award_reason ?? "Ruined artifact award",
      fulfilledAt: toIso(row.completed_at),
      imageUrl: null,
      inputRequired: row.job_status === "collecting",
      name: row.award_name,
      trackingUrl: safeExternalUrl(row.production_snapshot?.tracking_url),
    })),
  };
}

export async function getMemberUpdates(
  authUserId: string,
): Promise<MemberUpdatesSnapshot | null> {
  const identity = await requireMemberIdentity(authUserId);
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, "updates.read")) {
    return { access, items: [], unreadCount: 0 };
  }
  const sql = getApplicationDatabase();
  const rows = await sql<
    Array<{
      body: string;
      href: string | null;
      id: string;
      kind: MemberUpdateItem["kind"];
      published_at: Date | string;
      read_at: Date | string | null;
      title: string;
    }>
  >`
    with membership_scope as (
      select
        member_assignment.circle_id,
        block_assignment.block_id,
        lifecycle.current_progression_level_slug
      from member_lifecycle lifecycle
      left join circle_member_assignments member_assignment
        on member_assignment.member_id = lifecycle.member_id
        and member_assignment.ended_at is null
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = member_assignment.circle_id
        and block_assignment.ended_at is null
      where lifecycle.member_id = ${identity.memberId}::uuid
      limit 1
    ), update_rows as (
      select
        notification.id::text as id,
        'notification'::text as kind,
        notification.title_snapshot as title,
        notification.body_snapshot as body,
        notification.action_url_snapshot as href,
        notification.created_at as published_at,
        notification.read_at
      from member_notifications notification
      where notification.member_id = ${identity.memberId}::uuid
        and notification.person_id = ${identity.personId}::uuid
        and notification.channel = 'in_app'
        and notification.status not in ('failed', 'cancelled')
        and notification.scheduled_for <= statement_timestamp()
        and notification.dismissed_at is null
      union all
      select
        announcement.id::text as id,
        'announcement'::text as kind,
        announcement.title,
        announcement.body_text as body,
        announcement.action_url as href,
        announcement.published_at,
        null::timestamptz as read_at
      from member_announcements announcement
      cross join membership_scope scope
      where announcement.status = 'published'
        and announcement.published_at <= statement_timestamp()
        and not exists (
          select 1
          from member_notifications notification
          where notification.announcement_id = announcement.id
            and notification.member_id = ${identity.memberId}::uuid
            and notification.channel = 'in_app'
        )
        and exists (
          select 1
          from member_announcement_targets target
          where target.announcement_id = announcement.id
            and (
              target.target_type = 'all_active_members'
              or (target.target_type = 'member' and target.member_id = ${identity.memberId}::uuid)
              or (target.target_type = 'circle' and target.circle_id = scope.circle_id)
              or (target.target_type = 'block' and target.block_id = scope.block_id)
              or (
                target.target_type = 'progression'
                and target.progression_level_slug = scope.current_progression_level_slug
              )
            )
        )
    )
    select id, kind, title, body, href, published_at, read_at
    from update_rows
    order by published_at desc
    limit 100
  `;
  const items = rows.map((row) => ({
    body: row.body,
    href: row.href,
    id: row.id,
    kind: row.kind,
    publishedAt: toIso(row.published_at)!,
    readAt: toIso(row.read_at),
    title: row.title,
  }));
  return {
    access,
    items,
    unreadCount: items.filter((item) => item.kind === "notification" && !item.readAt).length,
  };
}

export async function markMemberNotificationRead(
  authUserId: string,
  notificationId: string,
): Promise<void> {
  if (!UUID.test(notificationId)) throw new MembershipInputError("That update is not valid.");
  const identity = await requireMemberIdentity(authUserId);
  requireMemberCapability(identity, "updates.read");
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${notificationId}), 47)`;
    const updatedRows = await tx<Array<{ read_at: Date | string }>>`
      update member_notifications
      set read_at = coalesce(read_at, statement_timestamp()),
          updated_at = statement_timestamp()
      where id = ${notificationId}::uuid
        and member_id = ${identity.memberId}::uuid
        and person_id = ${identity.personId}::uuid
        and channel = 'in_app'
        and status not in ('failed', 'cancelled')
      returning read_at
    `;
    if (!updatedRows[0]) throw new MembershipAccessDeniedError();
    await tx`
      insert into member_notification_events (
        notification_id,
        event_type,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${notificationId}::uuid,
        'read',
        ${authUserId}::uuid,
        '{"source":"my_ruined"}'::jsonb,
        ${`notification-read:${notificationId}`}
      )
      on conflict (dedupe_key) do nothing
    `;
  });
}
