import "server-only";

import type { PlatformViewer } from "@/lib/platform/model";
import { getSupportReturnTo } from "@/lib/auth/support-return";
import {
  claimPlatformMemberForViewer,
  getPasswordlessAccessEligibility,
  getOperatorRole,
  PlatformAccessDeniedError,
} from "@/lib/platform/repository";
import { claimPlatformOperatorForViewer } from "@/lib/platform/ops-access-repository";
import { ensureOperatorMemberProfile } from "@/lib/platform/operator-member-profile";

/** Call only after completePlatformSignIn has succeeded. This grants no access. */
export async function getSupportSignInDestination(
  viewer: PlatformViewer,
  requestedReturnTo: unknown,
  fallback: "/my" | "/my/join" | "/ops",
): Promise<string> {
  const returnTo = getSupportReturnTo(requestedReturnTo);
  if (!returnTo) return fallback;
  if (returnTo.startsWith("/ops/") && await getOperatorRole(viewer.authUserId) !== "ops_admin") return fallback;
  return returnTo;
}

/** Eligibility is private server state, never a role chosen on the login form. */
export async function getUnifiedAccessEligibility(email: string) {
  const [member, operator] = await Promise.all([
    getPasswordlessAccessEligibility(email, "member"),
    getPasswordlessAccessEligibility(email, "ops"),
  ]);
  return {
    member,
    operator,
    eligible: member !== "none" || operator !== "none",
    // Returning identities must not be recreated, even with another pending invite.
    shouldCreateUser: member !== "returning" && operator !== "returning" &&
      (member === "invited" || operator === "invited"),
  };
}

/** Called only after Supabase has verified the identity, including existing sessions. */
export async function completePlatformSignIn(
  viewer: PlatformViewer,
): Promise<{ redirectTo: "/my" | "/my/join" | "/ops" }> {
  const access = await getUnifiedAccessEligibility(viewer.email);
  if (!access.eligible) throw new PlatformAccessDeniedError();

  let memberAuthorized = false;
  let operatorAuthorized = false;

  // Each claim rechecks current grants/invitations inside its own transaction.
  // Claim staff first so dual invitations converge on the same canonical
  // person. One stale secondary invitation must not lock out a valid account.
  if (access.operator !== "none") {
    try {
      await claimPlatformOperatorForViewer(viewer);
      operatorAuthorized = true;
    } catch (error) {
      if (!(error instanceof PlatformAccessDeniedError)) throw error;
    }
  }
  if (access.member !== "none") {
    try {
      await claimPlatformMemberForViewer(viewer);
      memberAuthorized = true;
    } catch (error) {
      if (!(error instanceof PlatformAccessDeniedError)) throw error;
    }
  }

  if (operatorAuthorized) {
    try {
      const profile = await ensureOperatorMemberProfile(viewer);
      memberAuthorized ||= profile.memberAccess;
    } catch (error) {
      // A conflicting, closed, or deliberately revoked member record must not
      // remove independently valid operations access.
      if (!(error instanceof PlatformAccessDeniedError)) throw error;
    }
  }

  if (memberAuthorized) {
    return { redirectTo: !operatorAuthorized && access.member === "invited" ? "/my/join" : "/my" };
  }
  if (operatorAuthorized) return { redirectTo: "/ops" };
  throw new PlatformAccessDeniedError();
}
