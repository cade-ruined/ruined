import Link from "next/link";
import { OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";

export default function OperatorEmptyState({
  actionHref,
  actionLabel,
  detail,
  eyebrow,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  detail: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <article className="grid gap-4 rounded-[4px] bg-black/[0.035] px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6 sm:py-6">
      <div>
        {eyebrow ? <p className="mb-2 w-fit [font-family:var(--font-cadehandy2)] text-xl leading-none text-[var(--color-poster)]">
          {eyebrow}
        </p> : null}
        <h2 className="max-w-2xl font-[var(--font-display)] text-2xl leading-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/60">{detail}</p>
      </div>
      {actionHref && actionLabel ? (
        <Link
          className={OPERATOR_PRIMARY_ACTION_CLASS}
          href={actionHref}
        >
          {actionLabel} →
        </Link>
      ) : null}
    </article>
  );
}
