import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import { PREVIEW_MEMBER_IDENTITY, PREVIEW_MEMBER_FOUNDATIONS_STATE } from "@/lib/membership/preview";
import type { MemberIdentity } from "@/lib/membership/model";

export const MEMBER_PREVIEW_SCENARIOS = ["foundations", "joining", "active", "operator", "complimentary", "limited"] as const;
export type MemberPreviewScenario = typeof MEMBER_PREVIEW_SCENARIOS[number];
export const MEMBER_PREVIEW_COOKIE = "ruined-member-preview";
export function memberPreviewScenario(value: unknown): MemberPreviewScenario {
  return MEMBER_PREVIEW_SCENARIOS.includes(value as MemberPreviewScenario) ? value as MemberPreviewScenario : "foundations";
}

// Presentation fixtures only. The server calls this exclusively in the
// existing non-production preview mode; it never authorizes a real account.
export function memberPreviewIdentity(scenario: MemberPreviewScenario) {
  const identity = { ...PREVIEW_MEMBER_IDENTITY, membershipFunding: "self" as "self" | "operator" | "complimentary" };
  if (scenario === "joining") Object.assign(identity, { billingState: "pending", administrativeOnboardingState: "in_progress", standingState: "pre_active", programState: "prospect", foundationsState: "not_started" });
  if (scenario === "active" || scenario === "operator") Object.assign(identity, { programState: "active", foundationsState: "completed" });
  if (scenario === "operator") Object.assign(identity, { membershipFunding: "operator", billingState: "pending" });
  if (scenario === "complimentary") Object.assign(identity, { membershipFunding: "complimentary", billingState: "pending" });
  if (scenario === "limited") Object.assign(identity, { standingState: "paused", programState: "paused" });
  return identity;
}

export function memberPreviewSnapshot<T>(fixture: T, scenario: MemberPreviewScenario): T {
  if (!fixture || typeof fixture !== "object") return fixture;
  const identity = memberPreviewIdentity(scenario);
  const access = deriveMemberAccessPolicy(identity);
  // Fixtures are JSON-safe snapshots, not service objects or authority.
  const data = structuredClone(fixture) as Record<string, unknown>;
  if ("authUserId" in data && "memberId" in data) return identity as T;
  if ("access" in data) data.access = access;
  if ("identity" in data) data.identity = identity;
  if ("billingState" in data) data.billingState = identity.billingState;
  if ("standingState" in data) data.standingState = identity.standingState;
  if ("agreement" in data) data.membershipFunding = identity.membershipFunding;
  if (scenario === "joining" && "agreement" in data) {
    data.agreement = { ...(data.agreement as object), acceptanceId: null, acceptedAt: null, receiptId: null };
    if ("requiredFieldsComplete" in data) { data.requiredFieldsComplete = false; data.state = "in_progress"; data.completedAt = null; }
  }
  if (data.foundations && identity.foundationsState === "completed") {
    const foundations = data.foundations as { progressPercent: number; state: string; requirements: { moments: { completed: number; total: number }; futureLetter: { completed: boolean; completedAt: string | null } } };
    foundations.progressPercent = 100;
    foundations.state = "completed";
    foundations.requirements.moments.completed = foundations.requirements.moments.total;
    foundations.requirements.futureLetter = { completed: true, completedAt: "2026-08-26T16:00:00.000Z" };
    data.nextAction = { kind: "circle", title: "Meet your Circle", body: "", href: "/my/circle" };
  }
  if ("nextAction" in data && !memberCan(access, "foundations.write")) {
    data.nextAction = access.mode === "entry"
      ? { kind: "onboarding", title: "Finish joining", body: access.reason, href: "/my/join" }
      : { kind: "account", title: "Review membership", body: access.reason, href: "/my/account" };
  }
  if (!memberCan(access, "learn.read") && "collections" in data) { data.uncollected = []; data.collections = []; }
  if (!memberCan(access, "circle.read")) {
    for (const key of ["circle", "block", "shaper", "nextMeeting", "circleName", "blockName"]) if (key in data) data[key] = null;
    for (const key of ["circleMembers", "members", "meetings", "resources"]) if (key in data) data[key] = [];
    if ("communication" in data) data.communication = { chatHref: null, chatState: "unavailable" };
    // These fixtures contain public community dates and one private Circle
    // meeting. Keep public dates without implying private-room access.
    for (const key of ["upcomingExperiences", "upcoming", "past"]) {
      if (Array.isArray(data[key])) data[key] = (data[key] as Array<{ kind: string }>).filter((event) => event.kind !== "circle_meeting");
    }
    if ((data.nextExperience as { kind?: string } | null)?.kind === "circle_meeting") data.nextExperience = null;
  }
  if (!memberCan(access, "artifacts.read")) for (const key of ["artifacts", "awards"]) if (key in data) data[key] = [];
  if (scenario === "joining") {
    if ("memberSince" in data) data.memberSince = null;
    if (data.foundations) {
      const total = (data.foundations as { requirements: { moments: { total: number } } }).requirements.moments.total;
      data.foundations = { progressPercent: 0, state: "not_started", requirements: {
        activeCircle: { completed: false, name: null },
        futureLetter: { completed: false, completedAt: null },
        moments: { completed: 0, total },
        timeline: { completed: false, completedAt: null, entryCount: 0 },
      } };
    }
    if ("upcomingExperiences" in data) data.upcomingExperiences = [];
    if ("nextExperience" in data) data.nextExperience = null;
    if ("ruinedHistory" in data) data.ruinedHistory = [];
  }
  return data as T;
}

export function memberPreviewFoundations(identity: MemberIdentity) {
  const state = structuredClone(PREVIEW_MEMBER_FOUNDATIONS_STATE);
  if (identity.foundationsState === "completed") {
    state.completedUnits = state.totalUnits;
    state.progressPercent = 100;
    state.status = "completed";
    state.nextMomentId = null;
    if (state.requirements) {
      state.requirements.futureLetter = { completed: true, completedAt: "2026-08-26T16:00:00.000Z" };
    }
    state.units = state.units.map((unit) => ({ ...unit, status: "completed" }));
  }
  return state;
}
