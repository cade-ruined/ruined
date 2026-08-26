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
    <OperatorPageFrame
      eyebrow="Blocks"
      introduction="A Block gathers multiple Circles into one larger membership group. It changes how operators organize the system; it does not add another Foundations requirement."
      title="Blocks"
    >
      {actions ? <div className="mt-14">{actions}</div> : null}

      <section className="mt-14 border-t border-black/25" aria-label="Block hierarchy">
        {visibleBlocks.map((block) => (
          <article
            className="grid gap-6 border-b border-black/20 py-7 lg:grid-cols-[minmax(13rem,0.7fr)_8rem_minmax(18rem,1fr)_minmax(12rem,0.55fr)] lg:items-start"
            key={block.id}
          >
            <div>
              <h2 className="text-3xl leading-none">{block.name}</h2>
              <p className="mt-3 text-sm text-black/42">{block.currentCircles} current Circles</p>
            </div>
            <StateLabel state={block.status} />
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-black/65">
              {block.circles.length > 0
                ? block.circles.map((circle) => (
                    <span key={circle.id}>{circle.name}</span>
                  ))
                : <span className="text-black/40">No Circles assigned</span>}
            </div>
            <p className="text-sm leading-relaxed text-black/50">
              {block.status === "forming" && block.currentCircles < 2
                ? `${2 - block.currentCircles} more current Circle${2 - block.currentCircles === 1 ? "" : "s"} needed before activation.`
                : block.status === "forming"
                  ? "Ready for deliberate activation."
                  : "Current Block relationship is visible to its own members."}
            </p>
          </article>
        ))}
        {visibleBlocks.length === 0 ? (
          <p className="border-b border-black/15 py-10 text-sm text-black/50">
            No Blocks have been created yet.
          </p>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
