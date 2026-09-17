"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { MemberUpdateItem, MemberUpdatesSnapshot } from "@/lib/membership/model";

import styles from "./MemberUpdates.module.css";

function isUnread(item: MemberUpdateItem) {
  return item.kind === "notification" && !item.readAt;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

export default function MemberUpdates({ initialUpdates, writable }: { initialUpdates: MemberUpdatesSnapshot; writable: boolean }) {
  const router = useRouter();
  const [updates, setUpdates] = useState(initialUpdates);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const requestPending = useRef(false);
  const unreadFilter = useRef<HTMLButtonElement>(null);
  const unreadItems = updates.items.filter(isUnread);
  const visibleItems = filter === "unread" ? unreadItems : updates.items;

  async function markRead(id: string) {
    const item = updates.items.find((update) => update.id === id && isUnread(update));
    if (!writable || requestPending.current || !item) return;
    requestPending.current = true;
    setPendingId(id);
    setError(null);
    setFeedback("");

    try {
      const response = await fetch("/api/my/updates/read", {
        body: JSON.stringify({ notificationId: id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as { error?: unknown; ok?: unknown } | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "We couldn’t mark this update as read. Please try again.");
      }
      if (filter === "unread") unreadFilter.current?.focus();
      setUpdates((current) => {
        const items = current.items.map((update) => update.kind === "notification" && update.id === id
          ? { ...update, readAt: new Date().toISOString() }
          : update);
        return { ...current, items, unreadCount: items.filter(isUnread).length };
      });
      setFeedback(`“${item.title}” marked as read.`);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error && !(requestError instanceof SyntaxError) && !(requestError instanceof TypeError)
        ? requestError.message
        : "We couldn’t mark this update as read. Please try again.");
    } finally {
      requestPending.current = false;
      setPendingId(null);
    }
  }

  return (
    <main className={`member-journey-page ${styles.page}`}>
      <header className={styles.header}>
        <p className={styles.note}>From Ruined</p>
        <h1 className={styles.title}>Updates</h1>
        <p className={styles.summary}>
          {unreadItems.length
            ? `${unreadItems.length} unread ${unreadItems.length === 1 ? "update" : "updates"}.`
            : updates.items.length ? "You’re all caught up." : "Your membership notices will appear here."}
        </p>
      </header>

      <div aria-label="Filter updates" className={styles.filters} role="group">
        <button aria-controls="member-updates-list" aria-pressed={filter === "all"} className={styles.filter} onClick={() => setFilter("all")} type="button">
          All <span className={styles.count}>{updates.items.length}</span>
        </button>
        <button aria-controls="member-updates-list" aria-pressed={filter === "unread"} className={styles.filter} onClick={() => setFilter("unread")} ref={unreadFilter} type="button">
          Unread <span className={styles.count}>{unreadItems.length}</span>
        </button>
      </div>

      {!writable && unreadItems.length ? <p className={styles.readOnly}>Read status can’t be changed in this view.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p aria-atomic="true" className={styles.srOnly} role="status">{feedback}</p>
      <p aria-atomic="true" className={styles.srOnly} role="status">
        {filter === "unread" ? `${visibleItems.length} unread updates shown.` : `${visibleItems.length} updates shown.`}
      </p>

      <section aria-label={filter === "unread" ? "Unread updates" : "All updates"} id="member-updates-list">
        {visibleItems.length ? (
          <ol className={styles.list}>
            {visibleItems.map((item) => {
              const unread = isUnread(item);
              return (
                <li className={`${styles.card} ${unread ? styles.unread : ""}`} key={`${item.kind}-${item.id}`}>
                  <article aria-labelledby={`update-${item.kind}-${item.id}`}>
                    <div className={styles.metadata}>
                      <div className={styles.kind}>
                        <span>{item.kind === "announcement" ? "Announcement" : "For you"}</span>
                        {item.kind === "notification" ? <span className={unread ? styles.unreadLabel : styles.readLabel}>{unread ? "Unread" : "Read"}</span> : null}
                      </div>
                      <time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time>
                    </div>
                    <h2 className={styles.cardTitle} id={`update-${item.kind}-${item.id}`}>{item.title}</h2>
                    <p className={styles.body}>{item.body}</p>
                    {item.href || unread ? (
                      <div className={styles.actions}>
                        {item.href ? <Link aria-label={`View details: ${item.title}`} className={styles.details} href={item.href}>View details <span aria-hidden="true">↗</span></Link> : null}
                        {unread ? (
                          <button
                            aria-label={pendingId === item.id ? `Marking as read: ${item.title}` : `Mark as read: ${item.title}`}
                            className={styles.markRead}
                            disabled={!writable || pendingId !== null}
                            onClick={() => markRead(item.id)}
                            type="button"
                          >
                            {pendingId === item.id ? "Saving…" : "Mark as read"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>{filter === "unread" && updates.items.length ? "All caught up." : "No updates yet."}</h2>
            <p className={styles.emptyBody}>{filter === "unread" && updates.items.length
              ? "There are no unread notices. Your announcements and previous updates are still here."
              : "Announcements and personal notices will appear here when there’s something to share."}</p>
            {filter === "unread" && updates.items.length ? <button className={styles.details} onClick={() => setFilter("all")} type="button">View all updates <span aria-hidden="true">→</span></button> : null}
          </div>
        )}
      </section>
    </main>
  );
}
