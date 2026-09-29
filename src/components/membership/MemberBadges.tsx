"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { MemberBadge } from "@/lib/membership/badge-model";
import styles from "./MemberBadges.module.css";

export type BadgeDisplay = Omit<MemberBadge, "key"> & { key: string; stamp?: string };
const badgeImages: Record<string, { src: string; filename: string }> = {
  "early-supporter": { src: "/membership/badges/i-was-here-red-dashes-v2.png", filename: "ruined-i-was-here-badge.png" },
};
const stampNumbers: Record<string, string> = { "early-supporter": "01" };
function stampFor(badge: BadgeDisplay) { return badge.stamp ?? stampNumbers[badge.key] ?? "•"; }
const earnedDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function MemberBadges({ badges, preview = false }: { badges: readonly BadgeDisplay[]; preview?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const activeIndex = Math.max(0, badges.findIndex(item => item.key === focusedKey));
  const rowRef = useRef<HTMLUListElement>(null);
  const selectOnScrollRef = useRef(true);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const badge = badges.find(item => item.key === selected);
  const artwork = badge ? badgeImages[badge.key] : undefined;
  const activeKey = badge?.key;
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!activeKey || !dialog) return;
    const previousFocus = triggerRef.current ?? document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      });
    };
  }, [activeKey]);

  // A native listener is needed here: React wheel listeners are passive. Consume
  // the wheel only when the dock can move; otherwise leave page scrolling alone.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    function wheel(event: WheelEvent) {
      if (!row || event.ctrlKey || event.metaKey) return;
      const overflow = row.scrollWidth - row.clientWidth;
      if (overflow <= 1) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? row.clientWidth : 1);
      if (!pixels || (pixels < 0 && row.scrollLeft <= 1) || (pixels > 0 && row.scrollLeft >= overflow - 1)) return;
      if (!event.cancelable) return;
      event.preventDefault();
      selectOnScrollRef.current = true;
      row.scrollLeft = Math.max(0, Math.min(overflow, row.scrollLeft + pixels));
    }
    row.addEventListener("wheel", wheel, { passive: false });
    return () => row.removeEventListener("wheel", wheel);
  }, [badges.length]);

  function selectFromScroll() {
    const row = rowRef.current;
    if (!row || !selectOnScrollRef.current || row.scrollWidth <= row.clientWidth + 1) return;
    const overflow = row.scrollWidth - row.clientWidth;
    let next = row.scrollLeft <= 1 ? 0 : row.scrollLeft >= overflow - 1 ? badges.length - 1 : -1;
    if (next < 0) {
      const center = row.getBoundingClientRect().left + row.clientWidth / 2;
      let nearest = Infinity;
      for (let index = 0; index < badges.length; index++) {
        const bounds = buttonRefs.current[index]?.getBoundingClientRect();
        if (!bounds) continue;
        const distance = Math.abs(bounds.left + bounds.width / 2 - center);
        if (distance < nearest) { nearest = distance; next = index; }
      }
    }
    if (badges[next]) setFocusedKey(badges[next].key);
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? Math.min(index + 1, badges.length - 1)
      : event.key === "ArrowLeft" ? Math.max(index - 1, 0)
      : event.key === "Home" ? 0 : event.key === "End" ? badges.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectOnScrollRef.current = false;
    setFocusedKey(badges[next].key);
    const button = buttonRefs.current[next], row = rowRef.current;
    button?.focus({ preventScroll: true });
    if (button && row) {
      const bounds = button.getBoundingClientRect(), viewport = row.getBoundingClientRect();
      // Reveal just enough of the next icon without moving the page vertically.
      if (bounds.left < viewport.left + 6) row.scrollLeft -= viewport.left + 6 - bounds.left;
      else if (bounds.right > viewport.right - 6) row.scrollLeft += bounds.right - viewport.right + 6;
    }
  }

  if (!badges.length) return null;

  return <div className={styles.badges}>
    <p id={`${id}-instructions`} className={styles.srOnly}>Use the arrow keys to explore badges. Press Enter to see how and when a badge was earned.</p>
    <ul ref={rowRef} className={styles.row} aria-label={preview ? "Sample badges" : "Earned badges"} onPointerDown={() => { selectOnScrollRef.current = true; }} onScroll={selectFromScroll}>
      {badges.map((item, index) => <li key={item.key}>
        <button ref={element => { buttonRefs.current[index] = element; }} type="button" className={styles.badge}
          data-active={index === activeIndex || undefined} data-neighbor={Math.abs(index - activeIndex) === 1 || undefined}
          tabIndex={index === activeIndex ? 0 : -1} aria-label={`${item.label} badge. View details`}
          aria-describedby={`${id}-instructions`} aria-haspopup="dialog" aria-controls={`${id}-dialog`}
          onPointerEnter={event => { if (event.pointerType !== "touch") setFocusedKey(item.key); }}
          onFocus={() => setFocusedKey(item.key)} onKeyDown={event => moveFocus(event, index)}
          onClick={event => { triggerRef.current = event.currentTarget; setFocusedKey(item.key); setSelected(item.key); }}>
          <span className={styles.stamp} data-artwork={Boolean(badgeImages[item.key]) || undefined} aria-hidden="true">{badgeImages[item.key] ? <Image src={badgeImages[item.key].src} alt="" width={72} height={72} sizes="56px" draggable={false}/> : stampFor(item)}</span>
        </button>
      </li>)}
    </ul>
    <dialog ref={dialogRef} id={`${id}-dialog`} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); setSelected(null); }} onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      {badge ? <><div className={styles.detail}>
        <span className={styles.cardEdge} aria-hidden="true" />
        <span className={styles.cardStock} aria-hidden="true" />
        <span className={styles.hangerRim} aria-hidden="true" />
        <button ref={closeRef} type="button" className={styles.close} aria-label="Close badge details" onClick={() => setSelected(null)}>×</button>
        <div className={styles.cardHeader}><span className={styles.cardBrand} role="img" aria-label="Ruined"/><span className={styles.cardSeries}>Merit badges</span></div>
        <div className={styles.patchMount} aria-hidden="true">
          <span className={styles.detailStamp} data-artwork={Boolean(artwork) || undefined}>{artwork ? <Image src={artwork.src} alt="" width={440} height={440} sizes="220px" draggable={false}/> : stampFor(badge)}<span className={styles.pin} /></span>
        </div>
        <div className={styles.cardCopy}>
          <p className={styles.eyebrow}>{preview ? "Badge preview" : "Earned badge"}</p>
          <h2 id={`${id}-title`}>{badge.label}</h2>
          <p id={`${id}-description`} className={styles.description}>{badge.description}</p>
        </div>
        <p className={styles.earned}><span>{preview ? "Example date" : "Earned"}</span><time dateTime={badge.earnedAt}>{earnedDate.format(new Date(badge.earnedAt))}</time></p>
        {preview ? <p className={styles.previewNote}>Layout preview · not added to your profile</p> : null}
      </div>{artwork ? <a className={styles.saveBadge} href={artwork.src} download={artwork.filename} aria-label={`Save ${badge.label} badge as a transparent PNG`}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5"/></svg>
        Save badge
      </a> : null}</> : null}
    </dialog>
  </div>;
}
