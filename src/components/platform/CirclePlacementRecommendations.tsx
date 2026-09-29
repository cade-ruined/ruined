"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { scoreCirclePlacement, type CircleRecommendation } from "@/lib/platform/circle-placement-model";
export default function CirclePlacementRecommendations({ memberId, preview = false, previewCircles }: { memberId: string; preview?: boolean; previewCircles?: Array<{ id: string; name: string; activeMembers: number; status: string }> }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CircleRecommendation[] | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true; setItems(null); setMessage("");
    if (preview) {
      const samplePreferences = { timezone: "America/Denver", availability: ["2:evening"], preferredConnectionId: null };
      setItems(scoreCirclePlacement(samplePreferences, (previewCircles ?? []).filter(circle => circle.status === "active" || circle.status === "forming").map((circle, index) => ({ circleId: circle.id, name: circle.name, activeMembers: circle.activeMembers, connectionPresent: index === 0, participantPreferences: [samplePreferences] }))));
      return;
    }
    fetch(`/api/ops/circle-recommendations?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Suggestions unavailable.");
      if (active) setItems(body.recommendations);
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [memberId, preview, open, previewCircles]);
  return <details className="mt-3 border-t border-black/10 pt-3" onToggle={event => setOpen(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Review placement suggestions</summary>
    <p className="mb-3 text-xs text-black/60">Suggestions do not place anyone. Libby approves routine placements; Tyler/Mitch review exceptions. Check the Circle’s meeting schedule before confirming.</p>
    {preview ? <p className="mb-3 text-xs font-semibold text-black/60">Preview — sample suggestions only. No member records are read or changed.</p> : null}
    {message ? <p className="text-xs" role="status">{message}</p> : items ? <ul className="space-y-3">{items.slice(0, 5).map(item => <li className="rounded bg-black/[0.035] p-3" key={item.circleId}><Link className="text-sm font-semibold underline" href={`/ops/circles?circleId=${item.circleId}&memberId=${memberId}`}>{item.name}</Link><p className="mt-1 text-xs">{item.activeMembers} {item.activeMembers === 1 ? "person" : "people"} · target 10{item.exceptionRequired ? " · Exception review" : ""}</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-black/60">{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></li>)}</ul> : <p className="text-xs">Loading suggestions…</p>}
  </details>;
}
