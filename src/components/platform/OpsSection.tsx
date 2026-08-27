import Link from "next/link";

import OperatorMemberDirectory from "@/components/platform/OperatorMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorProgress from "@/components/platform/OperatorProgress";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { OperatorDashboardSnapshot } from "@/lib/platform/model";

type OpsSectionName = "access-billing" | "circles" | "foundations" | "members" | "sync";

export default function OpsSection({
  actions,
  circles,
  configuration,
  dashboard,
  section,
}: {
  actions?: React.ReactNode;
  circles?: Array<{
    activeMembers: number;
    blockId?: string | null;
    blockName?: string | null;
    blockStatus?: string | null;
    capacity: number;
    id: string;
    name: string;
    status: string;
  }>;
  configuration: PlatformConfiguration;
  dashboard: OperatorDashboardSnapshot;
  section: OpsSectionName;
}) {
  const title = section === "access-billing" || section === "sync"
    ? "Access & Billing"
    : section[0].toUpperCase() + section.slice(1);
  const circleRows = circles ?? Array.from(
    new Set(dashboard.members.map((member) => member.circleName).filter(Boolean)),
  ).map((circleName) => {
    const member = dashboard.members.find((candidate) => candidate.circleName === circleName);
    return {
      activeMembers: dashboard.members.filter((candidate) => candidate.circleName === circleName).length,
      blockId: null,
      blockName: member?.blockName ?? null,
      blockStatus: member?.blockStatus ?? null,
      capacity: 10,
      id: String(circleName),
      name: String(circleName),
      status: member?.circleStatus ?? "active",
    };
  });

  return (
    <OperatorPageFrame title={title}>
      {section === "members" ? (
        <OperatorMemberDirectory members={dashboard.members} />
      ) : null}

      {section === "foundations" ? (
        <section className="mt-14" aria-label="Foundations snapshot">
          <div className="grid gap-px bg-black sm:grid-cols-3">
            {[
              ["Not started", dashboard.members.filter((member) => member.foundationsState === "not_started").length],
              ["Moving", dashboard.members.filter((member) => member.foundationsState === "in_progress").length],
              ["Complete", dashboard.members.filter((member) => member.foundationsState === "completed").length],
            ].map(([label, value]) => (
              <div className="bg-[#080605] px-5 py-5 text-[var(--color-bone)] sm:px-6" key={label}>
                <p className="text-sm text-white/48">{label}</p>
                <p className="mt-3 font-[var(--font-display)] text-4xl leading-none">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-2">
            {[...dashboard.members]
              .sort((left, right) => left.foundationsProgress - right.foundationsProgress)
              .map((member) => (
                <article
                  className="grid gap-4 bg-black/[0.025] px-4 py-4 transition-colors hover:bg-black/[0.05] sm:grid-cols-[minmax(12rem,1fr)_9rem_5rem_minmax(11rem,0.8fr)] sm:items-center sm:px-5"
                  id={`member-foundations-${member.memberId}`}
                  key={member.memberId}
                >
                  <div>
                    <h2 className="font-[var(--font-display)] text-xl leading-none">
                      <Link
                        className="transition-colors hover:text-[var(--color-poster)]"
                        href={`/ops/members/${member.memberId}#journey`}
                      >
                        {member.name}
                      </Link>
                    </h2>
                    <p className={`mt-2 text-sm ${member.circleName ? "text-black/45" : "text-[var(--color-poster)]"}`}>
                      {member.circleName ?? "Needs Circle"}
                    </p>
                  </div>
                  <StateLabel state={member.foundationsState} />
                  <p className="text-sm tabular-nums text-black/58">{member.foundationsProgress}%</p>
                  <OperatorProgress label={`${member.name} Foundations`} value={member.foundationsProgress} />
                </article>
              ))}
          </div>
        </section>
      ) : null}

      {section === "circles" ? (
        <section className="mt-14 grid gap-2" aria-label="Circle snapshot">
          {circleRows.map((circle) => (
            <article
              className="grid gap-4 bg-black/[0.025] px-4 py-5 transition-colors hover:bg-black/[0.05] md:grid-cols-[minmax(12rem,1fr)_9rem_minmax(10rem,0.8fr)_minmax(12rem,1fr)] md:items-center md:px-5"
              id={`circle-${circle.id}`}
              key={circle.id}
            >
              <div>
                <h2 className="font-[var(--font-display)] text-2xl leading-none">
                  <a className="hover:text-[var(--color-poster)]" href={`#circle-${circle.id}`}>
                    {circle.name}
                  </a>
                </h2>
                <p className="mt-2 text-sm text-black/42">{circle.blockName ?? "No Block"}</p>
              </div>
              <StateLabel state={circle.status} />
              <p className="text-sm tabular-nums text-black/58">
                {circle.activeMembers} / {circle.capacity} members
              </p>
              <p className="text-sm leading-relaxed text-black/50">
                {Math.max(0, circle.capacity - circle.activeMembers)} open
              </p>
            </article>
          ))}
          <article className="grid gap-4 bg-[var(--color-poster)]/[0.08] px-4 py-5 md:grid-cols-[minmax(12rem,1fr)_9rem_minmax(10rem,0.8fr)_minmax(12rem,1fr)] md:items-center md:px-5">
            <h2 className="font-[var(--font-display)] text-2xl leading-none">Without a Circle</h2>
            <StateLabel state="pending" />
            <p className="text-sm tabular-nums text-[var(--color-poster)]">{dashboard.unassignedMembers} members</p>
            <Link className="text-sm underline decoration-black/25 underline-offset-4" href="/ops/members?filter=unassigned">Place members</Link>
          </article>
        </section>
      ) : null}

      {section === "access-billing" || section === "sync" ? (
        <section className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.55fr)]">
          <div className="grid gap-2">
            {[
              ["Member identity", configuration.supabase, "Passwordless sign-in and verified identity."],
              ["Membership record", configuration.database, "Accounts, progress, Circles, Blocks, and history."],
              ["Membership billing", configuration.stripe, "Checkout, subscriptions, and payment attention."],
            ].map(([name, state, description]) => (
              <div
                className="grid gap-3 bg-black/[0.025] px-4 py-5 sm:grid-cols-[minmax(10rem,0.6fr)_8rem_minmax(12rem,1fr)] sm:items-center"
                key={name}
              >
                <h2 className="ui-heading text-base font-semibold">{name}</h2>
                <StateLabel state={state} />
                <p className="text-sm leading-relaxed text-black/50">{description}</p>
              </div>
            ))}
          </div>
          <aside className="bg-[#080605] p-6 text-[var(--color-bone)]">
            <p className="text-sm text-white/48">Billing attention</p>
            <p className="mt-5 text-5xl tracking-[-0.04em] text-[var(--color-poster)]">{dashboard.attentionRequired}</p>
          </aside>
        </section>
      ) : null}

      {actions ? (
        <details className="group mt-10 bg-[var(--color-surface)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-sm font-medium marker:content-none sm:px-6">
            <span>Manage {title}</span>
            <span aria-hidden="true" className="text-xl font-normal text-[var(--color-poster)] group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-black/10 px-5 pb-6 pt-5 sm:px-6">{actions}</div>
        </details>
      ) : null}
    </OperatorPageFrame>
  );
}
