import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  repository,
  route,
  field,
  circlesPage,
  experiencesPage,
  experiencesDirectory,
  experienceRecord,
  experienceRepository,
  opsSection,
  googleHelper,
] = await Promise.all([
  source("src/lib/platform/ops-operating-repository.ts"),
  source("app/api/ops/google-communications/route.ts"),
  source("src/components/platform/OperatorGoogleCommunicationField.tsx"),
  source("app/ops/circles/page.tsx"),
  source("app/ops/experiences/page.tsx"),
  source("src/components/platform/OperatorExperienceDirectory.tsx"),
  source("src/components/platform/OperatorExperienceRecord.tsx"),
  source("src/lib/platform/ops-experience-repository.ts"),
  source("src/components/platform/OpsSection.tsx"),
  source("src/lib/google/communications.ts"),
]);

test("Google communication destinations are exact, environment-separated, and fail closed", () => {
  assert.match(googleHelper, /GOOGLE_COMMUNICATIONS_LIVEMODE/);
  assert.match(googleHelper, /if \(value === "true"\) return true/);
  assert.match(googleHelper, /if \(value === "false"\) return false/);
  assert.match(googleHelper, /return null/);
  assert.match(googleHelper, /url\.hostname !== "meet\.google\.com"/);
  assert.match(googleHelper, /url\.hostname === "chat\.google\.com"/);
  assert.match(repository, /if \(livemode === null\)/);
  assert.match(repository, /must be set to test or live before links can change/);
  assert.match(repository, /\^#chat\\\/space\\\/\(\[A-Za-z0-9_-\]\+\)\$/);
  assert.match(repository, /gmailChatIdentifier \?\?/);
});

test("Circle and Experience directories expose only scoped Google connection state", () => {
  const circles = repository.slice(
    repository.indexOf("export async function getOpsCircleCommunicationDirectory"),
    repository.indexOf("export async function getOpsExperienceDirectory"),
  );
  assert.match(circles, /requireOperatorAccess\(tx, actorAuthUserId\)/);
  assert.match(circles, /circle_staff_assignments staff_assignment/);
  assert.match(circles, /role_grant\.revoked_at is null/);
  assert.match(circles, /staff_assignment\.ended_at is null/);
  assert.match(circles, /local_entity_type = 'circle'/);
  assert.match(circles, /external_entity_type = 'chat_space'/);
  assert.match(circles, /googleCommunicationsConfigured/);

  const experiences = repository.slice(
    repository.indexOf("export async function getOpsExperienceDirectory"),
    repository.indexOf("export async function setOpsGoogleCommunicationLink"),
  );
  assert.match(experiences, /circle_staff_assignments staff_assignment/);
  assert.match(experiences, /local_entity_type = 'experience'/);
  assert.match(experiences, /external_entity_type = 'meet_space'/);
  assert.match(experiences, /googleCommunicationUrlFromMetadata\("meet"/);
});

test("writes reauthorize, lock the target, upsert atomically, clear narrowly, and append an audit event", () => {
  const mutation = repository.slice(
    repository.indexOf("export async function setOpsGoogleCommunicationLink"),
    repository.indexOf("export async function getOpsAnnouncements"),
  );
  assert.match(mutation, /requireOperatorAccess\(tx, input\.actorAuthUserId, \{ lock: true \}\)/);
  assert.match(mutation, /requireGoogleCommunicationEntityAccess/);
  assert.match(mutation, /for update/);
  assert.match(mutation, /safeGoogleCommunicationUrl\(kind, suppliedUrl\)/);
  assert.match(mutation, /insert into integration_entity_links/);
  assert.match(mutation, /on conflict \([\s\S]*provider,[\s\S]*local_entity_type,[\s\S]*local_entity_id,[\s\S]*external_entity_type,[\s\S]*livemode[\s\S]*\) do update set/);
  assert.match(mutation, /delete from integration_entity_links/);
  assert.match(mutation, /and provider = 'google'/);
  assert.match(mutation, /writeAudit\(tx/);
  assert.match(mutation, /google_chat_linked/);
  assert.match(mutation, /google_meet_cleared/);
});

test("the JSON boundary and compact operator controls are wired into both existing pages", () => {
  assert.match(route, /requireOpsMutationRequest\(request\)/);
  assert.match(route, /actorAuthUserId: access\.viewer\.authUserId/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /OpsOperatingRepositoryError/);

  assert.match(field, /fetch\("\/api\/ops\/google-communications"/);
  assert.match(field, /Google Chat/);
  assert.match(field, /Google Meet/);
  assert.match(field, /Setup needed/);
  assert.match(field, /rounded-\[4px\]/);
  assert.doesNotMatch(field, /iframe|dangerouslySetInnerHTML|title=/);

  assert.match(circlesPage, /getOpsCircleCommunicationDirectory/);
  assert.match(circlesPage, /canManageGoogleCommunications=\{context\.state === "authenticated"\}/);
  assert.match(opsSection, /entityType="circle"/);
  assert.match(experiencesPage, /getOpsExperienceManagementDirectory/);
  assert.match(experiencesDirectory, /entityType="experience"/);
  assert.match(experienceRecord, /editable=\{experience\.canManageCommunication\}/);
  assert.match(experienceRepository, /canManageCommunication: true/);
});
