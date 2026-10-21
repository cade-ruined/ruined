"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import type { MemberBadge } from "@/lib/membership/badge-model";
import styles from "./MemberBadges.module.css";

export type BadgeDisplay = Omit<MemberBadge, "key"> & { key: string; stamp?: string };
const artworks: Record<string, { src: string; filename: string }> = {
  "early-supporter": { src: "/membership/badges/i-was-here-red-dashes-v2.png", filename: "ruined-i-was-here-badge.png" },
  "make-it-yours": { src: "/membership/badges/make-it-yours-v2.png", filename: "ruined-make-it-yours-badge.png" },
  "first-words": { src: "/membership/badges/first-words-v2.png", filename: "ruined-first-words-badge.png" },
  "your-story": { src: "/membership/badges/your-story-v2.png", filename: "ruined-your-story-badge.png" },
  "on-the-record": { src: "/membership/badges/on-the-record-v1.png", filename: "ruined-on-the-record-badge.png" },
  "groundwork": { src: "/membership/badges/groundwork-v2.png", filename: "ruined-groundwork-badge.png" },
  "in-the-room": { src: "/membership/badges/in-the-room-v2.png", filename: "ruined-in-the-room-badge.png" },
  "full-circle": { src: "/membership/badges/full-circle-v2.png", filename: "ruined-full-circle-badge.png" },
  "the-whole-month": { src: "/membership/badges/the-whole-month-v2.png", filename: "ruined-the-whole-month-badge.png" },
  "open-door": { src: "/membership/badges/open-door-v2.png", filename: "ruined-open-door-badge.png" },
  "in-real-life": { src: "/membership/badges/in-real-life-v2.png", filename: "ruined-in-real-life-badge.png" },
};
const stampNumbers: Record<string, string> = { "early-supporter": "01", "one-year": "1" };
export function badgeArtwork(badge: Pick<BadgeDisplay, "key">) { return artworks[badge.key]; }
export function badgeStamp(badge: Pick<BadgeDisplay, "key" | "stamp">) { return badge.stamp ?? stampNumbers[badge.key] ?? "•"; }
const earnedDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The same physical hang tag is used by the dock and the first-earned reveal. */
export default function MemberBadgeCard({ badge, id, preview = false, celebration = false, closeControl }: {
  badge: BadgeDisplay; id: string; preview?: boolean; celebration?: boolean; closeControl?: ReactNode;
}) {
  const artwork = badgeArtwork(badge);
  return <div className={`${styles.detail}${celebration ? ` ${styles.reveal}` : ""}`}>
    <span className={styles.cardEdge} aria-hidden="true" />
    <span className={styles.cardStock} aria-hidden="true" />
    <span className={styles.hangerRim} aria-hidden="true" />
    {closeControl}
    <div className={styles.cardHeader}><span className={styles.cardBrand} role="img" aria-label="Ruined"/><span className={styles.cardSeries}>Merit badges</span></div>
    <div className={styles.patchMount} aria-hidden="true">
      <span className={styles.detailStamp} data-artwork={Boolean(artwork) || undefined}>{artwork ? <Image src={artwork.src} alt="" width={440} height={440} sizes="220px" draggable={false}/> : badgeStamp(badge)}<span className={styles.pin} /></span>
    </div>
    <div className={styles.cardCopy}>
      <p className={styles.eyebrow}>{celebration ? "You earned a badge" : preview ? "Badge preview" : "Earned badge"}</p>
      <h2 id={`${id}-title`}>{badge.label}</h2>
      <p id={`${id}-description`} className={styles.description}>{badge.description}</p>
    </div>
    <p className={styles.earned}><span>{preview ? "Example date" : "Earned"}</span><time dateTime={badge.earnedAt}>{earnedDate.format(new Date(badge.earnedAt))}</time></p>
    {preview ? <p className={styles.previewNote}>Layout preview · not added to your profile</p> : null}
  </div>;
}

/** Native download of the original transparent art; never a screenshot or rendered derivative. */
export function MemberBadgeDownload({ badge }: { badge: BadgeDisplay }) {
  const artwork = badgeArtwork(badge);
  return artwork ? <a className={styles.saveBadge} href={artwork.src} download={artwork.filename} aria-label={`Save ${badge.label} badge as a transparent PNG`}>
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5"/></svg>
    Save badge
  </a> : null;
}
