"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { memberTier } from "@/lib/membership/member-number";
import type { PublicMemberProfile } from "@/lib/membership/public-card-model";
import type { PublicJournalEntry, PublicJournalPage } from "@/lib/membership/public-journal-repository";
import styles from "./PublicJournal.module.css";

export default function PublicJournal({ token, identity, previewEntries }: {
  token: string; identity: PublicMemberProfile; previewEntries?: PublicJournalEntry[];
}) {
  const tier = memberTier(identity.memberNumber);
  const [entries, setEntries] = useState<PublicJournalEntry[]>(previewEntries ?? []);
  const [loading, setLoading] = useState(previewEntries === undefined), [error, setError] = useState(false), [unavailable, setUnavailable] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null), [next, setNext] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    if (previewEntries !== undefined) return;
    const controller = new AbortController(), request = ++generation.current;
    setLoading(true); setError(false);
    fetch(`/api/cards/${token}/journal${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (controller.signal.aborted || generation.current !== request) return;
        if (response.status === 404) { setEntries([]); setUnavailable(true); setNext(null); return; }
        if (!response.ok) throw new Error("Timeline unavailable");
        const result = await response.json() as PublicJournalPage;
        if (controller.signal.aborted || generation.current !== request) return;
        setUnavailable(false);
        setEntries(current => cursor ? [...current, ...result.entries.filter(entry => !current.some(previous => previous.id === entry.id))] : result.entries);
        setNext(result.hasMore ? result.nextCursor : null);
      }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, cursor, attempt, previewEntries]);
  return <main className={styles.page}><div className={styles.content}>
    <Link href="/" className={styles.back}>The Ruined Project</Link>
    {previewEntries && <p className={styles.preview}>Preview · Example profile and posts</p>}
    {!unavailable && <header className={styles.identity}>
      <div className={styles.identityCopy}><h1>{identity.name}</h1>{identity.memberTag && <p className={styles.tag}>@{identity.memberTag}</p>}
        {identity.bio && <p className={styles.bio}>{identity.bio}</p>}
        {tier && <p className={styles.membership}><span>{tier.label}</span><span aria-label={`Member number ${identity.memberNumber}`}>№ {tier.displayNumber}</span></p>}
      </div>
    </header>}
    <section className={styles.journal} aria-labelledby="public-journal-title">
      <h2 id="public-journal-title" className={styles.journalTitle}>Timeline</h2>
      <div aria-live="polite">
        {unavailable ? <p className={styles.empty}>This profile is unavailable.</p> : <>
          {!loading && !error && entries.length === 0 && <p className={styles.empty}>No Timeline posts yet.</p>}
          <div className={styles.entries}>{entries.map(entry => <article className={styles.entry} key={entry.id}>
            <header className={styles.postHeading}><div className={styles.postIdentity}><span className={styles.monogram} aria-hidden="true">{identity.name.trim().charAt(0)}</span><div><strong>{identity.name}</strong>{identity.memberTag && <span>@{identity.memberTag}</span>}</div></div><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(entry.createdAt))}</time></header>
            {entry.title && <h3>{entry.title}</h3>}{entry.body && <p className={styles.body}>{entry.body}</p>}
            {!!entry.media.length && <div className={styles.media}>{entry.media.map((media, index) => media.mimeType.startsWith("video/")
              ? <video key={media.url} src={media.url} controls playsInline preload="metadata" aria-label={`${entry.title || "Timeline moment"} — video ${index + 1}`} />
              : <Image key={media.url} src={media.url} alt={`${entry.title || "Timeline moment"} — photograph ${index + 1}`} width={960} height={720} style={{ width: "100%", height: "auto" }} unoptimized />)}</div>}
          </article>)}</div>
          {loading && <p className={styles.status}>Loading Timeline…</p>}
          {error && <div className={styles.status}><p>The Timeline couldn’t load.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
          {!loading && !error && next && <button className={styles.more} type="button" onClick={() => setCursor(next)}>Load more</button>}
        </>}
      </div>
    </section><footer className={styles.footer}>The Ruined Project</footer>
  </div></main>;
}
