"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const DISMISSED_KEY = "ruined:lobby-process-note:dismissed";

export default function LobbyProcessNote() {
  const [visible, setVisible] = useState(false);
  const [centered, setCentered] = useState(false);

  useEffect(() => {
    const sync = () => {
      const inLobby = !window.location.hash || window.location.hash === "#top";
      setVisible(inLobby && sessionStorage.getItem(DISMISSED_KEY) !== "true");
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("ruined:home-scene-change", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("ruined:home-scene-change", sync);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    if (!centered) {
      setCentered(true);
      return;
    }
    sessionStorage.setItem(DISMISSED_KEY, "true");
    setVisible(false);
  };

  return (
    <div
      className={`ruined-process-note fixed inset-0 z-[70] ${centered ? "is-centered" : ""}`}
      role="presentation"
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setCentered(true);
      }}
      onTouchMove={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setCentered(true);
      }}
    >
      <button type="button" onClick={dismiss} className="ruined-process-note__paper" aria-label={centered ? "Enter the walk" : "Read the note"}>
        <Image
          src="/textures/working-on-this-note-v2.png"
          alt="We’re still working on this, but you should probably see it anyway. Come in."
          fill
          priority
          sizes="(min-width: 768px) 32rem, 82vw"
          className="object-contain"
        />
      </button>
      <style>{`
        .ruined-process-note {
          pointer-events: auto;
          background: transparent;
          transition: background-color 500ms ease;
        }

        .ruined-process-note__paper {
          position: absolute;
          top: 18%;
          left: 66%;
          width: min(25vw, 21rem);
          aspect-ratio: 1126 / 1397;
          pointer-events: auto;
          filter: drop-shadow(8px 12px 8px rgb(0 0 0 / 0.28));
          transform: translate(-50%, 0) rotate(2deg) scale(0.72);
          transform-origin: center;
          transition: top 700ms cubic-bezier(.2,.75,.2,1), left 700ms cubic-bezier(.2,.75,.2,1), width 700ms cubic-bezier(.2,.75,.2,1), transform 700ms cubic-bezier(.2,.75,.2,1);
        }

        .ruined-process-note.is-centered {
          background: rgb(0 0 0 / 0.2);
        }

        .ruined-process-note.is-centered .ruined-process-note__paper {
          top: 50%;
          left: 50%;
          width: min(72vw, 31rem);
          transform: translate(-50%, -50%) rotate(-1deg) scale(1);
        }

        @media (max-width: 767px) {
          .ruined-process-note__paper {
            top: 22%;
            left: 72%;
            width: 48vw;
          }

          .ruined-process-note.is-centered .ruined-process-note__paper {
            width: min(84vw, 27rem);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ruined-process-note__paper,
          .ruined-process-note { transition: none; }
        }
      `}</style>
    </div>
  );
}
