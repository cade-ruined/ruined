"use client";

import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { FOUNDATION_CALL_CHAPTERS as DECK_CHAPTERS, FOUNDATION_CALL_SLIDES as DECK_SLIDES } from "./deck-content";
import { motion } from "motion/react";
import FilmGrain from "../foundations/FilmGrain";
import SlideContent from "./SlideContent";
import styles from "./graphic-shell.module.css";
import foundationStyles from "./foundations-call.module.css";

const clamp = (index: number) => Math.max(0, Math.min(DECK_SLIDES.length - 1, index));
const number = (value: number) => String(value).padStart(2, "0");

type DeckMessage = { type: "navigate" | "state"; index: number } | { type: "ready" };

export default function FoundationsCallDeck() {
  const [active, setActive] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [reduced, setReduced] = useState(true);
  const [quiet, setQuiet] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const presenterPane = useRef<HTMLDivElement>(null);
  const indexDialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const blankDialog = useRef<HTMLDialogElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const activeRef = useRef(active);
  const popup = useRef<Window | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  activeRef.current = active;
  const slide = DECK_SLIDES[active];
  const chapter = DECK_CHAPTERS[slide.room];
  const reduceMotion = quiet || reduced;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPresenter(params.get("presenter") === "1");
    setSession(params.get("session"));
    const readHash = () => {
      const id = window.location.hash.slice(1);
      const index = DECK_SLIDES.findIndex((item) => item.id === id);
      setActive(index < 0 ? 0 : index);
    };
    readHash();
    // The URL owns the first slide; do not write or broadcast slide zero before reading it.
    setInitialized(true);
    window.addEventListener("hashchange", readHash);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduced(motion.matches);
    syncMotion(); motion.addEventListener("change", syncMotion);
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("hashchange", readHash);
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const url = new URL(window.location.href);
    url.hash = slide.id;
    if (session) url.searchParams.set("session", session);
    window.history.replaceState(null, "", url.toString());
    stage.current?.scrollTo({ top: 0, behavior: "instant" });
    presenterPane.current?.scrollTo({ top: 0, behavior: "instant" });
    if (!presenter) channel.current?.postMessage({ type: "state", index: active } satisfies DeckMessage);
  }, [active, initialized, slide.id, presenter, session]);

  useEffect(() => {
    if (!initialized || !session || !("BroadcastChannel" in window)) return;
    const connection = new BroadcastChannel(`ruined-foundations01-${session}`);
    channel.current = connection;
    let lastReply = Date.now();
    connection.onmessage = ({ data }: MessageEvent<DeckMessage>) => {
      if (!data || typeof data !== "object") return;
      if (data.type === "ready" && !presenter) {
        connection.postMessage({ type: "state", index: activeRef.current } satisfies DeckMessage);
        setConnected(true);
      }
      if ((presenter && data.type === "state") || (!presenter && data.type === "navigate")) {
        if (Number.isInteger(data.index) && data.index >= 0 && data.index < DECK_SLIDES.length) {
          lastReply = Date.now();
          setActive(data.index); setConnected(true);
          if (data.type === "navigate") setBlackout(false);
        }
      }
    };
    if (presenter) connection.postMessage({ type: "ready" } satisfies DeckMessage);
    const heartbeat = presenter ? window.setInterval(() => {
      if (Date.now() - lastReply > 4500) setConnected(false);
      connection.postMessage({ type: "ready" } satisfies DeckMessage);
    }, 1500) : undefined;
    return () => { window.clearInterval(heartbeat); connection.close(); channel.current = null; };
  }, [initialized, presenter, session]);

  useEffect(() => {
    if (blackout) {
      if (!blankDialog.current?.open) blankDialog.current?.showModal();
    } else blankDialog.current?.close();
  }, [blackout]);

  const navigate = useCallback((index: number) => {
    const next = clamp(index);
    setActive(next); setBlackout(false);
    if (presenter) channel.current?.postMessage({ type: "navigate", index: next } satisfies DeckMessage);
  }, [presenter]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else setNotice("Use your browser’s full-screen command on this device.");
    } catch { setNotice("Full screen is unavailable. You can continue in this window."); }
  }, []);

  const openPresenter = useCallback(() => {
    if (!("BroadcastChannel" in window)) {
      setNotice("This browser cannot sync presenter windows. Use a current desktop browser."); return;
    }
    const id = session ?? window.crypto.randomUUID();
    setSession(id);
    const url = new URL(window.location.href);
    url.hash = DECK_SLIDES[activeRef.current].id;
    url.searchParams.set("presenter", "1"); url.searchParams.set("session", id);
    popup.current = window.open(url.toString(), "ruined-foundations01-presenter", "popup,width=1180,height=820");
    if (!popup.current) setNotice("Allow pop-ups for this site to open your separate presenter notes.");
    else { popup.current.focus(); setNotice("Presenter notes opened separately. Share this audience window on your call."); }
  }, [session]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!initialized || event.metaKey || event.ctrlKey || event.altKey || event.repeat || indexDialog.current?.open || helpDialog.current?.open) return;
      const target = event.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable='true'],[role='tablist'],[role='slider']")) return;
      // Let the active slide's own buttons and links keep their keyboard behavior.
      if (stage.current?.contains(target) && target.closest("button,a,[role='button'],[role='tab']")) return;
      if (["ArrowRight", "PageDown"].includes(event.key) || (event.key === " " && !target.closest("button,a"))) {
        event.preventDefault(); navigate(activeRef.current + 1);
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault(); navigate(activeRef.current - 1);
      } else if (event.key === "Home") { event.preventDefault(); navigate(0);
      } else if (event.key === "End") { event.preventDefault(); navigate(DECK_SLIDES.length - 1);
      } else if (event.key.toLowerCase() === "f" && !presenter) { event.preventDefault(); void toggleFullscreen();
      } else if (event.key.toLowerCase() === "n" && !presenter) { event.preventDefault(); openPresenter();
      } else if (event.key.toLowerCase() === "o") { event.preventDefault(); indexDialog.current?.showModal();
      } else if (event.key.toLowerCase() === "b" && !presenter) { event.preventDefault(); setBlackout((value) => !value);
      } else if (event.key === "?") { event.preventDefault(); helpDialog.current?.showModal();
      } else if (event.key === "Escape") setBlackout(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [initialized, navigate, openPresenter, presenter, toggleFullscreen]);

  function endTouch(event: TouchEvent) {
    if (!touch.current || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - touch.current.x;
    const dy = event.changedTouches[0].clientY - touch.current.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) navigate(active + (dx < 0 ? 1 : -1));
    touch.current = null;
  }

  const controls = <>
    <button type="button" aria-label="Previous slide" disabled={active === 0} onClick={() => navigate(active - 1)}>←</button>
    <button type="button" className={styles.counter} aria-label={`Slide ${active + 1} of ${DECK_SLIDES.length}. Open slide index`} onClick={() => indexDialog.current?.showModal()}>{number(active + 1)} <span>/ {DECK_SLIDES.length}</span></button>
    <button type="button" aria-label="Next slide" disabled={active === DECK_SLIDES.length - 1} onClick={() => navigate(active + 1)}>→</button>
  </>;

  return (
    <main ref={root} className={`${styles.deck} ${foundationStyles.deck}`} data-presenter={presenter} data-kind={slide.kind} data-theme={presenter ? "ink" : slide.theme} data-quiet={reduceMotion} aria-label="Ruined Foundations 01" aria-busy={!initialized}>
      <FilmGrain enabled={initialized && !presenter && !reduceMotion} />
      <header className={styles.header}>
        <Link href="/" prefetch={false} className={styles.home} aria-label="Return to Ruined website"><Image src="/ruined-wordmark.svg" width={130} height={39} alt="Ruined" /></Link>
        <div className={styles.headerTools}>
          {presenter ? <span className={styles.presenterLabel}>Presenter view <span>{connected ? "Synced" : "Audience not connected"}</span></span> : <>
            <button type="button" className={styles.notesButton} onClick={openPresenter}>Presenter <span aria-hidden="true">↗</span></button>
            <button type="button" aria-label={fullscreen ? "Exit full screen" : "Enter full screen"} onClick={() => void toggleFullscreen()}>⛶</button>
          </>}
          <button type="button" aria-label="Open slide index" onClick={() => indexDialog.current?.showModal()}>Index <span aria-hidden="true">☰</span></button>
        </div>
      </header>

      {initialized && (presenter ? (
        <div ref={presenterPane} className={styles.presenter}>
          <section className={styles.presenterCurrent}>
            <p className={styles.eyebrow}>{connected ? "On screen" : "Preview"} / {number(active + 1)}</p>
            <h1>{slide.headline}</h1>
            <div className={styles.presenterNav}>{controls}</div>
            <p className={styles.presenterHint}>Share the audience window only. These notes stay here.</p>
            {active < DECK_SLIDES.length - 1 && <div className={styles.upNext}><p className={styles.eyebrow}>Up next / {number(active + 2)}</p><p>{DECK_SLIDES[active + 1].title}</p></div>}
          </section>
          <section className={styles.speakerNotes} aria-label="Speaker notes">
            <p className={styles.eyebrow}>Speaker notes</p><h2>{slide.title}</h2>
            {slide.notes.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph.replace(/\n/g, " ")}</p>)}
          </section>
        </div>
      ) : (
        <div ref={stage} className={styles.stage} onTouchStart={(event) => {
          touch.current = null;
          if ((event.target as HTMLElement).closest("button,a,input,textarea,select,[contenteditable='true'],[role='tablist'],[role='slider'],[role='button']")) return;
          if (event.touches.length !== 1) return;
          touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }} onTouchEnd={endTouch} onTouchCancel={() => { touch.current = null; }}>
          <motion.article key={slide.id} initial={reduceMotion ? false : { opacity: 0, y: 18, clipPath: "inset(0 0 3% 0)" }} animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0 0)" }} transition={reduceMotion ? { duration: 0 } : { duration: 0.66, ease: [0.22, 1, 0.36, 1] }} className={`${styles.slide} ${foundationStyles.slide}`} data-slide={active + 1} data-layout={slide.kind} aria-roledescription="slide" aria-label={`${active + 1} of ${DECK_SLIDES.length}: ${slide.title}`}>
            <SlideContent slide={slide} reducedMotion={reduceMotion} />
          </motion.article>
        </div>
      ))}

      <footer className={styles.footer}>
        <button type="button" className={styles.chapterLabel} onClick={() => indexDialog.current?.showModal()}><span>{number(slide.room + 1)} /</span> {chapter.title}</button>
        <nav className={styles.chapterTrack} aria-label="Chapters">{DECK_CHAPTERS.map((item) => <button key={item.room} type="button" aria-label={`${item.title}, slides ${item.start} to ${item.end}`} aria-current={item.room === slide.room ? "step" : undefined} onClick={() => navigate(item.start - 1)}><span /></button>)}</nav>
        <div className={styles.navigation}>{controls}<button type="button" className={styles.helpButton} aria-label="Presentation help" onClick={() => helpDialog.current?.showModal()}>?</button></div>
      </footer>
      <div className={styles.progress} style={{ width: `${((active + 1) / DECK_SLIDES.length) * 100}%` }} />
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">Slide {active + 1} of {DECK_SLIDES.length}: {slide.title}</p>
      {notice && <div className={styles.notice} role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
      <dialog ref={blankDialog} className={styles.blackout} aria-label="Presentation paused" onCancel={() => setBlackout(false)}><button type="button" aria-label="Resume presentation" onClick={() => setBlackout(false)}><span>Click or press B to return</span></button></dialog>

      <dialog ref={indexDialog} className={styles.indexDialog} aria-labelledby="foundations-index-title" onClick={(event) => { if (event.target === event.currentTarget) indexDialog.current?.close(); }}>
        <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>Foundations 01</p><h2 id="foundations-index-title">The conversation</h2></div><button type="button" aria-label="Close slide index" onClick={() => indexDialog.current?.close()}>×</button></div>
        <div className={styles.indexChapters}>{DECK_CHAPTERS.map((item) => <section key={item.room}>
          <h3><span>{number(item.room + 1)}</span> {item.title}</h3>
          <ol>{DECK_SLIDES.slice(item.start - 1, item.end).map((entry, index) => <li key={entry.id}><button type="button" aria-current={active === item.start + index - 1 ? "true" : undefined} onClick={() => { navigate(item.start + index - 1); indexDialog.current?.close(); }}><span>{number(item.start + index)}</span>{entry.title}</button></li>)}</ol>
        </section>)}</div>
      </dialog>
      <dialog ref={helpDialog} className={styles.helpDialog} aria-labelledby="foundations-help-title">
        <div className={styles.dialogHeader}><h2 id="foundations-help-title">Present Foundations 01</h2><button type="button" aria-label="Close help" onClick={() => helpDialog.current?.close()}>×</button></div>
        <p>Share this audience window. Open Presenter in a separate window for the full speaking notes and slide controls.</p>
        <dl><div><dt>← / → / Space</dt><dd>Previous / next slide</dd></div><div><dt>Home / End</dt><dd>First / final slide</dd></div><div><dt>O</dt><dd>Slide index</dd></div><div><dt>N</dt><dd>Presenter notes</dd></div><div><dt>F</dt><dd>Full screen</dd></div><div><dt>B</dt><dd>Blank screen / return</dd></div><div><dt>?</dt><dd>Presentation help</dd></div></dl>
        <p>On touchscreens, swipe sideways or use the arrows. The closing slides review the conversation, set out the between-call work, and preview Foundations 02.</p>
        <button type="button" className={styles.motionToggle} aria-pressed={quiet} onClick={() => setQuiet((value) => !value)}>{quiet ? "Enable animations" : "Pause animations"}</button>
        {reduced && <p className={styles.small}>Your device’s reduced-motion preference is active.</p>}
      </dialog>
    </main>
  );
}
