import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  platformRepository,
  pageData,
  requestRoute,
  verifyRoute,
  checkoutRoute,
  portalRoute,
  middleware,
  membershipMigration,
] = await Promise.all([
  source("src/lib/platform/repository.ts"),
  source("src/lib/platform/page-data.ts"),
  source("app/api/auth/otp/request/route.ts"),
  source("app/api/auth/otp/verify/route.ts"),
  source("app/api/stripe/checkout/route.ts"),
  source("app/api/stripe/portal/route.ts"),
  source("middleware.ts"),
  source("db/migrations/20260825_membership_foundations_circle_gate.sql"),
]);

function functionSource(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} was not found`);
  assert.ok(end > start, `${endMarker} was not found after ${startMarker}`);
  return sourceText.slice(start, end);
}

test("OTP delivery is generic and creates an Auth identity only for a current invitation", () => {
  const eligibilityIndex = requestRoute.indexOf("getPasswordlessAccessEligibility(email, audience)");
  const otpIndex = requestRoute.indexOf("supabase.auth.signInWithOtp");

  assert.ok(eligibilityIndex >= 0 && otpIndex > eligibilityIndex);
  assert.match(requestRoute, /const response = NextResponse\.json\(\{ ok: true \}\)/);
  assert.match(requestRoute, /if \(eligibility === "none"\) return response/);
  assert.match(requestRoute, /options: \{ shouldCreateUser: eligibility === "invited" \}/);
  assert.doesNotMatch(requestRoute, /console\.(?:warn|error|log)\([^)]*email/);
});

test("eligibility admits active returning identities and only live member invitations", () => {
  const eligibility = functionSource(
    platformRepository,
    "export async function getPasswordlessAccessEligibility",
    "export async function requireActivePlatformMemberLink",
  );

  assert.match(
    eligibility,
    /platform_user\.user_type = 'staff'[\s\S]*platform_user\.status = 'active'[\s\S]*grant_row\.role_slug in \('ops_admin', 'circle_leader', 'guide'\)[\s\S]*grant_row\.revoked_at is null/,
  );
  assert.match(
    eligibility,
    /join member_lifecycle lifecycle[\s\S]*platform_user\.user_type = 'member'[\s\S]*platform_user\.status = 'active'[\s\S]*lifecycle\.account_state = 'active'/,
  );
  assert.match(eligibility, /invitation\.intended_user_type = 'member'/);
  assert.match(eligibility, /invitation\.accepted_at is null/);
  assert.match(eligibility, /invitation\.revoked_at is null/);
  assert.match(
    eligibility,
    /invitation\.expires_at is null or invitation\.expires_at > statement_timestamp\(\)/,
  );
  assert.match(eligibility, /lifecycle\.account_state in \('suspended', 'closed'\)/);
});

test("member claim is serialized, invitation-bound, and never creates an uninvited member", () => {
  const claim = functionSource(
    platformRepository,
    "export async function claimPlatformMemberForViewer",
    "type MemberSnapshotRow",
  );
  const returningIndex = claim.indexOf('existingLink?.status === "active"');
  const invitationIndex = claim.indexOf("from passwordless_account_invites");

  assert.match(claim, /sql\.begin\(async \(tx\) =>/);
  assert.match(claim, /pg_advisory_xact_lock\(hashtext\(\$\{emailNormalized\}\), 1\)/);
  assert.ok(returningIndex >= 0 && invitationIndex > returningIndex);
  assert.match(
    claim,
    /from passwordless_account_invites[\s\S]*accepted_at is null[\s\S]*revoked_at is null[\s\S]*expires_at > statement_timestamp\(\)[\s\S]*for update/,
  );
  assert.match(
    claim,
    /where id = \$\{invitation\.member_id\}::uuid[\s\S]*email_normalized = \$\{emailNormalized\}/,
  );
  assert.match(claim, /auth_user_id <> \$\{viewer\.authUserId\}::uuid/);
  assert.match(claim, /existingLifecycle\?\.account_state === "suspended"/);
  assert.match(claim, /existingLifecycle\?\.account_state === "closed"/);
  assert.match(
    claim,
    /existingLink\?\.status === "active"[\s\S]*join member_lifecycle lifecycle[\s\S]*memberRows\[0\]\?\.account_state !== "active"/,
  );
  assert.doesNotMatch(claim, /insert into ruined_members/);
  assert.match(
    claim,
    /update passwordless_account_invites[\s\S]*accepted_by_auth_user_id = \$\{viewer\.authUserId\}::uuid[\s\S]*accepted_at = statement_timestamp\(\)/,
  );
  assert.match(
    claim,
    /revoked_by_auth_user_id = \$\{viewer\.authUserId\}::uuid[\s\S]*id <> \$\{invitation\.id\}::bigint[\s\S]*accepted_at is null[\s\S]*revoked_at is null/,
  );
  assert.match(claim, /insert into platform_role_grants/);
});

test("verification rechecks authorization and clears the verified session on denial", () => {
  const eligibilityIndex = verifyRoute.indexOf("getPasswordlessAccessEligibility(email, audience)");
  const verifyIndex = verifyRoute.indexOf("supabase.auth.verifyOtp");
  const claimIndex = verifyRoute.indexOf("claimPlatformMemberForViewer", verifyIndex);

  assert.ok(eligibilityIndex >= 0 && verifyIndex > eligibilityIndex && claimIndex > verifyIndex);
  assert.match(verifyRoute, /const verifiedEmail = data\.user\.email\?\.trim\(\)\.toLowerCase\(\)/);
  assert.match(verifyRoute, /verifiedEmail !== email/);
  assert.match(verifyRoute, /await getOperatorRole\(authUserId\)/);
  assert.match(
    verifyRoute,
    /const denialResponse = NextResponse\.json[\s\S]*response: denialResponse[\s\S]*denialClient\.auth\.signOut\(\{ scope: "local" \}\)[\s\S]*return denialResponse/,
  );
  assert.match(verifyRoute, /return denyVerifiedSession\(request, denied \? 401 : 503\)/);
});

test("GET page data and Stripe mutations only consume an existing member link", () => {
  const memberPageData = functionSource(
    pageData,
    "export async function getMemberPageContext",
    "export async function getOperatorPageContext",
  );

  assert.match(memberPageData, /getMemberPlatformSnapshot\(viewer\.authUserId\)/);
  assert.match(memberPageData, /state: member \? "authenticated" : "denied"/);
  assert.doesNotMatch(memberPageData, /claimPlatformMemberForViewer|ensurePlatformMemberForViewer/);

  for (const route of [checkoutRoute, portalRoute]) {
    assert.match(route, /requireActivePlatformMemberLink\(viewer\)/);
    assert.doesNotMatch(route, /claimPlatformMemberForViewer|ensurePlatformMemberForViewer/);
    assert.match(route, /error instanceof PlatformAccessDeniedError/);
    assert.match(route, /status: 403/);
  }
});

test("middleware refreshes sessions for member and operations API namespaces", () => {
  for (const matcher of ["/api/my/:path*", "/api/ops/:path*"]) {
    assert.ok(middleware.includes(`"${matcher}"`), `${matcher} is not protected`);
  }
});

test("revocation closes Data API program reads while account entry remains available", () => {
  assert.match(
    membershipMigration,
    /function private\.ruined_sync_revoked_member_platform_access\(\)[\s\S]*account_state not in \('suspended', 'closed'\)[\s\S]*update public\.platform_users/,
  );
  assert.match(
    membershipMigration,
    /function private\.ruined_current_member_id\(\)[\s\S]*platform_user\.user_type = 'member'[\s\S]*lifecycle\.account_state = 'active'/,
  );
  assert.match(
    membershipMigration,
    /function private\.ruined_current_active_access_member_id\(\)[\s\S]*lifecycle\.billing_state = 'active'[\s\S]*lifecycle\.program_state in \('onboarding', 'active'\)/,
  );
  assert.match(
    membershipMigration,
    /foundation_enrollments_select_self[\s\S]*private\.ruined_current_active_access_member_id\(\)/,
  );

  const snapshot = functionSource(
    platformRepository,
    "export async function getMemberPlatformSnapshot",
    "export async function getOperatorRole",
  );
  assert.match(snapshot, /lifecycle\.account_state = 'active'/);
  assert.doesNotMatch(snapshot, /lifecycle\.billing_state = 'active'/);
  assert.doesNotMatch(snapshot, /lifecycle\.program_state in \('onboarding', 'active'\)/);
});
