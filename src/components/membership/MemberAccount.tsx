import Link from "next/link";

import MemberPageHeader from "@/components/membership/MemberPageHeader";
import StateLabel from "@/components/platform/StateLabel";
import type { MemberAccountSnapshot } from "@/lib/membership/model";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value));
}

export default function MemberAccount({
  account,
  billingConnected,
}: {
  account: MemberAccountSnapshot;
  billingConnected: boolean;
}) {
  return (
    <main>
      <MemberPageHeader
        eyebrow="Ruined Membership / Account"
        imageIntent="A closed black folder, one sheet visible, direct overhead light. Administrative but human."
        imageSequence="08"
        note="the practical record"
        summary="Membership standing, billing access, and the exact agreement receipt live here—separate from your profile and Circle presence."
        title="Membership, without the noise."
      />

      {account.access.reason ? (
        <p className="mt-10 border-l-2 border-[var(--color-poster)] bg-black/[0.025] px-5 py-4 font-[var(--font-body)] text-sm leading-relaxed text-black/62" role="status">{account.access.reason}</p>
      ) : null}

      <section className="mt-16 grid bg-[#080605] text-[var(--color-bone)] lg:grid-cols-2">
        <div className="px-6 py-10 sm:px-10 lg:px-14 lg:py-16">
          <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">Standing</p>
          <h2 className="mt-6 font-[var(--font-display)] text-5xl capitalize leading-[0.9] tracking-[-0.04em] sm:text-6xl">{account.standingState.replaceAll("_", " ")}</h2>
          <div className="mt-7"><StateLabel state={account.billingState} /></div>
          <p className="mt-6 font-[var(--font-body)] text-sm text-white/45">{account.email}</p>
        </div>
        <div className="border-t border-white/15 px-6 py-10 sm:px-10 lg:border-l lg:border-t-0 lg:px-14 lg:py-16">
          <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-white/38">Billing</p>
          <h2 className="mt-6 font-[var(--font-display)] text-4xl leading-none tracking-[-0.035em]">Secure management through Stripe.</h2>
          <p className="mt-6 max-w-lg font-[var(--font-body)] text-sm leading-relaxed text-white/45">Update the payment method, review invoices, or manage the subscription in the secure billing portal.</p>
          <form action="/api/stripe/portal" method="post">
            <button className="mt-8 min-h-12 border border-white bg-white px-6 font-[var(--font-body)] text-xs font-medium uppercase tracking-[0.14em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:opacity-40" disabled={!billingConnected} type="submit">{billingConnected ? "Open billing" : "Billing unavailable"}</button>
          </form>
        </div>
      </section>

      <section className="mt-20 grid gap-10 border-y border-black/20 py-10 lg:grid-cols-[minmax(17rem,0.65fr)_minmax(0,1.35fr)] lg:gap-20 lg:py-14">
        <div>
          <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">Agreement</p>
          <h2 className="mt-5 font-[var(--font-display)] text-5xl leading-[0.92] tracking-[-0.04em]">The copy you accepted.</h2>
        </div>
        <div>
          <dl className="border-t border-black/15">
            {[
              ["Agreement", account.agreement.title ?? "No durable acceptance yet"],
              ["Version", account.agreement.version ?? "—"],
              ["Accepted", account.agreement.acceptedAt ? formatDate(account.agreement.acceptedAt) : "—"],
            ].map(([label, value]) => (
              <div className="grid gap-2 border-b border-black/15 py-5 sm:grid-cols-[9rem_minmax(0,1fr)]" key={label}>
                <dt className="font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.14em] text-black/35">{label}</dt>
                <dd className="font-[var(--font-body)] text-sm text-black/64">{value}</dd>
              </div>
            ))}
          </dl>
          {account.agreement.receiptId ? (
            // This route returns an attachment, so native navigation is intentional.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a className="mt-7 inline-flex font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black/52 underline decoration-black/25 underline-offset-8 hover:text-black" href="/api/my/agreement/receipt">Download receipt →</a>
          ) : (
            <p className="mt-7 font-[var(--font-body)] text-sm leading-relaxed text-black/45">A receipt will appear after the durable acceptance record is generated.</p>
          )}
        </div>
      </section>

      <div className="mt-10 flex flex-wrap gap-x-8 gap-y-4 font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black/45">
        <Link className="underline decoration-black/20 underline-offset-8 hover:text-black" href="/my/profile">Edit profile</Link>
        <Link className="underline decoration-black/20 underline-offset-8 hover:text-black" href="/privacy">Privacy policy</Link>
      </div>
    </main>
  );
}
