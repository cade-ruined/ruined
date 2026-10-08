import "server-only";

import type { Sql, TransactionSql } from "postgres";
import { googleCommunicationLivemode, googleCommunicationUrlFromMetadata } from "@/lib/google/communications";
import { memberEligibleForExperience } from "@/lib/platform/experience-member-access";
import { MEMBER_COMMUNICATION_NOTICE_VERSION, MEMBER_SMS_TERMS_VERSION } from "@/lib/membership/member-communication-preferences-model";
import type { MemberSmsReminder } from "./member-sms-model";
import { memberSmsCallReminderKey, type MemberSmsAutomationConfiguration } from "./member-sms-automation-model";

type Job = {
  id: string;
  memberId: string;
  kind: "call_reminder" | "opt_in_confirmation";
  reminderKey: string;
  expectedConsentId: string | null;
  eventId: string | null;
  startsAt: Date | string | null;
};

/** Materialize every currently due occurrence before batching, so ineligible rows cannot starve later members. */
export async function enqueueMemberSmsAutomation(sql: Sql, config: MemberSmsAutomationConfiguration): Promise<number> {
  if (!config.activatedAt) return 0;
  return await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '10s'`;
    const inserted = await tx<Array<{ id: string }>>`
      with consent_candidates as (
        select member.id as member_id,member.person_id,member.membership_state,lifecycle.account_state,
          consent.id as consent_id,consent.accepted_at
        from ruined_members member
        join member_lifecycle lifecycle on lifecycle.member_id=member.id
        join person_private_profiles profile on profile.person_id=member.person_id
        join lateral (
          select * from member_consents decision where decision.member_id=member.id
            and decision.consent_type='communications'
            and decision.evidence->>'context'='member_communication_preferences_v1'
            and decision.evidence->>'purpose'='membership_updates' and decision.evidence->>'channel'='sms'
          order by decision.id desc limit 1
        ) consent on true
        where member.deleted_at is null and lifecycle.account_state in ('provisional','invited','active')
          and profile.mobile_e164 ~ '^[+][1-9][0-9]{1,14}$'
          and consent.decision='accepted' and consent.policy_version=${MEMBER_COMMUNICATION_NOTICE_VERSION}
          and consent.source='member' and consent.actor_auth_user_id is not null
          and consent.evidence->>'destination'=profile.mobile_e164 and consent.evidence->>'requested'='true'
          and consent.evidence->>'action'='sms_checkbox_checked' and consent.evidence->>'marketingConsent'='false'
          and consent.evidence->>'termsVersion'=${MEMBER_SMS_TERMS_VERSION}
          and not exists(select 1 from private.member_sms_phone_suppressions stop where stop.phone_e164=profile.mobile_e164)
      ), occurrences as (
        select consent.member_id,'opt_in_confirmation'::text as kind,'consent:'||consent.consent_id::text as reminder_key,
          consent.consent_id,null::uuid as experience_id,null::timestamptz as starts_at,
          consent.accepted_at as due_at,consent.accepted_at+interval '10 minutes' as expires_at
        from consent_candidates consent
        where consent.accepted_at>=${config.activatedAt}::timestamptz
          and consent.accepted_at>=statement_timestamp()-interval '10 minutes'
          and consent.accepted_at<=statement_timestamp()
        union all
        select consent.member_id,'call_reminder',
          'call:'||experience.id::text||':'||((extract(epoch from experience.starts_at)*1000)::bigint)::text||':60m',
          consent.consent_id,experience.id,experience.starts_at,
          experience.starts_at-interval '1 hour',experience.starts_at-interval '50 minutes'
        from consent_candidates consent cross join experiences experience
        where consent.membership_state='active' and consent.account_state='active'
          and private.ruined_member_profile_released(consent.member_id)
          and experience.kind in ('weekly_call','circle_meeting','academy_session','member_event','public_event')
          and experience.status='published' and experience.cancelled_at is null
          and experience.starts_at-interval '1 hour'>=${config.activatedAt}::timestamptz
          and experience.starts_at>statement_timestamp()+interval '50 minutes'
          and experience.starts_at<=statement_timestamp()+interval '1 hour'
          and exists(select 1 from integration_entity_links meeting where meeting.provider='google'
            and meeting.local_entity_type='experience' and meeting.local_entity_id=experience.id::text
            and meeting.external_entity_type='meet_space' and meeting.livemode=${googleCommunicationLivemode()})
      )
      insert into private.member_sms_automation_jobs(member_id,reminder_kind,reminder_key,expected_consent_id,
        experience_id,starts_at,due_at,expires_at)
      select member_id,kind,reminder_key,consent_id,experience_id,starts_at,due_at,expires_at from occurrences
      on conflict(member_id,reminder_kind,reminder_key) do nothing returning id`;
    return inserted.length;
  });
}

/** A claimed occurrence is never automatically retried, including a worker crash before its provider response. */
export async function claimMemberSmsAutomationJob(sql: Sql): Promise<Job | null> {
  return await sql.begin(async tx => {
    await tx`set local lock_timeout = '3s'`;
    await tx`set local statement_timeout = '10s'`;
    await tx`update private.member_sms_automation_jobs set status='finished',outcome='expired',updated_at=statement_timestamp()
      where status='queued' and expires_at<=statement_timestamp()`;
    const [job] = await tx<Job[]>`with candidate as (
      select id from private.member_sms_automation_jobs where status='queued'
        and due_at<=statement_timestamp() and expires_at>statement_timestamp()
      order by due_at,id for update skip locked limit 1
    ) update private.member_sms_automation_jobs job set status='processing',updated_at=statement_timestamp()
      from candidate where job.id=candidate.id
      returning job.id,job.member_id as "memberId",job.reminder_kind as kind,job.reminder_key as "reminderKey",
        job.expected_consent_id::text as "expectedConsentId",job.experience_id as "eventId",job.starts_at as "startsAt"`;
    return job ?? null;
  });
}

export async function memberSmsAutomationReminder(sql: Sql, job: Job): Promise<MemberSmsReminder | null> {
  if (job.kind === "opt_in_confirmation") {
    return job.expectedConsentId ? { memberId: job.memberId, kind: job.kind, reminderKey: job.reminderKey,
      expectedConsentId: job.expectedConsentId } : null;
  }
  if (!job.eventId || !job.startsAt) return null;
  const [event] = await sql<Array<{ title: string; timeZone: string }>>`
    select title,timezone as "timeZone" from experiences where id=${job.eventId}::uuid`;
  if (!event) return null;
  return { memberId: job.memberId, kind: job.kind, reminderKey: job.reminderKey, expectedConsentId: job.expectedConsentId ?? undefined,
    callDetails: { eventId: job.eventId, startsAt: new Date(job.startsAt).toISOString(), title: event.title, timeZone: event.timeZone } };
}

export async function finishMemberSmsAutomationJob(sql: Sql, id: string, outcome: string): Promise<void> {
  await sql`update private.member_sms_automation_jobs set status='finished',outcome=${outcome},updated_at=statement_timestamp()
    where id=${id}::uuid and status='processing'`;
}

export async function memberSmsConfirmationAccepted(sql: Sql, input: MemberSmsReminder): Promise<boolean> {
  if (!input.expectedConsentId) return false;
  const [confirmation] = await sql`select id from private.member_sms_delivery_attempts
    where member_id=${input.memberId}::uuid and reminder_kind='opt_in_confirmation'
      and reminder_key=${`consent:${input.expectedConsentId}`} and consent_id=${input.expectedConsentId}::bigint
      and status='accepted' and (delivery_status is null or delivery_status not in ('failed','undelivered'))`;
  return Boolean(confirmation);
}

/** Run in the transport transaction at reservation and again immediately before its network call. */
export async function validateMemberSmsAutomationOccurrence(tx: TransactionSql, input: MemberSmsReminder,
  config: MemberSmsAutomationConfiguration): Promise<boolean> {
  if (!config.activatedAt) return false;
  const lazyConfirmation = input.kind === "opt_in_confirmation" && Boolean(input.callDetails);
  const sourceKind = lazyConfirmation ? "call_reminder" : input.kind;
  const sourceKey = lazyConfirmation ? memberSmsCallReminderKey(input.callDetails!.eventId, input.callDetails!.startsAt) : input.reminderKey;
  const [job] = await tx`select id from private.member_sms_automation_jobs where member_id=${input.memberId}::uuid
    and reminder_kind=${sourceKind} and reminder_key=${sourceKey} and status='processing'
    and expected_consent_id=${input.expectedConsentId ?? null}::bigint
    and due_at>=${config.activatedAt}::timestamptz and due_at<=statement_timestamp() and expires_at>statement_timestamp()
    for share`;
  if (!job) return false;
  if (input.kind === "opt_in_confirmation" && !lazyConfirmation) {
    if (!input.expectedConsentId || input.reminderKey !== `consent:${input.expectedConsentId}`) return false;
    const [consent] = await tx`select id from member_consents where id=${input.expectedConsentId}::bigint
      and member_id=${input.memberId}::uuid and accepted_at>=${config.activatedAt}::timestamptz
      and accepted_at>statement_timestamp()-interval '10 minutes' and accepted_at<=statement_timestamp() for share`;
    return Boolean(consent); // Exact current consent and account evidence are enforced by the transport gate.
  }
  if ((!lazyConfirmation && input.kind !== "call_reminder") || !input.callDetails
    || (lazyConfirmation ? input.reminderKey !== `consent:${input.expectedConsentId}`
      : input.reminderKey !== memberSmsCallReminderKey(input.callDetails.eventId, input.callDetails.startsAt))) return false;
  if (!lazyConfirmation) {
    const [confirmation] = await tx`select id from private.member_sms_delivery_attempts
      where member_id=${input.memberId}::uuid and reminder_kind='opt_in_confirmation'
        and reminder_key=${`consent:${input.expectedConsentId}`} and consent_id=${input.expectedConsentId ?? null}::bigint
        and status='accepted' and (delivery_status is null or delivery_status not in ('failed','undelivered')) for share`;
    if (!confirmation) return false;
  }
  const [event] = await tx<Array<{ id: string; visibility: string; circle_id: string | null; block_id: string | null;
    progression_level_slug: string | null; registration_mode: string }>>`
    select id,visibility,circle_id,block_id,progression_level_slug,registration_mode from experiences
    where id=${input.callDetails.eventId}::uuid and starts_at=${input.callDetails.startsAt}::timestamptz
      and title=${input.callDetails.title} and timezone=${input.callDetails.timeZone}
      and kind in ('weekly_call','circle_meeting','academy_session','member_event','public_event')
      and status='published' and cancelled_at is null
      and starts_at>statement_timestamp()+interval '50 minutes' and starts_at<=statement_timestamp()+interval '1 hour'
    for share`;
  if (!event) return false;
  // Hold the registration-access row, not just a computed boolean, until dispatch commits.
  const accessRows = await tx<Array<{ profile_activated_at: Date | null }>>`
    select profile_activated_at from member_registration_access where member_id=${input.memberId}::uuid for share`;
  if (accessRows.some(row => row.profile_activated_at === null)) return false;
  const [member] = await tx<Array<{ person_id: string }>>`select person_id from ruined_members
    where id=${input.memberId}::uuid and deleted_at is null for share`;
  if (!member) return false;
  const registrations = await tx<Array<{ status: string }>>`select status from experience_registrations
    where experience_id=${event.id}::uuid and person_id=${member.person_id}::uuid for share`;
  const registration = registrations[0];
  if (registration && registration.status !== "registered") return false;
  if ((event.registration_mode !== "none" || ["invite_only", "public"].includes(event.visibility))
    && registration?.status !== "registered") return false;
  if (!await memberEligibleForExperience(tx, event, input.memberId)) return false;
  const meetings = await tx<Array<{ metadata: unknown }>>`select metadata from integration_entity_links
    where provider='google' and local_entity_type='experience' and local_entity_id=${event.id}
      and external_entity_type='meet_space' and livemode=${googleCommunicationLivemode()} for share`;
  return meetings.some(meeting => Boolean(googleCommunicationUrlFromMetadata("meet", meeting.metadata)));
}
