import Link from "next/link";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { OperatorDashboardSnapshot } from "@/lib/platform/model";

export default function OpsOverview({
  dashboard,
}: {
  configuration: PlatformConfiguration;
  dashboard: OperatorDashboardSnapshot;
}) {
  const priorityMembers = dashboard.members
    .filter((member) => member.billingState === "attention_required")
    .slice(0, 6);
  const overviewMembers = priorityMembers.length > 0
    ? priorityMembers
    : dashboard.members.slice(0, 6);

  return (
    <OperatorPageFrame
      eyebrow="Overview"
      introduction="A quiet control room for member access, progress, Circles, Blocks, and billing. Each state stays independent so operators can see the real next decision."
      title="The membership, in view."
    >
      <section className="mt-16 border-y border-black/25 py-8" aria-label="Membership summary">
        <p className="max-w-6xl text-[clamp(1.75rem,4vw,3.8rem)] leading-[1.02] tracking-[-0.035em] text-black/84">
          <span className="font-medium text-black">{dashboard.activeMembers}</span> active members
          across <span className="font-medium text-black">{dashboard.totalMembers}</span> total,
          with <span className="font-medium text-[var(--color-poster)]"> {dashboard.attentionRequired}</span> needing attention
          and <span className="font-medium text-black"> {dashboard.unassignedMembers}</span> without a Circle.
        </p>
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-black/25 pb-4">
          <div>
            <p className="text-[0.64rem] font-medium uppercase tracking-[0.17em] text-black/42">
              {priorityMembers.length > 0 ? "Needs attention" : "Current roster"}
            </p>
            <h2 className="mt-3 text-3xl leading-none">Member decisions</h2>
          </div>
          <Link
            className="text-[0.66rem] font-medium uppercase tracking-[0.15em] text-black/55 underline decoration-black/25 underline-offset-8 hover:text-black"
            href="/ops/members"
          >
            Open member directory
          </Link>
        </div>

        <div className="divide-y divide-black/15">
          {overviewMembers.map((member) => (
            <article
              className="grid gap-4 py-5 sm:grid-cols-[minmax(12rem,1fr)_minmax(10rem,0.7fr)_8rem_minmax(11rem,1fr)] sm:items-center"
              key={member.memberId}
            >
              <div>
                <h3 className="ui-heading text-base font-semibold">{member.name}</h3>
                <p className="mt-1 text-sm text-black/45">{member.email}</p>
              </div>
              <p className="text-sm leading-relaxed text-black/58">
                {member.circleName ?? "No Circle"}
                <span className="block text-black/38">{member.blockName ?? "No Block"}</span>
              </p>
              <StateLabel state={member.billingState} />
              <p className="text-sm leading-relaxed text-black/58">{member.nextAction}</p>
            </article>
          ))}
        </div>
      </section>

      <nav className="mt-16 grid border-y border-black/25 sm:grid-cols-3" aria-label="Operator next views">
        {[
          ["Foundations", "/ops/foundations", "Review completion and members still in progress."],
          ["Circles", "/ops/circles", "Place eligible members and manage active groups."],
          ["Blocks", "/ops/blocks", "Organize multiple Circles without changing Foundations."],
        ].map(([label, href, description], index) => (
          <Link
            className={`group py-6 sm:px-7 ${index > 0 ? "border-t border-black/15 sm:border-l sm:border-t-0" : ""}`}
            href={href}
            key={href}
          >
            <span className="ui-heading text-lg font-semibold">{label}</span>
            <span className="mt-3 block max-w-xs text-sm leading-relaxed text-black/50 group-hover:text-black/70">
              {description}
            </span>
          </Link>
        ))}
      </nav>
    </OperatorPageFrame>
  );
}
