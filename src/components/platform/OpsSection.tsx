import Link from "next/link";

import OperatorGoogleCommunicationField from "@/components/platform/OperatorGoogleCommunicationField";
import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorMemberDirectory from "@/components/platform/OperatorMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorProgress from "@/components/platform/OperatorProgress";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { OperatorDashboardSnapshot } from "@/lib/platform/model";

function FoundationMemberRow({
  member,
}: {
  member: OperatorDashboardSnapshot["members"][number];
}) {
  return (
    <article
      className="grid gap-4 rounded-[4px] bg-black/[0.025] px-4 py-4 transition-colors hover:bg-black/[0.05] sm:grid-cols-[minmax(12rem,1fr)_9rem_5rem_minmax(11rem,0.8fr)] sm:items-center sm:px-5"
      id={`member-foundations-${member.memberId}`}
    >
      <div>
        <h3 className="font-[var(--font-display)] text-xl leading-none">
          <Link
            className="transition-colors hover:text-[var(--color-poster)]"
            href={`/ops/members/${member.memberId}#journey`}
          >
            {member.name}
          </Link>
        </h3>
        <p className={`mt-2 text-sm ${member.circleName ? "text-black/45" : "text-[var(--color-poster)]"}`}>
          {member.circleName ?? "Circle needed before completion"}
        </p>
      </div>
      <StateLabel state={member.foundationsState} />
      <p className="text-sm tabular-nums text-black/58">{member.foundationsProgress}%</p>
      <OperatorProgress label={`${member.name} Foundations`} value={member.foundationsProgress} />
    </article>
  );
}

type OpsSectionName = "access-billing" | "circles" | "foundations" | "members" | "sync";

export default function OpsSection({
  actions,
  canManageGoogleCommunications = false,
  circles,
  configuration,
  dashboard,
  section,
}: {
  actions?: React.ReactNode;
  canManageGoogleCommunications?: boolean;
  circles?: Array<{
    activeMembers: number;
    blockId?: string | null;
    blockName?: string | null;
    blockStatus?: string | null;
    capacity: number;
    chatUrl?: string | null;
    googleCommunicationsConfigured?: boolean;
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
      chatUrl: null,
      googleCommunicationsConfigured: undefined,
      id: String(circleName),
      name: String(circleName),
      status: member?.circleStatus ?? "active",
    };
  });
  const foundationGroups = [
    {
      action: true,
      label: "Circle needed",
      members: dashboard.members.filter((member) => !member.circleName && member.foundationsState !== "completed"),
    },
    {
      action: false,
      label: "Moving",
      members: dashboard.members.filter((member) => Boolean(member.circleName) && member.foundationsState === "in_progress"),
    },
    {
      action: false,
      label: "Not started",
      members: dashboard.members.filter((member) => Boolean(member.circleName) && member.foundationsState === "not_started"),
    },
  ];
  const completedFoundations = dashboard.members.filter((member) => member.foundationsState === "completed");

  return (
    <OperatorPageFrame title={title}>
      {section === "members" ? (
        <OperatorMemberDirectory members={dashboard.members} />
      ) : null}

      {section === "foundations" ? (
        <section className="mt-2" aria-label="Foundations snapshot">
          <div className="grid gap-px overflow-hidden rounded-[4px] bg-black sm:grid-cols-3">
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
          <div className="mt-7 grid gap-8">
            {foundationGroups.map((group) => group.members.length ? (
              <section aria-labelledby={`foundations-${group.label.replaceAll(" ", "-").toLowerCase()}`} key={group.label}>
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 className="font-[var(--font-display)] text-2xl leading-none" id={`foundations-${group.label.replaceAll(" ", "-").toLowerCase()}`}>
                    {group.label} <span className="text-black/35">{group.members.length}</span>
                  </h2>
                  {group.action ? (
                    <Link className="text-sm underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)]" href="/ops/members?filter=unassigned">
                      Place members →
                    </Link>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  {[...group.members]
                    .sort((left, right) => left.foundationsProgress - right.foundationsProgress)
                    .map((member) => <FoundationMemberRow key={member.memberId} member={member} />)}
                </div>
              </section>
            ) : null)}
            {foundationGroups.every((group) => group.members.length === 0) && completedFoundations.length === 0 ? (
              <OperatorEmptyState
                detail="Members will appear here as soon as their membership begins."
                eyebrow="All clear"
                title="No Foundations work is waiting."
              />
            ) : null}
            {completedFoundations.length ? (
              <details className="group rounded-[4px] bg-black/[0.025]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
                  <span className="font-[var(--font-display)] text-2xl">Complete <span className="text-black/35">{completedFoundations.length}</span></span>
                  <span aria-hidden="true" className="text-2xl transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="grid gap-2 px-3 pb-3">
                  {completedFoundations.map((member) => <FoundationMemberRow key={member.memberId} member={member} />)}
                </div>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      {section === "circles" ? (
        <section className="mt-2 grid gap-2" aria-label="Circle snapshot">
          {circleRows.length === 0 ? (
            <OperatorEmptyState
              actionHref={actions ? "#manage-circles" : "/ops/members?filter=unassigned"}
              actionLabel={actions ? "Create first Circle" : "View unplaced members"}
              detail="A Circle holds up to ten members, their Shaper, shared resources, and communication link."
              eyebrow="Start here"
              title="Build the first Circle."
            />
          ) : null}
          {circleRows.map((circle) => (
            <article
              className="grid gap-4 rounded-[4px] bg-black/[0.025] px-4 py-5 transition-colors hover:bg-black/[0.05] xl:grid-cols-[minmax(12rem,1fr)_8rem_minmax(9rem,0.7fr)_minmax(7rem,0.55fr)_minmax(14rem,0.9fr)] xl:items-center xl:px-5"
              id={`circle-${circle.id}`}
              key={circle.id}
            >
              <div>
                <h2 className="font-[var(--font-display)] text-2xl leading-none">
                  {circle.name}
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
              {circle.googleCommunicationsConfigured !== undefined ? (
                <div>
                  <OperatorGoogleCommunicationField
                    configured={circle.googleCommunicationsConfigured}
                    editable={canManageGoogleCommunications}
                    entityId={circle.id}
                    entityType="circle"
                    initialUrl={circle.chatUrl ?? null}
                    kind="chat"
                  />
                </div>
              ) : null}
            </article>
          ))}
          <article className="grid gap-4 rounded-[4px] bg-[var(--color-poster)]/[0.08] px-4 py-5 xl:grid-cols-[minmax(12rem,1fr)_9rem_minmax(10rem,0.8fr)_minmax(12rem,1fr)] xl:items-center xl:px-5">
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
                className="grid gap-3 rounded-[4px] bg-black/[0.025] px-4 py-5 sm:grid-cols-[minmax(10rem,0.6fr)_8rem_minmax(12rem,1fr)] sm:items-center"
                key={name}
              >
                <h2 className="ui-heading text-base font-semibold">{name}</h2>
                <StateLabel state={state} />
                <p className="text-sm leading-relaxed text-black/50">{description}</p>
              </div>
            ))}
          </div>
          <aside className="rounded-[4px] bg-[#080605] p-6 text-[var(--color-bone)]">
            <p className="text-sm text-white/48">Billing attention</p>
            <p className="mt-5 text-5xl tracking-[-0.04em] text-[var(--color-poster)]">{dashboard.attentionRequired}</p>
          </aside>
        </section>
      ) : null}

      {actions ? (
        <details
          className={`group mt-10 rounded-[4px] bg-[var(--color-surface)] ${section === "circles" && circleRows.length === 0 ? "shadow-[5px_5px_0_var(--color-poster)]" : ""}`}
          id={section === "circles" ? "manage-circles" : undefined}
          open={section === "circles" && circleRows.length === 0}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-sm font-medium marker:content-none sm:px-6">
            <span>{section === "circles" && circleRows.length === 0 ? "Create the first Circle" : `Manage ${title}`}</span>
            <span aria-hidden="true" className="text-xl font-normal text-[var(--color-poster)] group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-black/10 px-5 pb-6 pt-5 sm:px-6">{actions}</div>
        </details>
      ) : null}
    </OperatorPageFrame>
  );
}
