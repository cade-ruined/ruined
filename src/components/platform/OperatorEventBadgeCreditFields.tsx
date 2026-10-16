"use client";

import { useState } from "react";
import { OPERATOR_FIELD_CLASS, OPERATOR_LABEL_CLASS, OPERATOR_LABEL_TEXT_CLASS } from "@/components/platform/operatorStyles";
import type { ExperienceBadgeCredit } from "@/lib/platform/badge-credit-model";

export default function OperatorEventBadgeCreditFields({ current, circleOnly = false, onlineOnly = false }: {
  current?: ExperienceBadgeCredit;
  circleOnly?: boolean;
  onlineOnly?: boolean;
}) {
  const [track, setTrack] = useState<ExperienceBadgeCredit["track"]>(current?.track ?? "none");
  const [stage, setStage] = useState(current?.stage ?? "");
  const stages = track === "membership" ? [["see", "See"], ["face", "Face"], ["cut", "Cut"], ["grow", "Grow"]]
    : [["why", "Why"], ["implementation", "Implementation"]];
  const hasStage = track === "membership" || track === "circle";

  return <fieldset className="min-w-0 space-y-3 sm:col-span-2">
    <legend className="mb-2 text-sm font-semibold">Badge credit</legend>
    <label className={OPERATOR_LABEL_CLASS}>
      <span className={OPERATOR_LABEL_TEXT_CLASS}>Counts toward</span>
      <select className={OPERATOR_FIELD_CLASS} name="badgeCreditTrack" value={track} onChange={(event) => {
        const nextTrack = event.currentTarget.value as ExperienceBadgeCredit["track"];
        setTrack(nextTrack);
        setStage("");
      }}>
        <option value="none">No badge credit</option>
        {!circleOnly ? <option value="membership">Membership call</option> : null}
        <option value="circle">Circle call</option>
        {!circleOnly && !onlineOnly ? <option value="in_person">In-person event</option> : null}
      </select>
    </label>
    {hasStage ? <div className="grid gap-3 sm:grid-cols-2">
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>{track === "membership" ? "Stage" : "Topic"}</span>
        <select className={OPERATOR_FIELD_CLASS} name="badgeCreditStage" required value={stage} onChange={(event) => setStage(event.currentTarget.value)}>
          <option value="" disabled>Choose {track === "membership" ? "a stage" : "a topic"}</option>
          {stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Program month</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={current?.month ?? ""} name="badgeCreditMonth" required type="month" />
      </label>
    </div> : null}
    <p className="text-xs leading-relaxed text-[color:var(--operator-muted)]">
      {track === "membership" ? "Choose the Weekly call type without a Circle audience. The program month groups See, Face, Cut, and Grow together. "
        : track === "circle" ? "Choose a Circle meeting and its Circle audience. The program month pairs Why with Implementation. "
        : track === "in_person" ? "Choose a Member event, Public event, or Retreat with a physical location and no online meeting link. " : "Leave unclassified events on No badge credit. "}
      Credit is earned only after an operator marks the member Attended. Invitations and meeting links do not confirm attendance.
    </p>
  </fieldset>;
}
