import Link from "next/link";

import type { OpsMemberRecord } from "@/lib/platform/ops-model";

const ACTION_CLASS = "ui-heading mt-4 inline-flex min-h-11 items-center gap-3 text-sm font-semibold underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)]";

export default function OperatorMemberSetup({ record }: { record: OpsMemberRecord }) {
  if (!record.access.roles.includes("ops_admin")) return null;

  const memberId = encodeURIComponent(record.header.memberId);
  const circle = record.community.circle;

  return (
    <section aria-label="Circle placement and operator access" className="mt-6 grid gap-3 lg:grid-cols-2">
      <article className="rounded-[4px] bg-[var(--color-shop)]/35 p-5">
        <h3 className="ui-heading text-lg font-semibold">Circle placement</h3>
        <p className="mt-2 text-sm leading-relaxed text-black/60">
          {circle
            ? `${circle.name} · ${circle.state === "active" ? "Active" : circle.state === "forming" ? "Forming — activate when ready" : circle.state}`
            : "No Circle assigned. Operator access is not required to join one."}
        </p>
        {circle ? (
          <p className="mt-3 text-sm leading-relaxed text-black/65">
            This placement is already saved. {circle.state === "forming"
              ? "Open Manage members on this Circle, then confirm activation when it is ready to run. An active Circle is required to finish Foundations."
              : "There is no need to assign this member again when adding operator access."}
          </p>
        ) : (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-black/65">
            <li>Choose a Circle with space, then open Manage members.</li>
            <li>Review this member, then select Add to that Circle.</li>
            <li>For a forming Circle, confirm activation in the same panel when ready.</li>
          </ol>
        )}
        <Link className={ACTION_CLASS} href={circle && circle.state !== "forming" ? `/ops/circles#circle-${encodeURIComponent(circle.circleId)}` : `/ops/circles?memberId=${memberId}#${circle?.state === "forming" ? "activate-circle" : "assign-member"}`}>
          {circle?.state === "forming" ? "Review Circle activation" : circle ? "View Circles" : "Assign Circle"}<span aria-hidden="true">→</span>
        </Link>
      </article>

      <article className="rounded-[4px] bg-black/[0.035] p-5">
        <h3 className="ui-heading text-lg font-semibold">Operator access</h3>
        <p className="mt-2 text-sm leading-relaxed text-black/60">
          A separate permission on this same account. Administrator access does not require a Circle.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-black/65">
          <li>Choose Administrator, Shaper, or Guide.</li>
          <li>Choose Circle access for a Shaper or Guide, then send the invitation.</li>
          <li>The person opens the sign-in page and, if asked, verifies the newest code. Check for Active access.</li>
        </ol>
        <Link className={ACTION_CLASS} href={`/ops/operators?memberId=${memberId}`}>
          Review operator access<span aria-hidden="true">→</span>
        </Link>
      </article>
    </section>
  );
}
