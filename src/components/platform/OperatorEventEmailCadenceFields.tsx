"use client";

import { useState } from "react";
import { OPERATOR_FIELD_CLASS, OPERATOR_LABEL_CLASS, OPERATOR_LABEL_TEXT_CLASS } from "@/components/platform/operatorStyles";
import type { OpsExperienceEmailCadence } from "@/lib/platform/ops-experience-model";

const labels = { foundations_01: "Foundations 01", foundations_02: "Foundations 02", foundations_03: "Foundations 03", foundations_04: "Foundations 04", membership: "Membership call", circle: "Circle call", none: "No email sequence" };
export default function OperatorEventEmailCadenceFields({ current, quick = false }: { current?: OpsExperienceEmailCadence | null; quick?: boolean }) {
  const [kind, setKind] = useState("");
  const [track, setTrack] = useState(current?.track ?? "members");
  const foundations = kind.startsWith("foundations_");
  return <fieldset className="min-w-0 space-y-3 sm:col-span-2">
    <legend className="mb-2 text-sm font-semibold">Email sequence</legend>
    {current ? <p className="text-xs text-[color:var(--operator-muted)]">Current: {labels[current.kind]} · {current.track === "founder_test" ? "Founder test" : "Members"}{current.cohortMonth ? ` · ${current.cohortMonth}` : ""}</p> : null}
    <label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>Call classification</span><select className={OPERATOR_FIELD_CLASS} name="emailCadenceKind" value={kind} onChange={event => setKind(event.currentTarget.value)}>
      <option value="">{current ? "Keep current classification" : "Auto — standard call rules"}</option>
      {!quick ? <><option value="foundations_01">Foundations 01</option><option value="foundations_02">Foundations 02</option><option value="foundations_03">Foundations 03</option><option value="foundations_04">Foundations 04</option></> : null}
      <option value="membership">Membership call</option><option value="circle">Circle call</option><option value="none">No email sequence</option>
    </select></label>
    {foundations ? <div className="grid gap-3 sm:grid-cols-2"><label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>Cadence</span><select className={OPERATOR_FIELD_CLASS} name="emailCadenceTrack" value={track} onChange={event => setTrack(event.currentTarget.value as typeof track)}><option value="members">Members</option><option value="founder_test">October founder test</option></select></label>{track === "members" ? <label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>Cohort month</span><input className={OPERATOR_FIELD_CLASS} defaultValue={current?.cohortMonth ?? ""} name="emailCadenceCohortMonth" required type="month" /></label> : null}</div> : <input name="emailCadenceTrack" type="hidden" value="members" />}
    <p className="text-xs leading-relaxed text-[color:var(--operator-muted)]">{foundations ? "Foundations requires an invite-only call with registration managed here. The cohort month and accepted session time identify its members. Use America/Denver and the scheduled cohort call time; founder tests use explicit invitations." : "Auto recognizes standard weekly Membership and Circle calls. Other events need an explicit classification. Names are never used to choose a sequence."} The approved email sequence and delivery settings must also be active before reminders can send.</p>
  </fieldset>;
}
