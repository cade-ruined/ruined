import type { Metadata } from "next";
import Link from "next/link";
import BagPageClient from "@/components/store/BagPageClient";

export const metadata: Metadata = {
  title: "Bag",
  description: "Review selected Ruined pieces and continue to checkout.",
  robots: { index: false, follow: true },
};

export default function BagPage() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "connect@theruinedproject.com";

  return (
    <main className="min-h-screen bg-black px-5 pb-24 pt-10 text-[var(--color-bone)] sm:px-10 sm:pt-12">
      <div className="mx-auto max-w-[96rem]">
        <div className="flex items-center justify-between gap-5 font-mono text-[0.56rem] uppercase tracking-[0.24em] text-white/45">
          <Link href="/#store" className="transition-colors hover:text-white">← Store</Link>
          <span>Held in this browser</span>
        </div>
        <div className="mb-10 mt-10 border-b border-white/15 pb-8 sm:mb-14 sm:mt-14 sm:pb-10">
          <p className="font-mono text-[0.56rem] uppercase tracking-[0.28em] text-[var(--color-poster)]">Your selection</p>
          <h1 className="display mt-3 text-[clamp(3.5rem,10vw,8rem)] leading-[0.82]">Bag.</h1>
        </div>
        <BagPageClient email={email} />
      </div>
    </main>
  );
}
