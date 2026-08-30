import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [repository, membership, route, panel, record, model, preview, docs] = await Promise.all([
  source("src/lib/platform/ops-calendar-repository.ts"),
  source("src/lib/membership/repository.ts"),
  source("app/api/ops/experiences/[experienceId]/calendar/route.ts"),
  source("src/components/platform/OperatorExperienceCalendar.tsx"),
  source("src/components/platform/OperatorExperienceRecord.tsx"),
  source("src/lib/platform/ops-experience-model.ts"),
  source("src/lib/platform/ops-experience-preview.ts"),
  source("docs/platform-foundation.md"),
]);

test("Calendar requests reauthorize scoped operators and resolve only eligible verified attendees", () => {
  assert.match(repository, /platform_user\.status = 'active'/);
  assert.match(repository, /role_grant\.revoked_at is null/);
  assert.match(repository, /staff_assignment\.ended_at is null/);
  assert.match(repository, /person_email_addresses/);
  assert.match(repository, /verification_state = 'verified'/);
  assert.match(repository, /email_address\.is_primary/);
  assert.match(repository, /registration\.status = 'registered'/);
  assert.match(repository, /registration\.status is null/);
  assert.match(repository, /circle_assignment\.ended_at is null/);
  assert.match(repository, /block_assignment\.ended_at is null/);
  assert.match(repository, /administrative_onboarding_state = 'completed'/);
  assert.match(repository, /standing_state in \('active', 'cancellation_requested'\)/);
  assert.match(repository, /registration_audience/);
  assert.match(repository, /left join ruined_members member on member\.person_id = registration\.person_id/);
  assert.match(repository, /audience\.email <> \$\{organizerEmail\}/);
});

test("one retry-safe provider request creates, updates, or cancels outside its database transaction", () => {
  assert.match(repository, /createGoogleCalendarEvent/);
  assert.match(repository, /updateGoogleCalendarEvent/);
  assert.match(repository, /cancelGoogleCalendarEvent/);
  assert.match(repository, /experience_calendar_sync_requests/);
  assert.match(repository, /experience_calendar_sync_events/);
  assert.match(repository, /experience_calendar_attendee_events/);
  assert.match(repository, /operator_audit_events/);
  assert.match(repository, /request_fingerprint/);
  assert.match(repository, /attendee_set_sha256/);
  assert.match(repository, /provider_html_url/);
  assert.match(repository, /provider_event_etag/);
  assert.match(repository, /send_updates/);
  assert.match(repository, /getGoogleCalendarConfigurationStatus/);
  assert.match(repository, /googleCommunicationLivemode/);
  assert.match(repository, /link\.current_sync_request_id === input\.reservation\.requestId/);
  assert.match(repository, /link\.desired_experience_version === input\.reservation\.desiredExperienceVersion/);
  assert.match(repository, /previousAttendees/);
  assert.match(repository, /action: "remove" as const/);
  assert.doesNotMatch(repository, /desired_attendee_revision = desired_attendee_revision \+ 1/);
});

test("an interrupted provider attempt is reclaimed without creating a second logical request", () => {
  assert.match(repository, /recoverStaleCalendarReservation/);
  assert.match(repository, /last_attempt_at <= statement_timestamp\(\) - interval '2 minutes'/);
  assert.match(repository, /status = 'queued'/);
  assert.match(repository, /calendar_attempt_interrupted/);
  assert.match(repository, /'retry_scheduled'/);
  assert.match(repository, /recovery: "stale_processing"/);
  assert.match(repository, /request\.conference_request_key \?\? providerRequestKey/);
  assert.match(repository, /attemptNumber: 1/);
  assert.match(repository, /input\.reservation\.attemptNumber/);
  assert.match(
    repository,
    /do not mislabel a local finalize failure as a provider rejection/,
  );
  assert.match(
    repository,
    /return finalizeCalendarSuccess\([\s\S]*result,[\s\S]*\);/,
  );
});

test("member registration commits first, then automatically reconciles an existing invite", () => {
  assert.match(repository, /export async function syncMemberExperienceCalendar/);
  assert.match(repository, /requireCalendarMemberSyncActor/);
  assert.match(repository, /Member registration can only reconcile an existing invitation/);
  assert.match(membership, /const result = await sql\.begin/);
  assert.match(membership, /calendarChanged = current\.status === "registered"/);
  assert.match(membership, /calendarChanged = registration\.status === "registered"/);
  assert.match(membership, /await syncMemberExperienceCalendar\(/);
  assert.match(membership, /Registration remains authoritative/);
});

test("provider success requires the same durable organizer and a ready Meet", () => {
  assert.match(repository, /link\.organizer_email !== configuration\.organizerEmail/);
  assert.match(repository, /!input\.result\.organizerVerified/);
  assert.match(repository, /conferenceReady = cancelled \|\| Boolean\(input\.result\?\.meetReady\)/);
  assert.match(repository, /calendar_meet_pending/);
  assert.match(repository, /calendar_meet_failed/);
});

test("the JSON boundary requires an idempotency key and accepts only the three Calendar intents", () => {
  assert.match(route, /requireOpsMutationRequest\(request\)/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /\["cancel", "create", "sync"\]/);
  assert.match(route, /syncOpsExperienceCalendar/);
  assert.match(route, /actorAuthUserId: access\.viewer\.authUserId/);
  assert.match(route, /OpsOperatingRepositoryError/);
  assert.doesNotMatch(route, /credential|private_key|access_token/i);
});

test("the operator Experience makes publish, sync, open, and cancellation understandable", () => {
  assert.match(model, /OpsExperienceCalendarState/);
  assert.match(preview, /organizerEmail: "connect@theruinedproject\.com"/);
  assert.match(panel, /Google Calendar/);
  assert.match(panel, /Create invite \+ Meet/);
  assert.match(panel, /Sync invitations/);
  assert.match(panel, /Open calendar/);
  assert.match(panel, /Send cancellation/);
  assert.match(panel, /Waitlisted and cancelled places are excluded/);
  assert.match(panel, /Preview only — no invitations were sent/);
  assert.match(record, /Publish \+ send invite/);
  assert.match(record, /Manual Meet fallback/);
  assert.match(record, /calendarRequest\(experience\.experienceId, "sync"\)/);
  assert.match(record, /calendarRequest\(experience\.experienceId, "cancel"\)/);
  assert.match(panel, /aria-busy=\{pending\}/);
  assert.match(panel, /!canManage \|\| !calendar\.configured/);
  assert.match(panel, /role=\{messageIsError \? "alert" : "status"\}/);
});

test("operator documentation states the exact assignment and credential boundaries", () => {
  assert.match(docs, /Publish \+ send invite/);
  assert.match(docs, /Circle and Block Experiences resolve current, eligible members/);
  assert.match(docs, /Public and[\s\S]*invite-only Experiences invite only confirmed registrations/);
  assert.match(docs, /only a verified primary email/);
  assert.match(docs, /calendar\.events\.owned/);
  assert.match(docs, /intentionally separate from the Google Sheets service account/);
});
