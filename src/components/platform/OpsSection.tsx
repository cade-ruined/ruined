import OperatorMemberDirectory from "@/components/platform/OperatorMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { OperatorDashboardSnapshot } from "@/lib/platform/model";

type OpsSectionName = "access-billing" | "circles" | "foundations" | "members" | "sync";

const SECTION_COPY: Record<
  OpsSectionName,
  { introduction: string; title: string }
> = {
  "access-billing": {
    introduction: "Read access and payment health together without collapsing them into one state. A billing problem should never silently rewrite a member account.",
    title: "Access & Billing",
  },
  circles: {
    introduction: "Circles are the member-level working groups. Place eligible members, protect capacity, and activate only when the Circle is ready.",
    title: "Circles",
  },
  foundations: {
    introduction: "See who is beginning, moving, or complete. A member still needs an active Circle before Foundations can be completed.",
    title: "Foundations",
  },
  members: {
    introduction: "Search the visible roster by person, email, Circle, or Block, then narrow the view to the decision that needs attention.",
    title: "Members",
  },
  sync: {
    introduction: "The membership system commits its own truth before downstream delivery. External services remain visible but independent.",
    title: "Access & Billing",
  },
};

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
  const copy = SECTION_COPY[section];
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
    <OperatorPageFrame
      eyebrow={section === "sync" ? "Access & Billing" : copy.title}
      introduction={copy.introduction}
      title={copy.title}
    >
      {actions ? <div className="mt-14">{actions}</div> : null}

      {section === "members" ? (
        <OperatorMemberDirectory members={dashboard.members} />
      ) : null}

      {section === "foundations" ? (
        <section className="mt-14">
          <div className="border-y border-black/25 py-7">
            <p className="max-w-5xl text-[clamp(1.5rem,3.2vw,3rem)] leading-[1.05] tracking-[-0.03em] text-black/82">
              {dashboard.members.filter((member) => member.foundationsState === "completed").length} complete,
              {" "}{dashboard.members.filter((member) => member.foundationsState === "in_progress").length} in progress,
              {" "}and {dashboard.members.filter((member) => member.foundationsState === "not_started").length} not started in the visible roster.
            </p>
          </div>
          <div className="divide-y divide-black/15">
            {[...dashboard.members]
              .sort((left, right) => left.foundationsProgress - right.foundationsProgress)
              .map((member) => (
                <article
                  className="grid gap-4 py-5 sm:grid-cols-[minmax(12rem,1fr)_8rem_8rem_minmax(11rem,0.8fr)] sm:items-center"
                  key={member.memberId}
                >
                  <div>
                    <h2 className="ui-heading text-base font-semibold">{member.name}</h2>
                    <p className="mt-1 text-sm text-black/45">{member.circleName ?? "No active Circle"}</p>
                  </div>
                  <StateLabel state={member.foundationsState} />
                  <p className="text-sm tabular-nums text-black/58">{member.foundationsProgress}%</p>
                  <div className="h-px bg-black/15" aria-hidden="true">
                    <div
                      className="h-px bg-black"
                      style={{ width: `${member.foundationsProgress}%` }}
                    />
                  </div>
                </article>
              ))}
          </div>
        </section>
      ) : null}

      {section === "circles" ? (
        <section className="mt-14 border-t border-black/25">
          {circleRows.map((circle) => (
            <article
              className="grid gap-5 border-b border-black/15 py-6 md:grid-cols-[minmax(12rem,1fr)_9rem_minmax(10rem,0.8fr)_minmax(12rem,1fr)] md:items-center"
              key={circle.id}
            >
              <div>
                <h2 className="text-2xl leading-none">{circle.name}</h2>
                <p className="mt-2 text-sm text-black/42">{circle.blockName ?? "No Block"}</p>
              </div>
              <StateLabel state={circle.status} />
              <p className="text-sm tabular-nums text-black/58">
                {circle.activeMembers} / {circle.capacity} members
              </p>
              <p className="text-sm leading-relaxed text-black/50">
                {Math.max(0, circle.capacity - circle.activeMembers)} open member positions
              </p>
            </article>
          ))}
          <article className="grid gap-5 border-b border-black/15 py-6 md:grid-cols-[minmax(12rem,1fr)_9rem_minmax(10rem,0.8fr)_minmax(12rem,1fr)] md:items-center">
            <h2 className="text-2xl leading-none">Without a Circle</h2>
            <StateLabel state="pending" />
            <p className="text-sm tabular-nums text-[var(--color-poster)]">{dashboard.unassignedMembers} members</p>
            <p className="text-sm leading-relaxed text-black/50">Placement remains an operator decision.</p>
          </article>
        </section>
      ) : null}

      {section === "access-billing" || section === "sync" ? (
        <section className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.55fr)]">
          <div className="border-t border-black/25">
            {[
              ["Member identity", configuration.supabase, "Passwordless sign-in and verified identity."],
              ["Membership record", configuration.database, "Accounts, progress, Circles, Blocks, and history."],
              ["Membership billing", configuration.stripe, "Checkout, subscriptions, and payment attention."],
            ].map(([name, state, description]) => (
              <div
                className="grid gap-3 border-b border-black/15 py-6 sm:grid-cols-[minmax(10rem,0.6fr)_8rem_minmax(12rem,1fr)] sm:items-center"
                key={name}
              >
                <h2 className="ui-heading text-base font-semibold">{name}</h2>
                <StateLabel state={state} />
                <p className="text-sm leading-relaxed text-black/50">{description}</p>
              </div>
            ))}
          </div>
          <aside className="border-t border-black/25 py-6">
            <p className="text-[0.64rem] font-medium uppercase tracking-[0.17em] text-black/42">Billing attention</p>
            <p className="mt-5 text-5xl tracking-[-0.04em] text-[var(--color-poster)]">{dashboard.attentionRequired}</p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-black/55">
              Payment issues remain visible without deleting access history, Foundations progress, or Circle proof.
            </p>
          </aside>
        </section>
      ) : null}
    </OperatorPageFrame>
  );
}
