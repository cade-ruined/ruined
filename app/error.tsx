"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black px-6 text-center text-[var(--color-bone)]">
      <h1 className="display text-5xl uppercase">The path broke.</h1>
      <p className="max-w-md text-sm text-white/65">
        The experience could not finish loading. Your place is safe; try the route again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="border border-current px-5 py-3 font-mono text-xs uppercase tracking-[0.3em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        Retry
      </button>
    </main>
  );
}
