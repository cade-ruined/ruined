import "server-only";

import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { memberEligibleForExperienceSnapshot } from "@/lib/platform/experience-member-access";
import { googleCommunicationLivemode, googleCommunicationUrlFromMetadata } from "@/lib/google/communications";
import { MEMBER_COMMUNICATION_NOTICE_VERSION, MEMBER_SMS_TERMS_VERSION } from "@/lib/membership/member-communication-preferences-model";
import { requireAdminEmailActor } from "./admin-email-repository";
import { AdminEmailError } from "./admin-email-model";
import { readMemberSmsConfiguration } from "./member-sms-config";
import { MEMBER_SMS_AUTOMATION_BATCH_SIZE, memberSmsCallReminderKey, readMemberSmsAutomationConfiguration } from "./member-sms-automation-model";
import { memberSmsReminderBody, type MemberSmsReminder } from "./member-sms-model";
import { getMemberSmsTemplatePreviews, memberSmsOperationNoticeMinutes } from "./member-sms-operations-model";
import { getCommunicationsChannelCatalog } from "./communications-channel-catalog";
import { getManualCommunicationCatalog } from "./communications-catalog";
import type { MemberSmsOneOffRequestRecord } from "./member-sms-one-off-model";
import type { MemberSmsHistoryItem, MemberSmsOperationCall, MemberSmsOperationJob, MemberSmsOperationRecipient, MemberSmsOperationsOverview, MemberSmsUpcomingItem } from "./member-sms-operations-types";

const ORIGIN = "https://members.theruinedproject.com";
const MEMBER_LIMIT = 250, EVENT_LIMIT = 32, PAIR_LIMIT = 400, UPCOMING_LIMIT = 100, HISTORY_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso = (value: Date | string) => new Date(value).toISOString();
const digest = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");
const masked = (phone: string) => `••• ${phone.slice(-4)}`;
export class MemberSmsOperationsError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "MemberSmsOperationsError"; }
}
export function parseMemberSmsHistoryCursor(value?: string | null): { createdAt: string; id: string } | null {
  if (value === undefined || value === null) return null;
  try {
    if (value.length > 180 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || Object.keys(parsed).sort().join(",") !== "createdAt,id" || !UUID.test(parsed.id)
      || typeof parsed.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(parsed.createdAt)
      || iso(parsed.createdAt).slice(0, 19) !== parsed.createdAt.slice(0, 19)) throw new Error();
    return parsed;
  } catch { throw new MemberSmsOperationsError(400, "That history page is invalid. Refresh text messages."); }
}

type Member = { memberId: string; personId: string; name: string; phone: string; sharedPhone: boolean;
  consentId: string; acceptedAt: Date | string; membershipState: string; accountState: string; released: boolean; total: number };
type Event = { id: string; title: string; startsAt: Date | string; timeZone: string; foundations01: boolean;
  visibility: string; registration_mode: string; circle_id: string | null; block_id: string | null; progression_level_slug: string | null; meetings: unknown[] | null };
type Attempt = { kind: string; memberId: string; reminderKey: string; consentId: string | null; status: string; deliveryStatus: string | null };
const recipient = (member: { memberId: string; name: string; phone: string; sharedPhone: boolean }): MemberSmsOperationRecipient => ({
  memberId: member.memberId, name: member.name, maskedPhone: masked(member.phone), sharedPhone: member.sharedPhone,
});
function callDetails(event: Event): MemberSmsOperationCall {
  return { eventId: event.id, title: event.title, startsAt: iso(event.startsAt), timeZone: event.timeZone, foundations01: event.foundations01 };
}
function reminder(memberId: string, consentId: string, event?: Event): MemberSmsReminder | null {
  if (!event) return { memberId, kind: "opt_in_confirmation", expectedConsentId: consentId, reminderKey: `consent:${consentId}` };
  const meetingUrl = event.meetings?.map(metadata => googleCommunicationUrlFromMetadata("meet", metadata)).find(Boolean);
  // The worker rejects a Foundations binding whose audience no longer matches.
  if (!meetingUrl || (event.foundations01 && (event.visibility !== "invite_only" || event.registration_mode !== "internal"))) return null;
  return { memberId, kind: "call_reminder", expectedConsentId: consentId, reminderKey: memberSmsCallReminderKey(event.id, event.startsAt),
    callDetails: { ...callDetails(event), ...(event.foundations01 ? { meetingUrl } : {}) } };
}
async function readMembers(tx: TransactionSql): Promise<Member[]> {
  return tx<Member[]>`select member.id as "memberId",member.person_id as "personId",
      coalesce(nullif(btrim(display.display_name),''),'Member') as name,profile.mobile_e164 as phone,
      exists(select 1 from person_private_profiles other where other.mobile_e164=profile.mobile_e164 and other.person_id<>member.person_id) as "sharedPhone",
      consent.id::text as "consentId",consent.accepted_at as "acceptedAt",member.membership_state as "membershipState",lifecycle.account_state as "accountState",
      private.ruined_member_profile_released(member.id) as released,count(*) over()::int as total
    from ruined_members member join member_lifecycle lifecycle on lifecycle.member_id=member.id
    join person_private_profiles profile on profile.person_id=member.person_id
    left join person_profiles display on display.person_id=member.person_id
    join lateral(select * from member_consents decision where decision.member_id=member.id and decision.consent_type='communications'
      and decision.evidence->>'context'='member_communication_preferences_v1' and decision.evidence->>'purpose'='membership_updates'
      and decision.evidence->>'channel'='sms' order by decision.id desc limit 1) consent on true
    where member.deleted_at is null and lifecycle.account_state in ('provisional','invited','active')
      and profile.mobile_e164 ~ '^[+][1-9][0-9]{1,14}$' and consent.decision='accepted'
      and consent.policy_version=${MEMBER_COMMUNICATION_NOTICE_VERSION} and consent.source='member' and consent.actor_auth_user_id is not null
      and consent.evidence->>'destination'=profile.mobile_e164 and consent.evidence->>'requested'='true'
      and consent.evidence->>'action'='sms_checkbox_checked' and consent.evidence->>'marketingConsent'='false'
      and consent.evidence->>'termsVersion'=${MEMBER_SMS_TERMS_VERSION}
      and not exists(select 1 from private.member_sms_phone_suppressions suppression where suppression.phone_e164=profile.mobile_e164)
    order by member.id limit ${MEMBER_LIMIT + 1}`;
}
async function readEvents(tx: TransactionSql, now: string, horizonEnd: string, activatedAt: string): Promise<Event[]> {
  return tx<Event[]>`select event.id,event.title,event.starts_at as "startsAt",event.timezone as "timeZone",
      coalesce(binding.kind='foundations_01',false) as "foundations01",event.visibility,event.registration_mode,event.circle_id,event.block_id,event.progression_level_slug,
      (select jsonb_agg(meeting.metadata) from integration_entity_links meeting where meeting.provider='google'
        and meeting.local_entity_type='experience' and meeting.local_entity_id=event.id::text and meeting.external_entity_type='meet_space'
        and meeting.livemode=${googleCommunicationLivemode()}) as meetings
    from experiences event left join private.member_email_cadence_event_bindings binding on binding.experience_id=event.id
    cross join lateral(select case when binding.kind='foundations_01' then 150 else 60 end as minutes) notice
    where event.kind in ('weekly_call','circle_meeting','academy_session','member_event','public_event')
      and event.status='published' and event.cancelled_at is null
      and (binding.kind is distinct from 'foundations_01' or (event.visibility='invite_only' and event.registration_mode='internal'))
      and event.starts_at-make_interval(mins=>notice.minutes)>=${activatedAt}::timestamptz
      and event.starts_at-make_interval(mins=>notice.minutes-10)>${now}::timestamptz
      and event.starts_at-make_interval(mins=>notice.minutes)<=${horizonEnd}::timestamptz
    order by event.starts_at-make_interval(mins=>notice.minutes),event.id limit ${EVENT_LIMIT + 1}`;
}
async function readUpcoming(tx: TransactionSql, now: string, activatedAt: string | null): Promise<MemberSmsOperationsOverview["upcoming"]> {
  const stopForecastingAt = Date.now() + 8_000;
  const horizonEnd = new Date(Date.parse(now) + 7 * 86400_000).toISOString();
  const members = await readMembers(tx);
  const total = members[0]?.total ?? 0;
  let truncated = members.length > MEMBER_LIMIT;
  members.splice(MEMBER_LIMIT);
  const items: MemberSmsUpcomingItem[] = [];
  const label = "Forecast for the next seven days, based on current consent and call access. Times are send windows, not promised delivery. The sender checks eligibility again; shared numbers can receive one message per eligible member.";
  if (!activatedAt) return { items, horizonEnd, truncated, currentOptIns: total, label: "An activation time is required to calculate automatic send windows." };
  const events = await readEvents(tx, now, horizonEnd, activatedAt);
  truncated ||= events.length > EVENT_LIMIT; events.splice(EVENT_LIMIT);
  const memberIds = members.map(member => member.memberId);
  const keys = [...members.map(member => `consent:${member.consentId}`), ...events.map(event => memberSmsCallReminderKey(event.id, event.startsAt))];
  const attempts = await tx<Attempt[]>`select reminder_kind as kind,member_id as "memberId",reminder_key as "reminderKey",consent_id::text as "consentId",status,delivery_status as "deliveryStatus"
    from private.member_sms_delivery_attempts where member_id=any(${memberIds}::uuid[]) and reminder_key=any(${keys}::text[])
      and reminder_kind in ('opt_in_confirmation','call_reminder')`;
  const jobs = await tx<Array<{ kind: string; memberId: string; reminderKey: string; status: string; consentId: string | null; dueAt: Date | string; expiresAt: Date | string }>>`
    select reminder_kind as kind,member_id as "memberId",reminder_key as "reminderKey",status,expected_consent_id::text as "consentId",due_at as "dueAt",expires_at as "expiresAt"
    from private.member_sms_automation_jobs where member_id=any(${memberIds}::uuid[]) and reminder_key=any(${keys}::text[])`;
  const attemptMap = new Map(attempts.map(row => [`${row.memberId}:${row.kind}:${row.reminderKey}`, row]));
  const jobMap = new Map(jobs.map(row => [`${row.memberId}:${row.kind}:${row.reminderKey}`, row]));
  const registrations = await tx<Array<{ eventId: string; personId: string; status: string }>>`
    select experience_id as "eventId",person_id as "personId",status from experience_registrations
    where experience_id=any(${events.map(event => event.id)}::uuid[]) and person_id=any(${members.map(member => member.personId)}::uuid[])`;
  const registrationMap = new Map(registrations.map(row => [`${row.eventId}:${row.personId}`, row.status]));
  function sourceFor(member: Member, kind: string, key: string, due: number): MemberSmsUpcomingItem["source"] | null {
    const keyWithMember = `${member.memberId}:${kind}:${key}`, job = jobMap.get(keyWithMember);
    // Any prior attempt is non-retryable, including unknown/blocked. A finished or
    // stale-consent durable job cannot be recreated by the worker's unique key.
    if (attemptMap.has(keyWithMember) || job?.status === "finished" || job?.status === "processing" || (job && job.consentId !== member.consentId)) return null;
    // An existing durable occurrence is never recreated with a new time after a
    // binding edit. Stale/interrupted jobs remain visible separately in jobs.
    if (job && (Date.parse(iso(job.dueAt)) !== due || Date.parse(iso(job.expiresAt)) !== due + 600_000
      || Date.parse(iso(job.expiresAt)) <= Date.parse(now))) return null;
    return job?.status === "queued" ? "queued" : "forecast";
  }
  for (const member of members) {
    const accepted = Date.parse(iso(member.acceptedAt)), dueAt = iso(member.acceptedAt), key = `consent:${member.consentId}`;
    const source = sourceFor(member, "opt_in_confirmation", key, accepted);
    if (source && accepted >= Date.parse(activatedAt) && accepted > Date.parse(now) - 600_000 && accepted <= Date.parse(now)) {
      items.push({ id: `${member.memberId}:${key}`, kind: "opt_in_confirmation", reminderKey: key, recipient: recipient(member), call: null,
        dueAt, expiresAt: new Date(accepted + 600_000).toISOString(), body: memberSmsReminderBody(reminder(member.memberId, member.consentId)!, ORIGIN),
        source, confirmation: "not_applicable", confirmationBody: null, confirmationStatus: null, blockedReason: null });
    }
  }
  let examined = 0;
  outer: for (const event of events) for (const member of members) {
    if (member.membershipState !== "active" || member.accountState !== "active" || !member.released) continue;
    const registration = registrationMap.get(`${event.id}:${member.personId}`);
    if ((registration && registration !== "registered") || ((event.registration_mode !== "none" || ["invite_only", "public"].includes(event.visibility)) && registration !== "registered")) continue;
    const input = reminder(member.memberId, member.consentId, event);
    if (!input) continue;
    const minutes = memberSmsOperationNoticeMinutes({ foundations01: event.foundations01, visibility: event.visibility, registrationMode: event.registration_mode });
    const due = Date.parse(iso(event.startsAt)) - minutes * 60_000;
    const source = sourceFor(member, "call_reminder", input.reminderKey, due); if (!source) continue;
    if (++examined > PAIR_LIMIT || Date.now() >= stopForecastingAt) { truncated = true; break outer; }
    if (!await memberEligibleForExperienceSnapshot(tx, event, member.memberId)) continue;
    let body: string;
    try { body = memberSmsReminderBody(input, ORIGIN); } catch { continue; } // Invalid call data is not sendable.
    const prior = attemptMap.get(`${member.memberId}:opt_in_confirmation:consent:${member.consentId}`);
    const confirmation = !prior ? "required" : prior.status === "accepted" && prior.consentId === member.consentId && !["failed", "undelivered"].includes(prior.deliveryStatus ?? "") ? "accepted" : "unavailable";
    items.push({ id: `${member.memberId}:${input.reminderKey}`, kind: "call_reminder", reminderKey: input.reminderKey, recipient: recipient(member), call: callDetails(event),
      dueAt: new Date(due).toISOString(), expiresAt: new Date(due + 600_000).toISOString(), body, source, confirmation,
      confirmationBody: confirmation === "required" ? memberSmsReminderBody(reminder(member.memberId, member.consentId)!, ORIGIN) : null,
      confirmationStatus: prior ? `${prior.status}${prior.deliveryStatus ? ` · ${prior.deliveryStatus}` : ""}` : null,
      blockedReason: confirmation === "unavailable" ? "The existing confirmation is unavailable. It will not be resent automatically." : null });
  }
  items.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  truncated ||= items.length > UPCOMING_LIMIT;
  return { items: items.slice(0, UPCOMING_LIMIT), horizonEnd, truncated, currentOptIns: total, label };
}

type HistoryRow = { id: string; memberId: string; name: string; phone: string; sharedPhone: boolean; kind: MemberSmsHistoryItem["kind"];
  reminderKey: string; consentId: string | null; status: MemberSmsHistoryItem["status"]; createdAt: Date | string; updatedAt: Date | string;
  deliveryStatus: string | null; deliveryUpdatedAt: Date | string | null; deliveryErrorCode: number | null; blockedReason: string | null; messageSid: string | null;
  actorName: string | null; bodyText: string | null; bodySha256: string; cursorCreatedAt: string; event: Event | null };
async function readHistory(tx: TransactionSql, cursor: ReturnType<typeof parseMemberSmsHistoryCursor>): Promise<MemberSmsOperationsOverview["history"]> {
  const rows = await tx<HistoryRow[]>`select attempt.id,attempt.member_id as "memberId",coalesce(nullif(btrim(display.display_name),''),'Member') as name,
      attempt.destination_e164 as phone,exists(select 1 from person_private_profiles other where other.mobile_e164=attempt.destination_e164 and other.person_id<>member.person_id) as "sharedPhone",
      attempt.reminder_kind as kind,attempt.reminder_key as "reminderKey",attempt.consent_id::text as "consentId",attempt.status,
      attempt.created_at as "createdAt",to_char(attempt.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorCreatedAt",attempt.updated_at as "updatedAt",attempt.delivery_status as "deliveryStatus",attempt.delivery_updated_at as "deliveryUpdatedAt",
      attempt.delivery_error_code as "deliveryErrorCode",attempt.blocked_reason as "blockedReason",attempt.twilio_message_sid as "messageSid",
      attempt.body_text as "bodyText",attempt.body_sha256 as "bodySha256",one_off.actor_name as "actorName",
      case when event.id is null then null else jsonb_build_object('id',event.id,'title',event.title,'startsAt',event.starts_at,'timeZone',event.timezone,
        'foundations01',coalesce(binding.kind='foundations_01',false),'visibility',event.visibility,'registration_mode',event.registration_mode,
        'meetings',(select jsonb_agg(link.metadata) from integration_entity_links link where link.provider='google' and link.local_entity_type='experience'
          and link.local_entity_id=event.id::text and link.external_entity_type='meet_space' and link.livemode=${googleCommunicationLivemode()})) end as event
    from private.member_sms_delivery_attempts attempt join ruined_members member on member.id=attempt.member_id
    left join person_profiles display on display.person_id=member.person_id
    left join private.member_sms_one_off_reviews one_off on one_off.id=case
      when attempt.reminder_kind='one_off' and attempt.reminder_key ~ '^one-off:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(attempt.reminder_key,':',2)::uuid else null end and one_off.member_id=attempt.member_id
    left join experiences event on event.id=case when attempt.reminder_key ~ '^call:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9]{10,16}:60m$'
      then split_part(attempt.reminder_key,':',2)::uuid else null end
    left join private.member_email_cadence_event_bindings binding on binding.experience_id=event.id
    where (${cursor?.createdAt ?? null}::timestamptz is null or (attempt.created_at,attempt.id)<(${cursor?.createdAt ?? null}::timestamptz,${cursor?.id ?? null}::uuid))
    order by attempt.created_at desc,attempt.id desc limit ${HISTORY_LIMIT + 1}`;
  const hasMore = rows.length > HISTORY_LIMIT; rows.splice(HISTORY_LIMIT);
  const items = rows.map(row => {
    let reconstructed: string | null = null, call: MemberSmsOperationCall | null = null;
    try {
      if (row.kind === "call_reminder" && row.event) {
        const millis = Number(row.reminderKey.split(":")[2]);
        const event = { ...row.event, startsAt: new Date(millis).toISOString() };
        const input = reminder(row.memberId, row.consentId ?? "", event);
        if (input) {
          const candidate = memberSmsReminderBody(input, ORIGIN);
          if (digest(candidate) === row.bodySha256) { reconstructed = candidate; call = callDetails(event); }
        }
      } else if (row.kind !== "call_reminder") {
        const candidate = memberSmsReminderBody({ memberId: row.memberId, kind: row.kind, reminderKey: row.reminderKey, expectedConsentId: row.consentId ?? undefined }, ORIGIN);
        if (digest(candidate) === row.bodySha256) reconstructed = candidate;
      }
    } catch { /* Historical metadata is not evidence unless its rendered hash matches. */ }
    const snapshot = row.bodyText !== null && digest(row.bodyText) === row.bodySha256 ? row.bodyText : null;
    return { id: row.id, kind: row.kind, actorName: row.actorName, reminderKey: row.reminderKey, recipient: recipient(row), call,
      createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), status: row.status, deliveryStatus: row.deliveryStatus,
      deliveryUpdatedAt: row.deliveryUpdatedAt ? iso(row.deliveryUpdatedAt) : null, deliveryErrorCode: row.deliveryErrorCode,
      blockedReason: row.blockedReason, messageSid: row.messageSid, body: snapshot ?? reconstructed,
      bodySource: snapshot !== null ? "snapshot" as const : reconstructed !== null ? "verified_reconstruction" as const : "unavailable" as const };
  });
  const last = rows.at(-1);
  return { items, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.cursorCreatedAt, id: last.id })).toString("base64url") : null };
}

async function readJobsWithoutAttempts(tx: TransactionSql): Promise<MemberSmsOperationsOverview["jobs"]> {
  const rows = await tx<Array<Omit<MemberSmsOperationJob, "recipient" | "call" | "dueAt" | "expiresAt" | "createdAt" | "updatedAt"> & {
    memberId: string; name: string; phone: string; sharedPhone: boolean; dueAt: Date | string; expiresAt: Date | string;
    createdAt: Date | string; updatedAt: Date | string; eventId: string | null; title: string | null; startsAt: Date | string | null; timeZone: string | null; foundations01: boolean;
  }>>`select job.id,job.reminder_kind as kind,job.member_id as "memberId",coalesce(nullif(btrim(display.display_name),''),'Member') as name,
      coalesce(consent.evidence->>'destination',profile.mobile_e164,'') as phone,
      exists(select 1 from person_private_profiles other where other.mobile_e164=coalesce(consent.evidence->>'destination',profile.mobile_e164)
        and other.person_id<>member.person_id) as "sharedPhone",
      job.due_at as "dueAt",job.expires_at as "expiresAt",job.created_at as "createdAt",job.updated_at as "updatedAt",job.status,job.outcome,
      event.id as "eventId",event.title,job.starts_at as "startsAt",event.timezone as "timeZone",coalesce(binding.kind='foundations_01',false) as "foundations01"
    from private.member_sms_automation_jobs job join ruined_members member on member.id=job.member_id
    left join person_profiles display on display.person_id=member.person_id
    left join person_private_profiles profile on profile.person_id=member.person_id
    left join member_consents consent on consent.id=job.expected_consent_id
    left join experiences event on event.id=job.experience_id
    left join private.member_email_cadence_event_bindings binding on binding.experience_id=event.id
    where not exists(select 1 from private.member_sms_delivery_attempts attempt where attempt.member_id=job.member_id
      and attempt.reminder_kind=job.reminder_kind and attempt.reminder_key=job.reminder_key)
    order by (job.status='processing') desc,job.created_at desc,job.id desc limit 51`;
  return { truncated: rows.length > 50, items: rows.slice(0, 50).map(row => ({ id: row.id, kind: row.kind, recipient: recipient(row),
    call: row.eventId && row.title && row.startsAt && row.timeZone ? { eventId: row.eventId, title: row.title, startsAt: iso(row.startsAt), timeZone: row.timeZone, foundations01: row.foundations01 } : null,
    dueAt: iso(row.dueAt), expiresAt: iso(row.expiresAt), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), status: row.status, outcome: row.outcome })) };
}

async function readOneOffRequests(tx:TransactionSql):Promise<{items:MemberSmsOneOffRequestRecord[];truncated:boolean}> {
  const rows=await tx<Array<{id:string;memberId:string;name:string;phone:string;sharedPhone:boolean;body:string;actorName:string;
    createdAt:Date|string;claimedAt:Date|string|null;status:"claimed"|"finished";outcome:string|null}>>`
    select review.id,review.member_id as "memberId",review.recipient_name as name,review.destination_e164 as phone,
      review.shared_phone as "sharedPhone",review.body_text as body,review.actor_name as "actorName",review.created_at as "createdAt",
      review.claimed_at as "claimedAt",review.status,review.outcome
    from private.member_sms_one_off_reviews review where review.status in ('claimed','finished')
      and not exists(select 1 from private.member_sms_delivery_attempts attempt where attempt.member_id=review.member_id
        and attempt.reminder_kind='one_off' and attempt.reminder_key='one-off:'||review.id::text)
    order by (review.status='claimed') desc,review.created_at desc,review.id desc limit 51`;
  return {truncated:rows.length>50,items:rows.slice(0,50).map(row=>({id:row.id,recipient:{...recipient(row),consentState:"opted_in"},
    body:row.body,actorName:row.actorName,createdAt:iso(row.createdAt),claimedAt:row.claimedAt?iso(row.claimedAt):null,status:row.status,outcome:row.outcome}))};
}

export async function getMemberSmsOperationsOverview(actor: string, options: { cursor?: string | null } = {}): Promise<MemberSmsOperationsOverview> {
  const cursor = parseMemberSmsHistoryCursor(options.cursor);
  return getApplicationDatabase().begin("isolation level repeatable read read only", async tx => {
    await tx`set local statement_timeout='8s'`;
    try { await requireAdminEmailActor(tx, actor, false); }
    catch (error) {
      if (error instanceof AdminEmailError) throw new MemberSmsOperationsError(error.status, "Administrator access is required to view text messages.");
      throw error;
    }
    const [{ now }] = await tx<Array<{ now: Date | string }>>`select statement_timestamp() as now`;
    const generatedAt = iso(now), config = readMemberSmsConfiguration(), automation = readMemberSmsAutomationConfiguration();
    const missing = [!config.sendReady ? "Twilio delivery configuration is incomplete." : null,
      !automation.ready ? "An activation time is required." : null, !process.env.CRON_SECRET?.trim() ? "The scheduled worker is not configured." : null].filter((item): item is string => Boolean(item));
    const callReady = googleCommunicationLivemode() !== null;
    const warnings = callReady ? [] : ["Call reminders need a Google meeting environment. Opt-in confirmations are unaffected."];
    const enabled = config.enabled && automation.enabled, ready = missing.length === 0;
    const state = !enabled ? "disabled" : !ready ? "unconfigured" : Date.parse(automation.activatedAt!) > Date.parse(generatedAt) ? "not_activated" : "enabled";
    const upcoming = await readUpcoming(tx, generatedAt, automation.activatedAt);
    const history = await readHistory(tx, cursor);
    const jobs = await readJobsWithoutAttempts(tx);
    const oneOffRequests = await readOneOffRequests(tx);
    return { generatedAt, automation: { enabled, transportEnabled: config.enabled, automationEnabled: automation.enabled, ready,
      activatedAt: automation.activatedAt, state, missing, callReady, warnings, schedule: "Every five minutes; each send window lasts ten minutes.", batchSize: MEMBER_SMS_AUTOMATION_BATCH_SIZE },
      templates: getMemberSmsTemplatePreviews(ORIGIN), communications: [...getCommunicationsChannelCatalog(), ...getManualCommunicationCatalog()].filter(item => item.channel === "texts"), upcoming, history, jobs, oneOffRequests };
  });
}
