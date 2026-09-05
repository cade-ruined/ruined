import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  migration,
  repository,
  academyPage,
  editorPage,
  academyView,
  academyEditor,
  academyActions,
  memberRepository,
  resourceCreateRoute,
  resourceEditRoute,
  resourceStateRoute,
  collectionCreateRoute,
  collectionEditRoute,
] = await Promise.all([
  source("db/migrations/20260828_operator_academy.sql"),
  source("src/lib/platform/ops-academy-repository.ts"),
  source("app/ops/academy/page.tsx"),
  source("app/ops/academy/[resourceId]/page.tsx"),
  source("src/components/platform/OperatorAcademy.tsx"),
  source("src/components/platform/OperatorAcademyEditor.tsx"),
  source("src/components/platform/OperatorAcademyActions.tsx"),
  source("src/lib/membership/repository.ts"),
  source("app/api/ops/academy/resources/route.ts"),
  source("app/api/ops/academy/resources/[resourceId]/route.ts"),
  source("app/api/ops/academy/resources/[resourceId]/state/route.ts"),
  source("app/api/ops/academy/collections/route.ts"),
  source("app/api/ops/academy/collections/[collectionId]/route.ts"),
]);

test("the Academy lifecycle migration is atomic, additive, and retirement based", () => {
  assert.match(migration, /^begin;\n/i);
  assert.match(migration, /\ncommit;\s*$/i);
  assert.equal((migration.match(/^commit;\s*$/gim) ?? []).length, 1);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/);
  for (const table of ["learning_collections", "learning_resources"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table}[\\s\\S]*add column if not exists revision bigint`));
    assert.match(migration, new RegExp(`alter table public\\.${table}[\\s\\S]*add column if not exists retired_at timestamptz`));
  }
  assert.match(migration, /status in \('draft', 'published', 'unpublished', 'retired'\)/);
  assert.match(migration, /Academy records are retired, never deleted/);
  assert.match(migration, /Academy projection revisions must advance by exactly one/);
  assert.match(migration, /A published Academy slug is immutable/);
  assert.match(migration, /revoke all on function private\.ruined_guard_learning_projection\(\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)/i);
});

test("Academy writes reauthorize an active admin, append versions, and audit changes", () => {
  assert.match(repository, /import "server-only"/);
  assert.match(repository, /platform_user\.status = 'active'[\s\S]*role_grant\.role_slug = 'ops_admin'[\s\S]*role_grant\.revoked_at is null/);
  assert.match(repository, /for update of platform_user, role_grant/);
  assert.match(repository, /insert into learning_resource_versions/g);
  assert.match(repository, /coalesce\(max\(version\), 0\) \+ 1 as next_version/);
  assert.match(repository, /academyDraft/);
  assert.match(repository, /insert into operator_audit_events/);
  assert.match(repository, /Number\(resource\.revision\) !== revision/);
  assert.match(repository, /revision = revision \+ 1/g);
  assert.match(repository, /must be a secure HTTPS URL/);
  assert.doesNotMatch(repository, /SUPABASE_SERVICE_ROLE_KEY|createClient\(/);
});

test("publishing is the only operation that changes the member projection and audiences", () => {
  const publishStart = repository.indexOf("export async function changeOpsAcademyResourceState");
  const collectionStart = repository.indexOf("export async function saveOpsAcademyCollection");
  const publishing = repository.slice(publishStart, collectionStart);
  const draftSaving = repository.slice(
    repository.indexOf("export async function saveOpsAcademyResource"),
    publishStart,
  );

  assert.match(publishing, /Save this lesson in the Academy editor before publishing/);
  assert.match(publishing, /normalizedAudiences\(metadata\.academyDraft\.audiences, true\)/);
  assert.match(publishing, /requireCollection\(tx, metadata\.academyDraft\.collectionId, true\)/);
  assert.match(repository, /Choose an audience before publishing/);
  assert.match(repository, /Publish the collection before publishing this lesson/);
  assert.match(publishing, /insert into learning_resource_versions[\s\S]*published_at/);
  assert.match(publishing, /delete from learning_resource_targets/);
  assert.match(publishing, /insert into learning_resource_targets/);
  assert.match(publishing, /current_version_id = \$\{publishedVersionId\}::uuid/);
  assert.match(publishing, /published_at = coalesce\(published_at, statement_timestamp\(\)\)/);
  assert.doesNotMatch(draftSaving, /delete from learning_resource_targets/);
  assert.doesNotMatch(draftSaving, /current_version_id =/);
});

test("operator Academy routes fail closed and every mutation uses the shared request guard", () => {
  for (const page of [academyPage, editorPage]) {
    assert.match(page, /context\.state === "signed_out"[\s\S]*redirect\("\/ops\/access"\)/);
    assert.match(page, /context\.state === "denied"/);
    assert.match(page, /context\.state === "preview"/);
    assert.match(page, /context\.role !== "ops_admin"/);
    assert.match(page, /PlatformUnavailable/);
  }
  assert.match(academyPage, /getOpsAcademySnapshot\(context\.viewer\.authUserId\)/);
  assert.match(editorPage, /getOpsAcademyEditor\(context\.viewer\.authUserId, resourceId\)/);
  assert.match(editorPage, /if \(!editor\) notFound\(\)/);

  for (const route of [
    resourceCreateRoute,
    resourceEditRoute,
    resourceStateRoute,
    collectionCreateRoute,
    collectionEditRoute,
  ]) {
    assert.match(route, /requireOpsMutationRequest\(request\)/);
    assert.match(route, /access\.viewer\.authUserId/);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|createClient\(/);
  }
});

test("the operator surface covers drafts, publishing, collections, media, downloads, captions, and audiences", () => {
  assert.match(academyView, /Academy snapshot/);
  assert.match(academyView, /New lesson/);
  assert.match(academyView, /Collections/);
  assert.match(academyEditor, /Saving creates a new immutable draft version/);
  for (const label of [
    "Create lesson draft",
    "Save new draft version",
    "Resource, download, or hosted page URL",
    "Direct video URL",
    "Thumbnail URL",
    "Captions URL",
    "Presenter",
    "Duration",
    "All active members",
    "Circles",
    "Blocks",
    "Edit collection",
    "Publish",
    "Unpublish",
    "Retire",
  ]) {
    assert.match(academyActions, new RegExp(label));
  }
  assert.match(academyActions, /aria-live="polite"/);
  assert.match(academyActions, /<fieldset/);
  assert.match(academyActions, /<legend/);
});

test("existing member Academy reads remain pinned to the published immutable version", () => {
  assert.match(memberRepository, /resource_version\.id = resource\.current_version_id/);
  assert.match(memberRepository, /where resource\.status = 'published'/);
  assert.match(memberRepository, /resource_version\.metadata/);
  assert.match(memberRepository, /media\.captionsUrl/);
  assert.match(memberRepository, /media\.videoUrl/);
  assert.match(memberRepository, /learning_resource_targets target/);
});
