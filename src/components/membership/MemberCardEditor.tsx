"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PublicMemberCardPage from "@/components/membership/card/PublicMemberCardPage";
import type { MemberCardSnapshot } from "@/lib/membership/public-card-model";

type CardResponse = { snapshot?: MemberCardSnapshot; error?: string };

/** The owner's room. Profile text and field choices have one editor: Edit profile. */
export default function MemberCardEditor({ initialSnapshot, writable, preview = false }: {
  initialSnapshot?: MemberCardSnapshot | null; writable: boolean; preview?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? null);
  const [loading, setLoading] = useState(initialSnapshot === undefined && !preview);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialSnapshot === null ? "Your card could not be loaded." : "");
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [origin, setOrigin] = useState("");
  const [nativeShare, setNativeShare] = useState(false);
  const request = useRef<AbortController | null>(null);
  const link = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/my/card", { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as CardResponse;
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Your card could not be loaded.");
      setSnapshot(payload.snapshot); setConflict(false);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Your card could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    setOrigin(window.location.origin); setNativeShare(typeof navigator.share === "function");
    if (initialSnapshot) setSnapshot(initialSnapshot);
    if (initialSnapshot === undefined && !preview) void load();
    return () => request.current?.abort();
  }, [initialSnapshot, load, preview]);
  useEffect(() => {
    if (preview) return;
    const refresh = () => { if (!document.hidden && !pending) void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, pending, preview]);
  const published = Boolean(snapshot?.settings.publicEnabled && snapshot.eligible && snapshot.publicUrl);
  const shareUrl = published && snapshot?.publicUrl && origin ? new URL(snapshot.publicUrl, origin).href : null;
  async function setPublic(publicEnabled: boolean) {
    if (!snapshot || preview || pending || loading || conflict || (publicEnabled && (!writable || !snapshot.writable || !snapshot.eligible))) return;
    setPending(true); setError(""); setStatus("");
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/my/card", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ ...snapshot.settings, publicEnabled, version: snapshot.version }) });
      const payload = await response.json() as CardResponse;
      if (!response.ok || !payload.snapshot) { if (response.status === 409) setConflict(true); throw new Error(payload.error || "Your sharing choice could not be saved."); }
      setSnapshot(payload.snapshot); setStatus(publicEnabled ? "Your card is public. Selected fields follow your saved profile." : "Your card is private.");
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Your sharing choice could not be saved."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  async function share(copy = false) {
    if (!shareUrl) return;
    try {
      if (!copy && navigator.share) await navigator.share({ title: `${snapshot?.card.name} / Ruined`, url: shareUrl });
      else { await navigator.clipboard.writeText(shareUrl); setStatus("Link copied."); }
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      link.current?.focus(); link.current?.select(); setStatus("Select and copy your public link below.");
    }
  }
  const feedback = <div className="mx-auto max-w-xl space-y-3 px-5 text-center text-sm text-[#e5e0d5]">
    {error ? <p role="alert">{error}</p> : null}
    {error || conflict ? <button className="underline underline-offset-4" type="button" disabled={loading || pending} onClick={() => void load()}>{loading ? "Loading…" : "Reload saved card"}</button> : null}
    <p role="status" aria-live="polite">{status}</p>
    {shareUrl ? <input ref={link} aria-label="Your public card link" readOnly value={shareUrl} onFocus={event => event.target.select()} className="w-full rounded border border-white/20 bg-black/20 px-3 py-2 text-center text-sm" /> : null}
  </div>;
  if (!snapshot) return <main className="min-h-screen bg-[#141413] px-6 py-16 text-[#e5e0d5]"><Link href="/my">Back to profile</Link><h1 className="mt-10 text-3xl">My Card</h1>{loading ? <p role="status">Opening your card…</p> : feedback}</main>;
  return <PublicMemberCardPage card={snapshot.card} preview={preview} title={preview ? "MY CARD / PREVIEW" : published ? "MY CARD / PUBLIC" : "MY CARD / PRIVATE"}
    headerActions={<><Link href="/my">My profile</Link><Link href="/my/profile">Edit profile ↗</Link></>}
    footerNote={preview ? "Preview only. Nothing is published." : published ? "Selected fields update whenever you save your profile." : snapshot.settings.publicEnabled ? "Public sharing is paused with your current membership status." : "Only you can see this card. Choose public fields in Edit profile."}
    footerActions={<>
      {shareUrl ? <>{nativeShare ? <button type="button" disabled={pending} onClick={() => void share()}>Share card ↗</button> : null}<button type="button" disabled={pending} onClick={() => void share(true)}>Copy link</button><a href={shareUrl} target="_blank" rel="noreferrer">Open public card ↗</a></> : null}
      {snapshot.settings.publicEnabled ? <button type="button" disabled={preview || pending || loading || conflict} onClick={() => void setPublic(false)}>{pending ? "Saving…" : "Make private"}</button> : <button type="button" disabled={preview || !writable || !snapshot.writable || !snapshot.eligible || pending || loading || conflict} onClick={() => void setPublic(true)}>{pending ? "Publishing…" : "Make card public"}</button>}
    </>}>{feedback}</PublicMemberCardPage>;
}
