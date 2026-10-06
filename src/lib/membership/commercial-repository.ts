import "server-only";

import type postgres from "postgres";
import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { getApplicationDatabase } from "@/lib/database/server";
import type { MembershipBillingPlan, MembershipOfferId, MembershipOfferTier } from "@/lib/membership/pricing";

export type CommercialTransaction = postgres.TransactionSql;
type CommercialSql = postgres.Sql | CommercialTransaction;
export type CommercialMembershipKind = "individual" | "couple";
export type CommercialMembershipParticipant = {
  memberId: string; personId: string; ordinal: number; foundingEligible: boolean; name: string;
};
export type CommercialMembershipReservation = {
  id: string; memberId: string; kind: CommercialMembershipKind; tier: MembershipOfferTier;
  plan: MembershipBillingPlan; offerId: MembershipOfferId; status: "reserved" | "activated" | "released";
  occupiedCountAtDecision: number; expiresAt: Date; stripeSubscriptionId: string | null;
  stripePriceId: string | null; coupleAuthorizationId: string | null; firstChargeAt: Date | null; billingSchedule: FoundationsBillingSchedule | null;
  participants: CommercialMembershipParticipant[];
};
export type CoupleMembershipAuthorization = {
  id: string; memberId: string; partnerMemberId: string; acceptedAt: Date | null;
  expiresAt: Date; revokedAt: Date | null;
};
export type CommercialEnrollment = {
  id: string; memberId: string; personId: string; reservationId: string | null;
  foundingEligible: boolean; source: "existing" | "paid" | "complimentary" | "couple";
  startedAt: Date; endedAt: Date | null; cancellationEffectiveAt: Date | null;
  billingAttentionAt: Date | null; endReason: string | null;
};
export class CommercialMembershipError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: "founding_place_pending" | "membership_offer_unavailable" = "membership_offer_unavailable") {
    super(message); this.name = "CommercialMembershipError";
  }
}
function database(tx?: CommercialSql) { return tx ?? getApplicationDatabase(); }
function date(value: Date | string) { return value instanceof Date ? value : new Date(value); }
function nullableDate(value: Date | string | null) { return value === null ? null : date(value); }
async function transaction<T>(tx: CommercialTransaction | undefined, work: (sql: CommercialTransaction) => Promise<T>): Promise<T> {
  if (tx) return work(tx);
  return await getApplicationDatabase().begin(work) as T;
}
async function translate<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    const known = error as { code?: string; message?: string };
    if (known.code === "40001") throw new CommercialMembershipError(409, "Your membership or Circle placement changed. Please try again.");
    if (known.code?.startsWith("P42")) throw new CommercialMembershipError(known.code === "P4200" ? 400 : 409,
      known.message ?? "This membership offer is unavailable.", known.code === "P4205" ? "founding_place_pending" : "membership_offer_unavailable");
    throw error;
  }
}

export async function getCommercialMembershipReservation(id: string, tx?: CommercialSql): Promise<CommercialMembershipReservation | null> {
  const sql = database(tx);
  const [row] = await sql<Array<{
    id: string; payer_member_id: string; kind: CommercialMembershipKind; tier: MembershipOfferTier;
    billing_plan: MembershipBillingPlan; status: CommercialMembershipReservation["status"];
    occupied_count_at_decision: number; expires_at: Date; stripe_subscription_id: string | null;
    stripe_price_id: string | null; couple_authorization_id: string | null; first_charge_at: Date | null; billing_schedule: FoundationsBillingSchedule | null;
  }>>`select * from membership_commercial_reservations where id = ${id}::uuid`;
  if (!row) return null;
  const participants = await sql<Array<{ member_id: string; person_id: string; ordinal: number; founding_eligible: boolean; name_snapshot: string }>>`
    select member_id, person_id, ordinal, founding_eligible, name_snapshot from membership_commercial_participants
    where reservation_id = ${id}::uuid order by ordinal`;
  return {
    id: row.id, memberId: row.payer_member_id, kind: row.kind, tier: row.tier, plan: row.billing_plan,
    offerId: `${row.tier}_${row.billing_plan}`, status: row.status,
    occupiedCountAtDecision: row.occupied_count_at_decision, expiresAt: date(row.expires_at),
    stripeSubscriptionId: row.stripe_subscription_id, stripePriceId: row.stripe_price_id,
    coupleAuthorizationId: row.couple_authorization_id, firstChargeAt: nullableDate(row.first_charge_at ?? null), billingSchedule: row.billing_schedule ?? null,
    participants: participants.map(person => ({ memberId: person.member_id, personId: person.person_id,
      ordinal: person.ordinal, foundingEligible: person.founding_eligible, name: person.name_snapshot })),
  };
}

export async function getCurrentCommercialMembershipReservation(memberId: string, tx?: CommercialSql) {
  const sql = database(tx);
  const [row] = await sql<Array<{ id: string }>>`select id from membership_commercial_reservations
    where payer_member_id = ${memberId}::uuid and status = 'reserved' order by created_at limit 1`;
  return row ? getCommercialMembershipReservation(row.id, sql) : null;
}

/** Hold this lock until the billing attempt is inserted in the SAME transaction.
 * It serializes quote replacement, founder claims, and billing consent binding.
 * Always persist stripe_checkout_attempts before contacting Stripe.
 */
export async function lockCommercialMembershipReservation(id: string, tx: CommercialTransaction) {
  await tx`select private.ruined_reconcile_commercial_memberships()`;
  await tx`select private.ruined_validate_commercial_reservation(${id}::uuid)`;
  return getCommercialMembershipReservation(id, tx);
}

export async function reserveCommercialMembership(input: {
  requestId: string; memberId: string; kind: CommercialMembershipKind; plan: MembershipBillingPlan;
  partnerMemberId?: string; coupleAuthorizationId?: string; expiresAt: Date; firstChargeAt?: Date | null; billingSchedule?: FoundationsBillingSchedule | null;
}, tx?: CommercialTransaction): Promise<CommercialMembershipReservation> {
  return translate(() => transaction(tx, async sql => {
    const [row] = await sql<Array<{ id: string }>>`select private.ruined_reserve_commercial_membership(
      ${input.requestId}::uuid, ${input.memberId}::uuid, ${input.kind}, ${input.plan},
      ${input.partnerMemberId ?? null}::uuid, ${input.coupleAuthorizationId ?? null}::uuid,
      ${input.expiresAt}::timestamptz) as id`;
    if (row) await sql`update membership_commercial_reservations
      set first_charge_at=${input.firstChargeAt ?? null},billing_schedule=${input.billingSchedule ? sql.json(JSON.parse(JSON.stringify(input.billingSchedule))) : null}::jsonb,billing_schedule_bound_at=clock_timestamp()
      where id=${row.id}::uuid and billing_schedule_bound_at is null`;
    const reservation = row ? await getCommercialMembershipReservation(row.id, sql) : null;
    if (!reservation) throw new CommercialMembershipError(409, "Membership offer could not be reserved.");
    return reservation;
  }));
}

export async function bindCommercialMembershipPrice(input: { reservationId: string; stripePriceId: string }, tx?: CommercialTransaction) {
  if (!/^price_[A-Za-z0-9_]+$/.test(input.stripePriceId)) throw new CommercialMembershipError(400, "Invalid membership price.");
  return transaction(tx, async sql => {
    const reservation = await lockCommercialMembershipReservation(input.reservationId, sql);
    if (!reservation || reservation.status !== "reserved" ||
      (reservation.stripePriceId && reservation.stripePriceId !== input.stripePriceId)) {
      throw new CommercialMembershipError(409, "This membership offer is no longer available.");
    }
    await sql`update membership_commercial_reservations set stripe_price_id = ${input.stripePriceId}
      where id = ${input.reservationId}::uuid and stripe_price_id is null`;
    return { ...reservation, stripePriceId: input.stripePriceId };
  });
}

export async function activateCommercialMembership(input: { reservationId: string; stripeSubscriptionId: string }, tx?: CommercialTransaction) {
  return translate(() => transaction(tx, async sql => {
    await sql`select private.ruined_activate_commercial_membership(${input.reservationId}::uuid, ${input.stripeSubscriptionId})`;
    return getCommercialMembershipReservation(input.reservationId, sql);
  }));
}

export async function releaseCommercialMembershipReservation(input: {
  reservationId: string; reason: "checkout_expired" | "checkout_failed" | "before_checkout_abandoned";
}, tx?: CommercialTransaction): Promise<void> {
  return translate(() => transaction(tx, async sql => {
    await sql`select private.ruined_release_commercial_membership(${input.reservationId}::uuid, ${input.reason})`;
  }));
}

/** Called only after the verified subscription projection records a canceled,
 * unpaid scheduled subscription. Does not release an active paid enrollment. */
export async function releaseScheduledCommercialMembership(input: {
  reservationId: string; stripeSubscriptionId: string; canceledAt: Date;
}, tx?: CommercialTransaction): Promise<void> {
  return translate(() => transaction(tx, async sql => {
    await sql`select private.ruined_release_scheduled_membership(${input.reservationId}::uuid, ${input.stripeSubscriptionId}, ${input.canceledAt})`;
  }));
}

/** A verified canceled subscription and full succeeded prestart refund are required.
 * Keep the reserved place while refund/provider state is unresolved. */
export async function releasePrepaidCommercialMembership(input: {
  reservationId: string; stripeSubscriptionId: string; canceledAt: Date;
}, tx?: CommercialTransaction): Promise<void> {
  return translate(() => transaction(tx, async sql => {
    await sql`select private.ruined_release_prepaid_membership(${input.reservationId}::uuid, ${input.stripeSubscriptionId}, ${input.canceledAt})`;
  }));
}

export async function reconcileCommercialMemberships(tx?: CommercialTransaction): Promise<void> {
  return transaction(tx, async sql => { await sql`select private.ruined_reconcile_commercial_memberships()`; });
}

export async function getCommercialEnrollment(memberId: string, tx?: CommercialSql): Promise<CommercialEnrollment | null> {
  const sql = database(tx);
  const [row] = await sql<Array<{
    id: string; member_id: string; person_id: string; reservation_id: string | null; founding_eligible: boolean;
    source: CommercialEnrollment["source"]; started_at: Date; ended_at: Date | null;
    cancellation_effective_at: Date | null; billing_attention_at: Date | null; end_reason: string | null;
  }>>`select * from membership_enrollment_episodes where member_id = ${memberId}::uuid
    order by (ended_at is null) desc, started_at desc limit 1`;
  return row ? { id: row.id, memberId: row.member_id, personId: row.person_id, reservationId: row.reservation_id,
    foundingEligible: row.founding_eligible, source: row.source, startedAt: date(row.started_at), endedAt: nullableDate(row.ended_at),
    cancellationEffectiveAt: nullableDate(row.cancellation_effective_at), billingAttentionAt: nullableDate(row.billing_attention_at), endReason: row.end_reason } : null;
}

export async function getCommercialBillingGroupBySubscription(subscriptionId: string, tx?: CommercialSql) {
  const sql = database(tx);
  const [row] = await sql<Array<{ id: string }>>`select id from membership_commercial_reservations
    where stripe_subscription_id = ${subscriptionId} and status = 'activated'`;
  return row ? getCommercialMembershipReservation(row.id, sql) : null;
}

export async function getCoupleMembershipAuthorization(id: string, tx?: CommercialSql): Promise<CoupleMembershipAuthorization | null> {
  const sql = database(tx);
  const [row] = await sql<Array<{ id: string; payer_member_id: string; partner_member_id: string; accepted_at: Date | null; expires_at: Date; revoked_at: Date | null }>>`
    select * from membership_couple_authorizations where id = ${id}::uuid`;
  return row ? { id: row.id, memberId: row.payer_member_id, partnerMemberId: row.partner_member_id,
    acceptedAt: nullableDate(row.accepted_at), expiresAt: date(row.expires_at), revokedAt: nullableDate(row.revoked_at) } : null;
}

export async function getReadyCoupleMembershipAuthorization(memberId: string, tx?: CommercialSql) {
  const sql = database(tx);
  const [row] = await sql<Array<{ id: string }>>`select id from membership_couple_authorizations where payer_member_id = ${memberId}::uuid
    and accepted_at is not null and revoked_at is null and expires_at > clock_timestamp() order by accepted_at desc limit 1`;
  return row ? getCoupleMembershipAuthorization(row.id, sql) : null;
}

/** memberId must come from the authenticated payer's session, never the request body. */
export async function createCoupleMembershipAuthorization(input: { id: string; memberId: string; partnerMemberId: string }, tx?: CommercialTransaction) {
  if (input.memberId === input.partnerMemberId) throw new CommercialMembershipError(400, "Couple membership requires two different adults.");
  return transaction(tx, async sql => {
    await sql`insert into membership_couple_authorizations(id, payer_member_id, partner_member_id)
      values(${input.id}::uuid, ${input.memberId}::uuid, ${input.partnerMemberId}::uuid) on conflict(id) do nothing`;
    const authorization = await getCoupleMembershipAuthorization(input.id, sql);
    if (!authorization || authorization.memberId !== input.memberId || authorization.partnerMemberId !== input.partnerMemberId) {
      throw new CommercialMembershipError(409, "This shared membership request conflicts with another request.");
    }
    return authorization;
  });
}

/** Only the second adult's authenticated, verified account may accept. */
export async function acceptCoupleMembershipAuthorization(input: { id: string; authUserId: string }, tx?: CommercialTransaction) {
  return transaction(tx, async sql => {
    await sql`select pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'))`;
    const [updated] = await sql<Array<{ id: string }>>`update membership_couple_authorizations approval
      set accepted_at = coalesce(accepted_at, clock_timestamp()), accepted_by_auth_user_id = ${input.authUserId}::uuid
      where id = ${input.id}::uuid and revoked_at is null and expires_at > clock_timestamp()
        and exists (select 1 from platform_users account
          join ruined_members member on member.id = approval.partner_member_id and member.id = account.member_id
            and member.person_id = account.person_id and member.deleted_at is null
          join people person on person.id = member.person_id and person.status = 'active'
          join platform_role_grants grant_row on grant_row.auth_user_id = account.auth_user_id
            and grant_row.role_slug = 'member' and grant_row.revoked_at is null
          where account.auth_user_id = ${input.authUserId}::uuid and account.status = 'active'
            and exists(select 1 from person_email_addresses email where email.person_id = member.person_id and email.verification_state = 'verified' and email.retired_at is null)
            and exists(select 1 from member_consents consent where consent.member_id = member.id and consent.consent_type = 'age_attestation' and consent.decision = 'accepted')
            and exists(select 1 from membership_agreement_acceptances acceptance
              join membership_agreement_versions agreement on agreement.id = acceptance.agreement_version_id
                and agreement.agreement_key='ruined_membership' and agreement.status='published' and agreement.version >= 2
                and (agreement.effective_at is null or agreement.effective_at <= clock_timestamp())
              where acceptance.member_id=member.id and acceptance.person_id=member.person_id))
      returning id`;
    if (!updated) throw new CommercialMembershipError(403, "This shared membership request requires the second adult's verified account.");
    const authorization = await getCoupleMembershipAuthorization(updated.id, sql);
    if (!authorization) throw new CommercialMembershipError(409, "This shared membership request is unavailable.");
    // Explicitly accepting a shared membership replaces a quote the partner only
    // looked at. Never terminate a provider checkout or alter a paid contract.
    const [ownOffer] = await sql<Array<{ id: string; has_attempt: boolean; stripe_subscription_id: string | null }>>`
      select reservation.id,reservation.stripe_subscription_id,
        exists(select 1 from stripe_checkout_attempts attempt where attempt.id=reservation.id or attempt.commercial_reservation_id=reservation.id) as has_attempt
      from membership_commercial_reservations reservation
      where reservation.payer_member_id=${authorization.partnerMemberId}::uuid and reservation.kind='individual' and reservation.status='reserved'
      order by reservation.created_at limit 1`;
    if (ownOffer?.has_attempt || ownOffer?.stripe_subscription_id) {
      throw new CommercialMembershipError(409, "Finish or cancel your current payment before joining this shared membership.");
    }
    if (ownOffer) await releaseCommercialMembershipReservation({ reservationId: ownOffer.id, reason: "before_checkout_abandoned" }, sql);
    return authorization;
  });
}
