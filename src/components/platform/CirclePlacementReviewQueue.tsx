"use client";

import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
type Review = { id: string; memberId: string; memberName: string; circleId: string; circleName: string; reason: string; previousAssignmentId: string | null; fromCircleId: string | null };
export default function CirclePlacementReviewQueue({ preview = false }: { preview?: boolean }) {
  const router = useRouter(); const [items, setItems] = useState<Review[]>([]); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (preview) return; let active = true;
    fetch("/api/ops/circle-placement-reviews", { cache: "no-store" }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (active) setItems(result.reviews); }).catch(error => { if (active) setNotice(error.message || "Exception requests unavailable."); });
    return () => { active = false; };
  }, [preview]);
  async function review(item: Review, approve: boolean) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(approve ? item.previousAssignmentId ? "/api/ops/circle-transfers" : "/api/ops/circle-assignments" : "/api/ops/circle-placement-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approve ? { memberId: item.memberId, circleId: item.circleId, toCircleId: item.circleId, fromCircleId: item.fromCircleId, assignmentId: item.previousAssignmentId, reviewId: item.id, exceptionReason: item.reason } : { action: "decline", reviewId: item.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Review could not be saved.");
      setItems(current => current.filter(value => value.id !== item.id)); setNotice(approve ? "Exception approved and placement saved." : "Exception declined."); router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Review could not be saved."); } finally { setBusy(false); }
  }
  return <details className={`rounded-none p-4 ${items.length ? "operator-emphasis" : "operator-glass"}`} data-operator-tone={items.length ? "wait" : undefined} open={items.length > 0}><summary className="min-h-11 cursor-pointer content-center font-semibold">Placement exceptions{items.length ? ` · ${items.length}` : ""}</summary><p className="mb-4 text-sm text-[color:var(--operator-muted)]">Administrators can request, approve, or decline an exception before anyone is placed.</p>
    {items.map(item => <article className="border-t border-[color:var(--operator-ink)]/10 py-4" key={item.id}><p className="text-sm font-semibold">{item.memberName} → {item.circleName}</p><p className="mt-2 whitespace-pre-wrap text-sm">{item.reason}</p><div className="mt-3 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={busy} onClick={() => review(item, true)}>Approve and place</button><button className={OPERATOR_BUTTON_CLASS} disabled={busy} onClick={() => review(item, false)}>Decline</button></div></article>)}
    {!items.length ? <p className="text-sm text-[color:var(--operator-muted)]">No pending requests.</p> : null}{notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}
  </details>;
}
