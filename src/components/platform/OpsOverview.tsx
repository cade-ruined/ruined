import { PlatformConnectionRail } from "@/components/platform/PlatformShell";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { OperatorDashboardSnapshot } from "@/lib/platform/model";

export default function OpsOverview({
  configuration,
  dashboard,
}: {
  configuration: PlatformConfiguration;
  dashboard: OperatorDashboardSnapshot;
}) {
  return (
    <main>
      <div className="border-t border-white/15 pt-5">
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/38">Operations / Overview</p>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-8">
          <h1 className="font-[var(--font-header)] text-[clamp(3.8rem,8vw,7.5rem)] font-bold uppercase leading-[0.78] tracking-[-0.06em]">See the whole system.</h1>
          <p className="max-w-sm text-sm leading-relaxed text-white/45">Payment, access, program, Circle, and Artifact state stay separate so one failure cannot silently distort the rest.</p>
        </div>
      </div>

      <section className="mt-14 grid grid-cols-2 border-y border-white/15 md:grid-cols-4">
        {[
          ["Active", dashboard.activeMembers],
          ["Needs attention", dashboard.attentionRequired],
          ["Unassigned", dashboard.unassignedMembers],
          ["Visible roster", dashboard.members.length],
        ].map(([label, value], index) => (
          <div className={`py-6 ${index % 2 ? "border-l border-white/15 pl-5" : ""} md:border-l md:border-white/15 md:px-6 md:first:border-l-0 md:first:pl-0`} key={label}>
            <p className="font-mono text-[0.54rem] uppercase tracking-[0.18em] text-white/30">{label}</p>
            <p className="mt-4 text-4xl font-medium tracking-[-0.04em] text-white">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-14">
        <div className="flex items-end justify-between gap-6 border-b border-white/15 pb-4">
          <div>
            <p className="font-mono text-[0.54rem] uppercase tracking-[0.18em] text-white/30">Priority view</p>
            <h2 className="ui-heading mt-3 text-2xl font-semibold tracking-[-0.03em]">Member state</h2>
          </div>
          <span className="font-mono text-[0.54rem] uppercase tracking-[0.16em] text-white/30">{dashboard.members.length} records</span>
        </div>

        <div className="divide-y divide-white/10">
          {dashboard.members.map((member) => (
            <article className="grid gap-4 py-5 sm:grid-cols-[minmax(10rem,1fr)_8rem_7rem_minmax(10rem,1.2fr)] sm:items-center" key={member.memberId}>
              <div>
                <h3 className="ui-heading text-base font-semibold">{member.name}</h3>
                <p className="mt-1 font-mono text-[0.53rem] uppercase tracking-[0.14em] text-white/25">{member.circleName ?? "Unassigned"}</p>
              </div>
              <StateLabel state={member.billingState} />
              <span className="font-mono text-[0.56rem] text-white/45">{member.foundationsProgress}%</span>
              <p className="text-sm text-white/48">{member.nextAction}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-16"><PlatformConnectionRail configuration={configuration} /></div>
    </main>
  );
}
