"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicMemberCard } from "@/lib/membership/public-card-model";
import type { PublicJournalEntry, PublicJournalPage } from "@/lib/membership/public-journal-repository";
import styles from "./PublicJournal.module.css";

export default function PublicJournal({ token, identity }: {
  token: string; identity: Pick<PublicMemberCard, "name" | "memberTag" | "avatarUrl">;
}) {
  const [entries, setEntries] = useState<PublicJournalEntry[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [unavailable, setUnavailable] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null), [next, setNext] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), request = ++generation.current;
    setLoading(true); setError(false);
    fetch(`/api/cards/${token}/journal${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 404) { setEntries([]); setUnavailable(true); setNext(null); return; }
        if (!response.ok) throw new Error("Journal unavailable");
        const result = await response.json() as PublicJournalPage;
        if (controller.signal.aborted || generation.current !== request) return;
        setUnavailable(false);
        setEntries(current => cursor ? [...current, ...result.entries.filter(entry => !current.some(previous => previous.id === entry.id))] : result.entries);
        setNext(result.hasMore ? result.nextCursor : null);
      }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, cursor, attempt]);
  return <main className={styles.page}><div className={styles.content}>
    <Link href={`/card/${token}`} className={styles.back}>Member card</Link>
    {!unavailable && <header className={styles.identity}>
      {identity.avatarUrl && <Image className={styles.portrait} src={identity.avatarUrl} alt="" width={144} height={180} unoptimized />}
      <div><h1>{identity.name}</h1>{identity.memberTag && <p className={styles.tag}>@{identity.memberTag}</p>}</div>
    </header>}
    <section className={styles.journal} aria-labelledby="public-journal-title">
      <h2 id="public-journal-title" className={styles.journalTitle}>Journal</h2>
      <div aria-live="polite">
        {unavailable ? <p className={styles.empty}>This journal is not being shared.</p> : <>
          {!loading && !error && entries.length === 0 && <p className={styles.empty}>No published entries yet.</p>}
          <div className={styles.entries}>{entries.map(entry => <article className={styles.entry} key={entry.id}>
            <time dateTime={entry.createdAt}>{new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(entry.createdAt))}</time>
            {entry.title && <h3>{entry.title}</h3>}{entry.body && <p className={styles.body}>{entry.body}</p>}
            {!!entry.media.length && <div className={styles.media}>{entry.media.map((media, index) => media.mimeType.startsWith("video/")
              ? <video key={media.url} src={media.url} controls playsInline preload="metadata" aria-label={`${entry.title || "Journal entry"} — video ${index + 1}`} />
              : <Image key={media.url} src={media.url} alt={`${entry.title || "Journal entry"} — photograph ${index + 1}`} width={960} height={720} unoptimized />)}</div>}
          </article>)}</div>
          {loading && <p className={styles.status}>Loading journal…</p>}
          {error && <div className={styles.status}><p>The journal couldn’t load.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
          {!loading && !error && next && <button className={styles.more} type="button" onClick={() => setCursor(next)}>Load more</button>}
        </>}
      </div>
    </section><footer className={styles.footer}>The Ruined Project</footer>
  </div></main>;
}
