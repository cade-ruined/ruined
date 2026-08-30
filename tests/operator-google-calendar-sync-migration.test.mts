import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function section(sourceText: string, startMarker: string, endMarker: string) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} was not found`);
  assert.ok(end > start, `${endMarker} was not found after ${startMarker}`);
  return sourceText.slice(start, end);
}

const [migration, hardening, meetUrlConstraint, runner] = await Promise.all([
  source("db/migrations/20260829_operator_google_calendar_sync.sql"),
  source("db/migrations/20260829_operator_google_calendar_sync_hardening.sql"),
  source("db/migrations/20260829_operator_google_calendar_meet_url_constraint.sql"),
  source("scripts/migrate-platform.mjs"),
]);

test("Google Calendar sync migrations are transaction-safe and ordered last", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /set local lock_timeout = '10s'/);
  assert.match(migration, /set local statement_timeout = '60s'/);
  assert.match(
    migration,
    /pg_advisory_xact_lock\(hashtext\('ruined-platform-migration-runner'\)\)/,
  );
  assert.match(migration, /commit;\s*$/);
  assert.match(hardening, /^begin;/);
  assert.match(hardening, /set local lock_timeout = '10s'/);
  assert.match(hardening, /set local statement_timeout = '60s'/);
  assert.match(hardening, /commit;\s*$/);
  assert.match(meetUrlConstraint, /^begin;/);
  assert.match(meetUrlConstraint, /set local lock_timeout = '10s'/);
  assert.match(meetUrlConstraint, /set local statement_timeout = '60s'/);
  assert.match(meetUrlConstraint, /commit;\s*$/);

  const notificationHardening = runner.indexOf(
    "20260828_operator_notification_hardening.sql",
  );
  const calendarSync = runner.indexOf(
    "20260829_operator_google_calendar_sync.sql",
  );
  const calendarHardening = runner.indexOf(
    "20260829_operator_google_calendar_sync_hardening.sql",
  );
  const meetUrlRepair = runner.indexOf(
    "20260829_operator_google_calendar_meet_url_constraint.sql",
  );
  const migrationsEnd = runner.indexOf("];", meetUrlRepair);
  assert.ok(notificationHardening >= 0 && notificationHardening < calendarSync);
  assert.ok(calendarSync >= 0 && calendarSync < calendarHardening);
  assert.ok(calendarHardening >= 0 && calendarHardening < meetUrlRepair);
  assert.ok(meetUrlRepair >= 0 && migrationsEnd > meetUrlRepair);
  assert.doesNotMatch(
    runner.slice(meetUrlRepair, migrationsEnd),
    /db\/migrations\/.+\.sql[\s\S]*db\/migrations\/.+\.sql/,
  );
});

test("Meet URL repair accepts only Google Meet HTTPS paths without fragile regex escaping", () => {
  assert.match(
    meetUrlConstraint,
    /drop constraint if exists experience_calendar_links_meet_url_check/,
  );
  assert.match(
    meetUrlConstraint,
    /meet_url like 'https:\/\/meet\.google\.com\/%'/,
  );
  assert.match(
    meetUrlConstraint,
    /char_length\(btrim\(meet_url\)\) between 25 and 2048/,
  );
  assert.match(meetUrlConstraint, /add constraint[\s\S]*not valid/);
  assert.match(meetUrlConstraint, /validate constraint experience_calendar_links_meet_url_check/);
  assert.doesNotMatch(meetUrlConstraint, /meet_url\s+~/);
});

test("hardening binds every Calendar ID to one immutable organizer account", () => {
  assert.match(hardening, /add column if not exists organizer_email text/);
  assert.match(hardening, /organizer_email = 'connect@theruinedproject\.com'/);
  assert.match(hardening, /alter column organizer_email set not null/);
  assert.match(hardening, /organizer_email = lower\(btrim\(organizer_email\)\)/);
  assert.match(hardening, /provider,[\s\S]*organizer_email,[\s\S]*organizer_calendar_id,[\s\S]*provider_event_id/);
  assert.match(hardening, /new\.organizer_email is distinct from old\.organizer_email/);
});

test("one current Google link records versioned provider and attendee state", () => {
  const links = section(
    migration,
    "create table if not exists public.experience_calendar_links",
    "create table if not exists public.experience_calendar_sync_requests",
  );

  assert.match(links, /experience_id uuid not null[\s\S]*references public\.experiences\(id\)/);
  assert.match(links, /check \(provider = 'google'\)/);
  assert.match(links, /unique \(experience_id, provider\)/);
  assert.match(links, /provider_event_id text/);
  assert.match(links, /provider_event_etag text/);
  assert.match(links, /provider_ical_uid text/);
  assert.match(links, /provider_html_url text/);
  assert.match(links, /provider_html_url ~ '\^https:\/\/'/);
  assert.match(links, /char_length\(btrim\(provider_html_url\)\) between 1 and 2048/);
  assert.match(links, /provider_conference_id text/);
  assert.match(links, /meet_url is null or meet_url ~ '\^https:\/\/meet/);
  assert.match(links, /desired_experience_version bigint not null/);
  assert.match(links, /synced_experience_version <= desired_experience_version/);
  assert.match(links, /desired_attendee_revision bigint not null/);
  assert.match(links, /synced_attendee_revision <= desired_attendee_revision/);
  assert.match(links, /version bigint not null default 1 check \(version > 0\)/);
  assert.match(links, /experience_calendar_links_provider_event_idx/);
  assert.match(links, /experience_calendar_links_status_idx[\s\S]*where status in/);
});

test("logical create, update, cancel, and reconcile requests are retry-safe and audited", () => {
  const requests = section(
    migration,
    "create table if not exists public.experience_calendar_sync_requests",
    "create table if not exists public.experience_calendar_sync_events",
  );

  assert.match(requests, /operator_audit_event_id bigint not null[\s\S]*references public\.operator_audit_events\(id\)/);
  assert.match(requests, /action in \('create', 'update', 'cancel', 'reconcile'\)/);
  assert.match(requests, /request_key text not null unique/);
  assert.match(requests, /request_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(requests, /conference_request_key text unique/);
  assert.match(requests, /attendee_set_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(requests, /expected_link_version bigint not null/);
  assert.match(requests, /send_updates text not null default 'all' check \(send_updates = 'all'\)/);
  assert.match(requests, /status in \('queued', 'processing', 'succeeded', 'failed', 'superseded'\)/);
  assert.match(requests, /experience_calendar_links_current_request_fkey/);
  assert.match(requests, /deferrable initially deferred/);
  assert.match(requests, /experience_calendar_sync_requests_audit_idx/);
  assert.match(requests, /experience_calendar_sync_requests_status_idx[\s\S]*where status in \('queued', 'processing'\)/);
});

test("sync and attendee provider evidence is append-only and relationally consistent", () => {
  const syncEvents = section(
    migration,
    "create table if not exists public.experience_calendar_sync_events",
    "create table if not exists public.experience_calendar_attendee_events",
  );
  const attendeeEvents = section(
    migration,
    "create table if not exists public.experience_calendar_attendee_events",
    "create or replace function private.ruined_guard_experience_calendar_link_mutation",
  );

  assert.match(syncEvents, /foreign key \(sync_request_id, calendar_link_id, experience_id\)/);
  assert.match(syncEvents, /dedupe_key text not null unique/);
  assert.match(syncEvents, /provider_created/);
  assert.match(syncEvents, /provider_updated/);
  assert.match(syncEvents, /provider_cancelled/);
  assert.match(syncEvents, /retry_scheduled/);
  assert.match(syncEvents, /event_type not in \('retry_scheduled', 'failed'\)[\s\S]*or failure_code is not null/);

  assert.match(attendeeEvents, /person_id uuid not null references public\.people\(id\)/);
  assert.match(attendeeEvents, /foreign key \(member_id, person_id\)[\s\S]*references public\.ruined_members\(id, person_id\)/);
  assert.match(attendeeEvents, /registration_id uuid[\s\S]*references public\.experience_registrations\(id\)/);
  assert.match(attendeeEvents, /action text not null check \(action in \('add', 'update', 'remove', 'observe'\)\)/);
  assert.match(attendeeEvents, /outcome text not null check \(outcome in \('requested', 'applied', 'failed', 'skipped'\)\)/);
  assert.match(attendeeEvents, /provider_response_status/);
  assert.match(attendeeEvents, /dedupe_key text not null unique/);
  assert.match(attendeeEvents, /experience_calendar_attendee_events_person_idx/);

  assert.match(migration, /experience_calendar_sync_events_append_only[\s\S]*public\.ruined_reject_append_only_mutation/);
  assert.match(migration, /experience_calendar_attendee_events_append_only[\s\S]*public\.ruined_reject_append_only_mutation/);
  assert.match(migration, /Applied means Google accepted the event mutation; it is not an inbox delivery receipt/);
});

test("mutable projections enforce optimistic versions and terminal evidence", () => {
  const guards = section(
    migration,
    "create or replace function private.ruined_guard_experience_calendar_link_mutation",
    "drop trigger if exists experience_calendar_links_guard",
  );

  assert.match(guards, /Experience calendar links cannot be deleted/);
  assert.match(guards, /new\.version <> old\.version \+ 1/);
  assert.match(guards, /A cancelled Google Calendar link cannot be reactivated/);
  assert.match(guards, /Experience calendar sync requests cannot be deleted/);
  assert.match(guards, /Experience calendar sync request intent is immutable/);
  assert.match(guards, /old\.status in \('succeeded', 'failed', 'superseded'\)/);
  assert.match(guards, /new\.attempt_count <> old\.attempt_count \+ 1/);
  assert.match(guards, /new\.next_attempt_at is null or new\.last_error_code is null/);
});

test("all calendar state is server-only with RLS and least-privilege grants", () => {
  for (const table of [
    "experience_calendar_links",
    "experience_calendar_sync_requests",
    "experience_calendar_sync_events",
    "experience_calendar_attendee_events",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }

  assert.match(
    migration,
    /revoke all on table[\s\S]*experience_calendar_links[\s\S]*experience_calendar_sync_requests[\s\S]*experience_calendar_sync_events[\s\S]*experience_calendar_attendee_events[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on sequence[\s\S]*experience_calendar_sync_events_id_seq[\s\S]*experience_calendar_attendee_events_id_seq[\s\S]*from public, anon, authenticated/,
  );
  assert.doesNotMatch(migration, /grant (select|insert|update|delete)[\s\S]*experience_calendar_/i);
});
