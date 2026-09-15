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
    <article className="operator-bento-card grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        {eyebrow ? <p className="mb-2 w-fit [font-family:var(--font-cadehandy2)] text-xl leading-none text-[var(--color-poster)]">
          {eyebrow}
        </p> : null}
        <h2 className="operator-section-heading max-w-2xl">
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
