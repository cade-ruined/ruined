"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { MemberUpdateItem, MemberUpdatesSnapshot } from "@/lib/membership/model";
import { safeMemberNotificationHref } from "@/lib/membership/notification-inbox-model";

import styles from "./MemberUpdates.module.css";

function isUnread(item: MemberUpdateItem) {
  return item.kind === "notification" && !item.readAt;
}

function withReadNotification(updates: MemberUpdatesSnapshot, id: string) {
  if (!updates.items.some((item) => item.id === id && isUnread(item))) return updates;
  return {
    ...updates,
    items: updates.items.map((item) => item.kind === "notification" && item.id === id
      ? { ...item, readAt: new Date().toISOString() }
      : item),
    unreadCount: Math.max(0, updates.unreadCount - 1),
  };
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
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const requestPending = useRef(false);
  const pendingReads = useRef(new Set<string>());
  const unreadFilter = useRef<HTMLButtonElement>(null);
  const unreadItems = updates.items.filter(isUnread);
  const visibleItems = filter === "unread" ? unreadItems : updates.items;

  useEffect(() => {
    if (writable) return;
    try {
      if (window.sessionStorage.getItem("ruined-preview-library-announcement") === "open") {
        setUpdates((current) => withReadNotification(current, "preview-library-launch"));
      }
    } catch { /* The local preview also works when browser storage is unavailable. */ }
  }, [writable]);

  async function markRead(id: string, fromLink = false) {
    const item = updates.items.find((update) => update.id === id && isUnread(update));
    if (!writable || !item || pendingReads.current.has(id) || (!fromLink && requestPending.current)) return;
    pendingReads.current.add(id);
    if (!fromLink) {
      requestPending.current = true;
      setPendingId(id);
      setError(null);
      setFeedback("");
    }

    try {
      const response = await fetch("/api/my/updates/read", {
        body: JSON.stringify({ notificationId: id }),
        headers: { "content-type": "application/json" },
        keepalive: true,
        method: "POST",
      });
      const payload = (await response.json()) as { error?: unknown; ok?: unknown } | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "We couldn’t mark this update as read. Please try again.");
      }
      if (!fromLink && filter === "unread") unreadFilter.current?.focus();
      setUpdates((current) => withReadNotification(current, id));
      window.dispatchEvent(new Event("ruined:member-updates"));
      if (!fromLink) {
        setFeedback(`“${item.title}” marked as read.`);
        router.refresh();
      }
    } catch (requestError) {
      if (!fromLink) {
        setError(requestError instanceof Error && !(requestError instanceof SyntaxError) && !(requestError instanceof TypeError)
          ? requestError.message
          : "We couldn’t mark this update as read. Please try again.");
      }
    } finally {
      pendingReads.current.delete(id);
      if (!fromLink) {
        requestPending.current = false;
        setPendingId(null);
      }
    }
  }

  return (
    <div className={styles.page}>
        <p className={styles.srOnly}>
          {updates.unreadCount
            ? `${updates.unreadCount} unread ${updates.unreadCount === 1 ? "update" : "updates"}.`
            : updates.items.length ? "You’re all caught up." : "Your membership notices will appear here."}
        </p>
      <div aria-label="Filter updates" className={styles.filters} role="group">
        <button aria-controls="member-updates-list" aria-pressed={filter === "unread"} className={styles.filter} onClick={() => setFilter("unread")} ref={unreadFilter} type="button">
          Unread <span className={styles.count}>{updates.unreadCount}</span>
        </button>
        <button aria-controls="member-updates-list" aria-pressed={filter === "all"} className={styles.filter} onClick={() => setFilter("all")} type="button">
          All
        </button>
      </div>

      {updates.items.length >= 100 ? <p className={styles.readOnly}>Showing your latest 100 updates.</p> : null}
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
              const href = safeMemberNotificationHref(item.href);
              const actionLabel = item.actionLabel?.trim() || "View details";
              return (
                <li className={`${styles.card} ${unread ? styles.unread : ""}`} key={`${item.kind}-${item.id}`}>
                  <article aria-labelledby={`update-${item.kind}-${item.id}`}>
                    <div className={styles.metadata}>
                      <time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time>
                    </div>
                    <h2 className={styles.cardTitle} id={`update-${item.kind}-${item.id}`}>{item.title}</h2>
                    <p className={styles.body}>{item.body}</p>
                    {href || unread ? (
                      <div className={styles.actions}>
                        {href ? <Link aria-label={`${actionLabel}: ${item.title}`} className={styles.details} href={href} onClick={() => { void markRead(item.id, true); }}>{actionLabel} <span aria-hidden="true">↗</span></Link> : null}
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
            <h2 className={styles.emptyTitle}>{filter === "unread" && updates.unreadCount
              ? "No unread updates in this view."
              : filter === "unread" && updates.items.length ? "All caught up." : "No updates yet."}</h2>
            <p className={styles.emptyBody}>{filter === "unread" && updates.unreadCount
              ? "Older unread notices aren’t in the latest 100 updates shown here."
              : filter === "unread" && updates.items.length
                ? "There are no unread notices. Your announcements and previous updates are still here."
              : "Announcements and personal notices will appear here when there’s something to share."}</p>
            {filter === "unread" && updates.items.length ? <button className={styles.details} onClick={() => setFilter("all")} type="button">View all updates <span aria-hidden="true">→</span></button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
