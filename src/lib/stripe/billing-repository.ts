import "server-only";

import postgres from "postgres";
import type Stripe from "stripe";

import { getBillingDatabase } from "@/lib/stripe/database";
import {
  type MembershipState,
  normalizeEmail,
} from "@/lib/stripe/membership-state";

export type BillingTransaction = postgres.TransactionSql;

export type BillingMember = {
  id: string;
  membershipState: MembershipState;
  stripeCustomerId: string | null;
};

export type MembershipCheckoutReservation = {
  agreementAcceptanceId: string;
  agreementAcceptedAt: Date;
  agreementContentSha256: string;
  agreementKey: string;
  agreementVersion: string;
  ageAttestedAt: Date;
  attemptId: string;
  existingAcceptanceMatches: boolean;
  existingStripeSessionId: string | null;
  memberId: string;
};

export class MembershipCheckoutConflictError extends Error {
  constructor() {
    super("This email already has membership billing in progress.");
    this.name = "MembershipCheckoutConflictError";
  }
}

export type SubscriptionSnapshot = {
  automaticTaxDisabledReason: string | null;
  automaticTaxEnabled: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  customerId: string;
  eventCreated: number;
  id: string;
  latestInvoiceId: string | null;
  memberId: string;
  priceId: string | null;
  status: string;
};

export type InvoiceSnapshot = {
  amountDue: number;
  amountPaid: number;
  billingReason: string | null;
  currency: string;
  customerId: string | null;
  eventCreated: number;
  id: string;
  memberId: string | null;
  purpose: "consulting" | "membership" | "membership_price_mismatch" | "unclassified";
  status: string | null;
  subscriptionId: string | null;
};

type MemberInput = {
  agreementAcceptedAt: Date | null;
  agreementVersion: string | null;
  ageAttestedAt: Date | null;
  candidateMemberId: string;
  customerId: string;
  email: string;
};

function eventObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

export async function findBillingMemberByEmail(email: string): Promise<BillingMember | null> {
  const sql = getBillingDatabase();
  const rows = await sql<
    Array<{
      id: string;
      membership_state: MembershipState;
      stripe_customer_id: string | null;
    }>
  >`
    select id, membership_state, stripe_customer_id
    from ruined_members
    where email_normalized = ${normalizeEmail(email)}
    limit 1
  `;
  const row = rows[0];

  return row
    ? {
        id: row.id,
        membershipState: row.membership_state,
        stripeCustomerId: row.stripe_customer_id,
      }
    : null;
}

export async function findBillingMemberById(memberId: string): Promise<BillingMember | null> {
  const sql = getBillingDatabase();
  const rows = await sql<
    Array<{
      id: string;
      membership_state: MembershipState;
      stripe_customer_id: string | null;
    }>
  >`
    select id, membership_state, stripe_customer_id
    from ruined_members
    where id = ${memberId}
    limit 1
  `;
  const row = rows[0];

  return row
    ? {
        id: row.id,
        membershipState: row.membership_state,
        stripeCustomerId: row.stripe_customer_id,
      }
    : null;
}

export async function reserveMembershipCheckout({
  acceptanceId,
  attemptId,
  authUserId,
  email,
}: {
  acceptanceId: string;
  attemptId: string;
  authUserId: string;
  email: string;
}): Promise<MembershipCheckoutReservation> {
  const sql = getBillingDatabase();
  const emailNormalized = normalizeEmail(email);

  return sql.begin(async (tx) => {
    // Serialize attempts for one email so parallel tabs cannot create two
    // open Checkout Sessions before either webhook arrives.
    await tx`select pg_advisory_xact_lock(hashtext(${emailNormalized}), 0)`;

    const memberRows = await tx<
      Array<{
        id: string;
        membership_state: MembershipState;
        person_id: string;
        stripe_customer_id: string | null;
      }>
    >`
      select member.id, member.membership_state, member.person_id, member.stripe_customer_id
      from platform_users platform_user
      join platform_role_grants member_grant
        on member_grant.auth_user_id = platform_user.auth_user_id
        and member_grant.role_slug = 'member'
        and member_grant.revoked_at is null
      join ruined_members member on member.person_id = platform_user.person_id
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      where platform_user.auth_user_id = ${authUserId}::uuid
        and platform_user.email_normalized = ${emailNormalized}
        and platform_user.status = 'active'
        and lifecycle.account_state = 'active'
      limit 1
      for update of member
    `;
    const member = memberRows[0];

    if (member?.membership_state === "active" || member?.membership_state === "attention_required") {
      throw new MembershipCheckoutConflictError();
    }

    if (!member) {
      throw new MembershipCheckoutConflictError();
    }

    const acceptanceRows = await tx<
      Array<{
        accepted_at: Date;
        age_attested_at: Date;
        agreement_key: string;
        agreement_version: number;
        content_sha256: string;
        id: string;
      }>
    >`
      select
        acceptance.id,
        acceptance.accepted_at,
        age_attestation.accepted_at as age_attested_at,
        agreement.agreement_key,
        agreement.version as agreement_version,
        agreement.content_sha256
      from membership_agreement_acceptances acceptance
      join membership_agreement_versions agreement
        on agreement.id = acceptance.agreement_version_id
      join member_consents age_attestation
        on age_attestation.id = acceptance.age_attestation_id
        and age_attestation.member_id = acceptance.member_id
        and age_attestation.consent_type = 'age_attestation'
        and age_attestation.decision = 'accepted'
      where acceptance.id = ${acceptanceId}::uuid
        and acceptance.member_id = ${member.id}::uuid
        and acceptance.person_id = ${member.person_id}::uuid
        and acceptance.accepted_by_auth_user_id = ${authUserId}::uuid
        and agreement.agreement_key = 'ruined_membership'
        and agreement.status = 'published'
        and (agreement.effective_at is null or agreement.effective_at <= statement_timestamp())
        and acceptance.accepted_at <= statement_timestamp()
      limit 1
    `;
    const acceptance = acceptanceRows[0];
    if (!acceptance) throw new MembershipCheckoutConflictError();
    const agreementVersion = `${acceptance.agreement_key}-v${acceptance.agreement_version}`;

    const nonterminalSubscriptions = await tx<Array<{ id: string }>>`
      select id
      from stripe_subscriptions
      where member_id = ${member.id}
        and stripe_status not in ('canceled', 'incomplete_expired')
      limit 1
    `;

    if (nonterminalSubscriptions.length > 0) {
      throw new MembershipCheckoutConflictError();
    }

    const completedWithoutSubscription = await tx<Array<{ id: string }>>`
      select attempt.id
      from stripe_checkout_attempts attempt
      where attempt.member_id = ${member.id}
        and attempt.status = 'completed'
        and (
          attempt.stripe_subscription_id is null
          or not exists (
            select 1
            from stripe_subscriptions subscription
            where subscription.id = attempt.stripe_subscription_id
          )
        )
      limit 1
    `;

    if (completedWithoutSubscription.length > 0) {
      throw new MembershipCheckoutConflictError();
    }

    await tx`
      update stripe_checkout_attempts
      set status = 'expired', updated_at = now()
      where member_id = ${member.id}
        and status in ('creating', 'open')
        and expires_at <= now()
    `;

    const attemptRows = await tx<
      Array<{
        agreement_accepted_at: Date;
        agreement_acceptance_id: string | null;
        agreement_version: string;
        age_attested_at: Date;
        id: string;
        stripe_session_id: string | null;
      }>
    >`
      select
        id,
        stripe_session_id,
        agreement_acceptance_id,
        agreement_version,
        agreement_accepted_at,
        age_attested_at
      from stripe_checkout_attempts
      where member_id = ${member.id}
        and status in ('creating', 'open')
      order by created_at desc
      limit 1
      for update
    `;
    const existingAttempt = attemptRows[0];

    if (existingAttempt) {
      return {
        agreementAcceptanceId: acceptance.id,
        agreementAcceptedAt: acceptance.accepted_at,
        agreementContentSha256: acceptance.content_sha256,
        agreementKey: acceptance.agreement_key,
        agreementVersion,
        ageAttestedAt: acceptance.age_attested_at,
        attemptId: existingAttempt.id,
        existingAcceptanceMatches:
          existingAttempt.agreement_acceptance_id === acceptance.id &&
          existingAttempt.agreement_version === agreementVersion,
        existingStripeSessionId: existingAttempt.stripe_session_id,
        memberId: member.id,
      };
    }

    await tx`
      insert into stripe_checkout_attempts (
        id,
        member_id,
        email_normalized,
        agreement_acceptance_id,
        agreement_version,
        agreement_accepted_at,
        age_attested_at,
        expires_at
      ) values (
        ${attemptId},
        ${member.id},
        ${emailNormalized},
        ${acceptance.id}::uuid,
        ${agreementVersion},
        ${acceptance.accepted_at},
        ${acceptance.age_attested_at},
        now() + interval '30 minutes'
      )
    `;

    return {
      agreementAcceptanceId: acceptance.id,
      agreementAcceptedAt: acceptance.accepted_at,
      agreementContentSha256: acceptance.content_sha256,
      agreementKey: acceptance.agreement_key,
      agreementVersion,
      ageAttestedAt: acceptance.age_attested_at,
      attemptId,
      existingAcceptanceMatches: true,
      existingStripeSessionId: null,
      memberId: member.id,
    };
  });
}

export async function openMembershipCheckoutAttempt({
  attemptId,
  expiresAt,
  stripeSessionId,
}: {
  attemptId: string;
  expiresAt: Date;
  stripeSessionId: string;
}): Promise<void> {
  const sql = getBillingDatabase();
  await sql`
    update stripe_checkout_attempts
    set
      expires_at = ${expiresAt},
      status = 'open',
      stripe_session_id = ${stripeSessionId},
      updated_at = now()
    where id = ${attemptId}
      and status in ('creating', 'open')
  `;
}

export async function expireMembershipCheckoutAttempt(attemptId: string): Promise<void> {
  const sql = getBillingDatabase();
  await sql`
    update stripe_checkout_attempts
    set status = 'expired', updated_at = now()
    where id = ${attemptId}
      and status in ('creating', 'open')
  `;
}

export async function claimWebhookEvent(
  tx: BillingTransaction,
  event: Stripe.Event,
): Promise<"claimed" | "duplicate"> {
  const inserted = await tx<Array<{ event_id: string }>>`
    insert into stripe_webhook_events (
      event_id,
      event_type,
      object_id,
      livemode,
      stripe_created,
      status
    ) values (
      ${event.id},
      ${event.type},
      ${eventObjectId(event)},
      ${event.livemode},
      ${event.created},
      'processing'
    )
    on conflict (event_id) do nothing
    returning event_id
  `;

  const rows = await tx<Array<{ attempts: number; status: string }>>`
    select attempts, status
    from stripe_webhook_events
    where event_id = ${event.id}
    for update
  `;
  const existing = rows[0];

  if (!existing) {
    throw new Error("Stripe webhook event could not be claimed.");
  }

  if (existing.status === "processed") {
    return "duplicate";
  }

  if (inserted.length === 0) {
    await tx`
      update stripe_webhook_events
      set
        attempts = attempts + 1,
        last_error = null,
        status = 'processing',
        updated_at = now()
      where event_id = ${event.id}
    `;
  }

  return "claimed";
}

export async function completeWebhookEvent(
  tx: BillingTransaction,
  eventId: string,
): Promise<void> {
  await tx`
    update stripe_webhook_events
    set
      last_error = null,
      processed_at = now(),
      status = 'processed',
      updated_at = now()
    where event_id = ${eventId}
  `;
}

export async function recordWebhookFailure(
  event: Stripe.Event,
  error: unknown,
): Promise<void> {
  const sql = getBillingDatabase();
  const message = (error instanceof Error ? error.message : "Unknown webhook error").slice(0, 1_000);

  await sql`
    insert into stripe_webhook_events (
      event_id,
      event_type,
      object_id,
      livemode,
      stripe_created,
      status,
      last_error
    ) values (
      ${event.id},
      ${event.type},
      ${eventObjectId(event)},
      ${event.livemode},
      ${event.created},
      'failed',
      ${message}
    )
    on conflict (event_id) do update
    set
      attempts = case
        when stripe_webhook_events.status = 'processed' then stripe_webhook_events.attempts
        else stripe_webhook_events.attempts + 1
      end,
      last_error = case
        when stripe_webhook_events.status = 'processed' then stripe_webhook_events.last_error
        else excluded.last_error
      end,
      status = case
        when stripe_webhook_events.status = 'processed' then 'processed'
        else 'failed'
      end,
      updated_at = now()
  `;
}

export async function ensureBillingMember(
  tx: BillingTransaction,
  input: MemberInput,
): Promise<BillingMember> {
  const emailNormalized = normalizeEmail(input.email);
  const linkedRows = await tx<
    Array<{
      id: string;
      membership_state: MembershipState;
      stripe_customer_id: string | null;
    }>
  >`
    select member.id, member.membership_state, member.stripe_customer_id
    from stripe_customer_links customer_link
    join ruined_members member on member.id = customer_link.member_id
    where customer_link.stripe_customer_id = ${input.customerId}
    limit 1
    for update of member
  `;
  const candidateRows = linkedRows.length
    ? []
    : await tx<
        Array<{
          id: string;
          membership_state: MembershipState;
          stripe_customer_id: string | null;
        }>
      >`
        select member.id, member.membership_state, member.stripe_customer_id
        from ruined_members member
        join person_email_addresses email_address
          on email_address.person_id = member.person_id
        where member.id = ${input.candidateMemberId}::uuid
          and email_address.email_normalized = ${emailNormalized}
          and email_address.verification_state = 'verified'
          and email_address.retired_at is null
        limit 1
        for update of member
      `;
  const existing = linkedRows[0] ?? candidateRows[0];
  if (!existing) {
    throw new Error("Membership billing cannot be linked to a verified Ruined identity.");
  }
  const memberId = existing.id;

  await tx`
    update ruined_members
    set
      agreement_accepted_at = coalesce(${input.agreementAcceptedAt}, agreement_accepted_at),
      agreement_version = coalesce(${input.agreementVersion}, agreement_version),
      age_attested_at = coalesce(${input.ageAttestedAt}, age_attested_at),
      stripe_customer_id = ${input.customerId},
      updated_at = now()
    where id = ${memberId}
  `;

  await tx`
    update stripe_customer_links
    set is_primary = false, updated_at = now()
    where member_id = ${memberId}
      and stripe_customer_id <> ${input.customerId}
  `;

  await tx`
    insert into stripe_customer_links (
      stripe_customer_id,
      member_id,
      email_normalized,
      is_primary
    ) values (
      ${input.customerId},
      ${memberId},
      ${emailNormalized},
      true
    )
    on conflict (stripe_customer_id) do update
    set
      email_normalized = excluded.email_normalized,
      is_primary = true,
      updated_at = now()
  `;

  return {
    id: memberId,
    membershipState: existing.membership_state,
    stripeCustomerId: input.customerId,
  };
}

export async function findMemberBySubscription(
  tx: BillingTransaction,
  subscriptionId: string,
): Promise<BillingMember | null> {
  const rows = await tx<
    Array<{
      id: string;
      membership_state: MembershipState;
      stripe_customer_id: string | null;
    }>
  >`
    select member.id, member.membership_state, member.stripe_customer_id
    from stripe_subscriptions subscription
    join ruined_members member on member.id = subscription.member_id
    where subscription.id = ${subscriptionId}
    limit 1
  `;
  const row = rows[0];

  return row
    ? {
        id: row.id,
        membershipState: row.membership_state,
        stripeCustomerId: row.stripe_customer_id,
      }
    : null;
}

export async function upsertCheckoutSession(
  tx: BillingTransaction,
  input: {
    customerId: string | null;
    eventCreated: number;
    id: string;
    livemode: boolean;
    memberId: string;
    paymentStatus: string | null;
    sessionStatus: string | null;
    subscriptionId: string | null;
  },
): Promise<void> {
  await tx`
    insert into stripe_checkout_sessions (
      id,
      member_id,
      stripe_customer_id,
      stripe_subscription_id,
      payment_status,
      session_status,
      livemode,
      last_event_created
    ) values (
      ${input.id},
      ${input.memberId},
      ${input.customerId},
      ${input.subscriptionId},
      ${input.paymentStatus},
      ${input.sessionStatus},
      ${input.livemode},
      ${input.eventCreated}
    )
    on conflict (id) do update
    set
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      payment_status = excluded.payment_status,
      session_status = excluded.session_status,
      last_event_created = excluded.last_event_created,
      updated_at = now()
    where excluded.last_event_created >= stripe_checkout_sessions.last_event_created
  `;
}

export async function reconcileCheckoutAttempt(
  tx: BillingTransaction,
  input: {
    acceptanceId: string | null;
    attemptId: string;
    expiresAt: Date;
    sessionId: string;
    status: "completed" | "expired" | "open";
    subscriptionId: string | null;
  },
): Promise<void> {
  const reconciledRows = await tx<Array<{ id: string }>>`
    update stripe_checkout_attempts
    set
      expires_at = ${input.expiresAt},
      status = ${input.status},
      stripe_session_id = ${input.sessionId},
      stripe_subscription_id = ${input.subscriptionId},
      updated_at = now()
    where id = ${input.attemptId}
      and (
        ${input.acceptanceId}::uuid is null
        or agreement_acceptance_id = ${input.acceptanceId}::uuid
      )
    returning id
  `;

  if (input.acceptanceId && reconciledRows.length === 0) {
    throw new Error("Stripe Checkout metadata does not match its agreement acceptance.");
  }
}

export async function upsertSubscription(
  tx: BillingTransaction,
  input: SubscriptionSnapshot,
): Promise<void> {
  await tx`
    insert into stripe_subscriptions (
      id,
      member_id,
      stripe_customer_id,
      stripe_status,
      price_id,
      current_period_start,
      current_period_end,
      automatic_tax_enabled,
      automatic_tax_disabled_reason,
      cancel_at_period_end,
      latest_invoice_id,
      last_event_created
    ) values (
      ${input.id},
      ${input.memberId},
      ${input.customerId},
      ${input.status},
      ${input.priceId},
      ${input.currentPeriodStart},
      ${input.currentPeriodEnd},
      ${input.automaticTaxEnabled},
      ${input.automaticTaxDisabledReason},
      ${input.cancelAtPeriodEnd},
      ${input.latestInvoiceId},
      ${input.eventCreated}
    )
    on conflict (id) do update
    set
      member_id = excluded.member_id,
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_status = excluded.stripe_status,
      price_id = excluded.price_id,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      automatic_tax_enabled = excluded.automatic_tax_enabled,
      automatic_tax_disabled_reason = excluded.automatic_tax_disabled_reason,
      cancel_at_period_end = excluded.cancel_at_period_end,
      latest_invoice_id = excluded.latest_invoice_id,
      last_event_created = excluded.last_event_created,
      updated_at = now()
    where excluded.last_event_created >= stripe_subscriptions.last_event_created
  `;
}

export async function upsertInvoice(
  tx: BillingTransaction,
  input: InvoiceSnapshot,
): Promise<void> {
  await tx`
    insert into stripe_invoices (
      id,
      member_id,
      stripe_customer_id,
      stripe_subscription_id,
      purpose,
      stripe_status,
      billing_reason,
      amount_due,
      amount_paid,
      currency,
      last_event_created
    ) values (
      ${input.id},
      ${input.memberId},
      ${input.customerId},
      ${input.subscriptionId},
      ${input.purpose},
      ${input.status},
      ${input.billingReason},
      ${input.amountDue},
      ${input.amountPaid},
      ${input.currency},
      ${input.eventCreated}
    )
    on conflict (id) do update
    set
      member_id = excluded.member_id,
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      purpose = excluded.purpose,
      stripe_status = excluded.stripe_status,
      billing_reason = excluded.billing_reason,
      amount_due = excluded.amount_due,
      amount_paid = excluded.amount_paid,
      currency = excluded.currency,
      last_event_created = excluded.last_event_created,
      updated_at = now()
    where excluded.last_event_created >= stripe_invoices.last_event_created
  `;
}

async function reconcileAdministrativeOnboardingAfterPaidMembership(
  tx: BillingTransaction,
  input: {
    eventCreated: number;
    memberId: string;
    sourceEventId: string;
    state: MembershipState;
  },
): Promise<boolean> {
  if (input.state !== "active") return false;

  const paidMembershipEvents = await tx<Array<{ event_id: string }>>`
    select webhook_event.event_id
    from stripe_webhook_events webhook_event
    join stripe_invoices invoice on invoice.id = webhook_event.object_id
    where webhook_event.event_id = ${input.sourceEventId}
      and webhook_event.event_type = 'invoice.paid'
      and invoice.member_id = ${input.memberId}::uuid
      and invoice.purpose = 'membership'
      and invoice.amount_paid > 0
    limit 1
  `;

  if (paidMembershipEvents.length === 0) return false;

  await tx`
    insert into member_onboardings (
      member_id,
      state,
      form_version,
      requirements_snapshot,
      billing_confirmed_at,
      started_at
    ) values (
      ${input.memberId}::uuid,
      'in_progress',
      'administrative-v1',
      jsonb_build_object(
        'legal_name', true,
        'preferred_name', true,
        'mobile', true,
        'birth_date_or_age_attestation', true,
        'shipping_address', true,
        'apparel_sizing', true,
        'profile_photo', 'progressive'
      ),
      to_timestamp(${input.eventCreated}),
      statement_timestamp()
    )
    on conflict (member_id) do update
    set
      billing_confirmed_at = coalesce(
        member_onboardings.billing_confirmed_at,
        excluded.billing_confirmed_at
      ),
      state = case
        when member_onboardings.state = 'not_started' then 'in_progress'
        else member_onboardings.state
      end,
      started_at = coalesce(member_onboardings.started_at, excluded.started_at),
      version = member_onboardings.version + 1,
      updated_at = statement_timestamp()
  `;

  const lifecycleRows = await tx<
    Array<{
      administrative_onboarding_state: string;
      program_state: string;
      standing_state: string;
    }>
  >`
    select administrative_onboarding_state, program_state, standing_state
    from member_lifecycle
    where member_id = ${input.memberId}::uuid
    limit 1
    for update
  `;
  const previous = lifecycleRows[0];
  if (!previous) return false;

  const completedOnboardings = await tx<Array<{ member_id: string }>>`
    update member_onboardings
    set
      state = 'completed',
      completed_at = coalesce(completed_at, statement_timestamp()),
      completion_evidence = completion_evidence || jsonb_build_object(
        'automatic', true,
        'source', 'paid_membership_activation',
        'source_event_id', ${input.sourceEventId}::text
      ),
      version = version + 1,
      updated_at = statement_timestamp()
    where member_id = ${input.memberId}::uuid
      and state <> 'completed'
      and profile_completed_at is not null
      and agreement_completed_at is not null
      and billing_confirmed_at is not null
    returning member_id
  `;

  if (completedOnboardings.length === 0) {
    const startedRows = await tx<Array<{ member_id: string }>>`
      update member_lifecycle
      set
        administrative_onboarding_state = 'in_progress',
        version = version + 1,
        updated_at = statement_timestamp()
      where member_id = ${input.memberId}::uuid
        and administrative_onboarding_state = 'not_started'
      returning member_id
    `;

    if (startedRows.length > 0) {
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          source_event_id,
          dedupe_key,
          occurred_at
        ) values (
          ${input.memberId}::uuid,
          'administrative_onboarding',
          'not_started',
          'in_progress',
          'paid_membership_checkpoint',
          'stripe',
          ${input.sourceEventId},
          ${`stripe-admin-onboarding-started:${input.sourceEventId}:${input.memberId}`},
          to_timestamp(${input.eventCreated})
        )
        on conflict (dedupe_key) do nothing
      `;
    }
    return false;
  }

  const activatedRows = await tx<
    Array<{
      administrative_onboarding_state: string;
      program_state: string;
      standing_state: string;
    }>
  >`
    update member_lifecycle
    set
      administrative_onboarding_state = 'completed',
      program_state = case when program_state = 'prospect' then 'onboarding' else program_state end,
      standing_state = case when standing_state = 'pre_active' then 'active' else standing_state end,
      access_started_at = coalesce(access_started_at, statement_timestamp()),
      version = version + 1,
      updated_at = statement_timestamp()
    where member_id = ${input.memberId}::uuid
    returning administrative_onboarding_state, program_state, standing_state
  `;
  const activated = activatedRows[0];
  if (!activated) return false;

  await tx`
    insert into member_state_history (
      member_id,
      dimension,
      previous_state,
      next_state,
      reason_code,
      source,
      source_event_id,
      dedupe_key,
      occurred_at
    ) values (
      ${input.memberId}::uuid,
      'administrative_onboarding',
      ${previous.administrative_onboarding_state},
      'completed',
      'administrative_requirements_complete',
      'stripe',
      ${input.sourceEventId},
      ${`stripe-admin-onboarding-completed:${input.sourceEventId}:${input.memberId}`},
      to_timestamp(${input.eventCreated})
    )
    on conflict (dedupe_key) do nothing
  `;

  if (previous.program_state !== activated.program_state) {
    await tx`
      insert into member_state_history (
        member_id, dimension, previous_state, next_state, reason_code,
        source, source_event_id, dedupe_key, occurred_at
      ) values (
        ${input.memberId}::uuid,
        'program',
        ${previous.program_state},
        ${activated.program_state},
        'administrative_onboarding_complete',
        'system',
        ${input.sourceEventId},
        ${`stripe-program-state:${input.sourceEventId}:${input.memberId}`},
        to_timestamp(${input.eventCreated})
      )
      on conflict (dedupe_key) do nothing
    `;
  }

  if (previous.standing_state !== activated.standing_state) {
    await tx`
      insert into member_state_history (
        member_id, dimension, previous_state, next_state, reason_code,
        source, source_event_id, dedupe_key, occurred_at
      ) values (
        ${input.memberId}::uuid,
        'standing',
        ${previous.standing_state},
        ${activated.standing_state},
        'administrative_onboarding_complete',
        'system',
        ${input.sourceEventId},
        ${`stripe-standing-state:${input.sourceEventId}:${input.memberId}`},
        to_timestamp(${input.eventCreated})
      )
      on conflict (dedupe_key) do nothing
    `;
  }

  return true;
}

export async function updateMemberBillingState(
  tx: BillingTransaction,
  input: {
    eventCreated: number;
    memberId: string;
    sourceEventId: string;
    state: MembershipState;
  },
): Promise<void> {
  const updatedMembers = await tx<Array<{ membership_state: MembershipState }>>`
    update ruined_members
    set
      billing_attention_at = case
        when ${input.state} = 'attention_required' then now()
        when ${input.state} = 'active' then null
        else billing_attention_at
      end,
      billing_last_event_created = ${input.eventCreated},
      membership_activated_at = case
        when ${input.state} = 'active' then coalesce(membership_activated_at, now())
        else membership_activated_at
      end,
      membership_ended_at = case
        when ${input.state} = 'ended' then coalesce(membership_ended_at, now())
        when ${input.state} = 'active' then null
        else membership_ended_at
      end,
      membership_state = ${input.state},
      updated_at = now()
    where id = ${input.memberId}
      and (
        ${input.eventCreated} > billing_last_event_created
        or (
          ${input.eventCreated} = billing_last_event_created
          and case ${input.state}
            when 'ended' then 3
            when 'attention_required' then 2
            when 'active' then 1
            else 0
          end >= case membership_state
            when 'ended' then 3
            when 'attention_required' then 2
            when 'active' then 1
            else 0
          end
        )
      )
    returning membership_state
  `;

  const updatedMember = updatedMembers[0];
  if (!updatedMember) return;

  let lifecycleRows = await tx<Array<{ billing_state: MembershipState }>>`
    select billing_state
    from member_lifecycle
    where member_id = ${input.memberId}::uuid
    for update
  `;
  let previousState: MembershipState | null = lifecycleRows[0]?.billing_state ?? null;
  let lifecycleCreated = false;

  if (lifecycleRows.length === 0) {
    const insertedLifecycle = await tx<Array<{ billing_state: MembershipState }>>`
      insert into member_lifecycle (member_id, billing_state)
      values (${input.memberId}::uuid, ${updatedMember.membership_state})
      on conflict (member_id) do nothing
      returning billing_state
    `;

    lifecycleCreated = insertedLifecycle.length > 0;

    if (!lifecycleCreated) {
      lifecycleRows = await tx<Array<{ billing_state: MembershipState }>>`
        select billing_state
        from member_lifecycle
        where member_id = ${input.memberId}::uuid
        for update
      `;
      previousState = lifecycleRows[0]?.billing_state ?? null;
    }
  }

  await tx`
    update member_lifecycle
    set
      billing_state = ${updatedMember.membership_state},
      version = version + 1,
      updated_at = now()
    where member_id = ${input.memberId}::uuid
      and billing_state is distinct from ${updatedMember.membership_state}
  `;

  const billingStateChanged =
    lifecycleCreated || previousState !== updatedMember.membership_state;

  if (billingStateChanged) {
    await tx`
      insert into member_state_history (
        member_id,
        dimension,
        previous_state,
        next_state,
        reason_code,
        source,
        source_event_id,
        dedupe_key,
        occurred_at
      ) values (
        ${input.memberId}::uuid,
        'billing',
        ${previousState},
        ${updatedMember.membership_state},
        'stripe_webhook',
        'stripe',
        ${input.sourceEventId},
        ${`stripe-billing-state:${input.sourceEventId}:${input.memberId}`},
        to_timestamp(${input.eventCreated})
      )
      on conflict (dedupe_key) do nothing
    `;
  }

  await reconcileAdministrativeOnboardingAfterPaidMembership(tx, {
    eventCreated: input.eventCreated,
    memberId: input.memberId,
    sourceEventId: input.sourceEventId,
    state: updatedMember.membership_state,
  });

}
