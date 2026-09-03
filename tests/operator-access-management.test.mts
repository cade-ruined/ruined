import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  migration,
  runner,
  repository,
  route,
  otpRequest,
  otpVerify,
  platformRepository,
  page,
  manager,
  shell,
] = await Promise.all([
  source("db/migrations/20260829_operator_access_management.sql"),
  source("scripts/migrate-platform.mjs"),
  source("src/lib/platform/ops-access-repository.ts"),
  source("app/api/ops/operators/route.ts"),
  source("app/api/auth/otp/request/route.ts"),
  source("app/api/auth/otp/verify/route.ts"),
  source("src/lib/platform/repository.ts"),
  source("app/ops/operators/page.tsx"),
  source("src/components/platform/OperatorAccessManager.tsx"),
  source("src/components/platform/PlatformShell.tsx"),
]);

test("operator access migration is ordered, immutable, indexed, and server-only", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /set local lock_timeout = '10s'/);
  assert.match(migration, /operator_invitation_configs/);
  assert.match(migration, /operator_invitation_circles/);
  assert.match(migration, /references public\.passwordless_account_invites\(id\) on delete restrict/);
  assert.match(migration, /operator_invitation_circles_circle_idx/);
  assert.match(migration, /Operator invitation configuration is immutable/);
  assert.match(migration, /intended_user_type = 'staff'/);
  assert.match(migration, /enable row level security/g);
  assert.match(
    migration,
    /revoke all on table[\s\S]*operator_invitation_configs[\s\S]*operator_invitation_circles[\s\S]*from public, anon, authenticated/,
  );
  assert.match(migration, /commit;\s*$/);
  assert.match(runner, /20260829_operator_access_management\.sql/);
});

test("operator invitations are admin-authorized, email-serialized, scoped, and audited", () => {
  assert.match(repository, /async function requireOpsAdmin/);
  assert.match(repository, /role_grant\.role_slug = 'ops_admin'/);
  assert.match(repository, /pg_advisory_xact_lock\(hashtext\(\$\{email\}\), 1\)/);
  assert.match(repository, /intended_user_type[\s\S]*'staff'/);
  assert.match(repository, /role_slug in \('ops_admin', 'circle_leader', 'guide'\)/);
  assert.match(repository, /Choose at least one Circle/);
  assert.match(repository, /already has a Shaper or a pending Shaper invitation/);
  assert.match(repository, /operator_invitation\.created/);
  assert.match(repository, /operator_invitation\.reissued/);
  assert.match(repository, /insert into operator_audit_events/);
});

test("verified staff claims reuse the shared identity and apply role plus Circle scope", () => {
  assert.match(platformRepository, /intended_user_type = 'staff'/);
  assert.match(platformRepository, /return rows\[0\]\?\.has_invite \? "invited" : "none"/);
  assert.match(otpRequest, /eligibility\.shouldCreateUser[\s\S]*options = \{ emailRedirectTo, shouldCreateUser: true \}/);
  assert.match(otpVerify, /completePlatformSignIn/);
  assert.match(repository, /ensurePersonForEmail/);
  assert.match(repository, /insert into platform_role_grants/);
  assert.match(repository, /insert into circle_staff_assignments/);
  assert.match(repository, /accepted_by_auth_user_id/);
  assert.match(repository, /operator_invitation\.accepted/);
  assert.doesNotMatch(repository, /user_metadata|app_metadata/);
});

test("access removal protects the final administrator and leaves shared membership identity intact", () => {
  assert.match(repository, /Ask another administrator to remove your access/);
  assert.match(repository, /ruined-operator-admins/);
  assert.match(repository, /Ruined must keep at least one active administrator/);
  assert.match(repository, /update circle_staff_assignments[\s\S]*ended_at = statement_timestamp\(\)/);
  assert.match(repository, /update platform_role_grants[\s\S]*revoked_at = statement_timestamp\(\)/);
  const removal = repository.slice(repository.indexOf("export async function removeOperatorAccess"), repository.indexOf("export async function claimPlatformOperatorForViewer"));
  assert.doesNotMatch(removal, /update platform_users[\s\S]*status/);
});

test("operator API fails closed and separates invitation delivery from authorization", () => {
  assert.match(route, /isTrustedPlatformOrigin\(request\)/);
  assert.match(route, /getCurrentPlatformViewer\(\)/);
  assert.match(route, /application\/json/);
  assert.match(route, /createOrReissueOperatorInvitation/);
  assert.match(route, /sendInvitedOperatorAccessCode/);
  assert.match(route, /delivery: "not_sent"/);
  assert.match(route, /removeOperatorAccess/);
  assert.match(route, /revokeOperatorInvitation/);
});

test("operator UI uses a low-training list and focused add task", () => {
  assert.match(page, /OperatorAccessManager/);
  assert.match(manager, /Add operator/);
  assert.match(manager, /Full name/);
  assert.match(manager, /Responsibility/);
  assert.match(manager, /Assigned Circles/);
  assert.match(manager, /Send invitation/);
  assert.match(manager, /aria-live="polite"/);
  assert.match(manager, /role="dialog"/);
  assert.match(manager, /keepFocusInside/);
  assert.match(manager, /event\.key === "Escape"/);
  assert.match(manager, /readOnly=\{Boolean\(resendEmail\)\}/);
  assert.match(manager, /Revoke it first to use a different email/);
  assert.match(manager, /Administrator[\s\S]*Shaper[\s\S]*Guide|Guide[\s\S]*Shaper[\s\S]*Administrator/);
  assert.match(manager, /Invitation pending/);
  assert.match(manager, /Remove operator access\?/);
});

test("operator navigation is grouped, responsive, and capability-aware", () => {
  const dailyWork = shell.slice(shell.indexOf('label: "Daily work"'), shell.indexOf('label: "Manage"'));
  const manage = shell.slice(shell.indexOf('label: "Manage"'), shell.indexOf('label: "Administration"'));
  assert.match(shell, /Daily work/);
  assert.match(shell, /Administration/);
  assert.match(shell, /\/ops\/operators/);
  assert.doesNotMatch(dailyWork, /\/ops\/academy/);
  assert.match(manage, /\/ops\/academy/);
  assert.match(shell, /operatorRole === "ops_admin"/);
  assert.match(shell, /aria-haspopup="dialog"/);
  assert.match(shell, /Close operations menu/);
  assert.match(shell, /mobileDialogRef/);
  assert.match(shell, /keepFocusInside/);
  assert.match(shell, /aria-current=\{current \? "page" : undefined\}/);
});
