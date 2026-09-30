import Image from "next/image";
import Link from "next/link";
import InstallRuined from "@/components/membership/InstallRuined";

type Props = {
  email: string;
  registeredAt: string | null;
  requiresPaymentMethod: boolean;
  preview?: boolean;
};

/** Registration is confirmed by the server before this receipt is rendered. */
export default function MemberRegistrationReceipt({ email, registeredAt, requiresPaymentMethod, preview = false }: Props) {
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
      <div className="grid min-w-0 gap-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] sm:gap-12">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Keep an eye on your email.</h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">We’ll email <span className="break-words font-medium text-[var(--member-ink)]">{email}</span> when your profile is ready. There’s nothing else you need to do today.</p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">You can close this page and sign back in whenever you need. Your registration will be here.</p>
        </div>
        <div className="border-t border-[var(--member-rule)] pt-5 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em]">Registration saved{date ? <span className="mt-2 block font-normal normal-case tracking-normal">{date}</span> : null}</p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">{requiresPaymentMethod ? "Your card is saved securely with Stripe. Nothing has been charged, and no subscription has started. You’ll confirm a future checkout before any payment." : "Your complimentary registration is confirmed. No payment card is required."}</p>
          {requiresPaymentMethod ? <Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/payment-method">Manage saved card</Link> : null}
        </div>
      </div>
      <div className="mt-8 border-t border-[var(--member-rule)] pt-6"><InstallRuined variant="profile" /></div>
      <a className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="mailto:connect@theruinedproject.com">Need a hand? Contact Ruined</a>
    </section>
  </main>;
}
