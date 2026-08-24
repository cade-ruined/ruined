"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

const NOTE_LOCK_SRC = "/sequences/popup/note-lock.webp?v=1";
const DISMISS_DURATION_MS = 180;

type PopupPhase = "dismissed" | "ready" | "locked" | "closing";

export default function LobbyPopupSequence() {
  const pointerGestureRef = useRef<{
    id: number;
    x: number;
    y: number;
    opened: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const leftLobbyRef = useRef(false);
  const phaseRef = useRef<PopupPhase>("dismissed");
  const dismissalTimerRef = useRef(0);
  const [phase, setPhaseState] = useState<PopupPhase>("dismissed");
  const [paperReady, setPaperReady] = useState(false);
  const visible = phase !== "dismissed";

  const setPhase = useCallback((nextPhase: PopupPhase) => {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }, []);

  const clearDismissalTimer = useCallback(() => {
    if (!dismissalTimerRef.current) return;
    window.clearTimeout(dismissalTimerRef.current);
    dismissalTimerRef.current = 0;
  }, []);

  const revealPaper = useCallback(() => {
    if (phaseRef.current !== "ready") return;
    setPhase("locked");
  }, [setPhase]);

  const enterLobby = useCallback(() => {
    if (phaseRef.current !== "locked") return;
    clearDismissalTimer();
    setPhase("closing");
    dismissalTimerRef.current = window.setTimeout(() => {
      dismissalTimerRef.current = 0;
      setPhase("dismissed");
    }, DISMISS_DURATION_MS);
  }, [clearDismissalTimer, setPhase]);

  const reset = useCallback(() => {
    clearDismissalTimer();
    pointerGestureRef.current = null;
    suppressClickRef.current = false;
    setPaperReady(false);
    setPhase("ready");
  }, [clearDismissalTimer, setPhase]);

  const hide = useCallback(() => {
    clearDismissalTimer();
    pointerGestureRef.current = null;
    suppressClickRef.current = false;
    setPaperReady(false);
    setPhase("dismissed");
  }, [clearDismissalTimer, setPhase]);

  useEffect(() => {
    const syncLocation = () => {
      const inLobby = !window.location.hash || window.location.hash === "#top";
      if (!inLobby) {
        leftLobbyRef.current = true;
        hide();
        return;
      }
      if (leftLobbyRef.current || phaseRef.current === "dismissed") {
        leftLobbyRef.current = false;
        reset();
      }
    };
    syncLocation();
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("pageshow", syncLocation);
    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("pageshow", syncLocation);
    };
  }, [hide, reset]);

  useEffect(() => {
    const syncScene = (event: Event) => {
      const scene = event as CustomEvent<{ index?: number; atLobby?: boolean }>;
      const index = scene.detail?.index;
      if (typeof index !== "number") return;
      const atLobby = scene.detail?.atLobby ?? index === 0;
      if (!atLobby) {
        leftLobbyRef.current = true;
        hide();
        return;
      }
      if (atLobby && leftLobbyRef.current) {
        leftLobbyRef.current = false;
        reset();
      }
    };
    const requestScene = (event: Event) => {
      const request = event as CustomEvent<{ hash?: string; index?: number }>;
      const leavesLobby =
        (typeof request.detail?.index === "number" && request.detail.index > 0) ||
        (request.detail?.hash != null && request.detail.hash !== "#top");
      if (!leavesLobby) return;
      leftLobbyRef.current = true;
      hide();
    };
    window.addEventListener("ruined:home-scene-change", syncScene);
    window.addEventListener("ruined:home-scene-request", requestScene);
    return () => {
      window.removeEventListener("ruined:home-scene-change", syncScene);
      window.removeEventListener("ruined:home-scene-request", requestScene);
    };
  }, [hide, reset]);

  useEffect(() => () => clearDismissalTimer(), [clearDismissalTimer]);

  useEffect(() => {
    if (!visible) return;

    const wheel = (event: WheelEvent) => {
      // Once the paper is leaving, the next deliberate gesture belongs to the
      // immersive journey rather than this overlay.
      if (phaseRef.current === "closing") return;
      event.preventDefault();
      event.stopImmediatePropagation();

      // Trackpads emit a train of inertial wheel events. The first reveals the
      // paper; later events are swallowed until the user dismisses it.
      if (phaseRef.current === "ready") revealPaper();
    };

    let clickResetTimer = 0;
    const armClickSuppression = (duration = 2500) => {
      suppressClickRef.current = true;
      window.clearTimeout(clickResetTimer);
      clickResetTimer = window.setTimeout(() => {
        suppressClickRef.current = false;
      }, duration);
    };

    const pointerDown = (event: PointerEvent) => {
      if (
        phaseRef.current === "closing" ||
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) return;
      pointerGestureRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        opened: false,
      };

      // The popup gets first refusal on a drag so the journey cannot consume
      // the same pointerdown. An unmoved tap can still activate Lobby cards.
      event.stopImmediatePropagation();
    };

    const pointerMove = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      if (gesture.opened) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const verticalDistance = Math.abs(gesture.y - event.clientY);
      const horizontalDistance = Math.abs(gesture.x - event.clientX);
      if (verticalDistance < 28 || verticalDistance <= horizontalDistance * 1.1) return;
      gesture.opened = true;
      armClickSuppression();
      event.preventDefault();
      event.stopImmediatePropagation();
      if (phaseRef.current === "ready") revealPaper();
    };

    const pointerEnd = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      pointerGestureRef.current = null;
      if (!gesture.opened) return;
      armClickSuppression(500);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handleClick = (event: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (phaseRef.current !== "locked") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (paperReady) enterLobby();
    };

    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    window.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("pointerup", pointerEnd, true);
    window.addEventListener("pointercancel", pointerEnd, true);
    window.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("pointerup", pointerEnd, true);
      window.removeEventListener("pointercancel", pointerEnd, true);
      window.removeEventListener("click", handleClick, true);
      window.clearTimeout(clickResetTimer);
    };
  }, [enterLobby, paperReady, revealPaper, visible]);

  if (!visible) return null;

  const paperVisible = phase === "locked" && paperReady;

  return (
    <div
      aria-hidden={!paperVisible}
      className={`fixed left-1/2 top-1/2 z-[26] aspect-[1126/1397] w-[min(50vh,92vw)] origin-center -translate-x-1/2 -translate-y-1/2 appearance-none border-0 bg-transparent p-0 transition-[opacity,transform] duration-200 ease-out ${
        paperVisible
          ? "pointer-events-auto scale-100 cursor-pointer opacity-100"
          : "pointer-events-none scale-[0.985] opacity-0"
      }`}
    >
      <button
        type="button"
        aria-label="Come in"
        onClick={enterLobby}
        disabled={!paperVisible}
        className="absolute inset-0 appearance-none border-0 bg-transparent p-0"
      >
        <NextImage
          src={NOTE_LOCK_SRC}
          alt=""
          fill
          priority
          unoptimized
          sizes="(max-width: 640px) 92vw, 50vh"
          onLoad={() => setPaperReady(true)}
          className="object-contain"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[54%] top-[75%] h-[6.5%] w-[32%] -translate-x-1/2 -translate-y-1/2 -rotate-2 rounded-[50%] border-2 border-[var(--color-poster)] shadow-[0_0_18px_rgba(214,47,43,0.28)] animate-[pulse_1.8s_ease-in-out_infinite]"
        >
          <span className="absolute inset-[-5px] rotate-3 rounded-[48%] border border-[var(--color-poster)]/55" />
        </span>
      </button>
      <button
        type="button"
        aria-label="Close note"
        onClick={enterLobby}
        disabled={!paperVisible}
        className="absolute right-[5%] top-[4%] z-10 flex h-10 w-10 items-center justify-center bg-[var(--color-bone)]/85 text-black/70 transition-colors hover:text-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:pointer-events-none"
      >
        <span aria-hidden="true" className="font-sans text-xl leading-none">
          ×
        </span>
      </button>
    </div>
  );
}
