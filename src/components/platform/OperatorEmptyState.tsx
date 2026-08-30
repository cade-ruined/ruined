import Link from "next/link";

export default function OperatorEmptyState({
  actionHref,
  actionLabel,
  detail,
  eyebrow = "Ready when you are",
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  detail: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <article className="grid gap-6 rounded-[4px] bg-black/[0.035] px-5 py-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:px-7 sm:py-8">
      <div>
        <p className="w-fit origin-left [font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none text-[var(--color-poster)] [transform:rotate(-3deg)]">
          {eyebrow}
        </p>
        <h2 className="mt-3 max-w-2xl font-[var(--font-display)] text-3xl leading-[0.95] tracking-[-0.03em] sm:text-4xl">
          {title}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-black/55">{detail}</p>
      </div>
      {actionHref && actionLabel ? (
        <Link
          className="ui-heading inline-flex min-h-12 items-center justify-center rounded-[4px] border border-black bg-black px-5 py-3 text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-bone)] shadow-[4px_4px_0_var(--color-poster)] transition-[background-color,transform,box-shadow] hover:-translate-y-px hover:bg-[var(--color-poster)] hover:shadow-[2px_2px_0_var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          href={actionHref}
        >
          {actionLabel} →
        </Link>
      ) : null}
    </article>
  );
}
