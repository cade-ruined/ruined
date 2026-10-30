"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { memberTier } from "@/lib/membership/member-number";
import MemberBadges from "./MemberBadges";
import TimelineStoryContent from "./TimelineStoryContent";
import type { MemberBadge } from "@/lib/membership/badge-model";
import profileStyles from "../platform/MemberProfile.module.css";
import journeyStyles from "./MemberJourneyShell.module.css";
import journalStyles from "./MemberJournal.module.css";
import type { PublicMemberProfile } from "@/lib/membership/public-card-model";
import type { PublicJournalEntry, PublicJournalPage } from "@/lib/membership/public-journal-repository";
import styles from "./PublicJournal.module.css";

export default function PublicJournal({ token, identity, badges = [], previewEntries }: {
  token: string; identity: PublicMemberProfile; badges?: readonly MemberBadge[]; previewEntries?: PublicJournalEntry[];
}) {
  const tier = memberTier(identity.memberNumber);
  const [firstName, ...surnameParts] = identity.name.trim().split(/\s+/);
  const surname = surnameParts.join(" ");
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
  return <main className={`${journeyStyles.journey} ${journeyStyles.focused}`} data-member-journey data-member-theme="paper" data-public-profile>
    <div className={`${journeyStyles.content} ${styles.content}`}>
      <Link href="/" className={styles.back}>The Ruined Project</Link>
      {previewEntries !== undefined && <p className={styles.preview}>Preview · Example profile and posts</p>}
      <div className={profileStyles.profile}>
        {!unavailable && <header className={profileStyles.identity}>
          <figure className={profileStyles.polaroid} aria-label={identity.avatarUrl ? `${identity.name} portrait` : "Portrait not added"}>
            <div className={profileStyles.photo}><Image src={identity.avatarUrl ?? "/membership/portrait-pending-editorial.webp"} alt="" fill sizes="(max-width: 359px) 128px, (max-width: 700px) 156px, 208px" priority unoptimized /></div>
            <Image className={profileStyles.frame} src="/membership/polaroid-frame.png" alt="" fill sizes="(max-width: 359px) 128px, (max-width: 700px) 156px, 208px" priority unoptimized />
            <figcaption>the ruined project</figcaption>
          </figure>
          <div className={profileStyles.nameBlock}>
            <h1 aria-label={identity.name}><span className={profileStyles.firstName}>{firstName}</span>{surname && <span className={profileStyles.surname}>{surname}</span>}</h1>
            {identity.memberTag && <p className={profileStyles.memberTag}>@{identity.memberTag}</p>}
            <div className={profileStyles.memberBadge}>
              <span className={profileStyles.memberLeaf} aria-hidden="true" style={{ maskImage: "url(/ruined-mark.svg)", WebkitMaskImage: "url(/ruined-mark.svg)" }} />
              <span className={profileStyles.badgeDetails}><span className={profileStyles.badgeLabel}>{tier?.label ?? "Member"}</span>{tier && <span className={profileStyles.badgeNumber} aria-label={`Member number ${identity.memberNumber}`}><span className={profileStyles.badgeDivider} aria-hidden="true">·</span>No. {tier.displayNumber}</span>}</span>
            </div>
          </div>
          {identity.bio && <p className={profileStyles.bio}>{identity.bio}</p>}
          {!!badges.length && <div className={profileStyles.earnedBadges}><MemberBadges badges={badges} preview={previewEntries !== undefined} /></div>}
        </header>}
        <section aria-labelledby="public-journal-title">
          <div className={profileStyles.profileControls}><h2 id="public-journal-title" className={styles.timelineTitle}>Timeline</h2></div>
          <div aria-live="polite" aria-busy={loading}>
            {unavailable ? <p className={styles.status}>This profile is unavailable.</p> : <>
              {!loading && !error && entries.length === 0 && <div className={journalStyles.empty}><h3>No Timeline posts yet.</h3><p>Shared thoughts, photographs, and moments will appear here.</p></div>}
              {!!entries.length && <div className={journalStyles.feed}>{entries.map(entry => <article className={journalStyles.feedPost} key={entry.id}>
                <div className={journalStyles.feedMeta}><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(entry.createdAt))}</time>{entry.timelineReflection && entry.eventYear ? <span>Remembering {entry.eventMonth ? `${new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(entry.eventYear, entry.eventMonth - 1, 1)))} ` : ""}{entry.eventDay ? `${entry.eventDay}, ` : ""}{entry.eventYear}</span> : null}</div>
                {entry.title && <h3 className={journalStyles.feedTitle}>{entry.title}</h3>}
                {entry.body && <p className={journalStyles.feedBody}>{entry.body}</p>}
                <TimelineStoryContent reflection={entry.timelineReflection} />
                {!!entry.media.length && <div className={styles.media}>{entry.media.map((media, index) => media.mimeType.startsWith("video/")
                  ? <video key={media.url} src={media.url} controls playsInline preload="metadata" aria-label={`${entry.title || "Timeline moment"} — video ${index + 1}`} />
                  : <Image key={media.url} src={media.url} alt={`${entry.title || "Timeline moment"} — photograph ${index + 1}`} width={960} height={720} style={{ width: "100%", height: "auto" }} unoptimized />)}</div>}
              </article>)}</div>}
              {loading && <p className={styles.status}>Loading Timeline…</p>}
              {error && <div className={styles.status}><p>The Timeline couldn’t load.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
              {!loading && !error && next && <button className={styles.more} type="button" onClick={() => setCursor(next)}>Load more</button>}
            </>}
          </div>
        </section>
        <footer className={styles.footer}><Link href="/">The Ruined Project</Link></footer>
      </div>
    </div>
  </main>;
}
