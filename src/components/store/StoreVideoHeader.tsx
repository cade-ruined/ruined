"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./StoreVideoHeader.module.css";

type DataConnection = EventTarget & { saveData?: boolean };

export default function StoreVideoHeader() {
  const headerRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const manualPlayback = useRef<"play" | "pause" | null>(null);
  const playbackRequested = useRef(false);
  const playbackFailed = useRef(false);
  const updatePlayback = useRef<() => void>(() => undefined);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    const video = videoRef.current;
    if (!header || !video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: DataConnection }).connection;
    const bounds = header.getBoundingClientRect();
    let visible = bounds.bottom > 0 && bounds.top < window.innerHeight;

    const update = () => {
      const permitted = manualPlayback.current === "play" || (
        manualPlayback.current !== "pause" && !reducedMotion.matches && !connection?.saveData
      );
      const shouldPlay = permitted && !playbackFailed.current && visible && document.visibilityState !== "hidden";
      playbackRequested.current = shouldPlay;

      if (shouldPlay) {
        // Sources are absent until playback is allowed, including on data-saving devices.
        setLoaded(true);
        if (video.querySelector("source")) {
          void video.play().catch(() => setPlaying(false));
        }
      } else {
        video.pause();
      }
    };

    updatePlayback.current = update;
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        update();
      },
      { threshold: 0 },
    );
    observer?.observe(header);
    reducedMotion.addEventListener("change", update);
    connection?.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();

    return () => {
      updatePlayback.current = () => undefined;
      observer?.disconnect();
      reducedMotion.removeEventListener("change", update);
      connection?.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      video.pause();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!loaded || !video) return;
    // Refresh source selection after React inserts the responsive video sources.
    video.load();
    if (playbackRequested.current) void video.play().catch(() => setPlaying(false));
  }, [loaded]);

  function togglePlayback() {
    manualPlayback.current = playing ? "pause" : "play";
    updatePlayback.current();
  }

  return (
    <header ref={headerRef} className={styles.header} aria-label="Ruined apparel film">
      <div className={styles.film}>
        <video
          ref={videoRef}
          className={`${styles.video} ${failed ? styles.failed : ""}`}
          poster="/media/store/apparel-header.webp"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedData={() => {
            playbackFailed.current = false;
            setFailed(false);
            updatePlayback.current();
          }}
          onError={() => {
            // Source selection can emit a transient error before the next
            // responsive source succeeds. Only a video-level failure is fatal.
            const error = videoRef.current?.error;
            if (!error || error.code === 1) return;
            playbackFailed.current = true;
            setFailed(true);
            setPlaying(false);
            playbackRequested.current = false;
            videoRef.current?.pause();
          }}
        >
          {loaded && <>
            <source src="/media/store/apparel-header-mobile.mp4" media="(max-width: 767px)" type="video/mp4" />
            <source src="/media/store/apparel-header.mp4" type="video/mp4" />
          </>}
        </video>
      </div>

      <Link href="/#top" className={`${styles.control} ${styles.back}`}>
        <span aria-hidden="true">←</span> Back to the walk
      </Link>

      {!failed && (
        <button
          type="button"
          className={`${styles.control} ${styles.playback}`}
          onClick={togglePlayback}
          aria-label={playing ? "Pause apparel film" : "Play apparel film"}
          title={playing ? "Pause apparel film" : "Play apparel film"}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            {playing
              ? <><path d="M6 4h4v16H6z" /><path d="M14 4h4v16h-4z" /></>
              : <path d="m7 3 14 9-14 9z" />}
          </svg>
        </button>
      )}
    </header>
  );
}
