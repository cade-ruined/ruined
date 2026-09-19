"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MemberInvitationSnapshot } from "@/lib/membership/invitation-model";
import { memberInvitationDeadline, memberInvitationExpired } from "@/lib/membership/invitation-expiry";
import { useInvitationExpired } from "./use-invitation-expiry";
import type { PublicMemberCard } from "@/lib/membership/public-card-model";
import MembershipWaitlistForm from "@/components/public-members/MembershipWaitlistForm";
import PublicMemberCardPage from "./card/PublicMemberCardPage";
import styles from "./MemberInvitation.module.css";

export function InvitationLanding({ card, token, expiresAt, preview = false }: { card: PublicMemberCard; token?: string; expiresAt: string | null; preview?: boolean }) {
  const expired = useInvitationExpired(expiresAt);
  return <PublicMemberCardPage card={card} variant="invitation" invitationExpiresAt={expiresAt} preview={preview} title="AN INVITATION TO RUINED"
    headerActions={preview ? <Link href="/my/invitation">My Invitation ↗</Link> : <a href="#join-ruined">Request to join ↗</a>}
    footerNote={preview ? "Example invitation. Nothing is sent or published." : `An invitation from ${card.name}.`}
    footerActions={<a href="https://theruinedproject.com/#members">About membership ↗</a>}>
    <section id="join-ruined" className={styles.panel} aria-labelledby="invitation-join-title">
      <p className={styles.eyebrow}>Your next step</p><h2 id="invitation-join-title">Find your people.</h2>
      <p>Leave your details and we’ll be in touch about joining. Your invitation will stay connected to {card.name}.</p>
      {expired ? <p role="status">This invitation has expired. Ask {card.name} for a new one.</p> : <p className={styles.note}>Valid until <time dateTime={expiresAt!}>{memberInvitationDeadline(expiresAt)}</time>.</p>}
      {preview ? <p className={styles.note}>Preview only. Visit your invitation to create a shareable link.</p> : <MembershipWaitlistForm invitationToken={token} disabled={expired} />}
    </section>
  </PublicMemberCardPage>;
}

export default function MemberInvitation({ initialSnapshot, preview = false }: { initialSnapshot: MemberInvitationSnapshot | null; preview?: boolean }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(!initialSnapshot && !preview);
  const busy = pending || loading;
  const expired = useInvitationExpired(snapshot?.expiresAt ?? null);
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if ((initialSnapshot && retry === 0) || preview) return;
    const controller = new AbortController();
    setError(""); setLoading(true);
    fetch("/api/my/invitation", { cache: "no-store", signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Your invitation could not be loaded.");
      setSnapshot(payload.snapshot);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Your invitation could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialSnapshot, preview, retry]);

  useEffect(() => {
    if (preview) return;
    const refresh = () => { if (!document.hidden && !busy) setRetry(value => value + 1); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [busy, preview]);

  async function changeSharing(enabled: boolean, renew = false) {
    if (!snapshot || preview || busy) return;
    setPending(true); setError(""); setStatus("");
    try {
      const response = await fetch("/api/my/invitation", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, version: snapshot.version, ...(renew ? { renew: true } : {}) }) });
      const payload = await response.json();
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Your invitation could not be updated.");
      setSnapshot(payload.snapshot); setStatus(enabled ? "Your invitation is ready to share for 48 hours." : "Invitation sharing is off.");
    } catch (error) { setError(error instanceof Error ? error.message : "Your invitation could not be updated."); }
    finally { setPending(false); }
  }

  async function share(copy = false) {
    if (!snapshot?.url || busy) return;
    if (memberInvitationExpired(snapshot.expiresAt)) { setStatus("This invitation has expired. Create a new one to share."); return; }
    setPending(true); setError(""); setStatus("");
    const url = new URL(snapshot.url, window.location.origin).href;
    try {
      if (!copy && navigator.share) await navigator.share({ title: `An invitation from ${snapshot.card?.name ?? "Ruined"}`, url });
      else { await navigator.clipboard.writeText(url); setStatus("Invitation link copied."); }
    } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setStatus("Select and copy your invitation link below."); }
    finally { setPending(false); }
  }

  if (!snapshot?.card) return <main className={styles.empty}><Link href="/my">↖ My profile</Link><h1>My Invitation</h1>{error ? <><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></> : <p role="status">Preparing your invitation…</p>}</main>;
  return <PublicMemberCardPage card={snapshot.card} variant="invitation" invitationExpiresAt={snapshot.expiresAt} title={preview ? "MY INVITATION / PREVIEW" : "MY INVITATION"}
    headerActions={<><Link href="/my">My profile ↗</Link><Link href="/my/card">My Card ↗</Link></>}
    footerNote={preview ? "Preview only. Nothing is published." : snapshot.enabled ? "Your display name and member tag appear on this invitation. Profile edits keep it current." : "Your invitation is private until you enable sharing."}
    footerActions={<Link href="/my/profile">Edit profile ↗</Link>}>
    <section className={styles.panel} aria-labelledby="my-invitation-title">
      <div className={styles.heading}><div><p className={styles.eyebrow}>A personal introduction</p><h2 id="my-invitation-title">Bring someone in.</h2></div><p className={styles.count}><strong>{snapshot.joinedCount}</strong><span>{snapshot.joinedCount === 1 ? "person has" : "people have"} joined through your invitation</span></p></div>
      <p>Share your invitation with someone you’d like to see here. Your display name and member tag appear on it and stay synced with your profile.</p>
      <p className={styles.note}>Each invitation is valid for 48 hours from creation. Sharing or copying it keeps the same deadline.</p>
      {snapshot.expiresAt ? <p className={styles.note}>{expired ? "Expired" : preview ? "Example deadline" : "Valid until"}: <time dateTime={snapshot.expiresAt}>{memberInvitationDeadline(snapshot.expiresAt)}</time>.</p> : null}
      {snapshot.enabled && snapshot.url && !expired ? <>
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void share()}>Share invitation ↗</button><button type="button" disabled={busy} onClick={() => void share(true)}>Copy link</button><a href={snapshot.url} target="_blank" rel="noreferrer">View invitation ↗</a></div>
        <label className={styles.linkLabel}>Your invitation link<input readOnly value={origin ? new URL(snapshot.url, origin).href : snapshot.url} onFocus={event => event.target.select()} /></label>
        <div><button className={styles.quiet} type="button" disabled={busy || preview || !snapshot.eligible || !snapshot.writable} onClick={() => void changeSharing(true, true)}>Create a new 48-hour invitation</button></div>
        <p className={styles.note}>A new invitation replaces this link. Your referral count stays with you.</p>
        <button className={styles.quiet} type="button" disabled={busy || preview} onClick={() => void changeSharing(false)}>{pending ? "Updating…" : "Turn off invitation sharing"}</button>
      </> : <button className={styles.enable} type="button" disabled={busy || preview || !snapshot.eligible || !snapshot.writable} onClick={() => void changeSharing(true)}>{pending ? "Preparing…" : (snapshot.expiresAt && !preview ? "Create new invitation ↗" : "Create my invitation ↗")}</button>}
      {snapshot.enabled && (!snapshot.url || expired) ? <button className={styles.quiet} type="button" disabled={busy || preview} onClick={() => void changeSharing(false)}>Turn off invitation sharing</button> : null}
      {preview ? <p className={styles.note}>This is a preview. Sharing and join counts become available with your membership.</p> : !snapshot.eligible ? <p className={styles.note}>Invitation sharing is available once membership entry is complete and your membership is active.</p> : null}
      <p className={styles.note}>Your count includes completed memberships. Only you and Ruined can see it.</p>
      {error ? <><p className={styles.error} role="alert">{error}</p><button type="button" className={styles.quiet} disabled={busy} onClick={() => setRetry(value => value + 1)}>Reload invitation</button></> : null}<p role="status" className={styles.note}>{status}</p>
    </section>
  </PublicMemberCardPage>;
}
