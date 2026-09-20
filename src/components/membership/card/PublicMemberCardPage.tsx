"use client";

/* eslint-disable @next/next/no-img-element -- Exact local SVG marks and a canvas fallback do not need image optimization. */

import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { publicMemberCardIdentity, type PublicMemberCard } from "@/lib/membership/public-card-model";
import MemberCard from "./MemberCard";
import AmbientParticles from "./AmbientParticles";
import type { ArchiveShadow } from "./archive-lighting";
import styles from "./PublicMemberCardPage.module.css";

export default function PublicMemberCardPage({ card, preview = false, variant = "member", invitationExpiresAt = null, invitationRecipientName = null, title, headerActions, footerActions, footerNote, children }: {
  card: PublicMemberCard; preview?: boolean; variant?: "member" | "invitation"; invitationExpiresAt?: string | null; invitationRecipientName?: string | null;
  title?: string; headerActions?: ReactNode; footerActions?: ReactNode; footerNote?: ReactNode; children?: ReactNode;
}) {
  const [status, setStatus] = useState("");
  const tableShadow = useRef<SVGSVGElement>(null), shadowShape = useRef<SVGPolygonElement>(null);
  // The tabletop extends beyond the card's canvas. Keep its projected shadow
  // in the room layer, updating the SVG directly without React renders per frame.
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
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `${publicMemberCardIdentity(card)} / Ruined`, url: window.location.href });
      else { await navigator.clipboard.writeText(window.location.href); setStatus("Link copied."); }
    } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setStatus("Copy this page’s address to share the card."); }
  }
  return <main className={styles.page} data-public-member-card>
    <div className={styles.archive} aria-hidden="true">
      <picture>
        <source media="(max-aspect-ratio: 4/5)" srcSet="/membership/card/archive-room-portrait-v1.webp" />
        <img src="/membership/card/archive-room-v1.webp" width={1672} height={941} alt="" decoding="async" fetchPriority="high" />
      </picture>
    </div>
    <svg ref={tableShadow} className={styles.tableShadow} preserveAspectRatio="none" aria-hidden="true"><polygon ref={shadowShape} fill="#050403" /></svg>
    <AmbientParticles className={styles.particles} archive />
    <header className={styles.header}><Link href="/" aria-label="Ruined home"><img src="/ruined-wordmark.svg" width={120} height={36} alt="Ruined" /></Link><span>{title ?? (preview ? "MEMBERS’ ARCHIVE / PREVIEW" : "THE MEMBERS’ ARCHIVE")}</span><div className={styles.headerActions}>{headerActions !== undefined ? headerActions : preview ? <Link href="/my/card">My Card ↗</Link> : <button type="button" onClick={share}>Share card ↗</button>}</div></header>
    <div className={styles.content}><div className={styles.caption}><h1>{variant === "invitation" ? `An invitation from ${publicMemberCardIdentity(card)}` : `${publicMemberCardIdentity(card)} — Ruined member card`}</h1></div><div className={styles.card}><MemberCard card={card} variant={variant} invitationExpiresAt={invitationExpiresAt} invitationRecipientName={invitationRecipientName} archive onArchiveShadow={updateShadow} /></div></div>
    <p className={styles.status} role="status">{status}</p>
    {children ? <div className={styles.belowCard}>{children}</div> : null}
    <footer className={styles.footer}><div>{footerNote ?? (preview ? "Example details. Nothing is published." : "Shared by its owner.")}</div><div className={styles.footerActions}>{footerActions !== undefined ? footerActions : <a href="https://theruinedproject.com/#members">Find your people <span aria-hidden="true">↗</span></a>}</div></footer>
  </main>;
}
