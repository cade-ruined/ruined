import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  artifactMigration,
  artifactRepository,
  artifactPage,
  artifactTemplateRoute,
  awardRoute,
  shipmentRoute,
  notificationRepository,
  operatingRepository,
  announcementActions,
  notificationPage,
  notificationRoute,
  profileRepository,
  profileRoute,
  profileComponent,
  shell,
] = await Promise.all([
  source("db/migrations/20260828_operator_artifact_fulfillment.sql"),
  source("src/lib/platform/ops-artifact-repository.ts"),
  source("app/ops/artifacts/page.tsx"),
  source("app/api/ops/artifact-templates/route.ts"),
  source("app/api/ops/artifact-awards/route.ts"),
  source("app/api/ops/artifact-shipments/route.ts"),
  source("src/lib/platform/ops-notification-repository.ts"),
  source("src/lib/platform/ops-operating-repository.ts"),
  source("src/components/platform/OperatorWorkActions.tsx"),
  source("app/ops/notifications/page.tsx"),
  source("app/api/ops/notifications/route.ts"),
  source("src/lib/platform/ops-profile-repository.ts"),
  source("app/api/ops/members/[memberId]/profile/route.ts"),
  source("src/components/platform/OperatorProfileSupport.tsx"),
  source("src/components/platform/PlatformShell.tsx"),
]);

test("Artifact fulfillment keeps current shipment state and append-only evidence behind RLS", () => {
  assert.match(artifactMigration, /create table if not exists public\.artifact_fulfillment_shipments/);
  assert.match(artifactMigration, /create table if not exists public\.artifact_fulfillment_events/);
  assert.match(artifactMigration, /artifact_fulfillment_events_append_only/);
  assert.match(artifactMigration, /ruined_reject_append_only_mutation/);
  assert.match(artifactMigration, /enable row level security/);
  assert.match(artifactMigration, /revoke all on table[\s\S]*from public, anon, authenticated/);
  assert.match(artifactMigration, /artifact_fulfillment_shipments_job_idx/);
  assert.match(artifactMigration, /artifact_fulfillment_events_actor_idx/);
});

test("Artifact controls cover Shopify templates, awards, work creation, fulfillment, and tracking", () => {
  assert.match(artifactRepository, /requireArtifactAdmin/);
  assert.match(artifactRepository, /role_grant\.role_slug = 'ops_admin'/);
  assert.match(artifactRepository, /createOpsArtifactTemplate/);
  assert.match(artifactRepository, /bindOpsArtifactTemplate/);
  assert.match(artifactRepository, /production_specification/);
  assert.match(artifactRepository, /integration_entity_links/);
  assert.match(artifactRepository, /createOpsArtifactAward/);
  assert.match(artifactRepository, /insert into artifact_jobs/);
  assert.match(artifactRepository, /createOpsArtifactShipment/);
  assert.match(artifactRepository, /updateOpsArtifactShipment/);
  assert.match(artifactRepository, /insert into operator_audit_events/);
  assert.match(artifactPage, /getOpsArtifactControlData/);
  for (const route of [artifactTemplateRoute, awardRoute, shipmentRoute]) {
    assert.match(route, /requireOpsMutationRequest\(request\)/);
    assert.match(route, /actorAuthUserId: access\.viewer\.authUserId/);
  }
});

test("notification center sends only server-authorized, targeted in-app records with delivery evidence", () => {
  assert.match(notificationRepository, /requireNotificationAdmin/);
  assert.match(notificationRepository, /role_grant\.role_slug = 'ops_admin'/);
  for (const target of ["all_active_members", "circle", "block", "member"]) {
    assert.match(notificationRepository, new RegExp(`"${target}"`));
  }
  assert.match(notificationRepository, /insert into member_notifications/);
  assert.match(notificationRepository, /insert into member_notification_events/);
  assert.match(notificationRepository, /notification\.sent/);
  assert.match(notificationRoute, /requireOpsMutationRequest\(request\)/);
  assert.match(notificationPage, /context\.state === "signed_out"/);
  assert.match(notificationPage, /getOpsNotificationCenter/);
  assert.match(shell, /href: "\/ops\/notifications"/);
});

test("published communications can be aimed at everyone, one Circle, one Block, or one member", () => {
  const announcementMutation = operatingRepository.slice(
    operatingRepository.indexOf("export async function createOpsAnnouncement"),
    operatingRepository.indexOf("export async function publishOpsAnnouncement"),
  );
  for (const target of ["all_active_members", "circle", "block", "member"]) {
    assert.match(announcementMutation, new RegExp(`"${target}"`));
  }
  assert.match(announcementMutation, /circle_id/);
  assert.match(announcementMutation, /block_id/);
  assert.match(announcementMutation, /member_id/);
  assert.doesNotMatch(announcementMutation, /progression/);
  assert.match(announcementActions, /audienceOptions\.circles/);
  assert.match(announcementActions, /audienceOptions\.blocks/);
  assert.match(announcementActions, /audienceOptions\.members/);
});

test("operator profile support is targeted, concurrency-safe, and audits private reads without storing values", () => {
  assert.match(profileRepository, /requireProfileAdmin/);
  assert.match(profileRepository, /role_grant\.role_slug = 'ops_admin'/);
  assert.match(profileRepository, /member\.private_profile_viewed/);
  assert.match(profileRepository, /member\.profile_supported/);
  assert.match(profileRepository, /sensitiveValuesStoredInAudit: false/);
  assert.match(profileRepository, /pg_advisory_xact_lock\(hashtext\(\$\{memberId\}\), 44\)/);
  assert.match(profileRepository, /currentVersion !== expectedVersion/);
  assert.match(profileRepository, /changedFields = supportedFields\.filter/);
  assert.doesNotMatch(profileRepository, /birth_date/);
  assert.match(profileRoute, /requireOpsMutationRequest\(request\)/);
  assert.match(profileRoute, /actorAuthUserId: access\.viewer\.authUserId/);
  assert.match(profileRoute, /optionalStringValue/);
  assert.match(profileRoute, /expectedVersion: requiredStringValue/);
  assert.match(profileComponent, /directory sharing stays under member control/);
  assert.match(profileComponent, /Object\.fromEntries/);
  assert.match(profileComponent, /Make a profile change before saving/);
  assert.match(profileComponent, /expectedVersion: profile\.version/);
  assert.match(profileComponent, /Why this correction is needed/);
});
