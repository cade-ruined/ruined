import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import type { RegistrationCompletionBasis, RegistrationMessageKind } from "./registration-email";
import type { RegistrationFoundingPricing } from "./registration-model";
import type { RegistrationPaidMembership } from "./registration-paid-confirmation";

export type RegistrationEmailPayload = {
  from: string; to: string; replyTo: string; subject: string; html: string; text: string;
  attachments?: Array<{ content: string; filename: string; contentId: string }>;
};
/** Invitation identity is frozen at issue time, rather than read from today's
 * member profile. No invitation token or recipient email is exposed to art. */
export type RegistrationAcceptedInvitation = {
  owner_member_id: string | null;
  origin: "member" | "ruined_direct";
  recipient_name: string;
  inviter_name: string;
  inviter_tag: string | null;
  issued_at: string;
  expires_at: string | null;
};
export type RegistrationMessageClaim = {
  id: string; member_id: string; kind: RegistrationMessageKind; attempts: number;
  first_send_attempt_at: Date | string | null;
};
export type RegistrationMessageDelivery = RegistrationMessageClaim & {
  email: string; member_name: string; completion_basis: RegistrationCompletionBasis;
  delivery_payload: RegistrationEmailPayload | null; eligible: boolean; registration_ready: boolean;
  accepted_invitation: RegistrationAcceptedInvitation | null;
  founding_pricing: RegistrationFoundingPricing | null;
  paid_membership: RegistrationPaidMembership | null;
  paid_reservation_id: string | null;
  delivery_payment_reservation_id: string | null;
};

export class RegistrationDeliveryError extends Error {
  constructor(readonly code: string, readonly terminal = false) { super(code); }
}

export async function claimRegistrationMessage(lease: string, memberId?: string): Promise<RegistrationMessageClaim | null> {
  const sql = getApplicationDatabase();
  const [claim] = await sql<RegistrationMessageClaim[]>`
    with candidate as (
      select id from member_registration_messages
      where (${memberId ?? null}::uuid is null or member_id=${memberId ?? null}::uuid)
        and ((status in ('pending','failed') and available_at<=clock_timestamp())
          or (status='sending' and locked_at<clock_timestamp()-interval '5 minutes'))
      order by available_at, created_at, id limit 1 for update skip locked
    )
    update member_registration_messages message
    set status='sending',attempts=attempts+1,locked_at=clock_timestamp(),lock_token=${lease}::uuid,updated_at=clock_timestamp()
    from candidate where message.id=candidate.id
    returning message.id,member_id,kind,attempts,first_send_attempt_at
  `;
  return claim ?? null;
}

/** Match member deletion/activation lock order. The final send rechecks under
 * these locks so a withdrawn account cannot race an already prepared message. */
export async function withRegistrationMessage<T>(claim: RegistrationMessageClaim, lease: string,
  action: (tx: TransactionSql, delivery: RegistrationMessageDelivery) => Promise<T>) {
  const sql = getApplicationDatabase();
  return sql.begin(async tx => {
    await tx`select private.ruined_lock_member_complimentary_funding(${claim.member_id}::uuid)`;
    await tx`select id from ruined_members where id=${claim.member_id}::uuid for update`;
    await tx`select member_id from member_lifecycle where member_id=${claim.member_id}::uuid for share`;
    await tx`select person.id from people person join ruined_members member on member.person_id=person.id
      where member.id=${claim.member_id}::uuid for share of person`;
    await tx`select email.id from person_email_addresses email join ruined_members member on member.person_id=email.person_id
      where member.id=${claim.member_id}::uuid and email.email_normalized=member.email_normalized for share of email`;
    await tx`select member_id from member_registration_access where member_id=${claim.member_id}::uuid for update`;
    const [delivery] = await tx<RegistrationMessageDelivery[]>`
      select message.*, member.email_normalized as email,
        coalesce(nullif(btrim(private_profile.legal_name),''),nullif(btrim(profile.display_name),''),'Friend') as member_name,
        registration.completion_basis,
        proof.reservation_id as paid_reservation_id,
        case when registration.completion_basis='paid_membership' and proof.reservation_id is not null
          and private.ruined_registration_paid_reservation(member.id)=proof.reservation_id
          then jsonb_build_object('offerId',contract.terms_snapshot->>'offerId',
            'billingPlan',contract.terms_snapshot->>'billingPlan','amountPaidCents',proof.amount_paid,
            'duesAmountCents',proof.dues_amount,'currency',proof.currency,'paidAt',invoice.paid_at,
            'billingSchedule',reservation.billing_schedule,'agreementVersion',contract.terms_snapshot->>'agreementVersion',
            'initialTermAmountCents',contract.terms_snapshot->'totalInitialDues',
            'buyoutCapCents',contract.terms_snapshot->'buyoutCap','isPayer',proof.member_id=member.id)
          else null end as paid_membership,
        case when pricing.founding_eligible and pricing.completion_basis='saved_card'
          and private.ruined_registration_founding_pricing_is_current(member.id)
          then jsonb_build_object('confirmed',true,'awardedAt',pricing.decided_at,
            'monthlyAmountCents',pricing.monthly_amount_cents,'annualAmountCents',pricing.annual_amount_cents,'currency',pricing.currency)
          else null end as founding_pricing,
        case when invitation.id is null then null else jsonb_build_object(
          'owner_member_id',invitation.member_id,'origin',invitation.origin,
          'recipient_name',invitation.recipient_name,'inviter_name',invitation.inviter_name,
          'inviter_tag',invitation.inviter_tag,'issued_at',invitation.issued_at,'expires_at',invitation.expires_at
        ) end as accepted_invitation,
        private.ruined_member_registration_ready(message.member_id) as registration_ready,
        coalesce(member.deleted_at is null and person.status='active' and lifecycle.account_state not in ('closed','suspended')
          and registration.registered_at is not null
          and registration.completion_basis in ('saved_card','complimentary','paid_membership')
          and exists(select 1 from person_email_addresses email where email.person_id=member.person_id
            and email.email_normalized=member.email_normalized and email.verification_state='verified' and email.retired_at is null)
          and case when message.kind='welcome' then registration.profile_activated_at is null
            else registration.profile_activated_at is not null end,false) as eligible
      from member_registration_messages message
      left join ruined_members member on member.id=message.member_id
      left join member_lifecycle lifecycle on lifecycle.member_id=member.id
      left join people person on person.id=member.person_id
      left join person_profiles profile on profile.person_id=member.person_id
      left join person_private_profiles private_profile on private_profile.person_id=member.person_id
      left join member_registration_access registration on registration.member_id=member.id
      left join member_registration_pricing_decisions pricing on pricing.member_id=member.id
      -- Registration keeps its historical first-payment reference. An unprepared
      -- welcome follows the currently verified payment after a refund/rejoin.
      left join membership_commercial_reservations reservation on reservation.id=private.ruined_registration_paid_reservation(member.id)
      left join stripe_membership_prepaid_proofs proof on proof.reservation_id=reservation.id
      left join stripe_membership_commitments contract on contract.id=proof.contract_id
      left join stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
      -- Acceptance belongs to this member, not merely to an email address or
      -- the most recently created invitation. An expired accepted card remains
      -- a keepsake; this lookup never renews its deadline or grants access.
      left join lateral (
        select id,member_id,origin,recipient_name,inviter_name,inviter_tag,issued_at,expires_at
        from member_personal_invitations
        where accepted_member_id=member.id and accepted_at is not null
        order by accepted_at,issued_at,id limit 1
      ) invitation on true
      where message.id=${claim.id}::uuid and message.status='sending' and message.lock_token=${lease}::uuid
      for update of message
    `;
    if (!delivery) return { kind: "deferred" as const };
    if (!delivery.eligible) {
      await tx`update member_registration_messages set status='cancelled',last_error='registration_unavailable',
        locked_at=null,lock_token=null,updated_at=clock_timestamp() where id=${claim.id}::uuid`;
      return { kind: "cancelled" as const };
    }
    if (delivery.kind==="welcome" && delivery.completion_basis==="paid_membership"
      && (delivery.delivery_payload || delivery.first_send_attempt_at)
      && (!delivery.delivery_payment_reservation_id || !delivery.paid_membership
        || delivery.delivery_payment_reservation_id!==delivery.paid_reservation_id)) {
      // Frozen bytes may already have reached the provider. Never replace their
      // receipt or retry an obsolete paid confirmation under that same key.
      await tx`update member_registration_messages set status='manual_review',last_error='paid_receipt_changed_requires_review',
        locked_at=null,lock_token=null,updated_at=clock_timestamp() where id=${claim.id}::uuid`;
      return { kind: "manualReview" as const };
    }
    if (delivery.kind==="welcome" && (!delivery.registration_ready
      || delivery.completion_basis==="paid_membership" && !delivery.paid_membership)) {
      // Withdrawing saved-card consent may temporarily make the registration
      // incomplete. Refunded or unverified upfront payment cannot produce a
      // paid welcome either. Wait rather than announce a saved card or payment or
      // consume a delivery attempt; deleted/closed accounts are cancelled above.
      await tx`update member_registration_messages set status='pending',last_error='registration_incomplete',
        attempts=greatest(0,attempts-1),available_at=clock_timestamp()+interval '15 minutes',
        locked_at=null,lock_token=null,updated_at=clock_timestamp() where id=${claim.id}::uuid`;
      return { kind: "deferred" as const };
    }
    return { kind: "ok" as const, value: await action(tx, delivery) };
  });
}

export async function preserveRegistrationMessage(tx: TransactionSql, id: string, payload: RegistrationEmailPayload,
  paymentReservationId: string | null = null) {
  await tx`update member_registration_messages set delivery_payload=${tx.json(payload)}::jsonb,
    delivery_payment_reservation_id=${paymentReservationId}::uuid,
    first_send_attempt_at=coalesce(first_send_attempt_at,clock_timestamp()),updated_at=clock_timestamp()
    where id=${id}::uuid`;
}

export async function completeRegistrationMessage(tx: TransactionSql, id: string, providerId: string) {
  await tx`update member_registration_messages set status='sent',sent_at=clock_timestamp(),
    provider_message_id=${providerId},last_error=null,locked_at=null,lock_token=null,updated_at=clock_timestamp()
    where id=${id}::uuid`;
}

export async function failRegistrationMessage(claim: RegistrationMessageClaim, lease: string,
  code: string, terminal: boolean): Promise<"failed" | "manualReview" | "deferred"> {
  const sql = getApplicationDatabase();
  const delay = Math.min(3600,60*2**Math.min(claim.attempts-1,5));
  const [row] = await sql<Array<{ status: string }>>`
    update member_registration_messages
    set status=case when ${terminal} or attempts>=5
        or first_send_attempt_at<clock_timestamp()-interval '23 hours' then 'manual_review' else 'failed' end,
      available_at=clock_timestamp()+${delay}*interval '1 second',last_error=${code},
      locked_at=null,lock_token=null,updated_at=clock_timestamp()
    where id=${claim.id}::uuid and status='sending' and lock_token=${lease}::uuid returning status
  `;
  return !row ? "deferred" : row.status === "manual_review" ? "manualReview" : "failed";
}
