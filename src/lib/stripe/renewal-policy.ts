import type Stripe from "stripe";

import { isMembershipOfferId, matchesMembershipInvoice, matchesMembershipOfferPrice, matchesMembershipPrice, type MembershipPriceConfiguration } from "@/lib/stripe/price-policy";

export type RenewalNoticeIdentity = {
  subscriptionId: string;
  customerId: string;
  memberId: string;
  renewsAt: string;
  leadDays: 40 | 20;
  livemode: boolean;
  noticeKind?: "annual_renewal" | "initial_term_end";
  offerId?: string | null;
  commitmentId?: string | null;
  commercialReservationId?: string | null;
  commitmentInitialTermEndsAt?: string | null;
  commitmentStatus?: string | null;
  boundPriceId?: string | null;
};
export type RenewalInvoicePreview = {
  renewalDate: string;
  currency: string;
  membershipAmount: number;
  taxAmount: number;
  invoiceTotal: number;
  amountDue: number;
  noticeKind?: "initial_term_end";
  previewBillingDate?: string;
};
export class RenewalNoticeError extends Error {
  constructor(readonly code: string, readonly disposition: "retry" | "cancelled" | "manual_review" = "manual_review") { super(code); }
}

export function validateRenewalSubscription(subscription: Stripe.Subscription, notice: RenewalNoticeIdentity,
  configuration: MembershipPriceConfiguration, now = new Date()): void {
  if (notice.livemode !== configuration.livemode || subscription.livemode !== notice.livemode
    || subscription.id !== notice.subscriptionId
    || (typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id) !== notice.customerId
    || subscription.metadata.ruined_member_id !== notice.memberId || subscription.metadata.ruined_context !== "membership") {
    throw new RenewalNoticeError("subscription_identity_mismatch");
  }
  const renewsAt = new Date(notice.renewsAt).getTime();
  if (subscription.status === "canceled" || subscription.cancel_at_period_end
    || typeof subscription.cancel_at === "number" && subscription.cancel_at * 1000 <= renewsAt) {
    throw new RenewalNoticeError("renewal_cancelled", "cancelled");
  }
  if (subscription.status !== "active" || subscription.pause_collection || subscription.schedule) {
    throw new RenewalNoticeError("renewal_requires_operator_review");
  }
  const item = subscription.items.data[0];
  const initialTermEnd = notice.noticeKind === "initial_term_end";
  const commercial = subscription.metadata.billing_terms_version === "membership-billing-v2";
  if (commercial) {
    if (!notice.commitmentId || notice.commitmentStatus !== "active" || !isMembershipOfferId(notice.offerId)
      || notice.offerId !== subscription.metadata.ruined_offer_id
      || notice.commercialReservationId !== subscription.metadata.ruined_commercial_reservation_id
      || notice.boundPriceId !== item?.price.id
      || !matchesMembershipOfferPrice(item.price, notice.offerId, configuration)
      || !notice.offerId.endsWith(initialTermEnd ? "_monthly" : "_annual")) {
      throw new RenewalNoticeError("commercial_renewal_commitment_mismatch");
    }
  } else if (initialTermEnd || notice.commitmentId) {
    throw new RenewalNoticeError("commercial_renewal_commitment_mismatch");
  }
  if (subscription.items.has_more || subscription.items.data.length !== 1 || item?.quantity !== 1
    || subscription.metadata.ruined_billing_plan !== (initialTermEnd ? "monthly" : "annual")
    || (!commercial && !matchesMembershipPrice(item.price, "annual", configuration))) {
    throw new RenewalNoticeError("annual_membership_price_mismatch");
  }
  if (!Number.isFinite(renewsAt) || (initialTermEnd
    ? Date.parse(notice.commitmentInitialTermEndsAt ?? "") !== renewsAt
      || item.current_period_end * 1000 > renewsAt || item.current_period_end * 1000 <= now.getTime()
    : item.current_period_end * 1000 !== renewsAt)) {
    throw new RenewalNoticeError("renewal_period_changed", "cancelled");
  }
  const days = (renewsAt - now.getTime()) / 86_400_000;
  // Late jobs are actionable. Never send a late 20-day notice outside its reviewed
  // 15–20-day window or silently count it as delivered.
  if (days < (notice.leadDays === 40 ? 30 : 15)) throw new RenewalNoticeError("notice_window_missed");
  if (days > notice.leadDays) throw new RenewalNoticeError("notice_not_due", "retry");
}

export function renewalInvoicePreview(invoice: Stripe.Invoice, subscription: Stripe.Subscription,
  configuration: MembershipPriceConfiguration, notice?: RenewalNoticeIdentity): RenewalInvoicePreview {
  const item = subscription.items.data[0];
  if (!matchesMembershipInvoice(invoice, subscription, configuration)
    || invoice.lines.data[0].period.start !== item.current_period_end
    || invoice.lines.data[0].period.end <= item.current_period_end
    || (typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id)
      !== (typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id)
    || subscription.automatic_tax.enabled && invoice.automatic_tax.status !== "complete") {
    throw new RenewalNoticeError("renewal_invoice_preview_mismatch");
  }
  const taxAmount = (invoice.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0);
  const numbers = [item.price.unit_amount, taxAmount, invoice.total, invoice.amount_due];
  if (numbers.some(amount => !Number.isSafeInteger(amount) || amount! < 0)) {
    throw new RenewalNoticeError("renewal_invoice_amount_invalid");
  }
  const billingDate = new Date(item.current_period_end * 1000).toISOString();
  return { renewalDate: notice?.noticeKind === "initial_term_end" ? notice.renewsAt : billingDate, currency: invoice.currency,
    ...(notice?.noticeKind === "initial_term_end" ? { noticeKind: "initial_term_end" as const, previewBillingDate: billingDate } : {}),
    membershipAmount: item.price.unit_amount!, taxAmount, invoiceTotal: invoice.total, amountDue: invoice.amount_due };
}
