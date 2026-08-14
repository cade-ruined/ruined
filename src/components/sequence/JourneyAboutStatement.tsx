export default function JourneyAboutStatement({
  headingId,
}: {
  headingId: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-journey-about-statement
      className="border border-white/25 bg-black/88 p-4 text-white shadow-[7px_8px_0_rgba(0,0,0,0.5)] backdrop-blur-sm sm:p-6"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(11rem,0.58fr)_minmax(0,1.42fr)] sm:gap-8">
        <header>
          <p className="ui-heading text-xs text-[var(--color-poster)]">
            About
          </p>
          <h2
            id={headingId}
            className="display mt-2 text-[clamp(1.75rem,4vw,3.5rem)] leading-[0.92]"
          >
            About Ruined.
          </h2>
        </header>

        <div className="space-y-3 text-[0.72rem] leading-[1.55] text-white/76 sm:text-sm sm:leading-relaxed">
          <p>
            Ruined exists to refine potential into identity. We believe what we
            become is shaped by what we choose to keep, change, and create. That
            belief runs through everything we do. From the people we work with
            to the clothing, brands, products, and experiences we create.
            Different outputs, same philosophy: remove what’s unnecessary,
            refine what matters, and create what deserves to exist.
          </p>
          <p>
            This site is still being built. But like most things Ruined, we
            think you should see the process, not just the finished product. So
            come in. Look around. Consider this a walk through a small piece of
            our world while we’re still making it.
          </p>
        </div>
      </div>
    </section>
  );
}
