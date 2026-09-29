"use client";
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
  return <details className="rounded-[4px] border border-black/15 p-4" open={items.length > 0}><summary className="min-h-11 cursor-pointer content-center font-semibold">Placement exceptions{items.length ? ` · ${items.length}` : ""}</summary><p className="mb-4 text-sm text-black/60">Libby can request an exception. Tyler/Mitch approve or decline before anyone is placed.</p>
    {items.map(item => <article className="border-t border-black/10 py-4" key={item.id}><p className="text-sm font-semibold">{item.memberName} → {item.circleName}</p><p className="mt-2 whitespace-pre-wrap text-sm">{item.reason}</p><div className="mt-3 flex flex-wrap gap-3"><button className="min-h-11 rounded bg-black px-4 text-sm text-white disabled:opacity-40" disabled={busy} onClick={() => review(item, true)}>Approve and place</button><button className="min-h-11 px-3 text-sm underline disabled:opacity-40" disabled={busy} onClick={() => review(item, false)}>Decline</button></div></article>)}
    {!items.length ? <p className="text-sm text-black/60">No pending requests.</p> : null}{notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}
  </details>;
}
