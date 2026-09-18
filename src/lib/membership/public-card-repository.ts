import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import type { MemberAccessIdentity } from "@/lib/membership/access-policy";
import { getMemberIdentity } from "@/lib/membership/repository";
import { MEMBER_PHOTO_BUCKET, ownedMemberPhotoPath } from "@/lib/membership/photo-policy";
import {
  defaultMemberCardSettings, MEMBER_CARD_TOKEN, projectMemberCard, PublicCardError,
  validateMemberCardInput, type MemberCardInput, type MemberCardLabel, type MemberCardSettings,
  type MemberCardSnapshot, type MemberCardSource, type PublicMemberCard,
} from "./public-card-model";

type CardSql = TransactionSql | ReturnType<typeof getApplicationDatabase>;

type CardRow = {
  member_id: string; public_token: string; wear_seed: string; public_enabled: boolean;
  show_portrait: boolean; show_member_since: boolean; show_location: boolean;
  show_bio: boolean; show_building: boolean; show_website: boolean; label_ids: string[]; version: number;
};
type SourceRow = {
  display_name: string | null; preferred_name: string | null; member_tag: string | null; avatar_storage_path: string | null;
  membership_activated_at: Date | string | null; location_label: string | null; bio: string | null; building_now: string | null; website_url: string | null;
};
type PublicRow = CardRow & SourceRow & {
  person_id: string;
  account_state: MemberAccessIdentity["accountState"]; billing_state: MemberAccessIdentity["billingState"];
  program_state: MemberAccessIdentity["programState"]; standing_state: MemberAccessIdentity["standingState"];
  administrative_onboarding_state: MemberAccessIdentity["administrativeOnboardingState"];
  cancellation_effective_at: Date | string | null; operator_funded: boolean;
};
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
function wearSeed(memberId: string) { return createHash("sha256").update(`ruined-member-card:${memberId}`).digest("hex").slice(0, 24); }
function sourceRevision(source: MemberCardSource, labels: MemberCardLabel[]): string {
  return createHash("sha256").update(JSON.stringify([source, labels])).digest("hex");
}
/** Entry, paused, suspended, inactive and ended accounts cannot publish. */
export function canPublishMemberCard(identity: MemberAccessIdentity, activation: string | null): boolean {
  if (!activation || !Number.isFinite(Date.parse(activation)) || Date.parse(activation) > Date.now() || identity.accountState !== "active" ||
      !["onboarding", "active"].includes(identity.programState) || !["active", "cancellation_requested"].includes(identity.standingState)) return false;
  const access = deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt);
  return ["onboarding", "full"].includes(access.mode) && memberCan(access, "profile.write");
}
function rowSettings(row: CardRow): MemberCardSettings {
  return {
    publicEnabled: row.public_enabled, showPortrait: row.show_portrait,
    showMemberSince: row.show_member_since, showLocation: row.show_location, showBio: row.show_bio,
    showBuilding: row.show_building, showWebsite: row.show_website, labelIds: row.label_ids,
  };
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
    select profile.display_name, profile.preferred_name, profile.member_tag, profile.avatar_storage_path,
      member.membership_activated_at, profile.location_label, profile.bio, profile.building_now, profile.website_url
    from ruined_members member left join person_profiles profile on profile.person_id = member.person_id
    where member.id = ${memberId}::uuid limit 1
  `;
  if (!row) throw new PublicCardError(404, "Member card not found.");
  return rowSource(row, memberId);
}
function rowSource(row: SourceRow, memberId: string): MemberCardSource {
  return {
    name: row.display_name?.trim() || row.preferred_name?.trim() || "Member",
    memberTag: row.member_tag,
    avatarUrl: ownedMemberPhotoPath(memberId, row.avatar_storage_path) ? row.avatar_storage_path : null,
    memberSince: iso(row.membership_activated_at), location: row.location_label,
    bio: row.bio ?? "", buildingNow: row.building_now ?? "", websiteUrl: row.website_url ?? "",
  };
}
/** Only existing member-visible milestone records; private evidence never leaves SQL. */
async function cardLabels(memberId: string, personId: string, sql: CardSql = getApplicationDatabase(), lock = false): Promise<MemberCardLabel[]> {
  if (lock) await sql`select id from member_milestones where member_id = ${memberId}::uuid and person_id = ${personId}::uuid for share`;
  const rows = await sql<Array<{ id: string; title: string }>>`
    select milestone.id, milestone.title from member_milestones milestone
    where milestone.member_id = ${memberId}::uuid and milestone.person_id = ${personId}::uuid
      and milestone.visibility in ('member', 'circle') and milestone.occurred_at <= statement_timestamp()
      and (milestone.source_entity_type is distinct from 'artifact_award' or exists (
        select 1 from artifact_awards award where award.id::text = milestone.source_entity_id
          and award.member_id = ${memberId}::uuid and award.person_id = ${personId}::uuid
          and award.status in ('awarded', 'in_fulfillment', 'fulfilled') and award.revoked_at is null
          and award.awarded_at <= statement_timestamp()
      ))
    order by milestone.occurred_at desc, milestone.id desc limit 100
  `;
  return rows.map(row => ({ id: row.id, label: row.title }));
}
export async function getOwnMemberCard(authUserId: string): Promise<MemberCardSnapshot> {
  const { identity, writable } = await owner(authUserId);
  const [source, availableLabels, rows] = await Promise.all([
    cardSource(identity.memberId), cardLabels(identity.memberId, identity.personId),
    getApplicationDatabase()<CardRow[]>`select * from member_public_cards where member_id = ${identity.memberId}::uuid limit 1`,
  ]);
  const row = rows[0];
  const settings = row ? rowSettings(row) : defaultMemberCardSettings();
  const eligible = canPublishMemberCard(identity, source.memberSince);
  return {
    card: projectMemberCard(settings, source, availableLabels, row?.wear_seed ?? wearSeed(identity.memberId)),
    settings, version: row?.version ?? 0, writable, eligible, source, sourceRevision: sourceRevision(source, availableLabels), availableLabels,
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
      await tx`update member_public_cards set public_enabled = false, version = version + 1,
        updated_at = statement_timestamp() where member_id = ${identity.memberId}::uuid`;
      return;
    }
    if (!writable) throw new PublicCardError(403, "This account cannot change its member card.");
    // Selected fields deliberately follow the current profile; only scope changes use this version.
    await tx`select person_id from person_profiles where person_id = ${identity.personId}::uuid for share`;
    const [source, labels, liveRows] = await Promise.all([
      cardSource(identity.memberId, tx), cardLabels(identity.memberId, identity.personId, tx, true),
      tx<PublicRow[]>`select lifecycle.account_state, lifecycle.billing_state, lifecycle.program_state,
        lifecycle.standing_state, lifecycle.administrative_onboarding_state, lifecycle.cancellation_effective_at,
        private.ruined_member_has_operator_funding(member.id) as operator_funded
        from ruined_members member join member_lifecycle lifecycle on lifecycle.member_id = member.id
        where member.id = ${identity.memberId}::uuid and member.person_id = ${identity.personId}::uuid
          and exists (select 1 from platform_users viewer join platform_role_grants member_grant
            on member_grant.auth_user_id = viewer.auth_user_id and member_grant.role_slug = 'member' and member_grant.revoked_at is null
            where viewer.auth_user_id = ${authUserId}::uuid and viewer.person_id = member.person_id and viewer.status = 'active')
        for share of lifecycle`,
    ]);
    const live = liveRows[0];
    const latestIdentity: MemberAccessIdentity | null = live ? {
      accountState: live.account_state, billingState: live.billing_state, programState: live.program_state,
      standingState: live.standing_state, administrativeOnboardingState: live.administrative_onboarding_state,
      cancellationEffectiveAt: iso(live.cancellation_effective_at), membershipFunding: live.operator_funded ? "operator" : "self",
    } : null;
    if (!latestIdentity || !memberCan(deriveMemberAccessPolicy(latestIdentity, latestIdentity.cancellationEffectiveAt), "profile.write")) {
      throw new PublicCardError(403, "This account cannot change its member card.");
    }
    if (input.publicEnabled && !canPublishMemberCard(latestIdentity, source.memberSince)) throw new PublicCardError(403, "An active membership is required to share this card.");
    if (input.labelIds.some(id => !labels.some(label => label.id === id))) throw new PublicCardError(400, "One of those labels is no longer available. Choose a current milestone.");
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
async function publicCardRow(token: string): Promise<PublicRow | null> {
  if (!MEMBER_CARD_TOKEN.test(token)) return null;
  const [row] = await getApplicationDatabase()<PublicRow[]>`
    select card.*, member.person_id, member.membership_activated_at,
      profile.display_name, profile.preferred_name, profile.member_tag, profile.avatar_storage_path,
      profile.location_label, profile.bio, profile.building_now, profile.website_url,
      lifecycle.account_state, lifecycle.billing_state, lifecycle.program_state, lifecycle.standing_state,
      lifecycle.administrative_onboarding_state, lifecycle.cancellation_effective_at,
      private.ruined_member_has_operator_funding(member.id) as operator_funded
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
    accountState: row.account_state, billingState: row.billing_state, programState: row.program_state,
    standingState: row.standing_state, administrativeOnboardingState: row.administrative_onboarding_state,
    cancellationEffectiveAt: iso(row.cancellation_effective_at), membershipFunding: row.operator_funded ? "operator" : "self",
  };
  return canPublishMemberCard(identity, iso(row.membership_activated_at)) ? row : null;
}
function publicPortraitPath(row: PublicRow): string | null {
  return row.show_portrait ? ownedMemberPhotoPath(row.member_id, row.avatar_storage_path) : null;
}
export async function getPublicMemberCard(token: string): Promise<PublicMemberCard | null> {
  const row = await publicCardRow(token);
  if (!row) return null;
  const labels = await cardLabels(row.member_id, row.person_id);
  const source = rowSource(row, row.member_id);
  const revision = sourceRevision(source, labels);
  const portraitRevision = createHash("sha256").update(publicPortraitPath(row) ?? "").digest("hex").slice(0, 20);
  const card = projectMemberCard(rowSettings(row), {
    ...source, avatarUrl: publicPortraitPath(row) ? `/api/cards/${token}/portrait?v=${portraitRevision}` : null,
  }, labels, row.wear_seed);
  // Recheck after projection: changed public scope or cleared profile data must not leak a stale response.
  const latest = await publicCardRow(token);
  return latest?.version === row.version && sourceRevision(rowSource(latest, latest.member_id), labels) === revision ? card : null;
}
export async function getPublicMemberCardPortrait(token: string): Promise<Blob | null> {
  const row = await publicCardRow(token);
  if (!row) return null;
  const path = publicPortraitPath(row);
  if (!path) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) throw new PublicCardError(503, "This portrait is temporarily unavailable.");
  const store = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
  }).storage.from(MEMBER_PHOTO_BUCKET);
  const { data, error } = await store.download(path);
  if (error) {
    if ("statusCode" in error && String(error.statusCode) === "404") return null;
    throw new PublicCardError(503, "This portrait is temporarily unavailable.");
  }
  // No signed redirect: each byte response is guarded, including after slow storage.
  const current = await publicCardRow(token);
  return current?.version === row.version && publicPortraitPath(current) === path ? data : null;
}
