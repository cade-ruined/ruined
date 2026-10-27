"use client";

import { useEffect, useRef, useState } from "react";

/** Only request a carousel film when its card is actually visible. */
export default function JourneyPreviewVideo({
  src,
  poster,
  label,
  className,
}: {
  src: string;
  poster?: string;
  label: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => {
      const active = visible && !reducedMotion.matches && document.visibilityState !== "hidden";
      if (active) setLoaded(true);
      setPlaying(active);
    };
    // The observer respects carousel clipping and display:none ancestors, so
    // neither offscreen slides nor the unused responsive lobby load the film.
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      update();
    }, { threshold: 0.25 });
    observer.observe(video);
    reducedMotion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      // A blocked autoplay leaves the poster visible and the link usable.
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [playing]);

  return (
    <video
      ref={videoRef}
      src={loaded ? src : undefined}
      poster={poster}
      aria-label={label}
      muted
      loop
      autoPlay={playing}
      playsInline
      preload="none"
      className={className}
    />
  );
}
