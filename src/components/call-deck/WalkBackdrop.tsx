"use client";

import { useEffect, useRef, useState } from "react";
import { MOBILE_ARRIVAL_FRAME_PATHS } from "@/data/mobileJourney";
import { versionSequenceAsset } from "@/data/sequences";
import styles from "./call-deck.module.css";

const ROOMS = ["lobby", "store", "records", "lounge"];

export default function WalkBackdrop({ room, still, onTravel }: {
  room: number;
  still: boolean;
  onTravel: (traveling: boolean) => void;
}) {
  const previous = useRef(room);
  const [clip, setClip] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [settledRoom, setSettledRoom] = useState(room);

  useEffect(() => {
    const from = previous.current;
    previous.current = room;
    if (still || Math.abs(room - from) !== 1) {
      setSettledRoom(room);
      setClip(null);
      setPlaying(false);
      onTravel(false);
      return;
    }
    setPlaying(false);
    setClip(`/media/call-deck/${ROOMS[Math.min(from, room)]}-${room > from ? "forward" : "reverse"}.mp4`);
    onTravel(true);
    // A missing, blocked, or stalled clip must never block the presentation.
    const timeout = window.setTimeout(() => {
      setClip(null);
      setSettledRoom(room);
      onTravel(false);
    }, 4000);
    return () => window.clearTimeout(timeout);
  }, [room, still, onTravel]);

  function finish() {
    setSettledRoom(room);
    setClip(null);
    setPlaying(false);
    onTravel(false);
  }

  return (
    <div className={styles.backdrop} aria-hidden="true">
      {MOBILE_ARRIVAL_FRAME_PATHS.map((src, index) => (
        // Original room images stay untouched; identical cover framing is used by the clips.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={versionSequenceAsset(src)} alt="" draggable={false}
          className={styles.room} data-active={settledRoom === index} fetchPriority={index === room ? "high" : "low"} />
      ))}
      {clip && <video key={clip} className={styles.walk} data-playing={playing}
        src={clip} autoPlay muted playsInline preload="auto"
        onPlaying={() => { setPlaying(true); setSettledRoom(room); }} onEnded={finish} onError={finish} />}
    </div>
  );
}
