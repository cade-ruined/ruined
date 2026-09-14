import Link from "next/link";

import MemberSettingsHeader from "@/components/membership/MemberSettingsHeader";
import { SUPPORT_ACTION_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import type { MemberAccountSnapshot } from "@/lib/membership/model";

const labelClass = "![font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]";
const sectionClass = "rounded-[4px] bg-black/[0.045] p-5 sm:p-6";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value));
}

export default function MemberAccount({ account, billingConnected, preview = false }: {
  account: MemberAccountSnapshot;
  billingConnected: boolean;
  preview?: boolean;
}) {
  const entry = account.access.mode === "entry";
  const complimentary = account.membershipFunding === "operator";
  const restricted = account.access.mode === "limited" || account.access.mode === "suspended";
  const standing = entry ? "Finish joining" : account.standingState.replaceAll("_", " ");
  const billing = { active: "Active", pending: "Not started", attention_required: "Needs attention", ended: "Ended" }[account.billingState];

  return (
    <main className="mx-auto max-w-[78rem] pb-24 font-[var(--font-body)] text-[var(--color-faded)]">
      <MemberSettingsHeader title="Account" />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section aria-labelledby="account-membership" className={sectionClass}>
          <h2 className={labelClass} id="account-membership">Membership</h2>
          <p className="mt-3 text-2xl font-bold capitalize tracking-tight">{standing}</p>
          <p className="mt-2 break-all text-base text-black/65">{account.email}</p>
          {account.access.reason ? <p className="mt-4 max-w-lg text-base leading-relaxed text-black/70" role="status">{account.access.reason}</p> : null}
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            {entry ? <Link className={SUPPORT_ACTION_CLASS} href="/my/join">Finish membership entry</Link> : null}
            {restricted ? <Link className={SUPPORT_LINK_CLASS} href="/my/support">Get help with access</Link> : null}
            <Link className={SUPPORT_LINK_CLASS} href="/my/profile">Profile details</Link>
          </div>
        </section>
        <section aria-labelledby="account-billing" className={sectionClass}>
          <h2 className={labelClass} id="account-billing">Billing</h2>
          <p className="mt-3 text-2xl font-bold tracking-tight">{complimentary ? "Complimentary operator membership" : billing}</p>
          <p className="mt-3 text-base leading-relaxed text-black/70">{complimentary
            ? "Your operator access includes membership. Complete your profile and agreement; no new membership payment is required."
            : entry
            ? "Complete your profile and agreement in membership entry, then continue to payment."
            : "Manage your payment method, subscription, and invoices."}</p>
          {complimentary && account.billingState === "active" ? <p className="mt-3 text-sm text-black/65">An existing billing record is still active. Complimentary access does not automatically cancel an existing subscription; contact support to review it.</p> : null}
          {!entry && (!complimentary || account.billingState === "active" || account.billingState === "attention_required") ? (
            billingConnected ? <form action="/api/stripe/portal" className="mt-5" method="post">
              <button className={SUPPORT_ACTION_CLASS} type="submit">{account.billingState === "attention_required" ? "Review billing" : "Manage billing"}</button>
            </form> : <p className="mt-4 text-sm text-black/65">{preview ? "Billing actions are disabled in this demo." : <>Billing is unavailable here. <Link className="underline underline-offset-4" href="/my/support">Contact support</Link> if you need help.</>}</p>
          ) : null}
        </section>
        <section aria-labelledby="account-agreement" className={sectionClass + " lg:col-span-2"}>
          <h2 className={labelClass} id="account-agreement">Agreement</h2>
          <dl className="mt-4 grid gap-5 sm:grid-cols-3">
            {[
              ["Agreement", account.agreement.title ?? "Not accepted"],
              ["Version", account.agreement.version ?? "—"],
              ["Accepted", account.agreement.acceptedAt ? formatDate(account.agreement.acceptedAt) : "Not yet"],
            ].map(([label, value]) => <div key={label}>
              <dt className="text-sm text-black/60">{label}</dt>
              <dd className="mt-1 text-base font-medium">{value}</dd>
            </div>)}
          </dl>
          {preview && account.agreement.receiptId ? <p className="mt-4 text-sm text-black/65">Example agreement record. Downloads are disabled in this demo.</p> : account.agreement.receiptId ? (
            // The receipt is a file attachment, not a client-side page.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a className={SUPPORT_LINK_CLASS + " mt-4"} href="/api/my/agreement/receipt">Download agreement receipt</a>
          ) : <p className="mt-4 text-sm text-black/65">{account.agreement.acceptedAt ? "Your receipt is not available yet." : "Your agreement and receipt will appear here after you accept it."}</p>}
        </section>
      </div>
      <nav aria-label="Account help" className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
        <Link className={SUPPORT_LINK_CLASS} href="/my/support">Support</Link>
        <Link className={SUPPORT_LINK_CLASS} href="/privacy">Privacy policy</Link>
      </nav>
    </main>
  );
}
