"use client";

/* eslint-disable @next/next/no-img-element -- Preserve the exact supplied Ruined mark. */

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicMemberCard } from "@/lib/membership/public-card-model";
import type { ArchiveShadow } from "@/components/membership/card/archive-lighting";
import styles from "./MembershipInvitationCard.module.css";

const ArchiveParticles = dynamic(() => import("@/components/membership/card/AmbientParticles"), { ssr: false });
const ArchiveRoomContext = createContext<((shadow: ArchiveShadow | null) => void) | null>(null);

/** The original basement photograph, dust and table shadow, bounded to this section. */
export function MembershipInvitationRoom({ children, className, frameToCard = false }: { children: ReactNode; className?: string; frameToCard?: boolean }) {
  const room = useRef<HTMLDivElement>(null);
  const tableShadow = useRef<SVGSVGElement>(null), shadowShape = useRef<SVGPolygonElement>(null);
  const [portrait, setPortrait] = useState(false), [inView, setInView] = useState(false);
  useEffect(() => {
    const element = room.current;
    if (!element) return;
    const stacked = window.matchMedia("(max-width: 759px)");
    const card = element.querySelector("[data-membership-invitation-preview]");
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      // Long forms can continue below the photographed room. Keep its table
      // beneath the card on stacked layouts or when card framing is requested.
      const cardBottom = card?.getBoundingClientRect().bottom;
      const height = (stacked.matches || frameToCard) && cardBottom !== undefined
        ? Math.min(bounds.height, Math.max(1, cardBottom - bounds.top + 32))
        : bounds.height;
      element.style.setProperty("--membership-room-height", `${height}px`);
      setPortrait(bounds.width / Math.max(1, height) <= 4 / 5);
    };
    resize();
    const size = new ResizeObserver(resize); size.observe(element);
    if (card) size.observe(card);
    stacked.addEventListener("change", resize);
    const visibility = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setInView(true); visibility?.disconnect();
    }, { rootMargin: "160px" });
    if (visibility) visibility.observe(element); else setInView(true);
    return () => { size.disconnect(); visibility?.disconnect(); stacked.removeEventListener("change", resize); };
  }, [frameToCard]);
  const updateShadow = useCallback((shadow: ArchiveShadow | null) => {
    const layer = tableShadow.current, shape = shadowShape.current;
    if (!layer || !shape) return;
    if (!shadow) { layer.style.visibility = "hidden"; return; }
    layer.setAttribute("viewBox", `0 0 ${shadow.width} ${shadow.height}`);
    layer.style.clipPath = `inset(${Math.max(0, shadow.clipTop)}px 0 ${Math.max(0, shadow.height - shadow.clipBottom)}px 0)`;
    shape.setAttribute("points", shadow.points.map(point => `${point.x},${point.y}`).join(" "));
    shape.style.filter = `blur(${shadow.blur}px)`;
    shape.style.opacity = String(shadow.opacity);
    layer.style.visibility = "visible";
  }, []);
  return <ArchiveRoomContext.Provider value={updateShadow}>
    <div ref={room} className={[styles.room, className].filter(Boolean).join(" ")} data-archive-room>
      <div className={styles.archive} data-archive-room-surface aria-hidden="true">
        <img src={portrait ? "/membership/card/archive-room-portrait-v1.webp" : "/membership/card/archive-room-v1.webp"}
          alt="" width={portrait ? 941 : 1672} height={portrait ? 1672 : 941} loading="lazy" decoding="async" />
      </div>
      <svg ref={tableShadow} className={styles.tableShadow} preserveAspectRatio="none" aria-hidden="true"><polygon ref={shadowShape} fill="#050403" /></svg>
      {inView ? <ArchiveParticles className={styles.particles} archive roomRelative /> : null}
      <div className={styles.roomContent}>{children}</div>
    </div>
  </ArchiveRoomContext.Provider>;
}

const Invitation = dynamic(() => import("@/components/membership/card/MemberCard"), {
  ssr: false,
  loading: InvitationPlaceholder,
});

// This is brand artwork, not an issued invitation or a fictional member profile.
const ruined: PublicMemberCard = {
  name: "The Ruined Project", memberTag: null, avatarUrl: null, memberSince: null,
  location: null, bio: null, buildingNow: null, websiteUrl: null, labels: [],
  wearSeed: "ruined-direct-landing-invitation",
};

function InvitationPlaceholder() {
  return <div className={styles.placeholder} role="img" aria-label="Ruined invitation. You’re allowed to become someone new.">
    <div className={styles.card} aria-hidden="true">
      <span>You’re allowed</span>
      <img src="/ruined-mark.svg" alt="" width="284" height="400" />
      <span>to become someone new.</span>
    </div>
  </div>;
}

/** Heavy card artwork and WebGL load only when the invitation reaches the reader. */
export default function MembershipInvitationCard({ recipientName = null }: { recipientName?: string | null }) {
  const updateShadow = useContext(ArchiveRoomContext);
  const root = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const name = recipientName?.trim() || null;
  const [printedName, setPrintedName] = useState(name);
  useEffect(() => {
    if (name === printedName) return;
    const timeout = window.setTimeout(() => setPrintedName(name), 240);
    return () => window.clearTimeout(timeout);
  }, [name, printedName]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setInView(true);
      observer.disconnect();
    }, { rootMargin: "160px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={root} className={styles.root} data-membership-invitation-preview>
    {inView
      ? <Invitation card={ruined} variant="invitation" invitationSource="ruined_direct" invitationRecipientName={printedName} embedded archive={Boolean(updateShadow)} onArchiveShadow={updateShadow ?? undefined} />
      : <InvitationPlaceholder />}
  </div>;
}
