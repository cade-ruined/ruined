import { PlatformConnectionRail } from "@/components/platform/PlatformShell";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { OperatorDashboardSnapshot } from "@/lib/platform/model";

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
    capacity: number;
    id: string;
    name: string;
    status: string;
  }>;
  configuration: PlatformConfiguration;
  dashboard: OperatorDashboardSnapshot;
  section: "circles" | "members" | "sync";
}) {
  const title = section === "members" ? "Members" : section === "circles" ? "Circles" : "Sync";
  const circleRows = circles ?? Array.from(
    new Set(dashboard.members.map((member) => member.circleName).filter(Boolean)),
  ).map((circleName) => ({
    activeMembers: dashboard.members.filter((member) => member.circleName === circleName).length,
    capacity: 10,
    id: String(circleName),
    name: String(circleName),
    status: "active",
  }));

  return (
    <main className="min-h-[68vh] border-t border-white/15 pt-5">
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/38">Operations / {title}</p>
      <h1 className="mt-12 font-[var(--font-header)] text-[clamp(4rem,9vw,8rem)] font-bold uppercase leading-[0.76] tracking-[-0.065em]">{title}</h1>

      {actions ? <div className="mt-14">{actions}</div> : null}

      {section === "members" ? (
        <section className="mt-14 border-t border-white/15">
          {dashboard.members.map((member) => (
            <article className="grid gap-4 border-b border-white/10 py-5 sm:grid-cols-[minmax(10rem,1fr)_8rem_7rem_minmax(10rem,1.2fr)] sm:items-center" key={member.memberId}>
              <div>
                <h2 className="ui-heading text-base font-semibold">{member.name}</h2>
                <p className="mt-1 font-mono text-[0.53rem] uppercase tracking-[0.14em] text-white/25">{member.circleName ?? "Unassigned"}</p>
              </div>
              <StateLabel state={member.billingState} />
              <span className="font-mono text-[0.56rem] text-white/45">{member.foundationsProgress}%</span>
              <p className="text-sm text-white/48">{member.nextAction}</p>
            </article>
          ))}
        </section>
      ) : null}

      {section === "circles" ? (
        <section className="mt-14 grid gap-8 md:grid-cols-2">
          {circleRows.map((circle) => (
            <article className="border-t border-white/15 py-5" key={circle.id}>
              <div className="flex items-start justify-between gap-6">
                <h2 className="ui-heading text-2xl font-semibold">{circle.name}</h2>
                <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-white/38">{circle.activeMembers} / {circle.capacity}</span>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                <StateLabel state={circle.status} />
                <p className="text-sm text-white/42">{Math.max(0, circle.capacity - circle.activeMembers)} open member positions</p>
              </div>
            </article>
          ))}
          <article className="border-t border-[var(--color-poster)]/60 py-5">
            <div className="flex items-start justify-between gap-6">
              <h2 className="ui-heading text-2xl font-semibold">Unassigned</h2>
              <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">{dashboard.unassignedMembers}</span>
            </div>
            <p className="mt-8 text-sm text-white/42">Assignment remains a deliberate internal decision in the pilot.</p>
          </article>
        </section>
      ) : null}

      {section === "sync" ? (
        <section className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)]">
          <div>
            <PlatformConnectionRail configuration={configuration} />
            <div className="mt-10 border-t border-white/15">
              {[
                ["Supabase", "Passwordless identity and the canonical Postgres member system."],
                ["Postgres", "Roles, lifecycle, Foundations, Circles, and Artifact production state."],
                ["Stripe", "Billing authority. Paid invoice events update billing state."],
                ["Resend", "Authentication email delivery only. Never an access authority."],
              ].map(([name, text]) => (
                <div className="grid gap-3 border-b border-white/10 py-5 sm:grid-cols-[9rem_1fr]" key={name}>
                  <h2 className="ui-heading text-base font-semibold">{name}</h2>
                  <p className="text-sm leading-relaxed text-white/45">{text}</p>
                </div>
              ))}
            </div>
          </div>
          <aside className="border-t border-white/15 py-5">
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Delivery rule</p>
            <p className="mt-5 text-sm leading-relaxed text-white/50">The primary database commits first. Email and other external delivery remain downstream and retryable. An external outage cannot reverse member progress or payment state.</p>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
