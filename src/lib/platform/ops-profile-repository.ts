import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOBILE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export type OpsMemberProfileSupport = {
  accessibilityNotes: string | null;
  address: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    countryCode: string;
    postalCode: string;
    region: string;
  } | null;
  apparelTopSize: string | null;
  avatarStoragePath: string | null;
  bio: string | null;
  buildingNow: string | null;
  directoryStatus: string;
  displayName: string;
  legalName: string | null;
  location: string | null;
  mobile: string | null;
  preferredName: string;
  timezone: string | null;
  version: string;
};

type ProfileTimestamp = Date | string | null;

function requireUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is required and must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined, maximum: number): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new OpsOperatingRepositoryError("invalid_request", `That value must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function addressFromValue(value: unknown): OpsMemberProfileSupport["address"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const address = value as Record<string, unknown>;
  const stringValue = (key: string) => typeof address[key] === "string" ? address[key] : "";
  const line1 = stringValue("addressLine1").trim();
  const city = stringValue("city").trim();
  const countryCode = stringValue("countryCode").trim().toUpperCase();
  const postalCode = stringValue("postalCode").trim();
  const region = stringValue("region").trim();
  if (!line1 || !city || !countryCode || !postalCode || !region) return null;
  return {
    addressLine1: line1,
    addressLine2: stringValue("addressLine2").trim() || null,
    city,
    countryCode,
    postalCode,
    region,
  };
}

function timestampVersion(value: ProfileTimestamp): string {
  if (!value) return "none";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "none" : date.toISOString();
}

function profileVersion(
  publicUpdatedAt: ProfileTimestamp,
  privateUpdatedAt: ProfileTimestamp,
): string {
  return `${timestampVersion(publicUpdatedAt)}|${timestampVersion(privateUpdatedAt)}`;
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
    && (input as Record<string, unknown>)[key] !== undefined;
}

async function requireProfileAdmin(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  lock = false,
): Promise<string> {
  const actorAuthUserId = requireUuid(actorAuthUserIdValue, "Operator identity");
  const rows = lock
    ? await tx<Array<{ auth_user_id: string }>>`
        select platform_user.auth_user_id
        from platform_users platform_user
        join platform_role_grants role_grant on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null
        for update of platform_user, role_grant
      `
    : await tx<Array<{ auth_user_id: string }>>`
        select platform_user.auth_user_id
        from platform_users platform_user
        join platform_role_grants role_grant on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null
      `;
  if (!rows[0]) {
    throw new OpsOperatingRepositoryError("forbidden", "Private profile support requires operations administrator access.");
  }
  return actorAuthUserId;
}

export async function getOpsMemberProfileSupport(
  actorAuthUserId: string,
  memberIdValue: string,
): Promise<OpsMemberProfileSupport | null> {
  const memberId = requireUuid(memberIdValue, "Member");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read`;
    const operatorAuthUserId = await requireProfileAdmin(tx, actorAuthUserId);
    const rows = await tx<Array<{
      accessibility_notes: string | null;
      apparel_sizing: Record<string, unknown> | null;
      avatar_storage_path: string | null;
      bio: string | null;
      building_now: string | null;
      default_fulfillment_address: Record<string, unknown> | null;
      directory_status: string;
      display_name: string | null;
      legal_name: string | null;
      location_label: string | null;
      mobile_e164: string | null;
      preferred_name: string | null;
      private_profile_updated_at: ProfileTimestamp;
      profile_updated_at: ProfileTimestamp;
      timezone: string | null;
    }>>`
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
        private_profile.default_fulfillment_address,
        private_profile.apparel_sizing,
        private_profile.accessibility_notes,
        profile.updated_at as profile_updated_at,
        private_profile.updated_at as private_profile_updated_at,
        coalesce(preference.directory_status, 'hidden') as directory_status
      from ruined_members member
      left join person_profiles profile on profile.person_id = member.person_id
      left join person_private_profiles private_profile on private_profile.person_id = member.person_id
      left join member_directory_preferences preference on preference.member_id = member.id
      where member.id = ${memberId}::uuid
    `;
    const row = rows[0];
    if (!row) return null;
    await tx`
      insert into operator_audit_events (
        actor_auth_user_id,
        action,
        subject_type,
        subject_id,
        member_id,
        before_snapshot,
        after_snapshot,
        metadata,
        dedupe_key
      ) values (
        ${operatorAuthUserId}::uuid,
        'member.private_profile_viewed',
        'member_profile',
        ${memberId},
        ${memberId}::uuid,
        null,
        null,
        ${tx.json({
          fields: ["contact", "fulfillment", "apparel_sizing", "accessibility"],
          sensitiveValuesStoredInAudit: false,
        })},
        ${randomUUID()}
      )
    `;
    const apparelTop = row.apparel_sizing?.top;
    return {
      accessibilityNotes: row.accessibility_notes,
      address: addressFromValue(row.default_fulfillment_address),
      apparelTopSize: typeof apparelTop === "string" ? apparelTop : null,
      avatarStoragePath: row.avatar_storage_path,
      bio: row.bio,
      buildingNow: row.building_now,
      directoryStatus: row.directory_status,
      displayName: row.display_name ?? row.preferred_name ?? "Member",
      legalName: row.legal_name,
      location: row.location_label,
      mobile: row.mobile_e164,
      preferredName: row.preferred_name ?? row.display_name ?? "Member",
      timezone: row.timezone,
      version: profileVersion(row.profile_updated_at, row.private_profile_updated_at),
    };
  });
}

export async function updateOpsMemberProfileSupport(input: {
  accessibilityNotes?: string | null;
  actorAuthUserId: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  apparelTopSize?: string | null;
  bio?: string | null;
  buildingNow?: string | null;
  city?: string | null;
  countryCode?: string | null;
  displayName?: string;
  expectedVersion: string;
  legalName?: string | null;
  location?: string | null;
  memberId: string;
  mobile?: string | null;
  postalCode?: string | null;
  preferredName?: string;
  reason: string;
  region?: string | null;
  timezone?: string | null;
}) {
  const memberId = requireUuid(input.memberId, "Member");
  const expectedVersion = requiredText(input.expectedVersion, "Profile version", 200);
  const reason = requiredText(input.reason, "Correction reason", 1000);
  const supportedFields = [
    "accessibilityNotes",
    "addressLine1",
    "addressLine2",
    "apparelTopSize",
    "bio",
    "buildingNow",
    "city",
    "countryCode",
    "displayName",
    "legalName",
    "location",
    "mobile",
    "postalCode",
    "preferredName",
    "region",
    "timezone",
  ] as const;
  const changedFields = supportedFields.filter((field) => hasOwn(input, field));
  if (changedFields.length === 0) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose at least one profile field to update.");
  }

  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireProfileAdmin(tx, input.actorAuthUserId, true);
    // Member-authored and operator-assisted profile writes share this lock.
    await tx`select pg_advisory_xact_lock(hashtext(${memberId}), 44)`;
    const memberRows = await tx<Array<{ person_id: string | null }>>`
      select member.person_id
      from ruined_members member
      where member.id = ${memberId}::uuid
      for update
    `;
    const member = memberRows[0];
    if (!member?.person_id) throw new OpsOperatingRepositoryError("not_found", "Member profile not found.");
    const rows = await tx<Array<{
      accessibility_notes: string | null;
      apparel_sizing: Record<string, unknown> | null;
      bio: string | null;
      building_now: string | null;
      default_fulfillment_address: Record<string, unknown> | null;
      display_name: string | null;
      legal_name: string | null;
      location_label: string | null;
      mobile_e164: string | null;
      preferred_name: string | null;
      private_profile_updated_at: ProfileTimestamp;
      profile_updated_at: ProfileTimestamp;
      timezone: string | null;
    }>>`
      select
        profile.display_name,
        profile.preferred_name,
        profile.timezone,
        profile.location_label,
        profile.bio,
        profile.building_now,
        profile.updated_at as profile_updated_at,
        private_profile.legal_name,
        private_profile.mobile_e164,
        private_profile.default_fulfillment_address,
        private_profile.apparel_sizing,
        private_profile.accessibility_notes,
        private_profile.updated_at as private_profile_updated_at
      from (select ${member.person_id}::uuid as person_id) identity
      left join person_profiles profile on profile.person_id = identity.person_id
      left join person_private_profiles private_profile on private_profile.person_id = identity.person_id
    `;
    const current = rows[0];
    if (!current) throw new OpsOperatingRepositoryError("not_found", "Member profile not found.");
    const currentVersion = profileVersion(current.profile_updated_at, current.private_profile_updated_at);
    if (currentVersion !== expectedVersion) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "This profile changed after it was opened. Refresh before saving support changes.",
      );
    }

    const publicChanged = changedFields.some((field) => [
      "displayName", "preferredName", "timezone", "location", "bio", "buildingNow",
    ].includes(field));
    const privateChanged = changedFields.some((field) => [
      "legalName", "mobile", "accessibilityNotes", "apparelTopSize",
      "addressLine1", "addressLine2", "city", "region", "postalCode", "countryCode",
    ].includes(field));
    const displayName = hasOwn(input, "displayName")
      ? requiredText(input.displayName ?? "", "Display name", 120)
      : current.display_name;
    const preferredName = hasOwn(input, "preferredName")
      ? requiredText(input.preferredName ?? "", "Preferred name", 120)
      : current.preferred_name;
    const timezone = hasOwn(input, "timezone") ? optionalText(input.timezone, 100) : current.timezone;
    const location = hasOwn(input, "location") ? optionalText(input.location, 160) : current.location_label;
    const bio = hasOwn(input, "bio") ? optionalText(input.bio, 1200) : current.bio;
    const buildingNow = hasOwn(input, "buildingNow") ? optionalText(input.buildingNow, 500) : current.building_now;
    const legalName = hasOwn(input, "legalName") ? optionalText(input.legalName, 180) : current.legal_name;
    const mobile = hasOwn(input, "mobile") ? optionalText(input.mobile, 20) : current.mobile_e164;
    if (mobile && !MOBILE_PATTERN.test(mobile)) {
      throw new OpsOperatingRepositoryError("invalid_request", "Mobile number must include a country code, such as +18015550123.");
    }
    const accessibilityNotes = hasOwn(input, "accessibilityNotes")
      ? optionalText(input.accessibilityNotes, 2000)
      : current.accessibility_notes;

    const currentAddress = addressFromValue(current.default_fulfillment_address);
    const addressFields = ["addressLine1", "addressLine2", "city", "region", "postalCode", "countryCode"] as const;
    const addressChanged = addressFields.some((field) => hasOwn(input, field));
    let address = currentAddress;
    if (addressChanged) {
      const nextAddress = {
        addressLine1: hasOwn(input, "addressLine1") ? input.addressLine1?.trim() ?? "" : currentAddress?.addressLine1 ?? "",
        addressLine2: hasOwn(input, "addressLine2") ? optionalText(input.addressLine2, 160) : currentAddress?.addressLine2 ?? null,
        city: hasOwn(input, "city") ? input.city?.trim() ?? "" : currentAddress?.city ?? "",
        countryCode: (hasOwn(input, "countryCode") ? input.countryCode?.trim() ?? "" : currentAddress?.countryCode ?? "").toUpperCase(),
        postalCode: hasOwn(input, "postalCode") ? input.postalCode?.trim() ?? "" : currentAddress?.postalCode ?? "",
        region: hasOwn(input, "region") ? input.region?.trim() ?? "" : currentAddress?.region ?? "",
      };
      const requiredAddressParts = [nextAddress.addressLine1, nextAddress.city, nextAddress.region, nextAddress.postalCode, nextAddress.countryCode];
      if (requiredAddressParts.every((part) => !part) && !nextAddress.addressLine2) {
        address = null;
      } else {
        if (requiredAddressParts.some((part) => !part)) {
          throw new OpsOperatingRepositoryError("invalid_request", "A shipping address needs street, city, region, postal code, and country.");
        }
        if (!/^[A-Z]{2}$/.test(nextAddress.countryCode)) {
          throw new OpsOperatingRepositoryError("invalid_request", "Country must use its two-letter code.");
        }
        address = {
          addressLine1: requiredText(nextAddress.addressLine1, "Street address", 160),
          addressLine2: nextAddress.addressLine2,
          city: requiredText(nextAddress.city, "City", 100),
          countryCode: nextAddress.countryCode,
          postalCode: requiredText(nextAddress.postalCode, "Postal code", 24),
          region: requiredText(nextAddress.region, "State or region", 100),
        };
      }
    }

    let apparelSizing = current.apparel_sizing;
    if (hasOwn(input, "apparelTopSize")) {
      const nextTop = optionalText(input.apparelTopSize, 40);
      const nextSizing = { ...(current.apparel_sizing ?? {}) };
      if (nextTop) nextSizing.top = nextTop;
      else delete nextSizing.top;
      apparelSizing = Object.keys(nextSizing).length ? nextSizing : null;
    }

    if (publicChanged) await tx`
      insert into person_profiles (
        person_id,
        display_name,
        preferred_name,
        timezone,
        location_label,
        bio,
        building_now
      ) values (
        ${member.person_id}::uuid,
        ${displayName},
        ${preferredName},
        ${timezone},
        ${location},
        ${bio},
        ${buildingNow}
      )
      on conflict (person_id) do update set
        display_name = excluded.display_name,
        preferred_name = excluded.preferred_name,
        timezone = excluded.timezone,
        location_label = excluded.location_label,
        bio = excluded.bio,
        building_now = excluded.building_now,
        updated_at = statement_timestamp()
    `;
    if (privateChanged) await tx`
      insert into person_private_profiles (
        person_id,
        legal_name,
        mobile_e164,
        default_fulfillment_address,
        apparel_sizing,
        accessibility_notes
      ) values (
        ${member.person_id}::uuid,
        ${legalName},
        ${mobile},
        ${address === null ? null : tx.json(address)},
        ${apparelSizing === null ? null : tx.json(apparelSizing as postgres.JSONValue)},
        ${accessibilityNotes}
      )
      on conflict (person_id) do update set
        legal_name = excluded.legal_name,
        mobile_e164 = excluded.mobile_e164,
        default_fulfillment_address = excluded.default_fulfillment_address,
        apparel_sizing = excluded.apparel_sizing,
        accessibility_notes = excluded.accessibility_notes,
        updated_at = statement_timestamp()
    `;
    const versionRows = await tx<Array<{
      private_profile_updated_at: ProfileTimestamp;
      profile_updated_at: ProfileTimestamp;
    }>>`
      select
        profile.updated_at as profile_updated_at,
        private_profile.updated_at as private_profile_updated_at
      from (select ${member.person_id}::uuid as person_id) identity
      left join person_profiles profile on profile.person_id = identity.person_id
      left join person_private_profiles private_profile on private_profile.person_id = identity.person_id
    `;
    const nextVersion = profileVersion(
      versionRows[0]?.profile_updated_at ?? null,
      versionRows[0]?.private_profile_updated_at ?? null,
    );
    await tx`
      insert into operator_audit_events (
        actor_auth_user_id,
        action,
        subject_type,
        subject_id,
        member_id,
        reason,
        before_snapshot,
        after_snapshot,
        metadata,
        dedupe_key
      ) values (
        ${actorAuthUserId}::uuid,
        'member.profile_supported',
        'member_profile',
        ${memberId},
        ${memberId}::uuid,
        ${reason},
        ${tx.json({ expectedVersion, version: currentVersion })},
        ${tx.json({
          addressPresent: address !== null,
          apparelSizingPresent: apparelSizing !== null,
          fields: changedFields,
          version: nextVersion,
        })},
        ${tx.json({ sensitiveValuesStoredInAudit: false })},
        ${randomUUID()}
      )
    `;
    return { memberId, version: nextVersion };
  });
}
