"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { BadgeCollectionItem, MemberBadgeCollection as Collection } from "@/lib/membership/badge-collection-model";
import { badgeArtwork, badgeStamp } from "./MemberBadgeCard";
import styles from "./MemberBadgeCollection.module.css";

const awardDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const actions: Record<string, string> = {
  "make-it-yours": "Edit your profile", "first-words": "Open your Journal", "your-story": "Open your Foundations timeline",
  "on-the-record": "Open your public Timeline", groundwork: "Open Foundations", "in-the-room": "See the Calendar",
  "full-circle": "Open your Circle", "the-whole-month": "See the Calendar", "open-door": "Open your invitation", "in-real-life": "See the Calendar",
};
type Lifecycle = { ownerId: string; controller: AbortController; version: number; refresh: () => Promise<boolean> };
const badgeStates = ["earned", "earning", "not-earned"] as const;
type BadgeState = typeof badgeStates[number];
type BadgeFilter = "all" | BadgeState;
type BadgeSort = "status" | "progress" | "recent" | "name";
const stateLabels: Record<BadgeState, string> = { earned: "Earned", earning: "Earning", "not-earned": "Not earned" };
function badgeState(badge: BadgeCollectionItem): BadgeState {
  return badge.earnedAt !== null ? "earned" : badge.progress > 0 ? "earning" : "not-earned";
}
function compareBadges(a: BadgeCollectionItem, b: BadgeCollectionItem, sort: BadgeSort) {
  if (sort === "name") return a.label.localeCompare(b.label);
  if (sort === "recent") return (b.earnedAt ? Date.parse(b.earnedAt) : 0) - (a.earnedAt ? Date.parse(a.earnedAt) : 0);
  if (sort === "progress") return Number(a.earnedAt !== null) - Number(b.earnedAt !== null)
    || b.progress / b.target - a.progress / a.target;
  return badgeStates.indexOf(badgeState(a)) - badgeStates.indexOf(badgeState(b));
}

function validCollection(value: unknown, ownerId: string): value is Collection {
  if (!value || typeof value !== "object") return false;
  const collection = value as Collection;
  if (collection.ownerId !== ownerId || !Array.isArray(collection.badges)
    || !(collection.seenAt === null || typeof collection.seenAt === "string" && Number.isFinite(Date.parse(collection.seenAt)))) return false;
  const keys = new Set<string>();
  return collection.badges.every(badge => {
    if (!badge || typeof badge.key !== "string" || keys.has(badge.key) || typeof badge.label !== "string"
      || typeof badge.description !== "string" || typeof badge.progressLabel !== "string"
      || !Number.isFinite(badge.progress) || !Number.isFinite(badge.target) || badge.target <= 0 || badge.progress < 0
      || typeof badge.publicVisible !== "boolean" || typeof badge.privateByDefault !== "boolean"
      || !(badge.earnedAt === null || typeof badge.earnedAt === "string" && Number.isFinite(Date.parse(badge.earnedAt)))
      || !(badge.actionHref === null || typeof badge.actionHref === "string" && /^\/my(?:[\/#?]|$)/.test(badge.actionHref))) return false;
    keys.add(badge.key); return true;
  });
}

function BadgeDetails({ badge, id, preview, busy, error, status, returnFocus, onDismiss, onVisibility, onAction }: {
  badge: BadgeCollectionItem | undefined; id: string; preview: boolean; busy: boolean; error: string | null; status: string | null;
  returnFocus: RefObject<HTMLButtonElement | null>; onDismiss: () => void; onVisibility: (visible: boolean) => void; onAction?: (href: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeKey = badge?.key;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!activeKey || !dialog) return;
    let previousFocus: Element | null = null;
    function closeForNow() {
      if (dialog!.open) dialog!.close();
      if (!document.hidden && !document.querySelector("dialog[open]") && previousFocus instanceof HTMLElement
        && previousFocus.isConnected && !previousFocus.closest("[hidden],[inert]")) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
    function reconcile() {
      const anotherDialog = Array.from(document.querySelectorAll("dialog[open]")).some(other => other !== dialog);
      if (document.hidden || dialog!.closest("[hidden],[inert]") || anotherDialog) { closeForNow(); return; }
      if (dialog!.open || !dialog!.isConnected) return;
      previousFocus = returnFocus.current ?? document.activeElement;
      dialog!.showModal(); closeRef.current?.focus({ preventScroll: true });
    }
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "inert"] });
    document.addEventListener("visibilitychange", reconcile); reconcile();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", reconcile); closeForNow(); };
  }, [activeKey, returnFocus]);
  const artwork = badge ? badgeArtwork(badge) : undefined;
  return <dialog ref={dialogRef} id={`${id}-dialog`} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onDismiss(); }} onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    {badge ? <div className={styles.detail}>
      <div className={styles.detailTop}><span>{preview ? "Badge preview" : badge.earnedAt ? "Earned badge" : "Not yet earned"}</span><button ref={closeRef} type="button" className={styles.close} aria-label="Close badge details" onClick={onDismiss}>×</button></div>
      <div className={styles.detailArtwork} data-earned={Boolean(badge.earnedAt)} aria-hidden="true">{artwork ? <Image src={artwork.src} alt="" width={440} height={440} sizes="(max-width: 540px) 200px, 240px" draggable={false}/> : <span>{badgeStamp(badge)}</span>}</div>
      <h2 id={`${id}-title`}>{badge.label}</h2>
      <p id={`${id}-description`} className={styles.description}>{badge.description}</p>
      {badge.earnedAt ? <p className={styles.earnedDate}><span>{preview ? "Example earned date" : "Earned"}</span><time dateTime={badge.earnedAt}>{awardDate.format(new Date(badge.earnedAt))}</time></p>
        : <div className={styles.progress}><p><span>Your progress</span><span>{badge.progressLabel}</span></p><progress aria-label={`${badge.label} progress`} max={badge.target} value={Math.min(badge.progress, badge.target)}/></div>}
      {badge.earnedAt ? <div className={styles.privacy}>
        <label className={styles.visibilityControl}><span>Show on my public profile</span><input type="checkbox" checked={badge.publicVisible} disabled={preview || busy} onChange={event => onVisibility(event.currentTarget.checked)}/></label>
        <p>{badge.privateByDefault ? "This achievement starts private. Sharing the badge never shares your Journal entry." : "You choose which earned badges appear on your public profile."}</p>
        <p className={styles.visibilityState}>{busy ? "Saving visibility…" : badge.publicVisible ? "Visible on your public profile" : "Only visible to you"}</p>
      </div> : badge.privateByDefault ? <p className={styles.privateNote}>Private by default. Once earned, you can choose to show this badge. Your Journal entry stays private.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {status ? <p className={styles.status} role="status">{status}</p> : null}
      <div className={styles.detailActions}>
        {!badge.earnedAt && badge.actionHref ? onAction ? <button type="button" className="member-button" disabled={busy} onClick={() => onAction(badge.actionHref!)}>{busy ? "Opening…" : actions[badge.key] ?? "Continue"} <span aria-hidden="true">↗</span></button> : <Link className="member-button" href={badge.actionHref}>{actions[badge.key] ?? "Continue"} <span aria-hidden="true">↗</span></Link> : null}
        {badge.earnedAt && artwork ? <a className="member-button" href={artwork.src} download={artwork.filename} aria-label={`Save ${badge.label} badge as a transparent PNG`}>Save badge <span aria-hidden="true">↓</span></a> : null}
      </div>
      {preview ? <p className={styles.previewNote}>Preview only · example progress and dates. Nothing is saved to your account.</p> : null}
    </div> : null}
  </dialog>;
}

export default function MemberBadgeCollection({ initialCollection, preview = false }: { initialCollection: Collection; preview?: boolean }) {
  const ownerId = initialCollection.ownerId;
  const router = useRouter();
  const id = useId();
  const [collection, setCollection] = useState<Collection | null>(initialCollection);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"seen" | "visibility" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [filter, setFilter] = useState<BadgeFilter>("all");
  const [sort, setSort] = useState<BadgeSort>("status");
  const lifecycle = useRef<Lifecycle | null>(null);
  const writing = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const current: Lifecycle = { ownerId, controller: new AbortController(), version: 0, refresh: async () => false };
    lifecycle.current = current; writing.current = false;
    setCollection(initialCollection); setSelectedKey(null); setBusy(null); setError(null); setStatus(null); setRefreshError(false);
    function isCurrent() { return lifecycle.current === current && !current.controller.signal.aborted; }
    function suspend() { if (isCurrent()) { setCollection(null); setSelectedKey(null); current.controller.abort(); } }
    current.refresh = async () => {
      if (preview || !isCurrent()) return false;
      const version = ++current.version;
      try {
        const response = await fetch("/api/my/badges/collection", { cache: "no-store", signal: current.controller.signal, headers: { "x-ruined-session-owner": ownerId } });
        if (!isCurrent() || version !== current.version) return false;
        if ([401, 403, 409].includes(response.status)) { suspend(); return false; }
        const result: unknown = await response.json();
        if (!isCurrent() || version !== current.version) return false;
        if (result && typeof result === "object" && "ownerId" in result && result.ownerId !== ownerId) { suspend(); return false; }
        if (!response.ok || !validCollection(result, ownerId)) throw new Error("Collection unavailable");
        setCollection(result); setRefreshError(false); return true;
      } catch {
        if (isCurrent() && version === current.version) setRefreshError(true);
        return false;
      }
    };
    function refreshOnReturn() { if (!document.hidden && !writing.current) void current.refresh(); }
    if (!preview) {
      void current.refresh();
      window.addEventListener("focus", refreshOnReturn);
      document.addEventListener("visibilitychange", refreshOnReturn);
    }
    return () => {
      current.controller.abort(); window.removeEventListener("focus", refreshOnReturn); document.removeEventListener("visibilitychange", refreshOnReturn);
      if (lifecycle.current === current) lifecycle.current = null;
    };
  }, [ownerId, initialCollection, preview]);

  const currentCollection = collection?.ownerId === ownerId ? collection : null;
  const selected = currentCollection?.badges.find(badge => badge.key === selectedKey);
  async function save(action: "seen" | "visibility", visible?: boolean, nextHref = "/my") {
    const current = lifecycle.current;
    const badge = selected;
    if (!currentCollection || !current || current.ownerId !== ownerId || current.controller.signal.aborted || writing.current) return;
    if (preview) { if (action === "seen") router.push(nextHref); return; }
    if (action === "visibility" && (!badge?.earnedAt || typeof visible !== "boolean")) return;
    writing.current = true; current.version++; setBusy(action); setError(null); setStatus(null);
    try {
      const response = await fetch("/api/my/badges/collection", { method: action === "seen" ? "POST" : "PATCH", signal: current.controller.signal,
        headers: { "Content-Type": "application/json", "x-ruined-session-owner": ownerId },
        body: JSON.stringify(action === "seen" ? { action, ownerId } : { action, ownerId, badgeKey: badge!.key, visible }) });
      if (current.controller.signal.aborted || lifecycle.current !== current) return;
      if ([401, 403, 409].includes(response.status)) { setCollection(null); setSelectedKey(null); current.controller.abort(); return; }
      const result = await response.json();
      if (current.controller.signal.aborted || lifecycle.current !== current) return;
      if (!response.ok || result.ok !== true) throw new Error("Collection update unavailable");
      if (result.ownerId !== undefined && result.ownerId !== ownerId) { setCollection(null); setSelectedKey(null); current.controller.abort(); return; }
      if (action === "seen") { router.push(nextHref); router.refresh(); }
      else {
        // The write is confirmed; refresh resolves the complete server-owned view.
        setCollection(value => value?.ownerId === ownerId ? { ...value, badges: value.badges.map(item => item.key === badge!.key ? { ...item, publicVisible: visible! } : item) } : value);
        const refreshed = await current.refresh();
        if (!current.controller.signal.aborted && lifecycle.current === current) setStatus(refreshed ? "Visibility saved." : "Visibility saved. The rest of your collection will refresh when you return.");
      }
    } catch {
      if (!current.controller.signal.aborted && lifecycle.current === current) setError(action === "seen" ? "We couldn’t save your introduction. Try again." : "We couldn’t save that visibility change. Try again.");
    } finally {
      if (!current.controller.signal.aborted && lifecycle.current === current) { writing.current = false; setBusy(null); }
    }
  }

  if (!currentCollection) return <section className={styles.collection}><h1>Your badges</h1><p className={styles.sessionNotice}>Your session changed. Reopen your profile to continue.</p><Link className="member-button" href="/my">Open profile</Link></section>;
  const earnedCount = currentCollection.badges.filter(badge => badge.earnedAt).length;
  const counts = Object.fromEntries(badgeStates.map(state => [state, currentCollection.badges.filter(badge => badgeState(badge) === state).length])) as Record<BadgeState, number>;
  const visibleBadges = currentCollection.badges.filter(badge => filter === "all" || badgeState(badge) === filter)
    .sort((a, b) => compareBadges(a, b, sort));
  return <main className={styles.collection}>
    <header className={styles.header}>
      {currentCollection.seenAt !== null ? <Link className={styles.back} href="/my"><span aria-hidden="true">←</span> Your profile</Link> : null}
      <div className={styles.heading}><h1>Your badges</h1><p className={styles.count}><strong>{earnedCount}</strong><span>of {currentCollection.badges.length} earned</span></p></div>
      {preview ? <p className={styles.previewBanner}>Collection preview · example progress. No changes are saved.</p> : null}
      {currentCollection.seenAt === null ? <div className={styles.introduction}><p>Badges mark the things you do here. Open one to see how to earn it and track your progress. You choose which earned badges appear on your public profile.</p><button type="button" className="member-button" disabled={busy === "seen"} onClick={() => { void save("seen"); }}>{busy === "seen" ? "Saving…" : "Continue to profile"}<span aria-hidden="true">↗</span></button></div> : <p className={styles.subheading}>Open a badge to see your progress, its earned date, and who can see it.</p>}
      {error && busy !== "visibility" && !selected ? <p className={styles.error} role="alert">{error}</p> : null}
      {refreshError ? <p className={styles.refreshNotice} role="status">Your latest progress couldn’t load. <button type="button" onClick={() => { if (!writing.current) void lifecycle.current?.refresh(); }}>Try again</button></p> : null}
    </header>
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Filter badges">
        {(["all", ...badgeStates] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
          {value === "all" ? "All" : stateLabels[value]}<span>{value === "all" ? currentCollection.badges.length : counts[value]}</span>
        </button>)}
      </div>
      <label className={styles.sort}>Sort by<select value={sort} onChange={event => setSort(event.currentTarget.value as BadgeSort)}>
        <option value="status">Status</option><option value="progress">Closest to earning</option><option value="recent">Newest earned</option><option value="name">Name: A–Z</option>
      </select></label>
    </div>
    <p className={styles.resultCount} role="status">{visibleBadges.length} {visibleBadges.length === 1 ? "badge" : "badges"}{filter !== "all" ? ` · ${stateLabels[filter]}` : " in your collection"}</p>
    {visibleBadges.length === 0 ? <p className={styles.empty}>No badges in this group yet. Choose All to explore your collection.</p> : <ul className={styles.grid} aria-label="Your badge collection">
      {visibleBadges.map(badge => {
        const artwork = badgeArtwork(badge);
        const state = badgeState(badge);
        const index = currentCollection.badges.findIndex(item => item.key === badge.key);
        return <li key={badge.key}><button type="button" className={styles.tile} data-state={state} data-earned={Boolean(badge.earnedAt)} aria-label={`${badge.label}. ${badge.earnedAt ? "Earned" : badge.progressLabel === "Earned" ? "Awaiting confirmation" : badge.progressLabel}. View badge details`} aria-haspopup="dialog" aria-controls={`${id}-dialog`}
          onClick={event => { triggerRef.current = event.currentTarget; setSelectedKey(badge.key); setError(null); setStatus(null); }}>
          <span className={styles.tileTop}><span>{String(index + 1).padStart(2, "0")}</span><span aria-hidden="true">↗</span></span>
          <span className={styles.artwork} aria-hidden="true">{artwork ? <Image src={artwork.src} alt="" width={360} height={360} sizes="(max-width: 600px) 100px, (max-width: 1023px) 180px, 180px" draggable={false}/> : <span>{badgeStamp(badge)}</span>}</span>
          <span className={styles.badgeName}>{badge.label}</span>
          <span className={styles.rule}>{badge.description}</span>
          <span className={styles.tileStatus}>{state === "earned" ? <><span className={styles.earnedMark} aria-hidden="true">✓</span> Earned<span className={styles.privacyLabel}>{badge.publicVisible ? "Public" : "Private"}</span></> : state === "earning" ? <>Earning <span className={styles.percent}>{Math.min(100, Math.floor(badge.progress / badge.target * 100))}%</span></> : "Not earned"}</span>
        </button></li>;
      })}
      </ul>
    }
    <p className={styles.footnote}>Your private Journal stays private. Badge visibility is yours to choose.</p>
    <BadgeDetails badge={selected} id={id} preview={preview} busy={busy !== null} error={error} status={status} returnFocus={triggerRef}
      onDismiss={() => { setSelectedKey(null); setError(null); setStatus(null); }} onVisibility={visible => { void save("visibility", visible); }} onAction={currentCollection.seenAt === null ? href => { void save("seen", undefined, href); } : undefined}/>
  </main>;
}
