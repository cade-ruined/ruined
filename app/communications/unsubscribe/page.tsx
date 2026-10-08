import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Email preferences", referrer: "no-referrer", robots: { index: false, follow: false },
};

export default async function EmailUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; status?: string }> }) {
  const { token, status } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
  const done = status === "unsubscribed";
  const unavailable = status === "unavailable";
  return <main className="min-h-screen bg-[var(--color-bone)] px-6 pb-28 pt-40 text-[var(--color-faded)]">
    <div className="mx-auto max-w-xl">
      <p className="font-mono text-xs uppercase tracking-widest">Ruined · Email preferences</p>
      <h1 className="mt-6 text-4xl leading-tight">{done ? "You’re unsubscribed." : unavailable ? "Try again shortly." : valid ? "Fewer emails." : "This link isn’t valid."}</h1>
      <p className="mt-6 text-base leading-relaxed opacity-75">{done
        ? "You will no longer receive general Ruined marketing updates. Essential membership and account emails are separate."
        : unavailable ? "Your preference could not be saved. Reopen the link in your email and try again."
        : valid ? "Unsubscribe from general Ruined marketing updates below. Essential membership and account emails are separate."
        : "Open the unsubscribe link in your Ruined email to manage this preference."}</p>
      {valid && !status && <form action="/api/communications/unsubscribe" method="post" className="mt-8">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="min-h-12 rounded px-6 py-3 bg-black text-white">Unsubscribe</button>
      </form>}
      <Link className="mt-10 inline-block underline underline-offset-4" href="/">Return to Ruined</Link>
    </div>
  </main>;
}
