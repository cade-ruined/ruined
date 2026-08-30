import Link from "next/link";

import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import type { OperatorDashboardSnapshot } from "@/lib/platform/model";
import type { OpsBlockSummary } from "@/lib/platform/ops-repository";

export default function OpsBlocks({
  actions,
  blocks,
  dashboard,
}: {
  actions?: React.ReactNode;
  blocks?: OpsBlockSummary[];
  dashboard: OperatorDashboardSnapshot;
}) {
  const visibleBlocks = blocks ?? Array.from(
    new Set(dashboard.members.map((member) => member.blockName).filter(Boolean)),
  ).map((blockName) => {
    const members = dashboard.members.filter((member) => member.blockName === blockName);
    const circles = Array.from(
      new Set(members.map((member) => member.circleName).filter(Boolean)),
    ).map((circleName) => ({
      id: String(circleName),
      name: String(circleName),
      status: members.find((member) => member.circleName === circleName)?.circleStatus ?? "active" as const,
    }));
    return {
      circles,
      currentCircles: circles.length,
      id: String(blockName),
      name: String(blockName),
      slug: String(blockName).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      status: members[0]?.blockStatus ?? "active" as const,
    };
  });

  return (
    <OperatorPageFrame title="Blocks">
      <section className="mt-2 grid gap-3" aria-label="Block hierarchy">
        {visibleBlocks.map((block) => (
          <article
            className="grid gap-5 rounded-[4px] bg-black/[0.025] px-5 py-6 transition-colors hover:bg-black/[0.05] lg:grid-cols-[minmax(13rem,0.7fr)_8rem_minmax(18rem,1fr)] lg:items-start lg:px-6"
            id={`block-${block.id}`}
            key={block.id}
          >
            <div>
              <h2 className="font-[var(--font-display)] text-3xl leading-none">
                <a className="hover:text-[var(--color-poster)]" href={`#block-${block.id}`}>
                  {block.name}
                </a>
              </h2>
              <p className="mt-3 text-sm text-black/42">
                {block.currentCircles} current Circles
                {block.status === "forming" && block.currentCircles < 2
                  ? ` · ${2 - block.currentCircles} more needed`
                  : ""}
              </p>
            </div>
            <StateLabel state={block.status} />
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-black/65">
              {block.circles.length > 0
                ? block.circles.map((circle) => (
                    <Link
                      className="underline decoration-black/20 underline-offset-4 hover:decoration-black"
                      href={`/ops/circles#circle-${circle.id}`}
                      key={circle.id}
                    >
                      {circle.name}
                    </Link>
                  ))
                : <span className="text-black/40">No Circles assigned</span>}
            </div>
          </article>
        ))}
        {visibleBlocks.length === 0 ? (
          <OperatorEmptyState
            actionHref={actions ? "#manage-blocks" : "/ops/circles"}
            actionLabel={actions ? "Create first Block" : "View Circles"}
            detail="A Block brings multiple Circles together. Create one when at least two Circles are ready to share a larger home."
            eyebrow="Circle → Block"
            title="No Blocks yet."
          />
        ) : null}
      </section>

      {actions ? (
        <details
          className={`group mt-10 rounded-[4px] bg-[var(--color-surface)] ${visibleBlocks.length === 0 ? "shadow-[5px_5px_0_var(--color-poster)]" : ""}`}
          id="manage-blocks"
          open={visibleBlocks.length === 0}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-sm font-medium marker:content-none sm:px-6">
            <span>{visibleBlocks.length === 0 ? "Create the first Block" : "Manage Blocks"}</span>
            <span aria-hidden="true" className="text-xl font-normal text-[var(--color-poster)] group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-black/10 px-5 pb-6 pt-5 sm:px-6">{actions}</div>
        </details>
      ) : null}
    </OperatorPageFrame>
  );
}
