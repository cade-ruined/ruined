import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import type { MemberAccessIdentity } from "@/lib/membership/access-policy";
import { getMemberIdentity } from "@/lib/membership/repository";
import {
  defaultMemberCardSettings, MEMBER_CARD_TOKEN, MEMBER_PROFILE_IDENTIFIER, projectMemberCard, PublicCardError,
  validateMemberCardInput, type MemberCardInput, type MemberCardSettings,
  type MemberCardSnapshot, type MemberCardSource, type PublicMemberCard, type PublicMemberProfile,
} from "./public-card-model";

type CardSql = TransactionSql | ReturnType<typeof getApplicationDatabase>;

type CardRow = {
  member_id: string; public_token: string; wear_seed: string; public_enabled: boolean;
  show_portrait: boolean; show_member_since: boolean; show_location: boolean;
  show_bio: boolean; show_building: boolean; show_website: boolean; label_ids: string[]; version: number;
};
type SourceRow = {
  display_name: string | null; preferred_name: string | null;
  membership_activated_at: Date | string | null;
};
type PublicRow = CardRow & SourceRow & {
  person_id: string;
  account_state: MemberAccessIdentity["accountState"]; billing_state: MemberAccessIdentity["billingState"];
  program_state: MemberAccessIdentity["programState"]; standing_state: MemberAccessIdentity["standingState"];
  administrative_onboarding_state: MemberAccessIdentity["administrativeOnboardingState"];
  cancellation_effective_at: Date | string | null; registration_held?: boolean; complimentary_funded: boolean; operator_funded: boolean;
  shared_billing_state?: MemberAccessIdentity["billingState"] | null;
};
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
function wearSeed(memberId: string) { return createHash("sha256").update(`ruined-member-card:${memberId}`).digest("hex").slice(0, 24); }
function sourceRevision(source: MemberCardSource): string {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}
/** Released, participating members can share their profile regardless of card activation history. */
export function canPublishMemberProfile(identity: MemberAccessIdentity): boolean {
  if (identity.accountState !== "active" ||
      !["onboarding", "active"].includes(identity.programState) || !["active", "cancellation_requested"].includes(identity.standingState)) return false;
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  return ["onboarding", "full"].includes(access.mode) && memberCan(access, "profile.write");
}
/** Collectible cards retain their separate activation-date requirement. */
export function canPublishMemberCard(identity: MemberAccessIdentity, activation: string | null): boolean {
  return Boolean(activation && Number.isFinite(Date.parse(activation)) && Date.parse(activation) <= Date.now()) &&
    canPublishMemberProfile(identity);
}
function rowSettings(row: CardRow): MemberCardSettings {
  return { ...defaultMemberCardSettings(), publicEnabled: row.public_enabled };
}
async function owner(authUserId: string, write = false) {
  const identity = await getMemberIdentity(authUserId);
  if (!identity) throw new PublicCardError(403, "Member access is required.");
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  if (!memberCan(access, write ? "profile.write" : "profile.read")) throw new PublicCardError(403, "This account cannot change its member card.");
  return { identity, writable: memberCan(access, "profile.write") };
}
async function cardSource(memberId: string, sql: CardSql = getApplicationDatabase()): Promise<MemberCardSource> {
  const [row] = await sql<SourceRow[]>`
    select profile.display_name, profile.preferred_name, member.membership_activated_at
    from ruined_members member left join person_profiles profile on profile.person_id = member.person_id
    where member.id = ${memberId}::uuid limit 1
  `;
  if (!row) throw new PublicCardError(404, "Member card not found.");
  return rowSource(row);
}
function rowSource(row: SourceRow): MemberCardSource {
  return {
    name: row.display_name?.trim() || row.preferred_name?.trim() || "Member",
    memberTag: null, avatarUrl: null, memberSince: iso(row.membership_activated_at),
    location: null, bio: "", buildingNow: "", websiteUrl: "",
  };
}
export async function getOwnMemberCard(authUserId: string): Promise<MemberCardSnapshot> {
  const { identity, writable } = await owner(authUserId);
  const [source, rows] = await Promise.all([
    cardSource(identity.memberId),
    getApplicationDatabase()<CardRow[]>`select * from member_public_cards where member_id = ${identity.memberId}::uuid limit 1`,
  ]);
  const row = rows[0];
  const settings = row ? rowSettings(row) : defaultMemberCardSettings();
  const eligible = canPublishMemberCard(identity, source.memberSince);
  return {
    card: projectMemberCard(settings, source, [], row?.wear_seed ?? wearSeed(identity.memberId)),
    settings, version: row?.version ?? 0, writable, eligible, source: { ...source, memberSince: null },
    sourceRevision: sourceRevision(source), availableLabels: [],
    publicUrl: row?.public_enabled && eligible ? `/card/${row.public_token}` : null,
  };
}
export async function saveOwnMemberCard(authUserId: string, value: MemberCardInput): Promise<MemberCardSnapshot> {
  const input = validateMemberCardInput(value);
  const { identity, writable } = await owner(authUserId);
  const sql = getApplicationDatabase();
  await sql.begin(tx => saveProfileCardSettings(tx, identity, writable, input, true));
  return getOwnMemberCard(authUserId);
}
/** Shared transaction: profile text and public choices either both save or both roll back. */
export async function saveProfileCardSettings(
  tx: TransactionSql, identity: NonNullable<Awaited<ReturnType<typeof getMemberIdentity>>>,
  writable: boolean, value: MemberCardInput, withdrawalOnly = false,
): Promise<void> {
    const input = validateMemberCardInput(value);
    const authUserId = identity.authUserId;
    // All first-save and optimistic-version checks for this member are serialized.
    await tx`select id from ruined_members where id = ${identity.memberId}::uuid for update`;
    const [current] = await tx<CardRow[]>`select * from member_public_cards where member_id = ${identity.memberId}::uuid for update`;
    if ((current?.version ?? 0) !== input.version) throw new PublicCardError(409, "This card changed in another tab. Reload before saving.");
    // Publication can always be withdrawn without re-approving stale profile details or labels.
    if (current?.public_enabled && !input.publicEnabled && (withdrawalOnly || !writable)) {
      await tx`update member_public_cards set public_enabled = false,
        show_portrait = false, show_member_since = false, show_location = false, show_bio = false,
        show_building = false, show_website = false, label_ids = '[]'::jsonb, version = version + 1,
        updated_at = statement_timestamp() where member_id = ${identity.memberId}::uuid`;
      return;
    }
    if (!writable) throw new PublicCardError(403, "This account cannot change its member card.");
    // The name follows the current profile; only publication changes use this version.
    await tx`select person_id from person_profiles where person_id = ${identity.personId}::uuid for share`;
    const [source, liveRows] = await Promise.all([
      cardSource(identity.memberId, tx),
      tx<PublicRow[]>`select lifecycle.account_state, lifecycle.billing_state, lifecycle.program_state,
        lifecycle.standing_state, lifecycle.administrative_onboarding_state, lifecycle.cancellation_effective_at,
        private.ruined_member_has_operator_funding(member.id) as operator_funded,
      not private.ruined_member_profile_released(member.id) as registration_held,
      private.ruined_member_shared_billing_state(member.id) as shared_billing_state,
        private.ruined_member_has_complimentary_funding(member.id) as complimentary_funded
        from ruined_members member join member_lifecycle lifecycle on lifecycle.member_id = member.id
        where member.id = ${identity.memberId}::uuid and member.person_id = ${identity.personId}::uuid
          and exists (select 1 from platform_users viewer join platform_role_grants member_grant
            on member_grant.auth_user_id = viewer.auth_user_id and member_grant.role_slug = 'member' and member_grant.revoked_at is null
            where viewer.auth_user_id = ${authUserId}::uuid and viewer.person_id = member.person_id and viewer.status = 'active')
        for share of lifecycle`,
    ]);
    const live = liveRows[0];
    const latestIdentity: MemberAccessIdentity | null = live ? {
      accountState: live.account_state, billingState: live.shared_billing_state ?? live.billing_state, programState: live.program_state,
      standingState: live.standing_state, administrativeOnboardingState: live.administrative_onboarding_state,
      registrationHeld: live.registration_held === true, cancellationEffectiveAt: iso(live.cancellation_effective_at), membershipFunding: live.operator_funded ? "operator" : live.complimentary_funded ? "complimentary" : live.shared_billing_state ? "couple" : "self",
    } : null;
    if (!latestIdentity || !memberCan(deriveMemberAccessPolicy(latestIdentity, latestIdentity.cancellationEffectiveAt), "profile.write")) {
      throw new PublicCardError(403, "This account cannot change its member card.");
    }
    if (input.publicEnabled && !canPublishMemberCard(latestIdentity, source.memberSince)) throw new PublicCardError(403, "An active membership is required to share this card.");
    const token = current?.public_token ?? randomBytes(32).toString("base64url");
    await tx`
      insert into member_public_cards (member_id, public_token, wear_seed, public_enabled,
        show_portrait, show_member_since, show_location, show_bio, show_building, show_website, label_ids)
      values (${identity.memberId}::uuid, ${token}, ${current?.wear_seed ?? wearSeed(identity.memberId)}, ${input.publicEnabled},
        ${input.showPortrait}, ${input.showMemberSince}, ${input.showLocation}, ${input.showBio}, ${input.showBuilding}, ${input.showWebsite}, ${tx.json(input.labelIds)}::jsonb)
      on conflict (member_id) do update set public_enabled = excluded.public_enabled,
        show_portrait = excluded.show_portrait, show_member_since = excluded.show_member_since, show_location = excluded.show_location,
        show_bio = excluded.show_bio, show_building = excluded.show_building, show_website = excluded.show_website,
        label_ids = excluded.label_ids, version = member_public_cards.version + 1, updated_at = statement_timestamp()
    `;
}
async function publicCardRow(token: string, sql: CardSql = getApplicationDatabase()): Promise<PublicRow | null> {
  if (!MEMBER_CARD_TOKEN.test(token)) return null;
  const [row] = await sql<PublicRow[]>`
    select card.*, member.person_id, member.membership_activated_at,
      profile.display_name, profile.preferred_name,
      lifecycle.account_state, lifecycle.billing_state, lifecycle.program_state, lifecycle.standing_state,
      lifecycle.administrative_onboarding_state, lifecycle.cancellation_effective_at,
      private.ruined_member_has_operator_funding(member.id) as operator_funded,
      not private.ruined_member_profile_released(member.id) as registration_held,
      private.ruined_member_shared_billing_state(member.id) as shared_billing_state,
      private.ruined_member_has_complimentary_funding(member.id) as complimentary_funded
    from member_public_cards card join ruined_members member on member.id = card.member_id
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    left join person_profiles profile on profile.person_id = member.person_id
    where card.public_token = ${token} and card.public_enabled
      and exists (select 1 from platform_users viewer join platform_role_grants member_grant
        on member_grant.auth_user_id = viewer.auth_user_id and member_grant.role_slug = 'member' and member_grant.revoked_at is null
        where viewer.person_id = member.person_id and viewer.status = 'active')
    limit 1
  `;
  if (!row) return null;
  const identity: MemberAccessIdentity = {
    accountState: row.account_state, billingState: row.shared_billing_state ?? row.billing_state, programState: row.program_state,
    standingState: row.standing_state, administrativeOnboardingState: row.administrative_onboarding_state,
    registrationHeld: row.registration_held === true, cancellationEffectiveAt: iso(row.cancellation_effective_at), membershipFunding: row.operator_funded ? "operator" : row.complimentary_funded ? "complimentary" : row.shared_billing_state ? "couple" : "self",
  };
  return canPublishMemberCard(identity, iso(row.membership_activated_at)) ? row : null;
}
/** Server-only scope shared by opt-in Journal publication. Never send this identity to visitors. */
export async function getPublicMemberCardScope(token: string, sql: CardSql = getApplicationDatabase()) {
  const row = await publicCardRow(token, sql);
  return row ? { memberId: row.member_id, token: row.public_token, version: row.version } : null;
}
export async function getOwnMemberCardPublicScope(memberId: string, sql: CardSql = getApplicationDatabase()) {
  const [card] = await sql<{ public_token: string }[]>`
    select public_token from member_public_cards where member_id = ${memberId}::uuid and public_enabled
  `;
  if (!card) return null;
  const scope = await getPublicMemberCardScope(card.public_token, sql);
  return scope?.memberId === memberId ? scope : null;
}
export async function getPublicMemberCard(token: string): Promise<PublicMemberCard | null> {
  const row = await publicCardRow(token);
  if (!row) return null;
  const source = rowSource(row);
  const card = projectMemberCard(rowSettings(row), source, [], row.wear_seed);
  // Recheck the name and publication gate after the initial read.
  const latest = await publicCardRow(token);
  return latest?.version === row.version && sourceRevision(rowSource(latest)) === sourceRevision(source) ? card : null;
}
/** Invitation callers establish their own active invitation/owner gate before reading this projection. */
export async function getInvitationMemberCard(memberId: string): Promise<PublicMemberCard | null> {
  const sql = getApplicationDatabase();
  const [member] = await sql<{ person_id: string }[]>`select person_id from ruined_members where id = ${memberId}::uuid`;
  if (!member) return null;
  const source = await cardSource(memberId, sql);
  const card = projectMemberCard(defaultMemberCardSettings(), source, [], wearSeed(memberId));
  const latest = await cardSource(memberId, sql);
  return sourceRevision(latest) === sourceRevision(source) ? card : null;
}

/** Public profiles have a fixed field set and do not depend on card sharing. */
type ProfileRow = Pick<PublicRow, "account_state" | "billing_state" | "program_state" | "standing_state" |
  "administrative_onboarding_state" | "cancellation_effective_at" | "registration_held" | "operator_funded" |
  "complimentary_funded" | "shared_billing_state"> & {
  member_id: string; public_token: string | null; display_name: string | null; preferred_name: string | null;
  member_tag: string | null; bio: string | null; member_number: number | null;
};
async function publicProfileRows(identifiers: string[], sql: CardSql): Promise<ProfileRow[]> {
  const validIdentifiers = [...new Set(identifiers.filter(identifier => MEMBER_PROFILE_IDENTIFIER.test(identifier)))];
  if (!validIdentifiers.length) return [];
  const rows = await sql<ProfileRow[]>`
    select member.id as member_id, card.public_token, profile.display_name, profile.preferred_name,
      profile.member_tag, profile.bio, member.member_number,
      lifecycle.account_state, lifecycle.billing_state, lifecycle.program_state, lifecycle.standing_state,
      lifecycle.administrative_onboarding_state, lifecycle.cancellation_effective_at,
      private.ruined_member_has_operator_funding(member.id) as operator_funded,
      not private.ruined_member_profile_released(member.id) as registration_held,
      private.ruined_member_shared_billing_state(member.id) as shared_billing_state,
      private.ruined_member_has_complimentary_funding(member.id) as complimentary_funded
    from ruined_members member join member_lifecycle lifecycle on lifecycle.member_id = member.id
    left join person_profiles profile on profile.person_id = member.person_id
    left join member_public_cards card on card.member_id = member.id
    where member.deleted_at is null
      and (member.id::text in ${sql(validIdentifiers)}
        or profile.member_tag in ${sql(validIdentifiers.map(identifier => identifier.toLowerCase()))}
        or card.public_token in ${sql(validIdentifiers)})
      and exists (select 1 from platform_users viewer join platform_role_grants member_grant
        on member_grant.auth_user_id = viewer.auth_user_id and member_grant.role_slug = 'member' and member_grant.revoked_at is null
        where viewer.person_id = member.person_id and viewer.status = 'active')
  `;
  return rows.filter(profileRowIsPublic);
}
function profileRowIsPublic(row: ProfileRow): boolean {
  const identity: MemberAccessIdentity = {
    accountState: row.account_state, billingState: row.shared_billing_state ?? row.billing_state, programState: row.program_state,
    standingState: row.standing_state, administrativeOnboardingState: row.administrative_onboarding_state,
    registrationHeld: row.registration_held === true, cancellationEffectiveAt: iso(row.cancellation_effective_at),
    membershipFunding: row.operator_funded ? "operator" : row.complimentary_funded ? "complimentary" : row.shared_billing_state ? "couple" : "self",
  };
  return canPublishMemberProfile(identity);
}
async function publicProfileRow(identifier: string, sql: CardSql = getApplicationDatabase()): Promise<ProfileRow | null> {
  return (await publicProfileRows([identifier], sql))[0] ?? null;
}
function profileProjection(row: ProfileRow): PublicMemberProfile {
  return { name: row.display_name?.trim() || row.preferred_name?.trim() || "Member", memberTag: row.member_tag,
    bio: row.bio?.trim() || null, memberNumber: row.member_number };
}
function profileScope(row: ProfileRow) {
  return { memberId: row.member_id, token: row.member_tag || row.public_token || row.member_id,
    version: createHash("sha256").update(JSON.stringify(profileProjection(row))).digest("hex") };
}
/** Resolve only currently public profiles; Circle-only details never enter this projection. */
export async function getPublicMemberProfileLinks(memberIds: string[], sql: CardSql = getApplicationDatabase()): Promise<Map<string, string>> {
  const ids = [...new Set(memberIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)).map(id => id.toLowerCase()))];
  const rows = await publicProfileRows(ids, sql);
  return new Map(rows.map(row => [row.member_id, `/profile/${encodeURIComponent(profileScope(row).token)}`]));
}
export async function getPublicMemberProfileScope(identifier: string, sql: CardSql = getApplicationDatabase()) {
  const row = await publicProfileRow(identifier, sql);
  return row ? profileScope(row) : null;
}
export async function getOwnMemberProfilePublicScope(memberId: string, sql: CardSql = getApplicationDatabase()) {
  const row = await publicProfileRow(memberId, sql);
  return row?.member_id === memberId ? profileScope(row) : null;
}
export async function getPublicMemberProfile(identifier: string): Promise<PublicMemberProfile | null> {
  const row = await publicProfileRow(identifier);
  return row ? profileProjection(row) : null;
}

/** Retired card portrait route: legacy selections never authorize image bytes. */
export async function getPublicMemberCardPortrait(token: string): Promise<Blob | null> {
  if (!MEMBER_CARD_TOKEN.test(token)) return null;
  return null;
}
