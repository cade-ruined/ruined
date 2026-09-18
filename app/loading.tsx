export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black px-6 text-center text-[var(--color-bone)]">
      <p className="text-base" role="status">
        Entering Ruined…
      </p>
      {/* A native link can recover an interrupted document even before hydration. */}
      <a
        href=""
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-current/35 px-5 py-2 text-sm underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        Reload page
      </a>
    </main>
  );
}
