import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveMemberAccessPolicy } from "../src/lib/membership/access-policy.ts";
import {
  normalizeOpsNotificationRequestKey,
  opsNotificationReadState,
  resolveOpsNotificationStatusAt,
} from "../src/lib/platform/ops-notification-model.ts";

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

test("notification request keys and history timestamps have deterministic behavior", () => {
  const requestKey = "8ce151b3-5a35-4459-abaa-b7645771345e";
  assert.equal(normalizeOpsNotificationRequestKey(` ${requestKey} `), requestKey);
  assert.equal(normalizeOpsNotificationRequestKey("too-short"), null);
  assert.equal(normalizeOpsNotificationRequestKey(`${requestKey}\nsecond-value`), null);

  const base = {
    createdAt: "2026-08-28T16:00:00.000Z",
    deliveredAt: null,
    latestStatusEventAt: "2026-08-28T16:03:00.000Z",
    sentAt: "2026-08-28T16:01:00.000Z",
    updatedAt: "2026-08-28T16:04:00.000Z",
  };
  assert.equal(
    resolveOpsNotificationStatusAt({ ...base, status: "sent" }),
    base.sentAt,
  );
  assert.equal(
    resolveOpsNotificationStatusAt({ ...base, status: "failed" }),
    base.latestStatusEventAt,
  );
  assert.equal(
    resolveOpsNotificationStatusAt({ ...base, deliveredAt: "2026-08-28T16:02:00.000Z", status: "delivered" }),
    "2026-08-28T16:02:00.000Z",
  );
  assert.equal(opsNotificationReadState("delivered", null), "unread");
  assert.equal(opsNotificationReadState("delivered", "2026-08-28T16:05:00.000Z"), "read");
  assert.equal(opsNotificationReadState("failed", null), null);
});

test("updates capability is limited to active paid and completed access", () => {
  const baseIdentity = {
    accountState: "active" as const,
    administrativeOnboardingState: "completed" as const,
    authUserId: "8ce151b3-5a35-4459-abaa-b7645771345e",
    billingState: "active" as const,
    cancellationEffectiveAt: null,
    email: "member@example.com",
    foundationsState: "in_progress" as const,
    memberId: "4fd81df9-ea52-46f8-b259-d44ee05a56c5",
    personId: "81f573d5-ff94-4fcb-b809-a97a36f27ed9",
    programState: "active" as const,
    standingState: "active" as const,
  };

  assert.ok(deriveMemberAccessPolicy(baseIdentity).capabilities.includes("updates.read"));
  assert.ok(!deriveMemberAccessPolicy({
    ...baseIdentity,
    billingState: "attention_required",
  }).capabilities.includes("updates.read"));
  assert.ok(!deriveMemberAccessPolicy({
    ...baseIdentity,
    standingState: "paused",
  }).capabilities.includes("updates.read"));
  assert.ok(!deriveMemberAccessPolicy({
    ...baseIdentity,
    administrativeOnboardingState: "in_progress",
  }).capabilities.includes("updates.read"));
});

test("new migration closes direct-target RLS gaps and persists retry-safe dispatches", async () => {
  const [migration, runner] = await Promise.all([
    source("db/migrations/20260828_operator_notification_hardening.sql"),
    source("scripts/migrate-platform.mjs"),
  ]);

  assert.match(migration, /create table if not exists public\.operator_notification_dispatches/);
  assert.match(migration, /request_key text not null unique/);
  assert.match(migration, /request_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /operator_dispatch_id uuid[\s\S]*references public\.operator_notification_dispatches/);
  assert.match(migration, /operator_notification_dispatches enable row level security/);
  assert.match(migration, /revoke all on table public\.operator_notification_dispatches[\s\S]*from public, anon, authenticated/);
  const updatesEntitlement = section(
    migration,
    "create or replace function private.ruined_current_updates_member_id",
    "create or replace function private.ruined_can_read_announcement",
  );
  assert.match(updatesEntitlement, /lifecycle\.account_state = 'active'/);
  assert.match(updatesEntitlement, /lifecycle\.billing_state = 'active'/);
  assert.match(updatesEntitlement, /lifecycle\.administrative_onboarding_state = 'completed'/);
  assert.match(updatesEntitlement, /lifecycle\.cancellation_effective_at > statement_timestamp\(\)/);
  assert.doesNotMatch(updatesEntitlement, /cancellation_effective_at is null/);

  const announcementPolicy = section(
    migration,
    "create or replace function private.ruined_can_read_announcement",
    "comment on table public.operator_notification_dispatches",
  );
  assert.match(announcementPolicy, /private\.ruined_current_updates_member_id\(\) as member_id/);
  assert.match(announcementPolicy, /where access\.member_id is not null/);
  assert.match(announcementPolicy, /target\.member_id = access\.member_id/);
  assert.doesNotMatch(announcementPolicy, /target\.member_id = private\.ruined_current_membership_id/);
  assert.match(announcementPolicy, /member_id = \(select private\.ruined_current_updates_member_id\(\)\)/);
  assert.match(announcementPolicy, /person_id = \(select private\.ruined_current_person_id\(\)\)/);
  assert.match(runner, /20260828_operator_notification_hardening\.sql/);
});

test("operator sends reuse persisted requests and target only entitled members", async () => {
  const [repository, route, component] = await Promise.all([
    source("src/lib/platform/ops-notification-repository.ts"),
    source("app/api/ops/notifications/route.ts"),
    source("src/components/platform/OperatorNotificationCenter.tsx"),
  ]);
  const send = repository.slice(repository.indexOf("export async function sendOpsNotification"));

  assert.match(send, /insert into operator_notification_dispatches/);
  assert.match(send, /on conflict \(request_key\) do nothing/);
  assert.match(send, /dispatch\.request_fingerprint !== requestFingerprint/);
  assert.match(send, /dispatch\.status === "completed"[\s\S]*replayed: true/);
  assert.match(send, /operator_dispatch_id/);
  assert.match(send, /lifecycle\.account_state = 'active'/);
  assert.match(send, /lifecycle\.billing_state = 'active'/);
  assert.match(send, /lifecycle\.administrative_onboarding_state = 'completed'/);
  assert.match(send, /role_grant\.role_slug = 'member'/);
  assert.match(send, /role_grant\.revoked_at is null/);
  assert.match(route, /request\.headers\.get\("idempotency-key"\)/);
  assert.match(route, /dispatch\.replayed \? 200 : 201/);
  assert.match(component, /"Idempotency-Key": requestKey\.current/);
  assert.match(component, /requestKey\.current = createRequestKey\(\)/);
});

test("operator history renders actual delivery status and its matching timestamp", async () => {
  const [repository, component] = await Promise.all([
    source("src/lib/platform/ops-notification-repository.ts"),
    source("src/components/platform/OperatorNotificationCenter.tsx"),
  ]);

  assert.match(repository, /notification\.status/);
  assert.match(repository, /event\.event_type = notification\.status/);
  assert.match(repository, /resolveOpsNotificationStatusAt/);
  assert.doesNotMatch(repository, /new Date\(0\)\.toISOString\(\)/);
  assert.match(component, /item\.status/);
  assert.match(component, /formatDate\(item\.statusAt\)/);
  assert.doesNotMatch(component, /formatDate\(item\.deliveredAt\)/);
});
