"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import OperatorPageFrame from "./OperatorPageFrame";
import { PRACTICE_RECAPS, type PracticeReleaseOverview, type PracticeReleaseReview, type PracticeReleaseCourse } from "@/lib/practice/release-model";
import styles from "./OperatorPracticeReleases.module.css";
const when = (date: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(date));
export default function OperatorPracticeReleases() {
  const [overview, setOverview] = useState<PracticeReleaseOverview | null>(null), [review, setReview] = useState<PracticeReleaseReview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { let alive = true; fetch("/api/ops/practice", { cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); if (alive) setOverview(data); }).catch(e => { if (alive) setError(e.message || "Practice releases are unavailable."); }); return () => { alive = false; }; }, []);
  async function refresh() {
    setError("");
    try { const response = await fetch("/api/ops/practice", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw Error(data.error); setOverview(data); } catch (e) { setError(e instanceof Error ? e.message : "Could not refresh release status."); }
  }
  async function request(body: object) {
    const response = await fetch("/api/ops/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw Error(data.error || "This release could not be saved."); return data;
  }
  async function prepare(course: PracticeReleaseCourse | "f2" | "f3") {
    setBusy(true); setError(""); setNotice(""); setReview(null);
    try { setReview(await request({ action: course === "f2" || course === "f3" ? "review_deck" : "review", course })); } catch (e) { setError(e instanceof Error ? e.message : "Could not review this release."); } finally { setBusy(false); }
  }
  async function release() {
    if (!review) return; setBusy(true); setError("");
    try { setOverview(await request({ action: review.kind === "deck" ? "release_deck" : "release", reviewToken: review.token })); setNotice(review.title + (review.kind === "deck" ? " deck is now available. The assignment remains to be announced; no recap email was queued." : " is released. Recap emails are queued automatically; refresh to see delivery status.")); setReview(null); }
    catch (e) { setError((e instanceof Error ? e.message : "The release response was interrupted.") + " Refresh status before trying again; the release may already be queued."); setReview(null); } finally { setBusy(false); }
  }
  return <OperatorPageFrame title="Practice releases"><div className={styles.wrap}>
    <Link className={styles.back} href="/ops/foundations">← Foundations</Link> <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh status</button>
    <header className={styles.intro}><h1>Release the next step.</h1><p>Open an assignment after its call. Members receive its recap and the link to earn their badge automatically.</p></header>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    {!overview ? <p>Loading releases…</p> : overview.setupRequired ? <p>Practice release setup has not been installed.</p> : <>
      <p className={styles.status}>{overview.deliveryReady ? "Automatic email delivery is ready." : "Email delivery is paused. Assignment recaps cannot be released yet."} {overview.foundationsOpen ? "Foundations access is open." : "Foundations member access is closed."}</p>
      <div className={styles.grid}>{overview.items.map(item => <article key={item.course} className={styles.card}>
        <p className={styles.eyebrow}>{item.course === "time" ? "MONTHLY" : "FOUNDATIONS"}</p><h2>{item.title}</h2>
        <p>{PRACTICE_RECAPS[item.course].assignment}</p>
        <p className={styles.releaseState}>{item.source === "expired" ? "Recap expired before sending · assignment available" : item.releasedAt ? "Released " + when(item.releasedAt) + " MT" : item.releaseAt ? "Scheduled " + when(item.releaseAt) + " MT · recap sends automatically" : item.course === "f1" && overview.foundationsOpen ? "Assignment available · recap not released" : "Not released"}</p>
        {item.releasedAt ? <dl className={styles.counts}>{[["Queued", (item.counts.pending ?? 0) + (item.counts.sending ?? 0)], ["Sent", item.counts.sent ?? 0], ["Retrying", item.counts.failed ?? 0], ["Stopped", item.counts.cancelled ?? 0], ["Needs review", item.counts.manual_review ?? 0]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <button type="button" disabled={busy || !overview.deliveryReady || !overview.foundationsOpen || (item.course === "time" && Boolean(item.releaseAt) && Date.parse(item.releaseAt!) > Date.now())} onClick={() => void prepare(item.course)}>{item.course === "time" && item.releaseAt && Date.parse(item.releaseAt) > Date.now() ? "Scheduled for December 1" : item.course === "f1" ? "Release recap →" : "Review release →"}</button>}
      </article>)}</div>
      <section className={styles.tbd}><h2>Foundations 2 &amp; 3</h2><p>Release each supporting deck after its call. The assignments remain to be announced; releasing a deck sends no badge or assignment email.</p><div className={styles.actions}>{overview.decks.map(deck => <button type="button" key={deck.course} disabled={busy || deck.released || !overview.foundationsOpen} onClick={() => void prepare(deck.course)}>{deck.course === "f2" ? "Foundations 2" : "Foundations 3"}: {deck.released ? "Deck available" : "Review deck release →"}</button>)}</div></section>
      <p className={styles.audience}>Current membership eligibility: {overview.localEligible} profiles. {overview.localExcluded} excluded. A release review checks current provider suppression and email preferences before showing the final audience. Permission is checked again immediately before each email.</p>
    </>}
    {review ? <section className={styles.review} aria-label="Review recap and audience"><h2>{review.title}: ready to release</h2><p>{review.kind === "assignment" ? <><strong>{review.eligible} recipients</strong> · {review.excluded} excluded. </> : "Deck access only. "}Review expires {when(review.expiresAt)} MT.</p><h3>{review.subject}</h3><pre>{review.text}</pre><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void release()}>{busy ? "Releasing…" : review.kind === "deck" ? "Release deck" : "Release and send " + review.eligible + " recaps"}</button><button type="button" disabled={busy} onClick={() => setReview(null)}>Cancel</button></div></section> : null}
  </div></OperatorPageFrame>;
}
