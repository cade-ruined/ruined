import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  repository,
  invitationRoute,
  circleRoute,
  assignmentRoute,
  blockRoute,
  blockAssignmentRoute,
  actions,
  membersPage,
  circlesPage,
  opsSection,
] = await Promise.all([
  source("src/lib/platform/ops-repository.ts"),
  source("app/api/ops/invitations/route.ts"),
  source("app/api/ops/circles/route.ts"),
  source("app/api/ops/circle-assignments/route.ts"),
  source("app/api/ops/blocks/route.ts"),
  source("app/api/ops/block-assignments/route.ts"),
  source("src/components/platform/OpsActions.tsx"),
  source("app/ops/members/page.tsx"),
  source("app/ops/circles/page.tsx"),
  source("src/components/platform/OpsSection.tsx"),
]);

test("every ops mutation verifies origin, identity, and ops_admin again inside its transaction", () => {
  for (const route of [
    invitationRoute,
    circleRoute,
    assignmentRoute,
    blockRoute,
    blockAssignmentRoute,
  ]) {
    assert.match(route, /isTrustedPlatformOrigin\(request\)/);
    assert.match(route, /const viewer = await getCurrentPlatformViewer\(\)/);
    assert.match(route, /if \(!viewer\)[\s\S]*401/);
    assert.match(route, /actorAuthUserId: viewer\.authUserId/);
  }

  assert.match(repository, /join platform_role_grants grant_row/);
  assert.match(repository, /platform_user\.status = 'active'/);
  assert.match(repository, /grant_row\.role_slug = 'ops_admin'/);
  assert.match(repository, /grant_row\.revoked_at is null/);
  assert.match(repository, /for update of platform_user, grant_row/);
  for (const functionName of [
    "createOrReissueMemberInvitation",
    "revokeLiveMemberInvitations",
    "createCircle",
    "activateCircle",
    "getOpsCircleSummaries",
    "createBlock",
    "activateBlock",
    "getOpsBlockSummaries",
    "assignCircleToBlock",
    "endCircleBlockAssignment",
    "assignMemberToCircle",
    "endMemberCircleAssignment",
  ]) {
    const start = repository.indexOf(`export async function ${functionName}`);
    const end = repository.indexOf("export async function", start + 1);
    const body = repository.slice(start, end < 0 ? undefined : end);
    assert.ok(start >= 0, `${functionName} must exist`);
    assert.match(body, /sql\.begin\(async \(tx\) => \{/);
    assert.match(body, /await requireOpsAdmin\(tx, actorAuthUserId\)/);
  }
});

test("member invitations are bound to a durable member and lifecycle for exactly seven days", () => {
  const requestBody = invitationRoute.match(
    /type InvitationRequestBody = \{([\s\S]*?)\n\};/,
  )?.[1] ?? "";

  assert.match(requestBody, /email\?: unknown/);
  assert.doesNotMatch(requestBody, /role|lifecycle|expiry|expires|userType|memberId/i);
  assert.match(repository, /pg_advisory_xact_lock\(hashtext\(\$\{email\}\), 1\)/);
  assert.match(repository, /from platform_users[\s\S]*email_normalized = \$\{email\}[\s\S]*for update/);
  assert.match(repository, /ensurePersonForEmail\(tx, \{/);
  assert.match(repository, /preferredPersonId: identity\?\.person_id \?\? member\?\.person_id/);
  assert.match(repository, /verified: identity\?\.status === "active"/);
  assert.match(repository, /identity\?\.status === "suspended"[\s\S]*identity\?\.status === "disabled"/);
  assert.match(repository, /from ruined_members[\s\S]*email_normalized = \$\{email\}[\s\S]*for update/);
  assert.match(repository, /insert into ruined_members \(id, person_id, email, email_normalized\)/);
  assert.match(repository, /insert into member_lifecycle \([\s\S]*'invited'[\s\S]*'prospect'/);
  assert.match(repository, /insert into member_onboardings \([\s\S]*'administrative-v1'/);
  assert.match(repository, /lifecycle\.account_state === "suspended"[\s\S]*lifecycle\.account_state === "closed"/);
  assert.match(repository, /update passwordless_account_invites[\s\S]*accepted_at is null[\s\S]*revoked_at is null/);
  assert.match(repository, /insert into passwordless_account_invites \([\s\S]*member_id/);
  assert.match(repository, /\$\{member\.id\}::uuid[\s\S]*'member'[\s\S]*interval '7 days'/);
  assert.doesNotMatch(invitationRoute, /resend|sendEmail|send_email/i);
});

test("live invitations can be explicitly revoked through the same serialized boundary", () => {
  assert.match(invitationRoute, /export async function DELETE\(request: Request\)/);
  assert.match(invitationRoute, /revokeLiveMemberInvitations\(\{/);
  assert.match(repository, /export async function revokeLiveMemberInvitations/);
  assert.match(
    repository,
    /revokeLiveMemberInvitations[\s\S]*pg_advisory_xact_lock\(hashtext\(\$\{email\}\), 1\)[\s\S]*update passwordless_account_invites/,
  );
  assert.match(repository, /intended_user_type = 'member'/);
  assert.match(repository, /accepted_at is null[\s\S]*revoked_at is null/);
  assert.match(repository, /revoked_by_auth_user_id = \$\{actorAuthUserId\}::uuid/);
  assert.match(actions, /"\/api\/ops\/invitations", \{ email \}, "DELETE"/);
  assert.match(actions, /Revoke live invite/);
});

test("Circle creation keeps slug, capacity, and lifecycle server-owned", () => {
  const requestBody = circleRoute.match(/type CircleRequestBody = \{([\s\S]*?)\n\};/)?.[1] ?? "";

  assert.match(requestBody, /name\?: unknown/);
  assert.doesNotMatch(requestBody, /slug|capacity|status|startsAt|endsAt|role/i);
  assert.match(repository, /function circleSlug\(name: string\)/);
  assert.match(repository, /randomUUID\(\)\.slice\(0, 8\)/);
  assert.match(repository, /insert into circles \(id, name, slug\)/);
  assert.doesNotMatch(repository, /insert into circles \(id, name, slug, capacity|insert into circles \(id, name, slug, status/);
});

test("Circle activation is an explicit server-owned transition before Foundations completion", () => {
  assert.match(circleRoute, /export async function PATCH\(request: Request\)/);
  assert.match(circleRoute, /activateCircle\(\{/);
  assert.match(repository, /export async function activateCircle/);
  assert.match(repository, /circle\.status !== "forming"/);
  assert.match(repository, /activeMembers < 1/);
  assert.match(repository, /status = 'active'/);
  assert.match(repository, /starts_at = coalesce\(starts_at, statement_timestamp\(\)\)/);
  assert.match(repository, /activated_by_auth_user_id = \$\{actorAuthUserId\}::uuid/);
  assert.match(actions, /Activation is deliberate/);
  assert.match(actions, /allows assigned members to complete Foundations/);
  assert.match(actions, /"\/api\/ops\/circles", \{ circleId \}, "PATCH"/);
});

test("Circle assignment serializes per member and fails closed on eligibility", () => {
  const requestBody = assignmentRoute.match(
    /type CircleAssignmentRequestBody = \{([\s\S]*?)\n\};/,
  )?.[1] ?? "";

  assert.match(requestBody, /circleId\?: unknown/);
  assert.match(requestBody, /memberId\?: unknown/);
  assert.doesNotMatch(requestBody, /role|lifecycle|billing|program|expiry|capacity/i);
  assert.match(repository, /pg_advisory_xact_lock\(hashtext\(\$\{memberId\}\), 2\)/);
  assert.match(repository, /member\.account_state === "active"/);
  assert.match(repository, /member\.billing_state === "active"/);
  assert.match(repository, /member\.membership_state === "active"/);
  assert.match(repository, /member\.program_state === "onboarding"[\s\S]*member\.program_state === "active"/);
  assert.match(repository, /where member_id = \$\{memberId\}::uuid[\s\S]*ended_at is null[\s\S]*for update/);
  assert.match(repository, /circle\.status !== "forming" && circle\.status !== "active"/);
  assert.match(repository, /active_members[\s\S]*circle\.capacity/);
  assert.match(repository, /assigned_by_auth_user_id[\s\S]*\$\{actorAuthUserId\}::uuid/);
});

test("active Circle assignments can be ended without deleting historical proof", () => {
  assert.match(assignmentRoute, /export async function PATCH\(request: Request\)/);
  assert.match(assignmentRoute, /endMemberCircleAssignment\(\{/);
  assert.match(repository, /export async function endMemberCircleAssignment/);
  assert.match(
    repository,
    /endMemberCircleAssignment[\s\S]*pg_advisory_xact_lock\(hashtext\(\$\{memberId\}\), 2\)[\s\S]*from ruined_members[\s\S]*for update[\s\S]*from circle_member_assignments[\s\S]*ended_at is null[\s\S]*for update/,
  );
  assert.match(repository, /ended_at = statement_timestamp\(\)/);
  assert.match(repository, /end_reason = 'ops_ended_assignment'/);
  assert.match(repository, /ended_by_auth_user_id = \$\{actorAuthUserId\}::uuid/);
  assert.match(
    repository,
    /from circles[\s\S]*id = \$\{assignment\.circle_id\}::uuid[\s\S]*for update/,
  );
  assert.match(repository, /circle\.status === "active" && activeMembers === 1/);
  assert.match(repository, /status = 'archived'/);
  assert.doesNotMatch(repository, /delete from circle_member_assignments/);
  assert.match(actions, /"\/api\/ops\/circle-assignments", \{ memberId \}, "PATCH"/);
  assert.match(actions, /Completed Foundations keeps its historical Circle proof/);
});

test("mutating controls are connected-only and remain absent for non-admin operators", () => {
  assert.match(membersPage, /context\.role === "ops_admin" && context\.viewer/);
  assert.match(circlesPage, /context\.role === "ops_admin" && context\.viewer/);
  assert.match(circlesPage, /getOpsCircleSummaries\(context\.viewer\.authUserId\)/);
  assert.match(actions, /Open passwordless eligibility for seven days/);
  assert.match(actions, /No email was sent/);
  assert.match(actions, /\/api\/ops\/invitations", \{ email \}/);
  assert.match(actions, /\/api\/ops\/circles", \{ name \}/);
  assert.match(actions, /\/api\/ops\/circle-assignments"[\s\S]*\{[\s\S]*circleId,[\s\S]*memberId/);
  assert.match(opsSection, /circles\?: Array/);
  assert.match(opsSection, /circle\.activeMembers} \/ \{circle\.capacity/);
});
