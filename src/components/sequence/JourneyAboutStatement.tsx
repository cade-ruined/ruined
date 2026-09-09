import Link from "next/link";

export default function JourneyAboutStatement({
  headingId,
}: {
  headingId: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-journey-about-statement
      className="rounded-[5px] bg-black/88 p-5 text-[var(--color-bone)] shadow-[7px_8px_0_rgba(0,0,0,0.5)] backdrop-blur-sm sm:p-7"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(11rem,0.58fr)_minmax(0,1.42fr)] sm:gap-8">
        <header>
          <p style={{ fontFamily: "var(--font-handwritten)" }} className="text-[1.6rem] leading-none text-[var(--color-signal)]">
            About us
          </p>
          <h2
            id={headingId}
            className="ui-heading mt-3 text-[clamp(1.9rem,4vw,3.5rem)] uppercase leading-[0.94] tracking-[-0.05em]"
          >
            Refine what matters.
          </h2>
        </header>

        <div className="space-y-3 text-[clamp(0.72rem,1.5vw,0.875rem)] leading-[1.55] text-white/76 sm:leading-relaxed">
          <p>
            Ruined exists to refine potential into identity. We believe what we
            become is shaped by what we choose to keep, change, and create. That
            belief runs through everything we do. From the people we work with
            to the clothing, brands, products, and experiences we create.
            Different outputs, same philosophy: remove what’s unnecessary,
            refine what matters, and create what deserves to exist.
          </p>
          <Link href="/about" className="inline-flex min-h-11 items-center gap-5 font-[var(--font-header)] font-semibold text-[var(--color-bone)] underline decoration-white/35 underline-offset-4 hover:decoration-white">
            About Ruined <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
