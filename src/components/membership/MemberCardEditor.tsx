"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PublicMemberCardPage from "@/components/membership/card/PublicMemberCardPage";
import type { MemberCardSnapshot } from "@/lib/membership/public-card-model";

type CardResponse = { snapshot?: MemberCardSnapshot; error?: string };

export default function MemberCardEditor({ initialSnapshot, preview = false }: {
  initialSnapshot?: MemberCardSnapshot | null; writable: boolean; preview?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? null);
  const [loading, setLoading] = useState(initialSnapshot === undefined && !preview);
  const [error, setError] = useState(initialSnapshot === null ? "Your card could not be loaded." : "");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/my/card", { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as CardResponse;
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Your card could not be loaded.");
      setSnapshot(payload.snapshot);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Your card could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    if (initialSnapshot) setSnapshot(initialSnapshot);
    if (initialSnapshot === undefined && !preview) void load();
    return () => request.current?.abort();
  }, [initialSnapshot, load, preview]);
  useEffect(() => {
    if (preview) return;
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, preview]);
  const feedback = error ? <div className="mx-auto max-w-xl space-y-3 px-5 text-center text-sm text-[#e5e0d5]"><p role="alert">{error}</p><button className="underline underline-offset-4" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Reload saved card"}</button></div> : null;
  if (!snapshot) return <main className="min-h-screen bg-[#141413] px-6 py-16 text-[#e5e0d5]"><Link href="/my">Back to profile</Link><h1 className="mt-10 text-3xl">My Card</h1>{loading ? <p role="status">Opening your card…</p> : feedback}</main>;
  return <PublicMemberCardPage card={snapshot.card} preview={preview} title={preview ? "MY CARD / PREVIEW" : "MY CARD"}
    headerActions={<><Link href="/my">My profile</Link><Link href="/my/invitation#card-customization">Customize in Invitations ↗</Link></>}
    footerNote={preview ? "Preview only. Nothing is published." : "Your card begins with your full name. Add details in Invitations."}
    footerActions={<Link href="/my/invitation">My Invitations ↗</Link>}>{feedback}</PublicMemberCardPage>;
}
