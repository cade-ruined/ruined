import type {
  MemberAccessPolicy,
  MemberCapability,
  MemberIdentity,
} from "@/lib/membership/model";

const ENTRY_CAPABILITIES = [
  "account.read",
  "home.read",
  "profile.read",
  "profile.write",
] as const satisfies readonly MemberCapability[];

const ONBOARDING_CAPABILITIES = [
  ...ENTRY_CAPABILITIES,
  "artifacts.read",
  "circle.read",
  "foundations.summary",
  "foundations.write",
  "updates.read",
] as const satisfies readonly MemberCapability[];

const FULL_CAPABILITIES = [
  ...ONBOARDING_CAPABILITIES,
  "artifacts.write",
  "experiences.member",
  "foundations.revisit",
  "learn.read",
] as const satisfies readonly MemberCapability[];

const LIMITED_CAPABILITIES = [
  "account.read",
  "artifacts.read",
  "foundations.summary",
  "home.read",
  "profile.read",
] as const satisfies readonly MemberCapability[];

export function memberCan(
  access: MemberAccessPolicy,
  capability: MemberCapability,
): boolean {
  return access.capabilities.includes(capability);
}

export function deriveMemberAccessPolicy(
  identity: MemberIdentity,
  accessEndsAt: string | null = null,
): MemberAccessPolicy {
  if (identity.accountState === "suspended") {
    return {
      accessEndsAt,
      capabilities: ["account.read"],
      mode: "suspended",
      reason: "Membership access is suspended. Contact Ruined for support.",
    };
  }

  if (identity.accountState === "closed") {
    return {
      accessEndsAt,
      capabilities: ["account.read"],
      mode: "limited",
      reason: "This membership is closed.",
    };
  }

  if (identity.accountState !== "active") {
    return {
      accessEndsAt,
      capabilities: ENTRY_CAPABILITIES,
      mode: "entry",
      reason: "Complete the administrative side of membership to continue.",
    };
  }

  if (
    identity.billingState === "pending" ||
    identity.administrativeOnboardingState !== "completed" ||
    identity.standingState === "pre_active"
  ) {
    return {
      accessEndsAt,
      capabilities: ENTRY_CAPABILITIES,
      mode: "entry",
      reason: "Complete the administrative side of membership to continue.",
    };
  }

  if (
    identity.billingState === "attention_required" ||
    identity.billingState === "ended"
  ) {
    return {
      accessEndsAt,
      capabilities: LIMITED_CAPABILITIES,
      mode: "limited",
      reason:
        identity.billingState === "attention_required"
          ? "Membership billing needs attention."
          : "This membership is no longer active.",
    };
  }

  if (identity.standingState === "cancellation_requested") {
    const effectiveAt = identity.cancellationEffectiveAt;
    const effectiveInFuture =
      effectiveAt !== null && new Date(effectiveAt).getTime() > Date.now();

    if (!effectiveInFuture) {
      return {
        accessEndsAt: effectiveAt,
        capabilities: LIMITED_CAPABILITIES,
        mode: "limited",
        reason: effectiveAt
          ? "This membership cancellation is now effective."
          : "Membership cancellation is awaiting an effective date.",
      };
    }

    return {
      accessEndsAt: effectiveAt,
      capabilities: FULL_CAPABILITIES,
      mode: "full",
      reason: `Membership access continues through ${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
      }).format(new Date(effectiveAt))}.`,
    };
  }

  if (identity.standingState === "alumni") {
    return {
      accessEndsAt,
      capabilities: [
        ...LIMITED_CAPABILITIES,
        "experiences.member",
        "foundations.revisit",
        "learn.read",
      ],
      mode: "alumni",
      reason: null,
    };
  }

  if (
    identity.standingState === "paused" ||
    identity.standingState === "inactive"
  ) {
    return {
      accessEndsAt,
      capabilities: LIMITED_CAPABILITIES,
      mode: "limited",
      reason:
        identity.standingState === "paused"
          ? "Membership participation is paused."
          : "Membership participation is inactive.",
    };
  }

  if (identity.programState === "onboarding") {
    return {
      accessEndsAt,
      capabilities: ONBOARDING_CAPABILITIES,
      mode: "onboarding",
      reason: null,
    };
  }

  return {
    accessEndsAt,
    capabilities: FULL_CAPABILITIES,
    mode: "full",
    reason: null,
  };
}
