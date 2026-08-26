import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [repository, membersPage, directoryComponent] = await Promise.all([
  source("src/lib/platform/repository.ts"),
  source("app/ops/members/page.tsx"),
  source("src/components/platform/OperatorMemberDirectory.tsx"),
]);

const directoryQuery = repository.slice(
  repository.indexOf("export async function getOperatorMemberDirectoryPage"),
  repository.indexOf("export async function getOperatorDashboard"),
);

test("the full member directory repeats operator authorization and Circle scope on the server", () => {
  assert.match(directoryQuery, /isolation level repeatable read read only/);
  assert.match(directoryQuery, /platform_user\.user_type = 'staff'/);
  assert.match(directoryQuery, /platform_user\.status = 'active'/);
  assert.match(directoryQuery, /grant_row\.revoked_at is null/);
  assert.match(directoryQuery, /grant_row\.role_slug in \('ops_admin', 'circle_leader', 'guide'\)/);
  assert.match(directoryQuery, /\$\{role\} = 'ops_admin'/);
  assert.match(
    directoryQuery,
    /circle_staff_assignments staff_assignment[\s\S]*staff_assignment\.auth_user_id = \$\{authUserId\}::uuid[\s\S]*staff_assignment\.ended_at is null/,
  );
});

test("search and filters are applied before an independent result count and page limit", () => {
  assert.match(directoryQuery, /select count\(\*\) as total_results/);
  assert.match(directoryQuery, /strpos\(lower\(coalesce\(profile\.display_name/);
  assert.match(directoryQuery, /strpos\(lower\(member\.email/);
  assert.match(directoryQuery, /strpos\(lower\(coalesce\(circle\.name/);
  assert.match(directoryQuery, /strpos\(lower\(coalesce\(membership_block\.name/);
  assert.match(directoryQuery, /lifecycle\.billing_state = 'attention_required'/);
  assert.match(directoryQuery, /lifecycle\.foundations_state <> 'completed'/);
  assert.match(directoryQuery, /active_circle\.circle_id is null/);
  assert.match(directoryQuery, /const totalResults = Number\(countRows\[0\]\?\.total_results/);
  assert.match(directoryQuery, /const pageCount = Math\.max\(1, Math\.ceil\(totalResults/);
  assert.match(directoryQuery, /limit \$\{OPERATOR_MEMBER_DIRECTORY_PAGE_SIZE\}[\s\S]*offset \$\{offset\}/);
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
  assert.match(membersPage, /context\.role === "ops_admin" && context\.viewer/);
  assert.match(membersPage, /context\.state === "preview"[\s\S]*previewDirectory/);
  assert.match(membersPage, /<OperatorMemberDirectory directory=\{directory\}/);
});

test("directory controls stay editorial and navigate the server-backed roster", () => {
  assert.doesNotMatch(directoryComponent, /"use client"|useMemo|useState/);
  assert.match(directoryComponent, /<form[\s\S]*action="\/ops\/members"[\s\S]*method="get"/);
  assert.match(directoryComponent, /name="q"/);
  assert.match(directoryComponent, /name="filter"/);
  assert.match(directoryComponent, /Previous members/);
  assert.match(directoryComponent, /Next members/);
  assert.match(directoryComponent, /Page \{directory\.page\} of \{directory\.pageCount\}/);
  assert.doesNotMatch(directoryComponent, /font-mono|tooltip|hover card|AI hint/i);
});
