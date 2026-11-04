import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [repository, membersPage, directoryComponent, controls] = await Promise.all([
  source("src/lib/platform/repository.ts"),
  source("app/ops/members/page.tsx"),
  source("src/components/platform/OperatorMemberDirectory.tsx"),
  source("src/components/platform/OperatorMemberDirectoryControls.tsx"),
]);

const directoryQuery = repository.slice(
  repository.indexOf("export async function getOperatorMemberDirectoryPage"),
  repository.indexOf("export async function getOperatorDashboard"),
);

test("the full member directory repeats operator authorization and Circle scope on the server", () => {
  assert.match(directoryQuery, /isolation level repeatable read read only/);
  assert.match(directoryQuery, /from platform_role_grants grant_row/);
  assert.match(
    directoryQuery,
    /join platform_users platform_user[\s\S]*platform_user\.auth_user_id = grant_row\.auth_user_id/,
  );
  assert.match(directoryQuery, /platform_user\.status = 'active'/);
  assert.match(directoryQuery, /grant_row\.revoked_at is null/);
  assert.match(directoryQuery, /grant_row\.role_slug in \('ops_admin', 'circle_leader', 'guide'\)/);
  assert.match(directoryQuery, /\$\{role\} = 'ops_admin'/);
  assert.match(
    directoryQuery,
    /circle_staff_assignments staff_assignment[\s\S]*staff_assignment\.auth_user_id = \$\{authUserId\}::uuid[\s\S]*staff_assignment\.ended_at is null/,
  );
});

test("search and filters are applied to all records before global sorting", () => {
  assert.match(directoryQuery, /strpos\(lower\(coalesce\(profile\.display_name/);
  assert.match(directoryQuery, /strpos\(lower\(member\.email/);
  assert.match(directoryQuery, /strpos\(lower\(coalesce\(circle\.name/);
  assert.match(directoryQuery, /strpos\(lower\(coalesce\(membership_block\.name/);
  assert.match(directoryQuery, /lifecycle\.billing_state = 'attention_required'/);
  assert.match(directoryQuery, /lifecycle\.foundations_state <> 'completed'/);
  assert.match(directoryQuery, /active_circle\.circle_id is null/);
  assert.match(directoryQuery, /totalResults: members\.length/);
  assert.match(directoryQuery, /sortOperatorMembers/);
  assert.match(directoryQuery, /pageCount: 1/);
  assert.doesNotMatch(directoryQuery, /offset \$\{|limit \$\{/);
  assert.doesNotMatch(directoryQuery, /limit 100/);
});

test("the Members page owns URL-backed search while preserving access and admin boundaries", () => {
  assert.match(membersPage, /searchParams: Promise<Record<string, SearchValue>>/);
  assert.match(membersPage, /context\.state === "signed_out"[\s\S]*redirect\("\/ops\/access"\)/);
  assert.match(membersPage, /context\.state === "denied"/);
  assert.match(
    membersPage,
    /getOperatorMemberDirectoryPage\(context\.viewer\.authUserId, input\)/,
  );
  assert.match(membersPage, /context\.role === "ops_admin" && \(context\.state === "preview" \|\| context\.viewer\)/);
  assert.match(membersPage, /OperatorMemberInvitations data=\{pendingInvitations\} directoryParams=\{directoryParams\} preview=\{context\.state === "preview"\}/);
  assert.match(membersPage, /context\.state === "preview"[\s\S]*previewDirectory/);
  assert.match(membersPage, /<OperatorMemberDirectory directory=\{directory\}/);
});

test("directory controls stay editorial and navigate the server-backed roster", () => {
  assert.doesNotMatch(directoryComponent, /"use client"|useMemo|useState/);
  assert.match(controls, /<form[\s\S]*action="\/ops\/members"[\s\S]*method="get"/);
  assert.match(controls, /name="q"/);
  assert.match(controls, /name="filter"/);
  assert.match(controls, /name="sort"/);
  assert.match(controls, /requestSubmit/);
  assert.doesNotMatch(directoryComponent, /Previous members|Next members/);
  assert.doesNotMatch(directoryComponent, /font-mono|tooltip|hover card|AI hint/i);
});
