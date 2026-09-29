"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import MemberBadgeDialog from "./MemberBadgeDialog";
import { badgeArtwork, badgeStamp, type BadgeDisplay } from "./MemberBadgeCard";
export type { BadgeDisplay } from "./MemberBadgeCard";
import styles from "./MemberBadges.module.css";

export default function MemberBadges({ badges, preview = false }: { badges: readonly BadgeDisplay[]; preview?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const activeIndex = Math.max(0, badges.findIndex(item => item.key === focusedKey));
  const rowRef = useRef<HTMLUListElement>(null);
  const selectOnScrollRef = useRef(true);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const badge = badges.find(item => item.key === selected);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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
          <span className={styles.stamp} data-artwork={Boolean(badgeArtwork(item)) || undefined} aria-hidden="true">{badgeArtwork(item) ? <Image src={badgeArtwork(item).src} alt="" width={72} height={72} sizes="56px" draggable={false}/> : badgeStamp(item)}</span>
        </button>
      </li>)}
    </ul>
    <MemberBadgeDialog badge={badge} id={id} preview={preview} returnFocus={triggerRef} onDismiss={() => setSelected(null)} />
  </div>;
}
