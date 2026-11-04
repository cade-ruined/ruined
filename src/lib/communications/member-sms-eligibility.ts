import "server-only";
import type { Sql, TransactionSql } from "postgres";

/** Funding follows canonical live evidence, not Stripe's legacy membership_state.
 * Prepaid/onboarding members may receive their specifically permitted calls. */
export function memberSmsFundedEligibilitySql(sql: Sql | TransactionSql, memberId: ReturnType<TransactionSql>) {
  return sql`exists(select 1 from ruined_members sms_member
    join people sms_person on sms_person.id=sms_member.person_id and sms_person.status='active'
    join member_lifecycle sms_lifecycle on sms_lifecycle.member_id=sms_member.id
    where sms_member.id=${memberId} and sms_member.deleted_at is null
      and sms_lifecycle.account_state='active'
      and (sms_lifecycle.standing_state in ('pre_active','active') or (sms_lifecycle.standing_state='cancellation_requested'
        and sms_lifecycle.cancellation_effective_at>statement_timestamp()))
      and private.ruined_member_profile_released(sms_member.id)
      and exists(select 1 from platform_users sms_account join platform_role_grants sms_role on sms_role.auth_user_id=sms_account.auth_user_id
        and sms_role.role_slug='member' and sms_role.revoked_at is null
        where sms_account.person_id=sms_member.person_id and (sms_account.member_id is null or sms_account.member_id=sms_member.id)
          and sms_account.status='active' and sms_account.email_normalized=sms_member.email_normalized)
      and exists(select 1 from person_email_addresses sms_email where sms_email.person_id=sms_member.person_id
        and sms_email.email_normalized=sms_member.email_normalized and sms_email.verification_state='verified' and sms_email.retired_at is null)
      and (private.ruined_member_has_complimentary_funding(sms_member.id)
        or (coalesce(private.ruined_member_shared_billing_state(sms_member.id),sms_lifecycle.billing_state)='active'
          and not coalesce((select subscription.stripe_status in ('canceled','incomplete_expired')
              or (subscription.cancel_at is not null and subscription.cancel_at<=statement_timestamp())
              or exists(select 1 from membership_enrollment_episodes episode where episode.reservation_id=reservation.id
                and episode.member_id=sms_member.id and episode.ended_at is not null)
            from membership_commercial_participants participant join membership_commercial_reservations reservation
              on reservation.id=participant.reservation_id and reservation.status='activated'
            join stripe_subscriptions subscription on subscription.id=reservation.stripe_subscription_id
            where participant.member_id=sms_member.id order by reservation.created_at desc limit 1),false))
        or exists(select 1 from membership_commercial_reservations prepaid_reservation
          join stripe_subscriptions prepaid_subscription on prepaid_subscription.id=prepaid_reservation.stripe_subscription_id
          join member_lifecycle prepaid_payer on prepaid_payer.member_id=prepaid_reservation.payer_member_id
          where prepaid_reservation.id=private.ruined_member_paid_reservation(sms_member.id)
            and prepaid_payer.account_state not in ('closed','suspended')
            and prepaid_payer.standing_state in ('pre_active','active','cancellation_requested')
            and (prepaid_payer.standing_state<>'cancellation_requested' or prepaid_payer.cancellation_effective_at>statement_timestamp())
            and (prepaid_subscription.cancel_at is null or prepaid_subscription.cancel_at>statement_timestamp())
            and not exists(select 1 from membership_enrollment_episodes prepaid_episode
              where prepaid_episode.reservation_id=prepaid_reservation.id and prepaid_episode.member_id=sms_member.id
                and prepaid_episode.ended_at is not null))))`;
}
/** Called after the number advisory lock and before member/lifecycle locks.
 * Normal refund writers take member/lifecycle locks first. We then retain all
 * mutable provider evidence through dispatch and re-evaluate the predicate. */
export async function lockMemberSmsFunding(tx: TransactionSql, memberId: string): Promise<void> {
  await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`;
  await tx`select id from ruined_members where id=${memberId}::uuid for no key update`;
  await tx`select member_id from member_lifecycle where member_id=${memberId}::uuid for share`;
  await tx`select person.id from people person join ruined_members member on member.person_id=person.id
    where member.id=${memberId}::uuid for share of person`;
  await tx`select account.auth_user_id from platform_users account join ruined_members member on member.person_id=account.person_id
    where member.id=${memberId}::uuid for share of account`;
  await tx`select role.auth_user_id from platform_role_grants role join platform_users account on account.auth_user_id=role.auth_user_id
    join ruined_members member on member.person_id=account.person_id where member.id=${memberId}::uuid and role.role_slug='member' for share of role`;
  await tx`select email.email_normalized from person_email_addresses email join ruined_members member on member.person_id=email.person_id
    where member.id=${memberId}::uuid for share of email`;
  await tx`select member_id from member_registration_access where member_id=${memberId}::uuid for share`;
  // Covers individual and shared subscriptions without assuming the recipient is the payer.
  await tx`select reservation.id from membership_commercial_participants participant
    join membership_commercial_reservations reservation on reservation.id=participant.reservation_id
    join stripe_subscriptions subscription on subscription.id=reservation.stripe_subscription_id
    join member_lifecycle payer on payer.member_id=reservation.payer_member_id
    where participant.member_id=${memberId}::uuid order by reservation.id
    for share of participant,reservation,subscription,payer`;
  await tx`select member_id from membership_enrollment_episodes where member_id=${memberId}::uuid for share`;
  const [paid]=await tx<Array<{id:string|null}>>`select private.ruined_member_paid_reservation(${memberId}::uuid) as id`;
  if (!paid?.id) return;
  await tx`select proof.reservation_id from stripe_membership_prepaid_proofs proof
    join membership_commercial_reservations reservation on reservation.id=proof.reservation_id
    join stripe_membership_commitments contract on contract.id=proof.contract_id
    join stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
    join stripe_subscriptions subscription on subscription.id=proof.stripe_subscription_id
    join stripe_checkout_attempts attempt on attempt.id=reservation.id
    where proof.reservation_id=${paid.id}::uuid for share of proof,reservation,contract,invoice,subscription,attempt`;
  await tx`select checkout.id from stripe_checkout_sessions checkout join stripe_checkout_attempts attempt on attempt.stripe_session_id=checkout.id
    where attempt.id=${paid.id}::uuid for share of checkout`;
  await tx`select payment.attempt_id from operator_membership_saved_payments payment join stripe_checkout_attempts attempt on attempt.id=payment.attempt_id
    where attempt.id=${paid.id}::uuid for share of payment`;
  await tx`select authority.id from operator_membership_authorizations authority join stripe_checkout_attempts attempt on attempt.operator_authorization_id=authority.id
    where attempt.id=${paid.id}::uuid for share of authority`;
}
export async function memberSmsFundedEligible(tx: Sql | TransactionSql, memberId:string):Promise<boolean> {
  const [row]=await tx<Array<{eligible:boolean}>>`select ${memberSmsFundedEligibilitySql(tx,tx`${memberId}::uuid`)} as eligible`;
  return row?.eligible===true;
}
