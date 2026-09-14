import Link from "next/link";
import { SUPPORT_ACTION_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import type { MemberAccessPolicy } from "@/lib/membership/model";

export default function MemberAccessNotice({ access, title = "Foundations" }: { access: MemberAccessPolicy; title?: string }) {
  const entry = access.mode === "entry";
  return (
    <main className="mx-auto max-w-3xl py-6 pb-24 font-[var(--font-body)]">
      <h1 className="text-3xl font-extrabold uppercase tracking-tight sm:text-4xl">{title}</h1>
      <section className="mt-5 rounded-[4px] bg-[var(--color-bone)] p-5 text-[var(--color-faded)] sm:p-7">
        <h2 className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]">{entry ? "Your next step" : "Membership access"}</h2>
        <p className="mt-3 text-base leading-relaxed">{access.reason ?? "Foundations progress is not available with your current membership status. Your saved work has not been removed."}</p>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-4">
          <Link className={SUPPORT_ACTION_CLASS} href={entry ? "/my/join" : "/my/account"}>{entry ? "Finish membership entry" : "Review membership"}</Link>
          <Link className={SUPPORT_LINK_CLASS} href="/my">Back to my profile</Link>
          <Link className={SUPPORT_LINK_CLASS} href="/my/support">Get help</Link>
        </div>
      </section>
    </main>
  );
}
