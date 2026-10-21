import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { memberEligibleForExperience, memberEligibleForExperienceSnapshot } from "@/lib/platform/experience-member-access";
import { googleCommunicationLivemode, googleCommunicationUrlFromMetadata } from "@/lib/google/communications";
import { cadenceOccurrences, cadenceOccurrenceIsDue, getMemberEmailCadenceConfiguration, type CadenceConfiguration } from "./member-email-cadence-model";
import type { CadenceDelivery, CadenceDeliveryClaim, CadenceEmailPayload, CadenceEventSnapshot, CadencePlan, CadenceRecipient } from "./member-email-cadence-types";
export type { CadenceDelivery, CadenceDeliveryClaim, CadenceEmailPayload } from "./member-email-cadence-types";

export class CadenceDeliveryError extends Error {
  constructor(readonly code: string, readonly terminal = false) { super(code); }
}
const iso = (value: Date | string) => new Date(value).toISOString();

export async function readCadenceEvent(tx: TransactionSql, id: string, lock = false): Promise<CadenceEventSnapshot | null> {
  const [row] = await tx<Array<CadenceEventSnapshot & { startsAt: Date | string; endsAt: Date | string }>>`
    select id,title,starts_at as "startsAt",ends_at as "endsAt",timezone as "timeZone",version::text,
      visibility,circle_id,block_id,progression_level_slug,registration_mode,kind,
      (select circle.name from circles circle where circle.id=experiences.circle_id) as "circleName",
      case when kind='weekly_call' and metadata->'badge_credit'->>'track'='membership'
        and metadata->'badge_credit'->>'stage' in ('see','face','cut','grow') then upper(metadata->'badge_credit'->>'stage')
      when kind='circle_meeting' and metadata->'badge_credit'->>'track'='circle'
        and metadata->'badge_credit'->>'stage' in ('why','implementation') then
          case metadata->'badge_credit'->>'stage' when 'why' then 'WHY' else 'BUILD' end
      else null end as "callType"
    from experiences where id=${id}::uuid and status='published' and cancelled_at is null
      and starts_at>statement_timestamp() and ends_at is not null
      and kind in ('weekly_call','circle_meeting','academy_session','member_event')
      and visibility<>'public' and registration_mode<>'external'
    ${lock ? tx`for share` : tx``}`;
  return row ? { ...row, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt) } : null;
}

export function sameCadenceEvent(a: CadenceEventSnapshot | null, b: CadenceEventSnapshot): boolean {
  return a !== null && Object.keys(b).every(key => a[key as keyof CadenceEventSnapshot] === b[key as keyof CadenceEventSnapshot]);
}

export async function cadenceCallReady(tx: TransactionSql, id: string, lock = false): Promise<boolean> {
  const links = await tx<Array<{ metadata: unknown }>>`select metadata from integration_entity_links
    where provider='google' and local_entity_type='experience' and local_entity_id=${id}
      and external_entity_type='meet_space' and livemode=${googleCommunicationLivemode()}
    ${lock ? tx`for share` : tx``}`;
  return links.some(link => Boolean(googleCommunicationUrlFromMetadata("meet", link.metadata)));
}

/** Internal calls use their roster; no-registration calls use the canonical current member audience. */
export async function readCadenceRecipients(tx: TransactionSql, event: CadenceEventSnapshot,
  track: CadencePlan["track"], options: { memberId?: string; lock?: boolean } = {}): Promise<CadenceRecipient[]> {
  if (event.visibility === "public" || event.registration_mode === "external") return [];
  const automatic = track === "members" && event.registration_mode === "none"
    && ["all_members", "circle", "block", "progression"].includes(event.visibility);
  const candidates = await tx<Array<{ memberId: string }>>`
    select member.id as "memberId" from ruined_members member
    where (${options.memberId ?? null}::uuid is null or member.id=${options.memberId ?? null}::uuid)
      and (${automatic} or exists(select 1 from experience_registrations registration
        where registration.experience_id=${event.id}::uuid and registration.member_id=member.id))
      and member.deleted_at is null
    order by member.id limit 501`;
  if (candidates.length > 500) throw new CadenceDeliveryError("roster_exceeds_review_limit", true);
  const recipients: CadenceRecipient[] = [];
  for (const candidate of candidates) {
    // Preference writes also take the member lock, closing a withdrawal/send race.
    if (options.lock) {
      await tx`select private.ruined_lock_member_complimentary_funding(${candidate.memberId}::uuid)`;
      await tx`select private.ruined_lock_member_operator_funding(${candidate.memberId}::uuid)`;
      await tx`select id from ruined_members where id=${candidate.memberId}::uuid for update`;
      await tx`select member_id from member_registration_access where member_id=${candidate.memberId}::uuid for share`;
      await tx`select email.id from person_email_addresses email join ruined_members member on member.person_id=email.person_id
        where member.id=${candidate.memberId}::uuid for share of email`;
      await tx`select contact.id from communication_contacts contact join ruined_members member on member.email_normalized=contact.email_normalized
        where member.id=${candidate.memberId}::uuid for share of contact`;
    }
    const [registration] = await tx<Array<{ registeredAt: Date | string; status: string; source: string }>>`
      select greatest(registration.registered_at,coalesce((select max(occurred_at) from experience_registration_events transition
          where transition.registration_id=registration.id and transition.next_status='registered'
            and transition.previous_status is distinct from 'registered'),registration.registered_at)) as "registeredAt",
        registration.status,registration.source from experience_registrations registration
      where registration.experience_id=${event.id}::uuid and registration.member_id=${candidate.memberId}::uuid
      ${options.lock ? tx`for share of registration` : tx``}`;
    const [member] = await tx<Array<{ name: string; email: string; available: boolean; verified: boolean;
      consentId: string | null; consent: boolean; suppressed: boolean; enrolledAt: Date | string }>>`
      select coalesce(nullif(btrim(profile.display_name),''),'Friend') as name,member.email_normalized as email,
        greatest(member.created_at,access.registered_at,access.profile_activated_at) as "enrolledAt",
        (member.deleted_at is null and person.status='active') as available,
        exists(select 1 from person_email_addresses email where email.person_id=member.person_id
          and email.email_normalized=member.email_normalized and email.verification_state='verified'
          and email.retired_at is null) as verified,
        consent.id::text as "consentId",
        exists(select 1 from communication_contacts contact where contact.email_normalized=member.email_normalized
          and contact.delivery_state<>'active') as suppressed,
        coalesce(consent.decision='accepted' and consent.evidence->>'destination'=member.email_normalized
          and consent.actor_auth_user_id is not null
          and consent.evidence->>'requested'='true' and consent.evidence->>'marketingConsent'='false'
          and (consent.source='member' or (consent.source='ops'
            and consent.evidence->>'action'='operator_email_preference_enabled'
            and consent.evidence->>'operatorApproved'='true' and consent.evidence->>'memberAffirmed'='false'
            and jsonb_typeof(consent.evidence->'approvalReference')='string'
            and consent.evidence->>'approvalReference' ~ '[^[:space:]]')),false) as consent
      from ruined_members member join people person on person.id=member.person_id
      left join person_profiles profile on profile.person_id=member.person_id
      left join member_registration_access access on access.member_id=member.id
      left join lateral (select id,decision,evidence,source,actor_auth_user_id from member_consents decision
        where decision.member_id=member.id and decision.consent_type='communications'
          and decision.evidence->>'context'='member_communication_preferences_v1'
          and decision.evidence->>'purpose'='membership_updates' and decision.evidence->>'channel'='email'
        order by decision.id desc limit 1) consent on true
      where member.id=${candidate.memberId}::uuid`;
    if (!member) continue;
    let reason = !member.available ? "Account unavailable" : !member.verified ? "Email is not verified"
      : (registration && registration.status !== "registered") || (!registration && !automatic) ? "Not on the confirmed call roster"
      : (track === "founder_test" || event.visibility === "invite_only") && registration?.source !== "ops" ? "This call requires an explicit admin invitation"
      : member.suppressed ? "Email delivery is suppressed"
      : !member.consent ? "Membership email reminders are not enabled" : "";
    if (!reason && !await (options.lock ? memberEligibleForExperience : memberEligibleForExperienceSnapshot)(tx, event, candidate.memberId)) {
      reason = "Current membership or call access does not qualify";
    }
    let enrolledAt = new Date(automatic ? member.enrolledAt : registration?.registeredAt ?? member.enrolledAt).getTime();
    if (automatic && registration) enrolledAt = Math.max(enrolledAt,new Date(registration.registeredAt).getTime());
    if (automatic && !reason && event.visibility !== "all_members") {
      // Access policy supplies authority; these matching timestamps prevent late enrollment backfill.
      let scopes: Array<{ enrolledAt: Date | string }>;
      if (event.visibility === "circle") {
        scopes = await tx<Array<{ enrolledAt: Date | string }>>`
          select greatest(assignment.assigned_at,circle.activated_at) as "enrolledAt"
          from circle_member_assignments assignment join circles circle on circle.id=assignment.circle_id
          where assignment.member_id=${candidate.memberId}::uuid and assignment.circle_id=${event.circle_id}::uuid
            and assignment.ended_at is null and assignment.assigned_at<=statement_timestamp()
            and circle.status='active' and circle.activated_at<=statement_timestamp()
            and (circle.ends_at is null or circle.ends_at>=statement_timestamp())
          ${options.lock ? tx`for share of assignment,circle` : tx``}`;
      } else if (event.visibility === "block") {
        scopes = await tx<Array<{ enrolledAt: Date | string }>>`
          select greatest(assignment.assigned_at,circle.activated_at,block_assignment.assigned_at,block.activated_at) as "enrolledAt"
          from circle_member_assignments assignment join circles circle on circle.id=assignment.circle_id
          join block_circle_assignments block_assignment on block_assignment.circle_id=circle.id
          join membership_blocks block on block.id=block_assignment.block_id
          where assignment.member_id=${candidate.memberId}::uuid and assignment.ended_at is null
            and assignment.assigned_at<=statement_timestamp() and circle.status='active'
            and circle.activated_at<=statement_timestamp() and (circle.ends_at is null or circle.ends_at>=statement_timestamp())
            and block_assignment.block_id=${event.block_id}::uuid and block_assignment.ended_at is null
            and block_assignment.assigned_at<=statement_timestamp() and block.status='active'
            and block.activated_at<=statement_timestamp() and (block.ends_at is null or block.ends_at>=statement_timestamp())
          ${options.lock ? tx`for share of assignment,circle,block_assignment,block` : tx``}`;
      } else {
        scopes = await tx<Array<{ enrolledAt: Date | string }>>`
          select assigned_at as "enrolledAt" from member_progression_assignments
          where member_id=${candidate.memberId}::uuid and progression_level_slug=${event.progression_level_slug}
            and ended_at is null and assigned_at<=statement_timestamp()
          ${options.lock ? tx`for share` : tx``}`;
      }
      if (!scopes.length) reason = "Current audience enrollment is not recorded";
      else enrolledAt = Math.max(enrolledAt,...scopes.map(scope=>new Date(scope.enrolledAt).getTime()));
    }
    recipients.push({ memberId:candidate.memberId,name:member.name,email:member.email,
      registeredAt:new Date(enrolledAt).toISOString(),consentId:member.consentId,eligible:!reason,reason:reason || "Qualified" });
  }
  return recipients;
}

type PlanRow = { id: string; revision: number; active: boolean; activatedAt: Date | string; snapshot: CadencePlan;
  sequenceId: string | null; sequenceRevision: number | null };
function planFromRow(row: PlanRow): CadencePlan {
  return { ...row.snapshot, id: row.id, revision: row.revision, active: row.active, activatedAt: iso(row.activatedAt) };
}

/** A paused/replaced rule or changed classification cannot authorize an inherited send. */
async function inheritanceIsCurrent(tx: TransactionSql,row: PlanRow): Promise<boolean> {
  if (!row.sequenceId) return true;
  const sequences=await tx`select sequence.id from private.member_email_cadence_sequences sequence
    join platform_users actor on actor.auth_user_id=sequence.approved_by and actor.status='active'
    join platform_role_grants grant_row on grant_row.auth_user_id=actor.auth_user_id and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
    where sequence.id=${row.sequenceId}::uuid and sequence.active and sequence.revision=${row.sequenceRevision}
      and sequence.kind=${row.snapshot.kind} and sequence.track=${row.snapshot.track}
    for share of sequence,actor,grant_row`;
  if (!sequences.length) return false;
  const expected=(row.snapshot as CadencePlan & {inheritanceBinding?:{kind:string;track:string;cohortMonth?:string}}).inheritanceBinding;
  if (!expected) return false;
  const [binding]=await tx<Array<{kind:string;track:string;cohortMonth:string|null}>>`select kind,track,cohort_month as "cohortMonth"
    from private.member_email_cadence_event_bindings where experience_id=${row.snapshot.eventId}::uuid for share`;
  if (binding) return binding.kind===expected.kind && binding.track===expected.track && (binding.cohortMonth ?? null)===(expected.cohortMonth ?? null);
  const event=row.snapshot.event;
  return expected.track==='members' && !expected.cohortMonth && ((expected.kind==='membership' && event.kind==='weekly_call'
    && ['all_members','block','progression'].includes(event.visibility)) || (expected.kind==='circle' && event.kind==='circle_meeting' && event.visibility==='circle'));
}

export async function enqueueCadenceDeliveries(configuration: CadenceConfiguration): Promise<number> {
  if (!configuration.enabled || !configuration.ready || !configuration.activatedAt) return 0;
  const sql = getApplicationDatabase();
  const plans = await sql<PlanRow[]>`
    select id,revision,active,activated_at as "activatedAt",snapshot,sequence_id as "sequenceId",sequence_revision as "sequenceRevision" from private.member_email_cadence_plans
    where active and (snapshot->'event'->>'startsAt')::timestamptz>statement_timestamp() order by id`;
  let queued = 0;
  for (const row of plans) {
    const plan = planFromRow(row);
    const now = new Date();
    const due = cadenceOccurrences(plan.event,plan.kind,plan.track)
      .filter(item => cadenceOccurrenceIsDue(item,{now,configuration,enrolledAt:plan.activatedAt}));
    if (!due.length) continue;
    queued += await sql.begin(async tx => {
      await tx`set local lock_timeout='3s'`;
      await tx`set local statement_timeout='10s'`;
      const [current] = await tx`select id from private.member_email_cadence_plans where id=${plan.id}::uuid
        and active and revision=${plan.revision} for share`;
      if (!current || !await inheritanceIsCurrent(tx,row) || !sameCadenceEvent(await readCadenceEvent(tx,plan.eventId,true),plan.event)
        || !await cadenceCallReady(tx,plan.eventId,true)) return 0;
      const recipients = await readCadenceRecipients(tx,plan.event,plan.track);
      let count = 0;
      for (const occurrence of due) for (const recipient of recipients) {
        if (!recipient.eligible || !recipient.consentId || !cadenceOccurrenceIsDue(occurrence,
          {now:new Date(),configuration,enrolledAt:recipient.registeredAt})) continue;
        const inserted = await tx`insert into private.member_email_cadence_deliveries
          (plan_id,plan_revision,experience_id,member_id,starts_at,stage,expected_email,expected_consent_id,due_at,expires_at)
          values(${plan.id}::uuid,${plan.revision},${plan.eventId}::uuid,${recipient.memberId}::uuid,
            ${plan.event.startsAt}::timestamptz,${occurrence.stage},${recipient.email},${recipient.consentId}::bigint,
            ${occurrence.dueAt}::timestamptz,${occurrence.expiresAt}::timestamptz)
          on conflict(member_id,experience_id,starts_at,stage) do nothing returning id`;
        count += inserted.length;
      }
      return count;
    });
  }
  return queued;
}

export async function claimCadenceDelivery(lease: string): Promise<CadenceDeliveryClaim | null> {
  const sql = getApplicationDatabase();
  // An expired attempted delivery is uncertain, not eligible for a fresh automatic send.
  await sql`update private.member_email_cadence_deliveries
    set status=case when first_attempt_at is null then 'cancelled' else 'manual_review' end,
      last_error='delivery_window_expired',lock_token=null,locked_at=null,updated_at=clock_timestamp()
    where status in ('pending','failed','sending') and expires_at<=clock_timestamp()
      and (locked_at is null or locked_at<clock_timestamp()-interval '2 minutes')`;
  const [claim] = await sql<CadenceDeliveryClaim[]>`with candidate as (
    select id from private.member_email_cadence_deliveries where expires_at>clock_timestamp() and due_at<=clock_timestamp()
      and ((status in ('pending','failed') and available_at<=clock_timestamp())
        or (status='sending' and locked_at<clock_timestamp()-interval '2 minutes'))
      order by due_at,id for update skip locked limit 1)
    update private.member_email_cadence_deliveries delivery
    set status='sending',attempts=attempts+1,locked_at=clock_timestamp(),lock_token=${lease}::uuid,updated_at=clock_timestamp()
    from candidate where delivery.id=candidate.id returning delivery.id,delivery.member_id as "memberId",
      attempts,first_attempt_at as "firstAttemptAt"`;
  return claim ?? null;
}

export async function withCadenceDelivery<T>(claim: CadenceDeliveryClaim, lease: string,
  action: (tx: TransactionSql, delivery: CadenceDelivery) => Promise<T>) {
  return getApplicationDatabase().begin(async tx => {
    await tx`set local lock_timeout='3s'`;
    await tx`set local statement_timeout='10s'`;
    const [row] = await tx<PlanRow[]>`
      select plan.id,plan.revision,plan.active,plan.activated_at as "activatedAt",plan.snapshot,plan.sequence_id as "sequenceId",plan.sequence_revision as "sequenceRevision"
      from private.member_email_cadence_plans plan join private.member_email_cadence_deliveries delivery on delivery.plan_id=plan.id
      where delivery.id=${claim.id}::uuid for share of plan`;
    const [job] = await tx<Array<{ planRevision: number; stage: CadenceDelivery["stage"]; expectedEmail: string; consentId: string;
      startsAt: Date | string; expiresAt: Date | string; dueAt: Date | string; payload: CadenceEmailPayload | null; firstAttemptAt: Date | string | null }>>`
      select plan_revision as "planRevision",stage,expected_email as "expectedEmail",expected_consent_id::text as "consentId",
        starts_at as "startsAt",expires_at as "expiresAt",due_at as "dueAt",payload,first_attempt_at as "firstAttemptAt"
      from private.member_email_cadence_deliveries where id=${claim.id}::uuid and status='sending'
        and lock_token=${lease}::uuid for update`;
    if (!job) return {kind:"deferred" as const};
    const plan = row ? planFromRow(row) : null;
    const event = plan ? await readCadenceEvent(tx,plan.eventId,true) : null;
    const configuration = getMemberEmailCadenceConfiguration();
    let valid = Boolean(plan && plan.active && plan.revision===job.planRevision && row && await inheritanceIsCurrent(tx,row) && configuration.enabled && configuration.ready
      && sameCadenceEvent(event,plan.event) && iso(job.startsAt)===plan.event.startsAt
      && cadenceOccurrenceIsDue({stage:job.stage,dueAt:iso(job.dueAt),expiresAt:iso(job.expiresAt)},
        {now:new Date(),configuration,enrolledAt:plan.activatedAt}));
    const recipient = valid && event && plan ? (await readCadenceRecipients(tx,event,plan.track,{memberId:claim.memberId,lock:true}))[0] : null;
    valid = valid && Boolean(recipient?.eligible && recipient.email===job.expectedEmail && recipient.consentId===job.consentId
      && Date.parse(recipient.registeredAt)<=Date.parse(iso(job.dueAt))
      && (!job.payload || job.payload.to===recipient.email));
    if (valid && event) valid = await cadenceCallReady(tx,event.id,true);
    if (!valid || !plan || !event || !recipient) {
      const uncertain = Boolean(job.firstAttemptAt);
      await tx`update private.member_email_cadence_deliveries set status=${uncertain ? "manual_review" : "cancelled"},
        last_error='eligibility_or_schedule_changed',lock_token=null,locked_at=null,updated_at=clock_timestamp() where id=${claim.id}::uuid`;
      return {kind:uncertain ? "manualReview" as const : "cancelled" as const};
    }
    return {kind:"ok" as const,value:await action(tx,{...claim,firstAttemptAt:job.firstAttemptAt,
      email:recipient.email,memberName:recipient.name,payload:job.payload,plan,event,stage:job.stage,
      dueAt:iso(job.dueAt),expiresAt:iso(job.expiresAt)})};
  });
}

export async function freezeCadenceDelivery(tx: TransactionSql,id: string,payload: CadenceEmailPayload) {
  await tx`update private.member_email_cadence_deliveries set payload=${tx.json(payload)}::jsonb,
    first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),updated_at=clock_timestamp() where id=${id}::uuid`;
}
export async function completeCadenceDelivery(tx: TransactionSql,id: string,providerId: string) {
  await tx`update private.member_email_cadence_deliveries set status='sent',provider_message_id=${providerId},
    sent_at=clock_timestamp(),last_error=null,lock_token=null,locked_at=null,updated_at=clock_timestamp() where id=${id}::uuid`;
}
export async function failCadenceDelivery(claim: CadenceDeliveryClaim,lease: string,code: string,terminal: boolean): Promise<"failed"|"manualReview"|"deferred"> {
  const result = await getApplicationDatabase()`update private.member_email_cadence_deliveries
    set status=case when ${terminal} or attempts>=5 then 'manual_review' else 'failed' end,
      last_error=${code},available_at=clock_timestamp()+interval '1 minute',lock_token=null,locked_at=null,updated_at=clock_timestamp()
    where id=${claim.id}::uuid and lock_token=${lease}::uuid and status='sending' returning status`;
  return result[0]?.status === "manual_review" ? "manualReview" : result.length ? "failed" : "deferred";
}
