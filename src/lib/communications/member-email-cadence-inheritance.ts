import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { memberEligibleForOperatorInvitation } from "@/lib/platform/experience-member-access";
import { markOpsExperienceCalendarPending } from "@/lib/platform/ops-calendar-repository";
import { foundationsBillingScheduleForMonth, parseFoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { AdminEmailError } from "./admin-email-model";
import { requireAdminEmailActor } from "./admin-email-repository";
import { isCadenceKind, isCadenceTrack, cadenceOccurrences, type CadenceKind, type CadenceTrack, type CadenceConfiguration } from "./member-email-cadence-model";
import { readCadenceEvent, sameCadenceEvent, cadenceCallReady, CadenceDeliveryError } from "./member-email-cadence-repository";
import type { CadenceEventSnapshot, CadencePlan } from "./member-email-cadence-types";

export type CadenceEventBinding = { kind: CadenceKind | "none"; track: CadenceTrack; cohortMonth?: string };
type BindingEvent = { kind: string; visibility: string; startsAt: string; registrationMode?: string; registration_mode?: string; timezone?: string; timeZone?: string };
type InheritedPlan = CadencePlan & { inheritanceBinding: CadenceEventBinding };
type Sequence = { id: string; kind: CadenceKind; track: CadenceTrack; revision: number; activatedAt: Date | string; snapshot: CadencePlan; approvedBy: string };

export function normalizeCadenceEventBinding(value: unknown, event: BindingEvent): CadenceEventBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminEmailError(400,"Choose a valid email sequence.");
  const input=value as Record<string,unknown>;
  if ((input.kind!=="none" && !isCadenceKind(input.kind)) || !isCadenceTrack(input.track)
    || Object.keys(input).some(key=>!["kind","track","cohortMonth"].includes(key))) throw new AdminEmailError(400,"Choose a valid email sequence.");
  const kind=input.kind as CadenceEventBinding["kind"],track=input.track;
  const mode=event.registrationMode ?? event.registration_mode;
  if (kind==="none") {
    if (input.cohortMonth) throw new AdminEmailError(400,"An excluded call cannot have an email cohort.");
    return {kind,track};
  }
  if (event.visibility==="public" || mode==="external") throw new AdminEmailError(400,"Member sequences require a private member call.");
  if ((kind.startsWith("foundations_") || track==="founder_test") && (event.visibility!=="invite_only" || mode!=="internal")) {
    throw new AdminEmailError(400,"Foundations and founder tests require a private call with internal invitations.");
  }
  if (kind==="circle" && (event.kind!=="circle_meeting" || event.visibility!=="circle" || track!=="members")) {
    throw new AdminEmailError(400,"Choose the Circle sequence only for a Circle meeting.");
  }
  if (kind==="membership" && (event.kind==="circle_meeting" || event.visibility==="circle")) throw new AdminEmailError(400,"Use the Circle sequence for this meeting.");
  if (kind.startsWith("foundations_") && track==="members") {
    if (typeof input.cohortMonth!=="string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.cohortMonth)
      || input.cohortMonth<"2026-11" || input.cohortMonth>"9998-12") throw new AdminEmailError(400,"Choose the accepted Foundations cohort month.");
    const index=Number(kind.slice(-2))-1;
    const supported=["foundations-prepaid-v1","foundations-prepaid-v2","foundations-prepaid-v3"] as const;
    if ((event.timezone ?? event.timeZone)!=="America/Denver" || !supported.some(version=>
      Date.parse(foundationsBillingScheduleForMonth(input.cohortMonth as string,"monthly",version).callStartsAt[index])===Date.parse(event.startsAt))) {
      throw new AdminEmailError(400,"This call must match its accepted cohort session time.");
    }
    return {kind,track,cohortMonth:input.cohortMonth};
  }
  if (input.cohortMonth) throw new AdminEmailError(400,"Only member Foundations calls use a paid cohort month.");
  return {kind,track};
}

export async function readCadenceEventBinding(tx: TransactionSql,id: string): Promise<CadenceEventBinding|null> {
  const [schema]=await tx`select to_regclass('private.member_email_cadence_event_bindings') is not null as ready`;
  if (!schema?.ready) return null;
  const [row]=await tx<Array<{kind:CadenceEventBinding["kind"];track:CadenceTrack;cohortMonth:string|null}>>`
    select kind,track,cohort_month as "cohortMonth" from private.member_email_cadence_event_bindings where experience_id=${id}::uuid`;
  return row ? {kind:row.kind,track:row.track,...(row.cohortMonth ? {cohortMonth:row.cohortMonth} : {})} : null;
}
export async function saveCadenceEventBinding(tx: TransactionSql,actor: string,eventId: string,value: unknown,event: BindingEvent): Promise<void> {
  if (value===undefined) return;
  const binding=normalizeCadenceEventBinding(value,event);
  await requireAdminEmailActor(tx,actor,true);
  const [schema]=await tx`select to_regclass('private.member_email_cadence_event_bindings') is not null as ready`;
  if (!schema?.ready) throw new AdminEmailError(503,"Email sequence setup must be installed before classifying calls.");
  await tx`insert into private.member_email_cadence_event_bindings(experience_id,kind,track,cohort_month,approved_by)
    values(${eventId}::uuid,${binding.kind},${binding.track},${binding.cohortMonth ?? null},${actor}::uuid)
    on conflict(experience_id) do update set kind=excluded.kind,track=excluded.track,cohort_month=excluded.cohort_month,
      approved_by=excluded.approved_by,updated_at=clock_timestamp()`;
}

async function classification(tx: TransactionSql,event: CadenceEventSnapshot): Promise<CadenceEventBinding|null> {
  const explicit=await readCadenceEventBinding(tx,event.id);
  if (explicit) {
    try { return normalizeCadenceEventBinding(explicit,event); }
    catch (error) { if (error instanceof AdminEmailError) return null; throw error; }
  }
  if (event.kind==="weekly_call" && ["all_members","block","progression"].includes(event.visibility)) return {kind:"membership",track:"members"};
  if (event.kind==="circle_meeting" && event.visibility==="circle") return {kind:"circle",track:"members"};
  return null;
}
const sameBinding=(a:CadenceEventBinding|undefined|null,b:CadenceEventBinding)=>Boolean(a && a.kind===b.kind && a.track===b.track && (a.cohortMonth ?? null)===(b.cohortMonth ?? null));

/** Lists semantic matches only. Neither titles nor calendar coincidences classify a call. */
export async function matchingCadenceEvents(tx: TransactionSql,kind: CadenceKind,track: CadenceTrack,deadline=Infinity): Promise<CadenceEventSnapshot[]> {
  const candidates=await tx<Array<{id:string}>>`select event.id from experiences event
    left join private.member_email_cadence_event_bindings binding on binding.experience_id=event.id
    where event.status='published' and event.cancelled_at is null and event.starts_at>statement_timestamp()
      and event.ends_at>event.starts_at and event.visibility<>'public' and event.registration_mode<>'external'
      and ((binding.kind=${kind} and binding.track=${track}) or (binding.experience_id is null and ${track}='members'
        and ((${kind}='membership' and event.kind='weekly_call' and event.visibility in ('all_members','block','progression'))
          or (${kind}='circle' and event.kind='circle_meeting' and event.visibility='circle'))))
    order by event.starts_at,event.id limit 251`;
  if (candidates.length>250) throw new CadenceDeliveryError("matching_calls_exceed_review_limit",true);
  const result:CadenceEventSnapshot[]=[];
  for (const item of candidates) {
    if (Date.now()>=deadline) break;
    const event=await readCadenceEvent(tx,item.id);
    if (!event) continue;
    const binding=await classification(tx,event);
    if (binding?.kind===kind && binding.track===track) result.push(event);
  }
  return result;
}

/** Creates invitations only; existing confirmed, waitlisted and cancelled choices are never rewritten. */
async function enrollPaidCohort(tx: TransactionSql,event: CadenceEventSnapshot,binding: CadenceEventBinding,sequence: Sequence,deadline: number): Promise<number> {
  if (!binding.kind.startsWith("foundations_") || binding.track!=="members" || !binding.cohortMonth) return 0;
  const index=Number(binding.kind.slice(-2))-1;
  const candidates=await tx<Array<{memberId:string}>>`select registration.member_id as "memberId" from member_registration_access registration
    join membership_commercial_reservations reservation on reservation.id=private.ruined_member_paid_reservation(registration.member_id)
    where registration.registered_at is not null and reservation.billing_schedule->>'cohortMonth'=${binding.cohortMonth}
      and (reservation.billing_schedule->'callStartsAt'->>${index}::integer)::timestamptz=${event.startsAt}::timestamptz
      and not exists(select 1 from experience_registrations roster where roster.experience_id=${event.id}::uuid and roster.member_id=registration.member_id)
    order by registration.member_id limit 501`;
  if (candidates.length>500) throw new CadenceDeliveryError("roster_exceeds_review_limit",true);
  let enrolled=0;
  for (const candidate of candidates) {
    if (Date.now()>=deadline) break;
    await tx`select private.ruined_lock_member_complimentary_funding(${candidate.memberId}::uuid)`;
    await tx`select private.ruined_lock_member_operator_funding(${candidate.memberId}::uuid)`;
    const [member]=await tx<Array<{personId:string}>>`select person_id as "personId" from ruined_members where id=${candidate.memberId}::uuid for update`;
    if (!member) continue;
    const existing=await tx`select id from experience_registrations where experience_id=${event.id}::uuid and person_id=${member.personId}::uuid for update`;
    if (existing.length) continue;
    const [paid]=await tx<Array<{id:string;billingPlan:"monthly"|"annual";schedule:unknown}>>`
      select reservation.id,reservation.billing_plan as "billingPlan",reservation.billing_schedule as schedule
      from member_registration_access registration
      join membership_commercial_reservations reservation on reservation.id=private.ruined_member_paid_reservation(registration.member_id)
      join membership_commercial_participants participant on participant.reservation_id=reservation.id and participant.member_id=registration.member_id
      join stripe_membership_prepaid_proofs proof on proof.reservation_id=reservation.id
      join stripe_checkout_attempts attempt on attempt.id=reservation.id
      join stripe_checkout_sessions checkout on checkout.id=attempt.stripe_session_id
      join stripe_membership_commitments contract on contract.id=proof.contract_id
      join stripe_subscriptions subscription on subscription.id=proof.stripe_subscription_id
      join stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
      where registration.member_id=${candidate.memberId}::uuid and registration.registered_at is not null
      for share of registration,reservation,participant,proof,attempt,checkout,contract,subscription,invoice`;
    const schedule=paid ? parseFoundationsBillingSchedule(paid.schedule,paid.billingPlan) : null;
    if (!schedule || schedule.cohortMonth!==binding.cohortMonth || schedule.callStartsAt[index]!==event.startsAt) continue;
    const [proof]=await tx<Array<{id:string|null}>>`select private.ruined_member_paid_reservation(${candidate.memberId}::uuid) as id`;
    if (proof?.id!==paid.id || !await memberEligibleForOperatorInvitation(tx,event,candidate.memberId,sequence.approvedBy)) continue;
    const [capacity]=await tx<Array<{available:boolean}>>`select (capacity is null or capacity>(select count(*) from experience_registrations where experience_id=${event.id}::uuid and status='registered')) as available from experiences where id=${event.id}::uuid`;
    if (!capacity?.available || Date.now()>=deadline) continue;
    const [created]=await tx<Array<{id:string}>>`insert into experience_registrations(experience_id,person_id,member_id,status,source,metadata)
      values(${event.id}::uuid,${member.personId}::uuid,${candidate.memberId}::uuid,'registered','ops',
        ${tx.json({source:"member_email_sequence",sequenceId:sequence.id,cohortMonth:binding.cohortMonth,reservationId:paid.id})}::jsonb)
      on conflict(experience_id,person_id) do nothing returning id`;
    if (!created) continue;
    const reason="Enrolled from the member's accepted paid Foundations cohort.";
    await tx`insert into experience_registration_events(registration_id,experience_id,person_id,previous_status,next_status,source,actor_auth_user_id,reason,dedupe_key)
      values(${created.id}::uuid,${event.id}::uuid,${member.personId}::uuid,null,'registered','ops',${sequence.approvedBy}::uuid,${reason},${`cadence-cohort:${created.id}`})`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,reason,metadata,dedupe_key)
      values(${sequence.approvedBy}::uuid,'experience.registration_registered','experience_registration',${created.id},${candidate.memberId}::uuid,${reason},
        ${tx.json({experienceId:event.id,sequenceId:sequence.id,cohortMonth:binding.cohortMonth})}::jsonb,${`cadence-cohort:${created.id}`})`;
    enrolled++;
  }
  if (enrolled) await markOpsExperienceCalendarPending(tx,{actorAuthUserId:sequence.approvedBy,experienceId:event.id,reason:"attendees"});
  return enrolled;
}

/** Runs only behind the worker's enablement/configuration gates. It never calls a provider. */
export async function reconcileCadenceInheritance(configuration: CadenceConfiguration,deadline: number): Promise<{plans:number;enrolled:number}> {
  const result={plans:0,enrolled:0};
  if (!configuration.enabled || !configuration.ready || !configuration.activatedAt || Date.parse(configuration.activatedAt)>Date.now() || Date.now()>=deadline) return result;
  const sql=getApplicationDatabase();
  const sequences=await sql<Sequence[]>`select id,kind,track,revision,activated_at as "activatedAt",snapshot,approved_by as "approvedBy"
    from private.member_email_cadence_sequences where active order by id`;
  for (const source of sequences) {
    if (Date.now()>=deadline) break;
    const events=await matchingCadenceEvents(sql as unknown as TransactionSql,source.kind,source.track,deadline);
    for (const expectedEvent of events) {
      if (Date.now()>=deadline) break;
      try {
        const changes=await sql.begin(async tx=>{
          await tx`set local lock_timeout='3s'`;
          await tx`set local statement_timeout='10s'`;
          // Share the manual-approval lock before observing plan ownership.
          await tx`select pg_advisory_xact_lock(hashtext(${`member-email-cadence:${expectedEvent.id}`}))`;
          await tx`select pg_advisory_xact_lock(hashtext(${expectedEvent.id}),48)`;
          const [existing]=await tx<Array<{id:string;active:boolean;sequenceId:string|null;sequenceRevision:number|null;snapshot:InheritedPlan}>>`
            select id,active,sequence_id as "sequenceId",sequence_revision as "sequenceRevision",snapshot
            from private.member_email_cadence_plans where experience_id=${expectedEvent.id}::uuid for update`;
          if (existing && (!existing.active || existing.sequenceId!==source.id)) return {plans:0,enrolled:0};
          const [sequence]=await tx<Sequence[]>`select id,kind,track,revision,activated_at as "activatedAt",snapshot,approved_by as "approvedBy"
            from private.member_email_cadence_sequences where id=${source.id}::uuid and active and revision=${source.revision} for share`;
          if (!sequence) return {plans:0,enrolled:0};
          await requireAdminEmailActor(tx,sequence.approvedBy,true);
          // Serialize cohort capacity/admission with the existing operator roster path.
          await tx`select id from experiences where id=${expectedEvent.id}::uuid for update`;
          const event=await readCadenceEvent(tx,expectedEvent.id,true);
          if (!event || !sameCadenceEvent(event,expectedEvent) || !await cadenceCallReady(tx,event.id,true)) return {plans:0,enrolled:0};
          await tx`select experience_id from private.member_email_cadence_event_bindings where experience_id=${event.id}::uuid for share`;
          const binding=await classification(tx,event);
          if (!binding || binding.kind!==sequence.kind || binding.track!==sequence.track
            || (existing && (!sameCadenceEvent(event,existing.snapshot.event) || !sameBinding(existing.snapshot.inheritanceBinding,binding)))) return {plans:0,enrolled:0};
          if (Date.now()>=deadline || !cadenceOccurrences(event,sequence.kind,sequence.track).some(item=>Date.parse(item.dueAt)>Date.now())) return {plans:0,enrolled:0};
          let plans=0;
          if (!existing || existing.sequenceRevision!==sequence.revision) {
            const plan:InheritedPlan={...sequence.snapshot,eventId:event.id,event,kind:sequence.kind,track:sequence.track,inheritanceBinding:binding};
            if (existing) await tx`update private.member_email_cadence_plans set snapshot=${tx.json(plan)}::jsonb,
              sequence_revision=${sequence.revision},revision=revision+1,activated_at=clock_timestamp(),approved_by=${sequence.approvedBy}::uuid,updated_at=clock_timestamp() where id=${existing.id}::uuid`;
            else {
              const created=await tx`insert into private.member_email_cadence_plans(experience_id,active,snapshot,approved_by,sequence_id,sequence_revision)
                values(${event.id}::uuid,true,${tx.json(plan)}::jsonb,${sequence.approvedBy}::uuid,${sequence.id}::uuid,${sequence.revision})
                on conflict(experience_id) do nothing returning id`;
              if (!created.length) return {plans:0,enrolled:0};
            }
            plans++;
          }
          return {plans,enrolled:await enrollPaidCohort(tx,event,binding,sequence,deadline)};
        });
        result.plans+=changes.plans;result.enrolled+=changes.enrolled;
      } catch(error) {
        if (!(error instanceof AdminEmailError && error.status===403)) throw error;
      }
    }
  }
  return result;
}
