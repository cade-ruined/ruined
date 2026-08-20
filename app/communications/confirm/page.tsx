import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Confirm email",
  alternates: { canonical: "/communications/confirm" },
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

type SearchValue = string | string[] | undefined;
type ConfirmationStatus =
  | "confirmed"
  | "already_confirmed"
  | "invalid"
  | "expired"
  | "unavailable";

const STATUS_COPY: Record<ConfirmationStatus, {
  eyebrow: string;
  title: string;
  message: string;
}> = {
  confirmed: {
    eyebrow: "Email confirmed",
    title: "You’re in.",
    message: "Your place on this list is confirmed. We’ll only send the updates you chose.",
  },
  already_confirmed: {
    eyebrow: "No action needed",
    title: "Already confirmed.",
    message: "This email preference was confirmed earlier. Nothing else is required.",
  },
  invalid: {
    eyebrow: "Confirmation unavailable",
    title: "This link isn’t valid.",
    message: "The confirmation link is incomplete or has already been replaced. Return to Ruined and request a new one.",
  },
  expired: {
    eyebrow: "Confirmation expired",
    title: "Time ran out.",
    message: "This confirmation link has expired. Return to Ruined and submit your email again for a new link.",
  },
  unavailable: {
    eyebrow: "Confirmation unavailable",
    title: "Try again later.",
    message: "We couldn’t confirm this request right now. No preference was changed.",
  },
};

function firstSearchValue(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isConfirmationStatus(value: string | undefined): value is ConfirmationStatus {
  return Boolean(value && Object.hasOwn(STATUS_COPY, value));
}

export default async function CommunicationConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const params = await searchParams;
  const requestedStatus = firstSearchValue(params.status);
  const status = isConfirmationStatus(requestedStatus) ? requestedStatus : undefined;
  const token = firstSearchValue(params.token)?.trim() ?? "";
  const hasPlausibleToken = token.length >= 20 && token.length <= 512;
  const copy = status ? STATUS_COPY[status] : undefined;

  return (
    <main className="min-h-screen bg-[var(--color-bone)] px-6 pb-28 pt-32 text-[var(--color-faded)] sm:px-10 sm:pt-40">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.38em] text-[var(--color-poster)]">
          {copy?.eyebrow ?? (hasPlausibleToken ? "One final step" : "Confirmation unavailable")}
        </p>

        <h1 className="display mt-5 max-w-4xl text-[clamp(3rem,9vw,7rem)] leading-[0.88]">
          {copy?.title ?? (hasPlausibleToken ? "Confirm what you chose." : "This link isn’t valid.")}
        </h1>

        <p className="mt-8 max-w-2xl text-lg leading-relaxed opacity-75">
          {copy?.message ?? (hasPlausibleToken
            ? "Opening this page did not change your email preferences. Confirm below to complete the request."
            : "The confirmation link is incomplete. Return to Ruined and submit your email again.")}
        </p>

        {!copy && hasPlausibleToken && (
          <form
            action="/api/communications/confirm"
            method="post"
            className="mt-12 max-w-xl border-t border-black/15 pt-8"
          >
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="min-h-12 border border-[var(--color-faded)] bg-[var(--color-faded)] px-7 py-4 font-mono text-[0.68rem] uppercase tracking-[0.26em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-faded)]"
            >
              Confirm email
            </button>
            <p className="mt-5 max-w-md text-sm leading-relaxed opacity-55">
              Only this deliberate action confirms your subscription.
            </p>
          </form>
        )}

        <Link
          href="/"
          className="mt-16 inline-block font-mono text-xs uppercase tracking-[0.3em] underline underline-offset-8"
        >
          ← Return home
        </Link>
      </div>
    </main>
  );
}
