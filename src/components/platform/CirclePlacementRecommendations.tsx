"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CIRCLE_TARGET,
  scoreCirclePlacement,
  type CirclePlacementConnection,
  type CircleRecommendationSnapshot,
} from "@/lib/platform/circle-placement-model";

type PreviewCircle = { id: string; name: string; activeMembers: number; status: string };
type Props = {
  memberId: string;
  display?: "inline" | "member";
  preview?: boolean;
  previewCircles?: PreviewCircle[];
};
type RequestState = {
  memberId: string;
  preview: boolean;
  previewCircles?: PreviewCircle[];
  attempt: number;
  snapshot: CircleRecommendationSnapshot | null;
  error: string;
};

function ConnectionContext({ label, connection }: { label: string; connection: CirclePlacementConnection }) {
  return <div className="min-w-0">
    <p className="text-xs text-[color:var(--operator-muted)]">{label}</p>
    <p className="mt-1 break-words text-sm font-semibold">{connection.name}</p>
    {connection.status === "available" || connection.status === "multiple_circles" ? <>
      <ul className="mt-1 space-y-1 text-xs leading-relaxed text-[color:var(--operator-muted)]">
        {connection.circles.map(circle => <li className="break-words" key={circle.circleId}>{circle.relationship === "supporter" ? "Circle Supporter" : "Member"} · {circle.name}</li>)}
      </ul>
      {connection.status === "multiple_circles" ? <p className="mt-1 text-xs leading-relaxed text-[color:var(--operator-muted)]">More than one current Circle is recorded. Review the fit before choosing.</p> : null}
    </> : <p className="mt-1 text-xs leading-relaxed text-[color:var(--operator-muted)]">{connection.status === "inactive"
      ? "This connection is not currently active."
      : connection.status === "circle_unavailable"
        ? "Their current Circle is not available for placement."
        : "No current Circle is recorded."}</p>}
  </div>;
}

export default function CirclePlacementRecommendations({ memberId, display = "inline", preview = false, previewCircles }: Props) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RequestState | null>(null);
  const enabled = display === "member" || open;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const current = { memberId, preview, previewCircles, attempt, snapshot: null, error: "" };
    setState(current);
    if (preview) {
      const preferences = { timezone: "", availability: [], preferredConnectionId: null };
      setState({ ...current, snapshot: {
        recommendations: scoreCirclePlacement(preferences, (previewCircles ?? [])
          .filter(circle => circle.status === "active" || circle.status === "forming")
          .map(circle => ({ circleId: circle.id, name: circle.name, activeMembers: circle.activeMembers, participantPreferences: [] }))),
        context: { memberId, inviter: null, preferredConnection: null, requiredPartnerCircle: null },
      } });
      return () => controller.abort();
    }
    void fetch(`/api/ops/circle-recommendations?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Placement suggestions are unavailable.");
        if (!Array.isArray(body.recommendations) || body.context?.memberId !== memberId) throw new Error("Placement suggestions could not be loaded. Please try again.");
        if (!controller.signal.aborted) setState({ ...current, snapshot: body });
      })
      .catch(error => {
        if (!controller.signal.aborted) setState({ ...current, error: error instanceof Error ? error.message : "Placement suggestions are unavailable." });
      });
    return () => controller.abort();
  }, [memberId, preview, enabled, previewCircles, attempt]);

  // Hide the previous member's information during render, before effect cleanup.
  const current = state?.memberId === memberId && state.preview === preview && state.attempt === attempt && (!preview || state.previewCircles === previewCircles) ? state : null;
  const snapshot = current?.snapshot;
  const context = snapshot?.context;
  const items = snapshot?.recommendations.filter((item, index) => index < 5 || item.inviterPresent || item.preferredConnectionPresent || item.circleId === context?.requiredPartnerCircle?.circleId) ?? [];
  const content = enabled ? <div className={display === "member" ? "mt-4" : "pt-2"}>
    <p className="mb-4 text-xs leading-relaxed text-[color:var(--operator-muted)]">Review the connection, meeting schedule, and available space before placing a member. Suggestions do not assign anyone.</p>
    {preview ? <p className="mb-4 text-xs leading-relaxed text-[color:var(--operator-muted)]">Preview — capacity examples from these preview Circles. Inviter and partner details appear with a connected member record.</p> : null}
    {current?.error ? <div className="space-y-2">
      <p className="text-sm text-[color:var(--operator-muted)]" role="alert">{current.error}</p>
      <button className="min-h-11 text-sm font-medium underline underline-offset-4" onClick={() => setAttempt(value => value + 1)} type="button">Try again</button>
    </div> : snapshot && context ? <>
      {!preview ? <div className="mb-4 space-y-4 border-l-2 border-[var(--color-poster)] pl-4">
        {context.inviter ? <ConnectionContext label="Invited by" connection={context.inviter} /> : <p className="text-xs text-[color:var(--operator-muted)]">No inviter is recorded for this member.</p>}
        {context.preferredConnection ? <ConnectionContext label="Preferred connection" connection={context.preferredConnection} /> : null}
      </div> : null}
      {context.requiredPartnerCircle ? <div className="mb-4 rounded-none bg-[var(--operator-surface-muted)] p-3">
        <p className="text-xs font-medium text-[color:var(--operator-muted)]">Required partner Circle</p>
        <p className="mt-1 break-words text-sm font-semibold">{context.requiredPartnerCircle.name}</p>
        <p className="mt-1 text-xs leading-relaxed text-[color:var(--operator-muted)]">Shared memberships stay together. This member must join their partner’s Circle; an inviter or preferred connection does not change that requirement.</p>
      </div> : null}
      {items.length ? <ul className="space-y-3">{items.map(item => <li className="min-w-0 break-words rounded-none bg-[var(--operator-surface-muted)] p-3 [overflow-wrap:anywhere]" key={item.circleId}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 break-words text-sm font-semibold">{item.name}</p>
          <p className="text-xs leading-5 text-[color:var(--operator-muted)]">{item.activeMembers} {item.activeMembers === 1 ? "person" : "people"} · target {CIRCLE_TARGET}</p>
        </div>
        {item.inviterPresent || item.preferredConnectionPresent ? <p className="mt-1 text-xs font-medium text-[color:var(--operator-muted)]">{[item.inviterPresent ? "Inviter’s Circle" : null, item.preferredConnectionPresent ? "Preferred connection here" : null].filter(Boolean).join(" · ")}</p> : null}
        {item.exceptionRequired ? <p className="mt-2 text-xs font-semibold text-[var(--operator-danger)]">Capacity exception required — Administrator review before placement.</p> : null}
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-[color:var(--operator-muted)]">{item.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        <Link className="mt-1 inline-flex min-h-11 max-w-full items-center text-xs font-semibold underline underline-offset-4" href={`/ops/circles?circleId=${encodeURIComponent(item.circleId)}&memberId=${encodeURIComponent(memberId)}`}>Review {item.name}</Link>
      </li>)}</ul> : <p className="text-sm leading-relaxed text-[color:var(--operator-muted)]" role="status">{context.requiredPartnerCircle ? "No placement suggestion is currently available for the required partner Circle. Review its status and capacity before proceeding." : "No eligible Circles are available for this member yet."}</p>}
    </> : <p className="text-sm text-[color:var(--operator-muted)]" role="status">Loading placement suggestions…</p>}
  </div> : null;

  if (display === "member") return <section aria-label="Circle placement" className="operator-bento-card mt-3 min-w-0">
    <h3 className="ui-heading text-base font-semibold">Circle placement</h3>
    {content}
  </section>;
  return <details className="mt-3 border-t border-[color:var(--operator-ink)]/10 pt-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Review placement suggestions</summary>
    {content}
  </details>;
}
