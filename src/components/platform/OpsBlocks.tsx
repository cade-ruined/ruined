import Link from "next/link";

import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import { OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
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
      <header className="operator-record-header flex flex-wrap items-center justify-between gap-3">
      <h2 className="operator-page-heading">Blocks</h2>
      <nav aria-label="Block tasks" className="flex flex-wrap items-center gap-3">
        {actions ? <a id="new-block-trigger" className={OPERATOR_PRIMARY_ACTION_CLASS} href="#create-block">+ New Block</a> : null}
        <Link className="inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-4" href="/ops/circles">Manage Circles →</Link>
      </nav>
      </header>
      <section className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Block hierarchy">
        {visibleBlocks.map((block) => (
          <article
            className="operator-bento-card flex flex-col gap-3 transition-colors hover:bg-black/[0.05]"
            id={`block-${block.id}`}
            key={block.id}
          >
            <div>
              <h2 className="text-xl font-semibold leading-tight">
                {block.name}
              </h2>
              <p className="mt-3 text-sm text-black/42">
                {block.currentCircles} current {block.currentCircles === 1 ? "Circle" : "Circles"}
                {block.status === "forming" && block.currentCircles < 2
                  ? ` · ${2 - block.currentCircles} more needed`
                  : ""}
              </p>
              {actions ? <a id={`manage-block-trigger-${block.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href={`#manage-block-${block.id}`}>Manage Block →</a> : null}
            </div>
            <StateLabel state={block.status} />
            <div className="flex flex-wrap gap-2 text-sm text-black/65">
              {block.circles.length > 0
                ? block.circles.map((circle) => (
                    <Link
                      className="inline-flex min-h-11 items-center rounded-md bg-white/25 px-3 text-xs font-medium hover:bg-white/50"
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
            actionHref={actions ? "#create-block" : "/ops/circles"}
            actionLabel={actions ? "Create first Block" : "View Circles"}
            detail="A Block brings multiple Circles together. Create one when at least two Circles are ready to share a larger home."
            eyebrow="Circle → Block"
            title="No Blocks yet."
          />
        ) : null}
      </section>

      {actions ? (
        <section
          className="scroll-mt-28"
          id="manage-blocks"
          aria-label="Block setup"
        >
          {actions}
        </section>
      ) : null}
    </OperatorPageFrame>
  );
}
