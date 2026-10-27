import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page is unavailable. Return to Ruined to explore the store, membership, and gatherings.",
  robots: { index: false, follow: true },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black px-6 text-center text-[var(--color-bone)]">
      <p className="font-mono text-xs uppercase tracking-[0.45em]">404 · Uncatalogued</p>
      <h1 className="display text-6xl uppercase">Nothing lives here.</h1>
      <Link className="font-mono text-xs uppercase tracking-[0.3em] underline underline-offset-8" href="/">
        Return to the entrance
      </Link>
    </main>
  );
}
