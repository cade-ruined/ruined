import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repository = await readFile(
  new URL("../src/lib/platform/operator-member-profile.ts", import.meta.url),
  "utf8",
);

function functionSource(sourceText: string, startMarker: string): string {
  const start = sourceText.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} was not found`);
  return sourceText.slice(start);
}

const ensureProfile = functionSource(
  repository,
  "export async function ensureOperatorMemberProfile",
);

test("operator profile provisioning authenticates a current verified operator identity", () => {
  assert.match(repository, /import "server-only"/);
  assert.match(ensureProfile, /UUID_PATTERN\.test\(authUserId\)/);
  assert.match(ensureProfile, /isPlausibleEmail\(emailNormalized\)/);
  assert.match(ensureProfile, /sql\.begin\(async \(tx\) =>/);
  assert.match(
    ensureProfile,
    /pg_advisory_xact_lock\(hashtext\(\$\{emailNormalized\}\), 1\)/,
  );
  assert.match(
    ensureProfile,
    /operator_grant\.role_slug in \('ops_admin', 'circle_leader', 'guide'\)[\s\S]*operator_grant\.revoked_at is null/,
  );
  assert.match(ensureProfile, /operator\.status !== "active"/);
  assert.match(
    ensureProfile,
    /email_address\.email_normalized = \$\{emailNormalized\}[\s\S]*email_address\.verification_state = 'verified'[\s\S]*email_address\.retired_at is null/,
  );
});

test("existing membership identity is reused without an automatic merge", () => {
  assert.match(
    ensureProfile,
    /where person_id = \$\{operator\.person_id\}::uuid[\s\S]*or email_normalized = \$\{emailNormalized\}/,
  );
  assert.match(ensureProfile, /if \(memberRows\.length > 1\)/);
  assert.match(
    ensureProfile,
    /member\.person_id !== null && member\.person_id !== operator\.person_id/,
  );
  assert.match(
    ensureProfile,
    /operator\.member_id && \(!member \|\| operator\.member_id !== member\.id\)/,
  );
  assert.match(ensureProfile, /auth_user_id <> \$\{authUserId\}::uuid/);
  assert.doesNotMatch(ensureProfile, /update person_profiles[\s\S]*set/);
});

test("revoked and suspended member access stays denied without blocking operator access", () => {
  const denialEnd = ensureProfile.indexOf("const priorAccountState");
  const denialSection = ensureProfile.slice(0, denialEnd);
  assert.match(
    denialSection,
    /!hasActiveMemberRole && hasRevokedMemberRole[\s\S]*return \{ memberAccess: false \}/,
  );
  assert.match(
    denialSection,
    /account_state === "suspended" \|\| lifecycle\?\.account_state === "closed"[\s\S]*return \{ memberAccess: false \}/,
  );
  assert.doesNotMatch(denialSection, /insert into ruined_members/);
  assert.doesNotMatch(denialSection, /insert into platform_role_grants/);
});

test("new operator profiles receive entry access but no paid benefits", () => {
  assert.match(
    ensureProfile,
    /insert into ruined_members[\s\S]*membership_state[\s\S]*'pending'/,
  );
  assert.match(
    ensureProfile,
    /insert into member_lifecycle[\s\S]*'active'[\s\S]*'pending'[\s\S]*'prospect'[\s\S]*'accepted'[\s\S]*'in_progress'[\s\S]*'pre_active'/,
  );
  assert.match(
    ensureProfile,
    /insert into member_onboardings[\s\S]*'administrative-v1'/,
  );
  assert.match(
    ensureProfile,
    /insert into platform_role_grants[\s\S]*'member'/,
  );
  assert.match(
    ensureProfile,
    /jsonb_build_object\('paid_benefits_granted', false\)/,
  );
  assert.doesNotMatch(
    ensureProfile,
    /update (?:ruined_members|member_lifecycle)[\s\S]*set[\s\S]*(?:billing_state|membership_state)\s*=/,
  );
});

test("provisioning is idempotent, preserves profile data, and records an audit trail", () => {
  assert.match(
    ensureProfile,
    /insert into person_profiles \(person_id\)[\s\S]*on conflict \(person_id\) do nothing/,
  );
  assert.match(
    ensureProfile,
    /insert into member_state_history[\s\S]*operator_member_profile_provisioned[\s\S]*on conflict \(dedupe_key\) do nothing/,
  );
  assert.match(
    ensureProfile,
    /insert into operator_audit_events[\s\S]*operator_member_profile\.provisioned[\s\S]*entry_profile_only[\s\S]*on conflict \(dedupe_key\) do nothing/,
  );
  assert.match(ensureProfile, /return \{ memberAccess: true \}/);
  assert.doesNotMatch(ensureProfile, /user_metadata|app_metadata/);
  assert.doesNotMatch(ensureProfile, /update passwordless_account_invites/);
  assert.match(ensureProfile, /update platform_users[\s\S]*user_type = 'member'/);
});
