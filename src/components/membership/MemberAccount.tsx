import Link from "next/link";

import MemberSettingsHeader from "@/components/membership/MemberSettingsHeader";
import MembershipCancellation from "@/components/membership/MembershipCancellation";
import { SUPPORT_ACTION_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import type { MemberAccountSnapshot } from "@/lib/membership/model";

const labelClass = "![font-family:var(--font-cadehandy2)] text-2xl text-[var(--member-red)]";
const sectionClass = "rounded-[4px] bg-[var(--member-soft)] p-5 sm:p-6";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value));
}

function formatBillingDate(value: string) {
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

export default function MemberAccount({ account, billingConnected, preview = false, paymentSetupEnabled = false, checkoutEnabled = false }: {
  account: MemberAccountSnapshot;
  billingConnected: boolean;
  preview?: boolean;
  paymentSetupEnabled?: boolean;
  checkoutEnabled?: boolean;
}) {
  const entry = account.access.mode === "entry";
  const complimentary = (account.membershipFunding === "operator" || account.membershipFunding === "complimentary");
  const prelaunch = !complimentary && account.membershipFunding !== "couple" && account.billingState === "pending" && !checkoutEnabled;
  const restricted = account.access.mode === "limited" || account.access.mode === "suspended";
  const standing = entry ? "Finish joining" : account.standingState.replaceAll("_", " ");
  const billing = { active: "Active", pending: "Not started", attention_required: "Needs attention", ended: "Ended" }[account.billingState];
  const subscription = account.subscription;
  const activeSubscription = subscription?.status === "active" || subscription?.status === "trialing";
  const cancellationDate = activeSubscription
    ? subscription.cancelAt ?? (subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null)
    : null;
  const scheduledCancellation = activeSubscription && (Boolean(cancellationDate) || subscription.cancelAtPeriodEnd);
  const billingBeforeCancellation = Boolean(cancellationDate && subscription?.currentPeriodEnd
    && new Date(subscription.currentPeriodEnd).getTime() < new Date(cancellationDate).getTime());
  const nextBillingDate = activeSubscription && (!scheduledCancellation || billingBeforeCancellation)
    ? subscription.currentPeriodEnd : null;

  return (
    <main className="member-journey-page member-account-page mx-auto max-w-[78rem] pb-24 font-[var(--font-body)] text-[var(--member-ink)]">
      <MemberSettingsHeader title="Account" />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section aria-labelledby="account-membership" className={sectionClass}>
          <h2 className={labelClass} id="account-membership">Membership</h2>
          <p className="mt-3 text-2xl font-bold capitalize tracking-tight">{standing}</p>
          <p className="mt-2 break-all text-base text-[var(--member-muted)]">{account.email}</p>
          {account.access.reason ? <p className="mt-4 max-w-lg text-base leading-relaxed text-[var(--member-muted)]" role="status">{account.access.reason}</p> : null}
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            {entry ? <Link className={SUPPORT_ACTION_CLASS} href="/my/join">Finish membership entry</Link> : null}
            {restricted ? <Link className={SUPPORT_LINK_CLASS} href="/my/support">Get help with access</Link> : null}
            <Link className={SUPPORT_LINK_CLASS} href="/my/profile">Profile details</Link>
          </div>
        </section>
        <section aria-labelledby="account-billing" className={sectionClass}>
          <h2 className={labelClass} id="account-billing">Billing</h2>
          <p className="mt-3 text-2xl font-bold tracking-tight">{complimentary ? "Complimentary membership" : prelaunch ? "Awaiting launch" : scheduledCancellation ? billingBeforeCancellation ? "Cancellation scheduled" : "Renewal canceled" : billing}</p>
          <p className="mt-3 text-base leading-relaxed text-[var(--member-muted)]">{complimentary
            ? "Your membership is complimentary. Complete your profile and agreement; no new membership payment is required."
            : prelaunch
            ? "There’s nothing to pay today. We’ll ask you to review your membership offer and confirm before membership begins."
            : entry
            ? "Complete your profile and agreement in membership entry, then continue to payment."
            : "Manage your payment method, subscription, and invoices."}</p>
          {prelaunch && (paymentSetupEnabled || preview) ? <div className="mt-5"><Link className={SUPPORT_ACTION_CLASS} href="/my/payment-method">Payment method</Link><p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Optional. Save securely for later, check its status, or remove it before joining.</p></div> : null}
          {complimentary && account.billingState === "active" ? <p className="mt-3 text-sm text-[var(--member-muted)]">An existing billing record is still active. Complimentary access does not automatically cancel an existing subscription; contact support to review it.</p> : null}
          {cancellationDate ? <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Your subscription is scheduled to end on <time dateTime={cancellationDate}>{formatBillingDate(cancellationDate)}</time>. {!billingBeforeCancellation ? "It will not renew." : "Billing continues before that date under your accepted agreement."}</p> : null}
          {nextBillingDate ? <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Next billing date: <time dateTime={nextBillingDate}>{formatBillingDate(nextBillingDate)}</time>.</p> : null}
          {scheduledCancellation && !cancellationDate ? <p className="mt-3 text-sm text-[var(--member-muted)]">Your subscription will not renew. Open Manage billing to confirm the scheduled end date.</p> : null}
          {!entry && !complimentary ? <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Your accepted membership agreement governs cancellation, any early-exit obligations, and your access end date. Review your billing details in Manage billing or <Link className="underline underline-offset-4" href="/my/support">contact support</Link>. Refund requests are reviewed individually.</p> : null}
          {!entry && (!complimentary || account.billingState === "active" || account.billingState === "attention_required") ? (
            billingConnected ? <form action="/api/stripe/portal" className="mt-5" method="post">
              <button className={SUPPORT_ACTION_CLASS} type="submit">{account.billingState === "attention_required" ? "Review billing" : "Manage billing"}</button>
            </form> : <p className="mt-4 text-sm text-[var(--member-muted)]">{preview ? "Billing actions are disabled in this demo." : <>Billing is unavailable here. <Link className="underline underline-offset-4" href="/my/support">Contact support</Link> if you need help.</>}</p>
          ) : null}
          {!entry && !complimentary && !preview ? <MembershipCancellation /> : null}
        </section>
        <section aria-labelledby="account-agreement" className={sectionClass + " lg:col-span-2"}>
          <h2 className={labelClass} id="account-agreement">Agreement</h2>
          <dl className="mt-4 grid gap-5 sm:grid-cols-3">
            {[
              ["Agreement", account.agreement.title ?? "Not accepted"],
              ["Version", account.agreement.version ?? "—"],
              ["Accepted", account.agreement.acceptedAt ? formatDate(account.agreement.acceptedAt) : "Not yet"],
            ].map(([label, value]) => <div key={label}>
              <dt className="text-sm text-[var(--member-muted)]">{label}</dt>
              <dd className="mt-1 text-base font-medium">{value}</dd>
            </div>)}
          </dl>
          {preview && account.agreement.receiptId ? <p className="mt-4 text-sm text-[var(--member-muted)]">Example agreement record. Downloads are disabled in this demo.</p> : account.agreement.receiptId ? (
            // The receipt is a file attachment, not a client-side page.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a className={SUPPORT_LINK_CLASS + " mt-4"} href="/api/my/agreement/receipt">Download agreement receipt</a>
          ) : <p className="mt-4 text-sm text-[var(--member-muted)]">{account.agreement.acceptedAt ? "Your receipt is not available yet." : "Your agreement and receipt will appear here after you accept it."}</p>}
        </section>
      </div>
      <nav aria-label="Account help" className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
        <Link className={SUPPORT_LINK_CLASS} href="/my/support">Support</Link>
        <Link className={SUPPORT_LINK_CLASS} href="/privacy">Privacy policy</Link>
      </nav>
    </main>
  );
}
