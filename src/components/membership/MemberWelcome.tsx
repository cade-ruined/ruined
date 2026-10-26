"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import type { MemberWelcomeAction, MemberWelcomeSnapshot } from "@/lib/membership/welcome-model";
import { badgeArtwork } from "./MemberBadgeCard";
import styles from "./MemberWelcome.module.css";

type Props = {
  ownerId: string;
  initialWelcome: MemberWelcomeSnapshot | null;
  profileReady: boolean;
  hasUpcomingCall?: boolean;
  preview?: boolean;
  onWritePrivate: () => void;
};

function validSnapshot(value: unknown, ownerId: string): value is MemberWelcomeSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as MemberWelcomeSnapshot;
  return row.ownerId === ownerId && typeof row.hasJournalEntry === "boolean"
    && (row.dismissedAt === null || typeof row.dismissedAt === "string")
    && (row.calendarViewedAt === null || typeof row.calendarViewedAt === "string");
}

export default function MemberWelcome({ ownerId, initialWelcome, profileReady, hasUpcomingCall = false, preview = false, onWritePrivate }: Props) {
  const [snapshot, setSnapshot] = useState(initialWelcome);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const headingId = useId();
  const request = useRef<AbortController | null>(null);
  const refreshRequest = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const state = snapshot?.ownerId === ownerId ? snapshot : null;
  const dismissed = Boolean(state?.dismissedAt);
  const completed = Number(profileReady) + Number(Boolean(state?.hasJournalEntry)) + Number(Boolean(state?.calendarViewedAt));

  useEffect(() => {
    setSnapshot(initialWelcome);
    setError("");
    setPending(false);
    let active = true;
    function update(event?: Event) {
      if (preview) {
        const detail = (event as CustomEvent<{ preview?: boolean; hasJournalEntry?: boolean }> | undefined)?.detail;
        if (detail?.preview && typeof detail.hasJournalEntry === "boolean") {
          setSnapshot(current => current?.ownerId === ownerId ? { ...current, hasJournalEntry: detail.hasJournalEntry! } : current);
        }
        return;
      }
      if (saving.current) return;
      refreshRequest.current?.abort();
      refreshRequest.current = new AbortController();
      const signal = refreshRequest.current.signal;
      fetch("/api/my/welcome", { cache: "no-store", headers: { "x-ruined-session-owner": ownerId }, signal })
        .then(async response => { if (!response.ok) return; const data: unknown = await response.json(); if (active && !signal.aborted && validSnapshot(data, ownerId)) setSnapshot(data); })
        .catch(() => { /* Optional guidance must never interrupt the profile. */ });
    }
    update();
    window.addEventListener("ruined:member-progress", update);
    window.addEventListener("focus", update);
    return () => { active = false; refreshRequest.current?.abort(); request.current?.abort(); saving.current = false; window.removeEventListener("ruined:member-progress", update); window.removeEventListener("focus", update); };
  }, [ownerId, preview, initialWelcome]);

  async function save(action: MemberWelcomeAction) {
    if (saving.current || !state) return;
    setError("");
    if (preview) {
      setSnapshot({ ...state, dismissedAt: action === "dismiss" ? new Date().toISOString() : null });
      return;
    }
    request.current?.abort();
    refreshRequest.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    saving.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/my/welcome", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json", "x-ruined-session-owner": ownerId },
        body: JSON.stringify({ action, ownerId }),
      });
      const data: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !validSnapshot(data, ownerId)) throw new Error("save");
      setSnapshot(data);
    } catch {
      if (!controller.signal.aborted) setError("Couldn’t save this change. Try again; your profile is still ready to use.");
    } finally { if (!controller.signal.aborted) { saving.current = false; setPending(false); } }
  }

  return <section className={styles.welcome} aria-labelledby={headingId} data-member-welcome>
    {state && !dismissed ? <>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Your first few moments</p><h2 id={headingId}>{completed === 3 ? "You’re at home here." : "Make yourself at home."}</h2></div>
        <button className={styles.dismiss} type="button" onClick={() => void save("dismiss")} disabled={pending}>{completed === 3 ? "Finish" : "Do this later"}<span aria-hidden="true"> ×</span></button>
      </header>
      <p className={styles.intro}>{completed === 3 ? "You’ve made a start. Come back whenever you need a place to think, share or connect." : "A few small ways to make this space yours. Pick up wherever you like."}</p>
      <div className={styles.progress}><span>{completed} of 3 complete</span><div aria-hidden="true">{[1, 2, 3].map(step => <i key={step} data-complete={completed >= step || undefined}/>)}</div></div>
      <ul className={styles.steps}>
        <li data-complete={profileReady || undefined}><span className={styles.check} aria-label={profileReady ? "Complete" : "Not complete"}>{profileReady ? "✓" : ""}</span><Image className={styles.badgeArt} src={badgeArtwork({key:"make-it-yours"}).src} alt="Make It Yours badge" width={84} height={84} sizes="(max-width: 600px) 60px, 84px"/><div><h3>Make it yours</h3><p>A photo, a few words about you, and your @tag.</p><span className={styles.reward}>Badge: Make It Yours</span></div><Link href="/my/profile">{profileReady ? "Edit profile" : "Set up profile"}<span aria-hidden="true"> ↗</span></Link></li>
        <li data-complete={state.hasJournalEntry || undefined}><span className={styles.check} aria-label={state.hasJournalEntry ? "Complete" : "Not complete"}>{state.hasJournalEntry ? "✓" : ""}</span><Image className={styles.badgeArt} src={badgeArtwork({key:"first-words"}).src} alt="First Words badge" width={84} height={84} sizes="(max-width: 600px) 60px, 84px"/><div><h3>A few words, just for you</h3><p>Your Journal is private. Start with what brought you here.</p><span className={styles.reward}>Badge: First Words · private by default</span></div><button type="button" onClick={onWritePrivate}>{state.hasJournalEntry ? "Write again" : "Write privately"}<span aria-hidden="true"> ↗</span></button></li>
        <li data-complete={Boolean(state.calendarViewedAt) || undefined}><span className={styles.check} aria-label={state.calendarViewedAt ? "Complete" : "Not complete"}>{state.calendarViewedAt ? "✓" : ""}</span><Image className={styles.badgeArt} src={badgeArtwork({key:"in-the-room"}).src} alt="In the Room badge" width={84} height={84} sizes="(max-width: 600px) 60px, 84px"/><div><h3>{hasUpcomingCall ? "Find your next call" : "Explore your calendar"}</h3><p>{hasUpcomingCall ? "Your scheduled calls and joining links live in Calendar." : "This is where your calls and joining links will appear."}</p><span className={styles.reward}>Badge: In the Room · earned by attending your first Foundations or Membership call.</span></div><Link href="/my/experiences">Open Calendar<span aria-hidden="true"> ↗</span></Link></li>
      </ul>
    </> : <div className={styles.collapsed}><h2 id={headingId}>Make yourself at home.</h2>{state ? <button type="button" onClick={() => void save("resume")} disabled={pending}>Getting started <span aria-hidden="true">↗</span></button> : <span>Your guide is below.</span>}</div>}
    <details className={styles.guide}><summary>A quick look around <span aria-hidden="true">+</span></summary><div>
      <p><strong>Your profile</strong> is how other people get to know you. Your photo, bio, @tag and public badges live here.</p>
      <p><strong>Journal is private.</strong> Check <strong>Add to Timeline</strong> only when you want an entry on your public profile. You can preview your profile as a visitor anytime.</p>
      <p><strong>Calendar</strong> holds your scheduled calls and joining links. If no call is listed yet, we’ll let you know when yours is ready.</p>
      <p><strong>My Circle</strong> is your smaller room. While you’re waiting for placement, start with Foundations. We’ll let you know when your Circle is ready.</p>
      <p><strong>Badges</strong> mark things you’ve actually done. <Link href="/my/badges">See what you can earn ↗</Link></p>
    </div></details>
    {error ? <p className={styles.error} role="status">{error}</p> : null}
  </section>;
}
