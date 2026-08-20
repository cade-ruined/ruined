import Link from "next/link";

import { PlatformConnectionRail } from "@/components/platform/PlatformShell";
import StateLabel from "@/components/platform/StateLabel";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { MemberPlatformSnapshot } from "@/lib/platform/model";

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-t border-white/15 py-5">
      <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">{label}</p>
      <div className="mt-4">{value}</div>
    </div>
  );
}
export default function MemberHome({
  configuration,
  member,
}: {
  configuration: PlatformConfiguration;
  member: MemberPlatformSnapshot;
}) {
  return (
    <main>
      <div className="flex flex-wrap items-start justify-between gap-8 border-t border-white/15 pt-5">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/38">My Ruined / Home</p>
          <h1 className="mt-10 max-w-5xl font-[var(--font-header)] text-[clamp(3.8rem,9vw,8rem)] font-bold uppercase leading-[0.78] tracking-[-0.06em]">
            {member.billingState === "active" ? "Do the next true thing." : "Begin where you are."}
          </h1>
        </div>
        <div className="min-w-48 text-right">
          <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Member</p>
          <p className="mt-2 text-sm text-white/70">{member.name}</p>
          <p className="mt-1 font-mono text-[0.56rem] text-white/30">{member.email}</p>
        </div>
      </div>

      <section className="mt-16 grid gap-10 border-y border-white/15 py-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)] lg:gap-20">
        <div>
          <p className="font-mono text-[0.56rem] uppercase tracking-[0.2em] text-[var(--color-poster)]">Next action</p>
          <h2 className="ui-heading mt-5 max-w-3xl text-[clamp(2rem,5vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.045em]">
            {member.nextAction}
          </h2>
          {member.billingState === "pending" ? (
            <Link
              className="mt-8 inline-flex min-h-11 items-center border border-white bg-white px-5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-black"
              href="/my/join"
            >
              Open membership entry
            </Link>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-x-5">
          <Metric label="Billing" value={<StateLabel state={member.billingState} />} />
          <Metric label="Program" value={<StateLabel state={member.programState} />} />
          <Metric label="Foundations" value={<span className="text-2xl text-white">{member.foundationsProgress}%</span>} />
          <Metric label="Circle" value={<span className="text-sm text-white/65">{member.circleName ?? "Unassigned"}</span>} />
        </div>
      </section>

      <section className="mt-14 grid gap-8 md:grid-cols-3">
        {[
          { href: "/my/foundations", label: "Foundations", state: member.foundationsState, text: "The four-part beginning: SEE, CONFRONT, CUT, GROW." },
          { href: "/my/circle", label: "Circle", state: member.circleName ? "active" : "pending", text: "Your assigned group, leader, and next live session." },
          { href: "/my/artifacts", label: "Artifacts", state: member.artifactState, text: "Member-controlled inputs that become physical work." },
        ].map((item) => (
          <Link className="group border-t border-white/15 py-5" href={item.href} key={item.href}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="ui-heading text-xl font-semibold tracking-[-0.025em]">{item.label}</h2>
              <StateLabel state={item.state} />
            </div>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/42">{item.text}</p>
            <span className="mt-8 block font-mono text-[0.56rem] uppercase tracking-[0.18em] text-white/35 transition-colors group-hover:text-white">Open →</span>
          </Link>
        ))}
      </section>

      <div className="mt-16">
        <PlatformConnectionRail configuration={configuration} />
      </div>
    </main>
  );
}
