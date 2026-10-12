import { defaultMemberCardSettings, projectMemberCard, type MemberCardSnapshot, type MemberCardSource } from "./public-card-model";
import { PREVIEW_MEMBER_PROFILE } from "./preview";
import type { MemberProfileSnapshot } from "./model";

/** Local development fixture. No preview token or public link is ever issued. */
export function memberCardPreviewSnapshot(profile: MemberProfileSnapshot = PREVIEW_MEMBER_PROFILE): MemberCardSnapshot {
  const source: MemberCardSource = {
    name: profile.directory.displayName,
    memberTag: null,
    avatarUrl: null,
    memberSince: null,
    location: null,
    bio: "",
    buildingNow: "",
    websiteUrl: "",
  };
  const settings = defaultMemberCardSettings();
  return { card: projectMemberCard(settings, source, [], "ruined-card-development-preview"), settings, source, sourceRevision: "0".repeat(64), availableLabels: [], version: 0, writable: false, eligible: false, publicUrl: null };
}
