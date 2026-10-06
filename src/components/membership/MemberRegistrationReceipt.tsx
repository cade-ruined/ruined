import Image from "next/image";
import Link from "next/link";
import RegistrationCouplePreference from "@/components/membership/RegistrationCouplePreference";
import InstallRuined from "@/components/membership/InstallRuined";
import type { MemberRegistrationSnapshot, RegistrationFoundingPricing } from "@/lib/membership/registration-model";
import { formatMembershipPrice } from "@/lib/membership/pricing";
import { registrationFoundingConfirmation } from "@/lib/membership/registration-pricing-confirmation";

type Props = {
  email: string;
  registeredAt: string | null;
  requiresPaymentMethod: boolean;
  foundingPricing?: RegistrationFoundingPricing | null;
  initialPayment?: MemberRegistrationSnapshot["initialPayment"];
  preview?: boolean;
  activationAvailable?: boolean;
};

/** Registration is confirmed by the server before this receipt is rendered. */
export default function MemberRegistrationReceipt({ email, registeredAt, requiresPaymentMethod, foundingPricing, initialPayment = null, preview = false, activationAvailable = false }: Props) {
  const founding = requiresPaymentMethod && !initialPayment ? registrationFoundingConfirmation(foundingPricing) : null;
  const schedule = initialPayment?.billingSchedule;
  const amountPaid = initialPayment ? new Intl.NumberFormat("en-US", {
    style: "currency", currency: initialPayment.currency,
    minimumFractionDigits: initialPayment.amountPaid % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(initialPayment.amountPaid / 100) : null;
  const callDate = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value)) + " Mountain Time";
  const timestamp = registeredAt ? new Date(registeredAt) : null;
  const date = timestamp && Number.isFinite(timestamp.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Denver" }).format(timestamp)
    : null;
  return <main className="mx-auto max-w-4xl pb-12 text-[var(--member-ink)]" data-registration-receipt>
    <header className="relative isolate min-h-80 overflow-hidden bg-black text-[#f3f0e7] sm:min-h-[28rem]">
      <Image src="/membership/hero-couch-wide.jpg" alt="" fill priority sizes="(min-width: 1024px) 896px, 100vw" className="object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
      <div className="relative flex min-h-80 flex-col justify-end p-6 sm:min-h-[28rem] sm:p-10">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em]">Ruined / Registration confirmed</p>
        <h1 className="max-w-2xl font-[var(--font-display)] text-[clamp(3.2rem,10vw,6.5rem)] leading-[0.95] tracking-[-0.045em]">You’re registered.</h1>
        <p className="mt-5 max-w-md text-base leading-relaxed">This is where it begins.</p>
      </div>
    </header>
    <section className="px-5 py-8 sm:px-10 sm:py-10" aria-label="What happens next">
      {preview ? <p className="mb-6 border-l-2 border-[var(--member-red)] pl-3 text-sm" role="status">Preview only. No account, card, registration, or email has been created.</p> : null}
      {founding ? <section className="mb-9 border border-[#23231f] bg-[#ffca2c] p-5 text-[#23231f] shadow-[5px_5px_0_#23231f] sm:p-7" aria-labelledby="founding-rate-confirmed">
        <h2 id="founding-rate-confirmed" className="text-lg font-semibold sm:text-xl">{founding.heading}</h2>
        <p className="mt-3 text-[clamp(2rem,8vw,3.25rem)] font-semibold leading-tight tracking-[-0.04em]">{founding.monthly}</p>
        <p className="mt-2 text-sm">{founding.annual}</p>
        <p className="mt-2 text-xs leading-relaxed">{founding.scope}</p>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed">{founding.retention}</p>
        <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed">Your founding offer is recorded. Billing requires a separate review of your price and terms and your confirmation.</p>
      </section> : null}
      {initialPayment && schedule ? <section className="mb-9 border border-[#23231f] bg-[#ffca2c] p-5 text-[#23231f] shadow-[5px_5px_0_#23231f] sm:p-7" aria-labelledby="initial-payment-confirmed">
        <p className="text-xs font-semibold uppercase tracking-[0.14em]">{initialPayment.offerId.startsWith("founding_") ? "Founding membership" : initialPayment.offerId.startsWith("couple_") ? "Couples membership" : "Membership"} / Payment confirmed</p>
        <h2 id="initial-payment-confirmed" className="mt-3 text-3xl font-semibold tracking-[-0.03em]">{initialPayment.isPayer ? `${amountPaid} paid` : "Your shared membership is paid."}</h2>
        <p className="mt-3 text-sm leading-relaxed">Your {initialPayment.plan === "annual" ? "first year" : "first month"} is paid. Service and your 12-month commitment begin with your first Foundations call.</p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Service begins</dt><dd className="mt-1">{callDate(schedule.serviceStartsAt)}</dd></div>
          <div><dt className="font-semibold">Next {initialPayment.isPayer ? "payment" : "shared payment"}</dt><dd className="mt-1">{formatMembershipPrice(initialPayment.installmentDues)} plus applicable tax<br />{callDate(schedule.nextChargeAt)}</dd></div>
        </dl>
        <p className="mt-5 text-sm leading-relaxed">{initialPayment.plan === "monthly" ? "Eleven further monthly installments complete the initial 12-month commitment, followed by monthly renewals." : "The initial 12-month commitment is paid in full, followed by annual renewals."} Your initial commitment ends {callDate(schedule.initialTermEndsAt)}.</p>
        <p className="mt-3 text-sm leading-relaxed">Cancel before service begins for a full refund of the initial payment, including tax. {initialPayment.plan === "monthly" ? "After service begins, early exit replaces the remaining installments with the lower of $1,500 or those unpaid installments." : "After service begins, turning off renewal stops the next annual payment; it does not automatically refund the prepaid year."}</p>
        {initialPayment.offerId.startsWith("founding_") ? <p className="mt-3 text-sm font-semibold">Your Founding rate stays protected while your membership remains continuously active.</p> : null}
        <Link href="/my/activate" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">View billing, terms & cancellation</Link>
      </section> : null}
      <div className="grid min-w-0 gap-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] sm:gap-12">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Keep an eye on your email.</h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">We’ll email <span className="break-words font-medium text-[var(--member-ink)]">{email}</span> when your profile is ready. We’ll send your next steps here.</p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">You can close this page and sign back in whenever you need. Your registration will be here.</p>
        </div>
        <div className="border-t border-[var(--member-rule)] pt-5 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em]">Registration saved{date ? <span className="mt-2 block font-normal normal-case tracking-normal">{date}</span> : null}</p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">{initialPayment ? "Your payment is confirmed by Stripe. Your profile stays closed until Ruined releases it; we’ll email you when it’s ready." : requiresPaymentMethod ? "Your card is saved securely with Stripe. Saving a card does not authorize a charge. You must separately review your price and confirm membership billing." : "Your complimentary registration is confirmed. No payment card is required."}</p>
          {requiresPaymentMethod ? <Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/payment-method">Manage saved card</Link> : null}
        </div>
      </div>
      {requiresPaymentMethod && !initialPayment && activationAvailable ? <div className="mt-8 border-t border-[var(--member-rule)] pt-6">
        <h2 className="text-xl font-semibold">Membership billing</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--member-muted)]">Review your membership offer and first payment date, or manage billing you have already confirmed.</p>
        <Link className="mt-4 inline-flex min-h-12 items-center border border-current px-5 py-3 text-sm font-semibold" href="/my/activate">Review membership billing</Link>
      </div> : null}
      {schedule ? <section className="mt-8 border-t border-[var(--member-rule)] pt-6" aria-labelledby="foundations-call-dates"><h2 id="foundations-call-dates" className="text-xl font-semibold">Your Foundations calls</h2><ol className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{schedule.callStartsAt.map(call => <li key={call}><time dateTime={call}>{callDate(call)}</time></li>)}</ol><p className="mt-3 text-sm text-[var(--member-muted)]">Four live virtual sessions, 90 minutes each. We’ll email your access details before you begin.</p></section> : null}
      {!initialPayment ? <RegistrationCouplePreference preview={preview} /> : null}
      <div className="mt-8 border-t border-[var(--member-rule)] pt-6"><InstallRuined variant="profile" /></div>
      <a className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="mailto:connect@theruinedproject.com">Need a hand? Contact Ruined</a>
    </section>
  </main>;
}
