"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { JournalEntry } from "@/lib/membership/journal-model";
import TimelineExportStudio from "./TimelineExportStudio";
import { TIMELINE_EXAMPLES, type TimelineDraftEntry } from "./timeline-model";
import artworkStyles from "./ruined-timeline.module.css";
import styles from "./TimelineGraphics.module.css";

export function publicTimelineArtworkEntries(entries: JournalEntry[]): TimelineDraftEntry[] {
  return entries.filter(entry => entry?.visibility === "public" && entry.includeOnTimeline).map((entry, index) => {
    const created = new Date(entry.createdAt);
    const hasEventYear = entry.eventYear !== null;
    return {
      id: entry.id,
      clientKey: entry.id,
      createdOrder: index,
      position: index + 1,
      year: entry.eventYear ?? created.getUTCFullYear(),
      month: hasEventYear ? entry.eventMonth : created.getUTCMonth() + 1,
      day: hasEventYear ? entry.eventDay : created.getUTCDate(),
      title: entry.title || entry.body?.slice(0, 90) || "A moment, kept.",
      details: entry.body || "",
    };
  });
}

type GraphicsState =
  | { kind: "loading"; key: string }
  | { kind: "ready"; key: string; entries: TimelineDraftEntry[] }
  | { kind: "error"; key: string; message: string };

export default function TimelineGraphics({ ownerId, preview, entries, revision }: {
  ownerId?: string;
  preview: boolean;
  entries: JournalEntry[];
  revision: string;
}) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<GraphicsState | null>(null);
  const requestVersion = useRef(0);
  const id = useId();
  // The feed array can be recreated while someone types. Only saved preview
  // content, not array identity or unfinished composer text, refreshes artwork.
  const previewSignature = preview ? JSON.stringify(publicTimelineArtworkEntries(entries)) : "";
  const sourceKey = JSON.stringify([ownerId ?? null, preview, revision, previewSignature]);
  const current = state?.key === sourceKey ? state : null;

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    setState({ kind: "loading", key: sourceKey });

    async function loadGraphics() {
      try {
        let artwork: TimelineDraftEntry[];
        if (preview) {
          artwork = JSON.parse(previewSignature) as TimelineDraftEntry[];
        } else {
          if (!ownerId) throw new Error("Sign in again to open your Timeline graphics.");
          const response = await fetch("/api/my/journal/export?collection=public", {
            cache: "no-store",
            headers: { "x-ruined-session-owner": ownerId },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Your Timeline graphics could not load.");
          if (!Array.isArray(result.entries)) throw new Error("Your Timeline graphics could not load.");
          artwork = publicTimelineArtworkEntries(result.entries);
        }
        if (!cancelled && version === requestVersion.current) setState({ kind: "ready", key: sourceKey, entries: artwork });
      } catch (error) {
        if (!cancelled && version === requestVersion.current) {
          setState({ kind: "error", key: sourceKey, message: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Your Timeline took too long to load. Please try again." });
        }
      }
    }
    void loadGraphics();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, ownerId, preview, previewSignature, sourceKey, retry]);

  function toggle() {
    requestVersion.current += 1;
    setState(null);
    setOpen(value => !value);
  }

  return <section className={styles.graphics} data-timeline-graphics aria-labelledby={`${id}-title`}>
    <div className={styles.callout}>
      <svg className={styles.mark} aria-hidden="true" viewBox="0 0 52 42" fill="none"><path d="M5 33C13 33 10 10 25 10s9 22 22 22" stroke="currentColor" strokeWidth="1.5"/><circle cx="5" cy="33" r="3" fill="currentColor"/><circle cx="25" cy="10" r="3" fill="currentColor"/><circle cx="47" cy="32" r="3" fill="currentColor"/></svg>
      <div className={styles.copy}><h2 id={`${id}-title`}>Timeline graphics</h2><p>Turn your public posts into a carousel, story, or print.</p></div>
      <button className={styles.toggle} type="button" aria-controls={`${id}-studio`} aria-expanded={open} onClick={toggle}>{open ? "Close graphics" : "Create a graphic"}<span aria-hidden="true">{open ? "−" : "↗"}</span></button>
    </div>
    {open ? <div className={styles.panel} id={`${id}-studio`}>
      {!current || current.kind === "loading" ? <p className={styles.status} role="status">Loading your public Timeline…</p> : current.kind === "error" ? <div className={styles.error}><p role="alert">{current.message}</p><button className={styles.retry} type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : <>
        {!current.entries.length ? <p className={styles.sample}><strong>Example artwork.</strong> Publish a Timeline post to create a graphic from your own story. Private Journal entries and drafts stay private.</p> : <p className={styles.note}>Made from your published Timeline posts. Private Journal entries and drafts stay private.</p>}
        <div className={artworkStyles.root}><TimelineExportStudio entries={current.entries.length ? current.entries : TIMELINE_EXAMPLES} examples={preview || !current.entries.length} /></div>
      </>}
    </div> : null}
  </section>;
}
