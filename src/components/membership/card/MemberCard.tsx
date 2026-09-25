"use client";

/* eslint-disable @next/next/no-img-element -- Exact local SVG marks and a canvas fallback do not need image optimization. */

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { publicMemberCardIdentity, type PublicMemberCard } from "@/lib/membership/public-card-model";
import { cardArtworkFontRequests, createCardArtwork, downloadCardArtwork, type CardArtwork, type CardVariant } from "./card-artwork";
import type { CardPose } from "./MemberCardScene";
import { memberInvitationDeadline } from "@/lib/membership/invitation-expiry";
import type { ArchiveShadow } from "./archive-lighting";
import AmbientParticles from "./AmbientParticles";
import styles from "./MemberCard.module.css";

const Scene = dynamic(() => import("./MemberCardScene"), { ssr: false });
class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}
const restingPose: CardPose = { x: 0, y: 0, tiltX: 0, tiltY: 0, roll: 0, lifted: false, side: "front", reduced: false, reset: 0 };

export default function MemberCard({ card, compact = false, archive = false, variant = "member", invitationExpiresAt = null, invitationRecipientName = null, invitationSource = "member", onDownload, onArchiveShadow }: { card: PublicMemberCard; compact?: boolean; archive?: boolean; variant?: CardVariant; invitationExpiresAt?: string | null; invitationRecipientName?: string | null; invitationSource?: "member" | "ruined_direct"; onDownload?: () => void; onArchiveShadow?: (shadow: ArchiveShadow | null) => void }) {
  const direct = variant === "invitation" && invitationSource === "ruined_direct";
  const identity = direct ? "The Ruined Project" : publicMemberCardIdentity(card);
  const id = useId(), stage = useRef<HTMLDivElement>(null), handle = useRef<HTMLDivElement>(null), flatCanvas = useRef<HTMLCanvasElement>(null);
  const [artworkResult, setArtworkResult] = useState<{ card: PublicMemberCard; variant: CardVariant; invitationExpiresAt: string | null; invitationRecipientName: string | null; invitationSource: "member" | "ruined_direct"; artwork: CardArtwork } | null>(null), [pose, setPose] = useState(restingPose);
  const artwork = artworkResult?.card === card && artworkResult.variant === variant && artworkResult.invitationExpiresAt === invitationExpiresAt && artworkResult.invitationRecipientName === invitationRecipientName && artworkResult.invitationSource === invitationSource ? artworkResult.artwork : null;
  const [artworkError, setArtworkError] = useState(false);
  const [ready, setReady] = useState(false), [flat, setFlat] = useState(false), [failed, setFailed] = useState(false), [visible, setVisible] = useState(true), [status, setStatus] = useState("");
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; side: "front" | "back"; yaw: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (pose.reduced || failed) setReady(false);
    if (!(pose.reduced || flat || failed || artworkError || !artwork) || !drag.current) return;
    const active = drag.current; drag.current = null;
    if (handle.current?.hasPointerCapture(active.id)) handle.current.releasePointerCapture(active.id);
    setPose(value => ({ ...restingPose, side: value.side, reduced: value.reduced, reset: value.reset + 1 }));
  }, [pose.reduced, flat, failed, artworkError, artwork]);
  useEffect(() => {
    let cancelled = false;
    setArtworkError(false);
    createCardArtwork(card, variant, invitationExpiresAt, invitationRecipientName, invitationSource).then(async value => {
      if (cancelled) return;
      setArtworkResult({ card, variant, invitationExpiresAt, invitationRecipientName, invitationSource, artwork: value });
      const fonts = document.fonts;
      const hasFonts = () => cardArtworkFontRequests(variant).every(font => fonts.check(font));
      if (fonts && !hasFonts()) {
        await fonts.ready;
        if (cancelled || !hasFonts()) return;
        const refined = await createCardArtwork(card, variant, invitationExpiresAt, invitationRecipientName, invitationSource);
        if (!cancelled) setArtworkResult({ card, variant, invitationExpiresAt, invitationRecipientName, invitationSource, artwork: refined });
      }
    }).catch(() => { if (!cancelled) { setArtworkError(true); setStatus("The image could not load. Every card detail is available below."); } });
    return () => { cancelled = true; };
  }, [card, variant, invitationExpiresAt, invitationRecipientName, invitationSource]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    function sync() { setPose(value => ({ ...value, reduced: media.matches })); }
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    let intersects = true;
    function sync() { setVisible(intersects && !document.hidden); }
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => { intersects = entries[0]?.isIntersecting ?? false; sync(); }, { rootMargin: "40px" }) : null;
    observer?.observe(element); sync(); document.addEventListener("visibilitychange", sync);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);
  useEffect(() => {
    if (!artwork || !flatCanvas.current) return;
    const output = flatCanvas.current; const source = artwork[pose.side];
    output.width = source.width; output.height = source.height; output.getContext("2d")?.drawImage(source, 0, 0);
  }, [artwork, pose.side]);
  const onReady = useCallback(() => setReady(true), []);
  const onLost = useCallback(() => { setFailed(true); setStatus("Showing the flat card."); }, []);
  useEffect(() => {
    if (!artwork || ready || failed || flat || pose.reduced || !visible) return;
    const timeout = window.setTimeout(onLost, 15000);
    return () => window.clearTimeout(timeout);
  }, [artwork, ready, failed, flat, pose.reduced, visible, onLost]);
  function flip() { setPose(value => ({ ...restingPose, reduced: value.reduced, side: value.side === "front" ? "back" : "front", reset: value.reset + 1 })); }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current || !artwork || !ready || flat || failed || pose.reduced) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, side: pose.side, yaw: 0 };
    setPose(value => ({ ...value, lifted: true }));
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (flat || failed || pose.reduced || !ready || !artwork) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (drag.current?.id === event.pointerId) {
      const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
      if (Math.hypot(dx, dy) > 7) drag.current.moved = true;
      const yaw = Math.max(-Math.PI * 1.15, Math.min(Math.PI * 1.15, dx / bounds.width * Math.PI * 1.7));
      drag.current.yaw = yaw;
      setPose(value => ({ ...value, x: Math.max(-.34, Math.min(.34, dx / bounds.width * .9)), y: Math.max(-.32, Math.min(.32, -dy / bounds.height * 1.2)), tiltX: Math.max(-.62, Math.min(.62, dy / bounds.height * 1.5)), tiltY: yaw, roll: Math.max(-.16, Math.min(.16, dx / bounds.width * .3)) }));
    } else if (event.pointerType === "mouse") {
      setPose(value => ({ ...value, tiltX: (event.clientY - bounds.top - bounds.height / 2) / bounds.height * .24, tiltY: (event.clientX - bounds.left - bounds.width / 2) / bounds.width * .34 }));
    }
  }
  function release(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && !active.moved) flip();
    else {
      const side = cancelled ? active.side : Math.cos((active.side === "back" ? Math.PI : 0) + active.yaw) < 0 ? "back" : "front";
      setPose(value => ({ ...restingPose, side, reduced: value.reduced, reset: value.reset + 1 }));
    }
  }
  async function download() {
    if (!artwork || downloading) return;
    setDownloading(true); setStatus("");
    try { await downloadCardArtwork(direct ? { ...card, name: "The Ruined Project" } : card, artwork, pose.side, variant); onDownload?.(); setStatus("Card image downloaded."); }
    catch { setStatus("The image could not be downloaded. Please try again."); }
    finally { setDownloading(false); }
  }
  const flatView = flat || failed || artworkError || pose.reduced;
  return <section className={styles.viewer} data-member-card data-card-side={pose.side} data-card-renderer={flatView ? "flat" : ready && artwork ? "3d" : "loading"} data-compact={compact || undefined} aria-label={variant === 'invitation' ? `An invitation from ${identity}` : `${identity}'s Ruined member card`}>
    <div ref={stage} className={styles.stage} data-lifted={pose.lifted || undefined} aria-describedby={`${id}-hint`}>
      {compact ? <AmbientParticles className={styles.particles} /> : null}
      {!archive ? <div className={styles.ground} aria-hidden="true" /> : null}
      <div className={styles.flat} data-visible={flatView || !ready || !artwork} aria-hidden="true">
        {artwork ? <canvas ref={flatCanvas} /> : <div className={styles.placeholder}><img src="/ruined-wordmark.svg" alt="" /><div className={styles.emptyPortrait} /><span>{identity}</span></div>}
      </div>
      {artworkResult && !failed && !pose.reduced ? <div className={styles.scene} data-visible={!flatView && Boolean(artwork)} aria-hidden="true"><SceneBoundary onError={onLost}><Scene artwork={artworkResult.artwork} pose={pose} visible={visible && !flatView && Boolean(artwork)} archive={archive} onArchiveShadow={onArchiveShadow} onReady={onReady} onLost={onLost} /></SceneBoundary></div> : null}
      <div ref={handle} className={styles.handle} data-cursor-native data-static={flatView || !ready || !artwork} role="button" tabIndex={0} aria-label={`Drag to rotate, or activate to flip card to ${pose.side === "front" ? "back" : "front"}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onLostPointerCapture={event => release(event, true)}
        onClick={(event) => { if (event.detail === 0 || flatView || !ready || !artwork) flip(); }}
        onPointerLeave={() => { if (!drag.current) setPose(value => ({ ...value, tiltX: 0, tiltY: 0 })); }}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); flip(); } if (event.key === "Escape") { event.preventDefault(); const active = drag.current; drag.current = null; if (active && event.currentTarget.hasPointerCapture(active.id)) event.currentTarget.releasePointerCapture(active.id); setPose(value => ({ ...restingPose, reduced: value.reduced, reset: value.reset + 1 })); } }} />
      <p className={styles.hint} id={`${id}-hint`}>{flatView ? "Your card, front and back." : !artwork || !ready ? "Preparing your card…" : "Drag to rotate · Tap to flip"}</p>
    </div>
    <div className={styles.controls}>
      <button type="button" onClick={flip}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M4 4h9v12H4zM16 6l2 3-2 3M1 8l-2 3 2 3" /></svg>Flip card</button>
      <button type="button" onClick={download} disabled={!artwork || downloading}>{downloading ? "Preparing…" : "Save image"}<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M10 2v11m-4-4 4 4 4-4M3 14v4h14v-4" /></svg></button>
      {!pose.reduced && !failed ? <button className={styles.flatToggle} type="button" onClick={() => setFlat(value => !value)} aria-pressed={flat}>{flat ? "3D view" : "Still view"}</button> : null}
    </div>
    <p className={styles.status} role="status">{status}</p>
    <details className={styles.details}><summary>{variant === "invitation" ? "Read invitation" : "Read card details"}<span aria-hidden="true">+</span></summary><div>
      <p className={styles.detailName}>{variant === "invitation" ? `An invitation from ${identity}` : card.name}</p>{variant === "invitation" ? <><p>{invitationRecipientName ? `This is for ${invitationRecipientName}.` : "This is for you."} You’re allowed to become someone new.</p>{memberInvitationDeadline(invitationExpiresAt) ? <p>Valid until <time dateTime={invitationExpiresAt!}>{memberInvitationDeadline(invitationExpiresAt)}</time>.</p> : <p>Valid for 48 hours once created.</p>}<p>{direct ? "Ruined Direct. Accept below, verify your email, then complete your profile, agreement, and payment." : "A personal invitation to Ruined. Leave your details below and we’ll be in touch about joining."}</p></> : null}
      {!direct ? <dl>{card.memberTag ? <div><dt>Member tag</dt><dd>@{card.memberTag}</dd></div> : null}{card.memberSince ? <div><dt>Member since</dt><dd>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(card.memberSince))}</dd></div> : null}{card.location ? <div><dt>Based in</dt><dd>{card.location}</dd></div> : null}{card.buildingNow ? <div><dt>Currently building</dt><dd>{card.buildingNow}</dd></div> : null}{card.bio ? <div><dt>About</dt><dd>{card.bio}</dd></div> : null}{card.labels.length ? <div><dt>Along the way</dt><dd>{card.labels.join(" · ")}</dd></div> : null}</dl> : null}
      {!direct && card.websiteUrl ? <a href={card.websiteUrl} target="_blank" rel="noopener noreferrer">Visit website ↗</a> : null}
    </div></details>
  </section>;
}
