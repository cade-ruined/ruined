import { parseFoundationsBillingSchedule, type FoundationsBillingSchedule } from "./foundations-schedule";

/** Receipt facts come from the immutable paid proof and accepted contract, never
 * the current catalog, a saved card, or a Checkout return URL. */
export type RegistrationPaidMembership = {
  offerId: string;
  billingPlan: "monthly" | "annual";
  amountPaidCents: number;
  duesAmountCents: number;
  currency: "usd";
  paidAt: string;
  billingSchedule: FoundationsBillingSchedule;
  agreementVersion: string;
  initialTermAmountCents: number;
  buyoutCapCents: number;
  isPayer: boolean;
};

function money(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: amount % 100 ? 2 : 0, maximumFractionDigits: 2,
  }).format(amount / 100);
}
function date(value: string, withWeekday = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", ...(withWeekday ? { weekday: "long" as const } : {}),
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value)) + " MT";
}

export function registrationPaidConfirmation(payment?: RegistrationPaidMembership | null) {
  if (!payment || payment.currency !== "usd" || typeof payment.isPayer !== "boolean"
    || ![payment.amountPaidCents, payment.duesAmountCents, payment.initialTermAmountCents, payment.buyoutCapCents]
      .every(amount => Number.isSafeInteger(amount) && amount > 0)
    || payment.amountPaidCents < payment.duesAmountCents
    || !/^(individual|founding_individual|couple)_(monthly|annual)$/.test(payment.offerId)
    || !payment.offerId.endsWith(`_${payment.billingPlan}`)
    || !/^[a-z][a-z0-9_-]*-v[1-9]\d*$/.test(payment.agreementVersion)) return null;
  const schedule = parseFoundationsBillingSchedule(payment.billingSchedule, payment.billingPlan);
  if (!schedule || !Number.isFinite(Date.parse(payment.paidAt))
    || Date.parse(payment.paidAt) >= Date.parse(schedule.cutoffAt)
    || payment.initialTermAmountCents !== payment.duesAmountCents * (payment.billingPlan === "monthly" ? 12 : 1)) return null;
  const annual = payment.billingPlan === "annual";
  const couple = payment.offerId.startsWith("couple_");
  const founding = payment.offerId.startsWith("founding_individual_");
  const period = annual ? "year" : "month";
  const firstCall = date(schedule.callStartsAt[0]);
  const firstCallDay = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timeZone, month: "long", day: "numeric",
  }).format(new Date(schedule.callStartsAt[0]));
  return {
    heading: "Your first payment is confirmed.",
    amount: `${money(payment.amountPaidCents)} USD paid`,
    paidOn: `Payment received ${date(payment.paidAt)}.`,
    paymentDetail: `${money(payment.duesAmountCents)} membership dues${payment.amountPaidCents > payment.duesAmountCents
      ? ` + ${money(payment.amountPaidCents - payment.duesAmountCents)} tax` : "; no tax was added"}. ${couple ? "This payment covers both named adults on your couples membership." : "Individual membership."}`,
    coverage: `Your first ${period} is paid. Service begins ${firstCall}; this payment covers service until ${date(schedule.prepaidThrough)}.`,
    nextCharge: `Next charge: ${money(payment.duesAmountCents)} USD plus applicable tax on ${date(schedule.nextChargeAt)}.`,
    commitment: annual
      ? `Your initial 12-month commitment is paid in full, from ${firstCall} through ${date(schedule.initialTermEndsAt)}.`
      : `Your initial 12-month commitment runs from ${firstCall} through ${date(schedule.initialTermEndsAt)}: this first payment plus 11 further monthly installments of ${money(payment.duesAmountCents)} USD, totaling ${money(payment.initialTermAmountCents)} USD before tax.`,
    renewal: annual
      ? `Renews annually at ${money(payment.duesAmountCents)} USD plus applicable tax until canceled. Turn off renewal before the next renewal date to prevent the next year’s charge.`
      : `After the initial commitment, renews monthly at ${money(payment.duesAmountCents)} USD plus applicable tax until canceled. Turning off renewal during the initial commitment does not waive its remaining installments.`,
    cancellation: `Cancel through Membership billing before ${firstCall} for a full refund of this payment, including tax, with no early-exit fee. After service begins, cancellation does not automatically refund payments already made; applicable legal rights remain unchanged.`,
    earlyExit: annual
      ? "Turning off renewal of a prepaid year has no early-exit charge."
      : `After service begins, early exit from the initial monthly commitment costs the lower of ${money(payment.buyoutCapCents)} USD or its remaining unpaid installments, plus any required tax. This replaces those installments; it does not buy access for the rest of the year.`,
    founding: founding ? "Your Founding rate stays with you while your membership remains continuously active. If you leave after service begins, rejoining requires a new eligibility check." : null,
    profile: "Your registration is complete. Profile access opens separately; we’ll email you when it is ready.",
    responsibility: couple && !payment.isPayer ? "Your partner authorized and manages the couples payment. This email does not create a separate charge for you." : null,
    calls: schedule.callStartsAt.map(call => date(call, true)),
    firstCall,
    firstCallDay,
    agreementPath: `/membership/agreement/${encodeURIComponent(payment.agreementVersion)}`,
  };
}
