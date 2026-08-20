import Link from "next/link";

import StateLabel from "@/components/platform/StateLabel";
import type { MemberPlatformSnapshot } from "@/lib/platform/model";

const CONTENT = {
  account: {
    eyebrow: "Identity and billing",
    title: "Account",
    text: "Your verified identity, membership standing, privacy controls, and billing access live here. Sensitive payment details stay inside Stripe.",
  },
  artifacts: {
    eyebrow: "Physical outcomes",
    title: "Artifacts",
    text: "Artifact templates remain versioned and configurable. Each production job will preserve the exact member inputs and template version used to make it.",
  },
  circle: {
    eyebrow: "10 members + 1 leader",
    title: "Circle",
    text: "Circle assignments are internal. Members see their group, leader, accountability context, and next live session—never the full operations roster.",
  },
  foundations: {
    eyebrow: "SEE · CONFRONT · CUT · GROW",
    title: "Foundations",
    text: "The live program is versioned so the next Foundations context can replace the old deck without rewriting a member’s completed work.",
  },
} as const;

export default function MemberSection({
  member,
  section,
}: {
  member: MemberPlatformSnapshot;
  section: keyof typeof CONTENT;
}) {
  const content = CONTENT[section];
  const state =
    section === "account"
      ? member.accountState
      : section === "artifacts"
        ? member.artifactState
        : section === "foundations"
          ? member.foundationsState
          : member.circleName
            ? "active"
            : "pending";

  return (
    <main className="min-h-[68vh] border-t border-white/15 pt-5">
      <div className="flex items-center justify-between gap-6">
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/38">My Ruined / {content.title}</p>
        <StateLabel state={state} />
      </div>
      <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)] lg:gap-24">
        <div className="min-w-0">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-[var(--color-poster)]">{content.eyebrow}</p>
          <h1 className="mt-6 font-[var(--font-header)] text-[clamp(2.25rem,11vw,9rem)] font-bold uppercase leading-[0.76] tracking-[-0.065em]">{content.title}</h1>
        </div>
        <div className="min-w-0 lg:pt-10">
          <p className="text-base leading-relaxed text-white/52">{content.text}</p>
          <div className="mt-10 border-y border-white/15 py-5">
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Current state</p>
            <div className="mt-4"><StateLabel state={state} /></div>
          </div>
          {section === "foundations" ? (
            <p className="mt-6 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-white/38">Progress · {member.foundationsProgress}%</p>
          ) : null}
          {section === "circle" ? <p className="mt-6 text-sm text-white/50">{member.circleName ?? "Assignment pending"}</p> : null}
          {section === "account" && member.billingState === "pending" ? (
            <Link className="mt-8 inline-flex border-b border-white/40 pb-1 font-mono text-[0.58rem] uppercase tracking-[0.18em]" href="/my/join">Continue membership entry</Link>
          ) : null}
          {section === "account" && member.billingState !== "pending" ? (
            <form action="/api/stripe/portal" method="post">
              <button className="mt-8 inline-flex border-b border-white/40 pb-1 font-mono text-[0.58rem] uppercase tracking-[0.18em]" type="submit">
                Manage billing in Stripe
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
