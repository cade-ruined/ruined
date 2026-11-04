import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { foundationsBillingScheduleForMonth, isFoundationsBillingScheduleVersion, parseFoundationsBillingSchedule, type FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { MEMBERSHIP_OFFERS, isMembershipBillingPlan, type MembershipOfferId } from "@/lib/membership/pricing";

const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;

export function prepaidScheduleFingerprint(schedule: FoundationsBillingSchedule): string {
  return createHash("sha256").update(JSON.stringify([schedule.version, schedule.cohortMonth, schedule.timeZone,
    schedule.callStartsAt, schedule.cutoffAt, schedule.serviceStartsAt, schedule.prepaidThrough,
    schedule.nextChargeAt, schedule.initialTermEndsAt])).digest("hex");
}

export function prepaidBillingMetadata(schedule: FoundationsBillingSchedule): Record<string, string> {
  return { ruined_billing_schedule_version: schedule.version, ruined_cohort_month: schedule.cohortMonth,
    ruined_service_starts_at: schedule.serviceStartsAt, ruined_prepaid_through: schedule.prepaidThrough,
    ruined_cohort_cutoff_at: schedule.cutoffAt, ruined_billing_schedule_sha256: prepaidScheduleFingerprint(schedule) };
}

/** The invoice and accepted consent retain these original dates after rollover. */
export function acceptedPrepaidScheduleFromSubscription(subscription: Stripe.Subscription): FoundationsBillingSchedule | null {
  const metadata = subscription.metadata, plan = metadata.ruined_billing_plan;
  if (!isFoundationsBillingScheduleVersion(metadata.ruined_billing_schedule_version) || !isMembershipBillingPlan(plan)
    || metadata.billing_terms_version !== "membership-billing-v2" || metadata.ruined_first_charge_at) return null;
  try {
    const schedule = foundationsBillingScheduleForMonth(metadata.ruined_cohort_month, plan, metadata.ruined_billing_schedule_version);
    return parseFoundationsBillingSchedule(schedule, plan) && !Object.entries(prepaidBillingMetadata(schedule)).some(([key, value]) => metadata[key] !== value) ? schedule : null;
  } catch { return null; }
}

export function prepaidRolloverMetadata(schedule: FoundationsBillingSchedule, reservationId: string): Record<string, string> {
  return { ruined_effective_cohort_month: schedule.cohortMonth, ruined_effective_schedule_version: schedule.version,
    ruined_effective_schedule_sha256: prepaidScheduleFingerprint(schedule), ruined_cohort_rollover_id: reservationId };
}

/** Provider dates are read back. Metadata alone never grants membership: callers
 * must also match the durable, completed rollover against the paid reservation. */
export function prepaidScheduleFromSubscription(subscription: Stripe.Subscription): FoundationsBillingSchedule | null {
  const accepted = acceptedPrepaidScheduleFromSubscription(subscription);
  if (!accepted) return null;
  let schedule = accepted;
  const metadata = subscription.metadata;
  if (Object.keys(metadata).some(key => key.startsWith("ruined_effective_") || key === "ruined_cohort_rollover_id")) {
    try {
      if (!isMembershipBillingPlan(metadata.ruined_billing_plan) || !isFoundationsBillingScheduleVersion(metadata.ruined_effective_schedule_version)
        || metadata.ruined_cohort_rollover_id !== metadata.ruined_commercial_reservation_id) return null;
      schedule = foundationsBillingScheduleForMonth(metadata.ruined_effective_cohort_month, metadata.ruined_billing_plan, metadata.ruined_effective_schedule_version);
      if (schedule.cohortMonth <= accepted.cohortMonth || Object.entries(prepaidRolloverMetadata(schedule, metadata.ruined_commercial_reservation_id))
        .some(([key,value]) => metadata[key] !== value)) return null;
    } catch { return null; }
  }
  return subscription.trial_end === Date.parse(schedule.prepaidThrough) / 1000
    && subscription.billing_cycle_anchor === Date.parse(schedule.prepaidThrough) / 1000 ? schedule : null;
}

/** Price/catalog and accepted reservation identity are verified by the caller.
 * Only the exact first-period invoice shape is eligible for prepaid coverage. */
export function matchesPrepaidMembershipInvoice(invoice: Stripe.Invoice, subscription: Stripe.Subscription): boolean {
  const schedule = acceptedPrepaidScheduleFromSubscription(subscription);
  const providerSchedule = prepaidScheduleFromSubscription(subscription);
  const item = subscription.items.data[0];
  const offer = MEMBERSHIP_OFFERS[subscription.metadata.ruined_offer_id as MembershipOfferId];
  if (!schedule || !providerSchedule || !offer || !item || subscription.items.has_more || subscription.items.data.length !== 1
    || invoice.billing_reason !== "subscription_create" || invoice.lines.has_more
    || invoice.lines.data.length !== 2 || invoice.currency !== "usd" || invoice.livemode !== subscription.livemode
    || id(invoice.parent?.subscription_details?.subscription) !== subscription.id
    || id(invoice.customer) !== id(subscription.customer) || item.price.unit_amount !== offer.amount
    || invoice.total_excluding_tax !== offer.amount || invoice.total_discount_amounts?.some(d => d.amount !== 0)) return false;
  const paidLines = invoice.lines.data.filter(line => line.subtotal === offer.amount);
  const zeroLines = invoice.lines.data.filter(line => line.subtotal === 0);
  if (paidLines.length !== 1 || zeroLines.length !== 1) return false;
  const paid = paidLines[0], zero = zeroLines[0];
  const upfront = paid.parent?.invoice_item_details, recurring = zero.parent?.subscription_item_details;
  const common = (line: Stripe.InvoiceLineItem) => line.currency === "usd" && line.livemode === subscription.livemode
    && line.quantity === 1 && line.period.end === Date.parse(schedule.prepaidThrough) / 1000
    && line.period.start === subscription.start_date && line.pricing?.type === "price_details"
    && id(line.pricing.price_details?.product) === id(item.price.product);
  return Boolean(common(paid) && common(zero) && paid.parent?.type === "invoice_item_details"
    && upfront?.subscription === subscription.id && !upfront.proration && upfront.invoice_item
    && paid.pricing?.price_details?.price && paid.amount === offer.amount
    && zero.parent?.type === "subscription_item_details" && recurring?.subscription === subscription.id
    && recurring.subscription_item === item.id && !recurring.proration
    && id(zero.pricing?.price_details?.price) === item.price.id && zero.amount === 0);
}

export function normalizePrepaidMembershipInvoiceCoverage(invoice: Stripe.Invoice, subscription: Stripe.Subscription) {
  if (!matchesPrepaidMembershipInvoice(invoice, subscription)) return null;
  const schedule = prepaidScheduleFromSubscription(subscription)!;
  return { periodStart: schedule.serviceStartsAt, periodEnd: schedule.prepaidThrough };
}

/** Stripe emits one $0 subscription_update invoice when trial_end is extended.
 * Only the exact extension of the original prepaid period is recognized. */
export function matchesCohortRolloverAdjustment(invoice: Stripe.Invoice, subscription: Stripe.Subscription): boolean {
  if (!subscription.metadata.ruined_cohort_rollover_id || invoice.billing_reason !== "subscription_update") return false;
  const accepted = acceptedPrepaidScheduleFromSubscription(subscription), effective = prepaidScheduleFromSubscription(subscription);
  const item = subscription.items.data[0], line = invoice.lines.data[0];
  const details = line?.parent?.subscription_item_details;
  return Boolean(accepted && effective && effective.cohortMonth > accepted.cohortMonth && item && line
    && invoice.billing_reason === "subscription_update" && invoice.status === "paid" && invoice.currency === "usd"
    && invoice.livemode === subscription.livemode && id(invoice.customer) === id(subscription.customer)
    && id(invoice.parent?.subscription_details?.subscription) === subscription.id
    && invoice.amount_due === 0 && invoice.amount_paid === 0 && invoice.amount_remaining === 0
    && invoice.total === 0 && invoice.total_excluding_tax === 0 && invoice.starting_balance === 0 && invoice.ending_balance === 0
    && invoice.pre_payment_credit_notes_amount === 0 && invoice.post_payment_credit_notes_amount === 0
    && !invoice.lines.has_more && invoice.lines.data.length === 1 && line.amount === 0 && line.subtotal === 0
    && line.currency === "usd" && line.livemode === subscription.livemode && line.quantity === 1
    && line.parent?.type === "subscription_item_details" && details?.subscription === subscription.id
    && details.subscription_item === item.id && !details.proration
    && line.pricing?.type === "price_details" && id(line.pricing.price_details?.price) === item.price.id
    && id(line.pricing.price_details?.product) === id(item.price.product)
    && line.period.start === Date.parse(accepted.prepaidThrough)/1000 && line.period.end === Date.parse(effective.prepaidThrough)/1000);
}
