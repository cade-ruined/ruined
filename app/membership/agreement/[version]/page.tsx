import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import AgreementText from "@/components/membership/AgreementText";
import { getPublicMembershipAgreement } from "@/lib/membership/published-agreement";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Membership Agreement | Ruined", robots: { index: false, follow: true } };

export default async function MembershipAgreementPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const agreement = await getPublicMembershipAgreement(version);
  if (!agreement) notFound();

  return <main className="min-h-screen bg-[#111111] px-6 pb-24 pt-32 text-white sm:px-10 sm:pt-40">
    <article className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.2em] text-white/60">Membership · Version {agreement.version}</p>
      <h1 className="mt-4 mb-10 font-[var(--font-display)] text-4xl leading-tight sm:text-5xl">{agreement.title}</h1>
      <AgreementText body={agreement.body} />
      <nav aria-label="Agreement help" className="mt-12 flex flex-wrap gap-x-6 gap-y-4 text-sm underline underline-offset-4">
        <a href="mailto:connect@theruinedproject.com">Contact Ruined</a>
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/my/activate">Manage membership</Link>
      </nav>
    </article>
  </main>;
}
