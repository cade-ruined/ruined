import Link from "next/link";

import type { OpsMemberRecord } from "@/lib/platform/ops-model";
import { guidanceForMemberRecord } from "@/lib/platform/operator-member-guidance";

const ACTION_CLASS = "ui-heading mt-2 inline-flex min-h-11 items-center gap-3 text-sm font-semibold underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)]";

export default function OperatorMemberSetup({ record }: { record: OpsMemberRecord }) {
  if (!record.access.roles.includes("ops_admin")) return null;

  const memberId = encodeURIComponent(record.header.memberId);
  const circle = record.community.circle;
  const next = guidanceForMemberRecord(record);
  const participationReview = next.key === "ongoing-review";
  const placementBlocked = next.placement === "blocked";

  return (
    <section aria-label="Circle placement and operator access" className="mt-3 grid gap-3 lg:grid-cols-2">
      <article className="operator-bento-card bg-[var(--color-shop)]/25">
        <h3 className="ui-heading text-base font-semibold">Circle placement</h3>
        <p className="mt-2 text-sm leading-relaxed text-black/60">
          {circle
            ? `${circle.name} · ${circle.state === "active" ? "Active" : circle.state === "forming" ? participationReview ? "Forming" : "Forming — activate when ready" : circle.state}`
            : "No Circle assigned. Operator access is not required to join one."}
        </p>
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer content-center text-xs font-medium text-black/55">Placement guidance</summary>
        {participationReview ? (
          <p className="mt-3 text-sm leading-relaxed text-black/65">
            {next.detail} {circle ? "The existing Circle assignment is still saved." : "No new placement is made here."} Review participation with an Administrator before any Circle change.
          </p>
        ) : placementBlocked ? (
          <p className="mt-3 text-sm leading-relaxed text-black/65">
            {next.actor}: {next.title}. Review joining and billing before changing placement.
            {circle ? " The existing Circle assignment is still saved." : " Circle placement does not complete joining or restore access."}
          </p>
        ) : circle ? (
          <p className="mt-3 text-sm leading-relaxed text-black/65">
            This placement is already saved. {circle.state === "forming"
              ? "Open Manage Circle, then confirm activation when it is ready to run. An active Circle is required to finish Foundations."
              : "There is no need to assign this member again when adding operator access."}
          </p>
        ) : (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-black/65">
            <li>Choose a Circle with space, then open Manage Circle.</li>
            <li>Review this member’s current eligibility, then select Add when available.</li>
            <li>For a forming Circle, confirm activation in the same panel when ready.</li>
          </ol>
        )}
        </details>
        <Link className={ACTION_CLASS} href={participationReview ? "#journey" : placementBlocked ? "#membership" : circle ? `/ops/circles?circleId=${encodeURIComponent(circle.circleId)}&memberId=${memberId}#circle-${encodeURIComponent(circle.circleId)}` : `/ops/circles?memberId=${memberId}#assign-member`}>
          {participationReview ? "Review ongoing participation" : placementBlocked ? "Review joining & billing" : circle?.state === "forming" ? "Review Circle activation" : circle ? "View Circles" : "Review Circle placement"}<span aria-hidden="true">→</span>
        </Link>
      </article>

      <article className="operator-bento-card">
        <h3 className="ui-heading text-base font-semibold">Operator access</h3>
        <p className="mt-2 text-sm leading-relaxed text-black/60">
          A separate permission on this same account. Administrator access does not require a Circle.
        </p>
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer content-center text-xs font-medium text-black/55">How operator access works</summary>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-black/65">
          <li>Choose Administrator, Shaper, or Guide.</li>
          <li>Choose Circle access for a Shaper or Guide, then send the invitation.</li>
          <li>The person opens the sign-in page and, if asked, verifies the newest code. Check for Active access.</li>
        </ol>
        </details>
        <Link className={ACTION_CLASS} href={`/ops/operators?memberId=${memberId}`}>
          Review operator access<span aria-hidden="true">→</span>
        </Link>
      </article>
    </section>
  );
}
