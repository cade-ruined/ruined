import "server-only";
import { getMemberRegistrationDestination } from "@/lib/membership/registration-repository";

type SignInDestination = "/my" | "/my/join" | "/ops" | "/my/payment-method" | "/my/registered" | "/my/activate";

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
  fallback: SignInDestination,
): Promise<string> {
  if (fallback === "/my/payment-method" || fallback === "/my/registered" || fallback === "/my/activate") return fallback;
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
  options?: { invitationToken: string },
): Promise<{ redirectTo: SignInDestination }> {
  if (options?.invitationToken !== undefined) {
    // A personal invitation approves membership only. Its claim revalidates
    // the exact recipient, deadline and eligibility in the same transaction.
    await claimPlatformMemberForViewer(viewer, options.invitationToken);
    return { redirectTo: (await getMemberRegistrationDestination(viewer.authUserId) ?? "/my/join") as SignInDestination };
  }
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
    const registration = await getMemberRegistrationDestination(viewer.authUserId);
    if (registration) return { redirectTo: registration as SignInDestination };
    return { redirectTo: !operatorAuthorized && access.member === "invited" ? "/my/join" : "/my" };
  }
  if (operatorAuthorized) return { redirectTo: "/ops" };
  throw new PlatformAccessDeniedError();
}
