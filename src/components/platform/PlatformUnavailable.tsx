import Link from "next/link";

export default function PlatformUnavailable({
  accessHref,
  title = "Connection required.",
}: {
  accessHref?: string;
  title?: string;
}) {
  return (
    <section className="grid min-h-[55vh] content-center border-t border-white/15 py-16">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.24em] text-[var(--color-poster)]">
        Platform foundation
      </p>
      <h1 className="mt-6 max-w-4xl font-[var(--font-header)] text-[clamp(3.4rem,9vw,8rem)] font-bold uppercase leading-[0.78] tracking-[-0.06em]">
        {title}
      </h1>
      <p className="mt-8 max-w-xl text-sm leading-relaxed text-white/50 sm:text-base">
        This surface fails closed when its identity or database connection is unavailable. No payment, membership access, or operator action is being simulated.
      </p>
      {accessHref ? (
        <Link
          className="mt-8 w-fit border-b border-white/35 pb-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-white"
          href={accessHref}
        >
          Request passwordless access
        </Link>
      ) : null}
    </section>
  );
}
