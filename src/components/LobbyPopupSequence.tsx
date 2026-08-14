"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

const FRAME_COUNT = 129;
const OPEN_FRAME = 31;
// Frames 93–114 in the source are a baked hold. Start on source frame 115 so
// the paper begins folding on the same instant the lock frame crossfades.
const CLOSE_START_FRAME = 114;
const MOBILE_POPUP_QUERY =
  "(max-width: 767px), ((max-width: 1024px) and (hover: none) and (pointer: coarse))";
const framePath = (index: number) => {
  const mobile =
    typeof window !== "undefined" &&
    window.matchMedia(MOBILE_POPUP_QUERY).matches;
  const root = `/sequences/popup${mobile ? "/mobile" : ""}`;
  return index === OPEN_FRAME
    ? `${root}/open-frame-lossless.webp?v=2`
    : `${root}/frame-${String(index + 1).padStart(4, "0")}.webp?v=5`;
};

type PopupPhase = "dismissed" | "ready" | "opening" | "locked" | "closing";

export default function LobbyPopupSequence() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const imagesRef = useRef(new Map<number, HTMLImageElement>());
  const animationFrameRef = useRef(0);
  const pointerGestureRef = useRef<{
    id: number;
    x: number;
    y: number;
    opened: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const leftLobbyRef = useRef(false);
  const phaseRef = useRef<PopupPhase>("dismissed");
  const [phase, setPhaseState] = useState<PopupPhase>("dismissed");
  const visible = phase !== "dismissed";

  const setPhase = useCallback((nextPhase: PopupPhase) => {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }, []);

  const cancelAnimation = useCallback(() => {
    if (!animationFrameRef.current) return;
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
  }, []);

  const releaseFrames = useCallback(() => {
    imagesRef.current.forEach((image) => {
      image.onload = null;
    });
    imagesRef.current.clear();
  }, []);

  const draw = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const image = imagesRef.current.get(index);
    if (!canvas || !image?.complete || !image.naturalWidth) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    canvas.style.opacity = String(index > FRAME_COUNT - 14 ? (FRAME_COUNT - 1 - index) / 12 : 1);
  }, []);

  const loadFrame = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(FRAME_COUNT - 1, index));
    const existing = imagesRef.current.get(bounded);
    if (existing) return existing;
    const image = new Image();
    image.decoding = "async";
    image.src = framePath(bounded);
    image.onload = () => {
      if (frameRef.current === bounded) draw(bounded);
    };
    imagesRef.current.set(bounded, image);
    return image;
  }, [draw]);

  const openFromSwipe = useCallback(() => {
    if (phaseRef.current !== "ready") return;
    cancelAnimation();
    setPhase("opening");
    const initialFrame = frameRef.current;
    const startedAt = performance.now();
    const duration = 720;
    const animate = (now: number) => {
      if (phaseRef.current !== "opening") return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const index = Math.round(initialFrame + eased * (OPEN_FRAME - initialFrame));
      frameRef.current = index;
      loadFrame(index);
      draw(index);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      animationFrameRef.current = 0;
      frameRef.current = OPEN_FRAME;
      draw(OPEN_FRAME);
      setPhase("locked");

      // The lossless lock image takes over here. Drop the opening sequence
      // before staging only the short closing run so mobile browsers never
      // retain both decoded sequences at the same time.
      releaseFrames();
      for (let index = CLOSE_START_FRAME; index < FRAME_COUNT; index += 1) {
        loadFrame(index);
      }
    };
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [cancelAnimation, draw, loadFrame, releaseFrames, setPhase]);

  const enterLobby = useCallback(() => {
    if (phaseRef.current !== "locked") return;
    cancelAnimation();
    setPhase("closing");
    frameRef.current = CLOSE_START_FRAME;
    loadFrame(CLOSE_START_FRAME);
    draw(CLOSE_START_FRAME);
    const startedAt = performance.now();
    const duration = 560;
    const animate = (now: number) => {
      if (phaseRef.current !== "closing") return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const index = Math.round(CLOSE_START_FRAME + progress * (FRAME_COUNT - 1 - CLOSE_START_FRAME));
      frameRef.current = index;
      loadFrame(index);
      draw(index);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      animationFrameRef.current = 0;
      releaseFrames();
      setPhase("dismissed");
    };
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [cancelAnimation, draw, loadFrame, releaseFrames, setPhase]);

  const reset = useCallback(() => {
    cancelAnimation();
    releaseFrames();
    frameRef.current = 0;
    pointerGestureRef.current = null;
    suppressClickRef.current = false;
    setPhase("ready");
    loadFrame(0);
    for (let index = 1; index <= OPEN_FRAME; index += 1) loadFrame(index);
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = 0;
      if (phaseRef.current === "ready") draw(0);
    });
  }, [cancelAnimation, draw, loadFrame, releaseFrames, setPhase]);

  const hide = useCallback(() => {
    cancelAnimation();
    releaseFrames();
    pointerGestureRef.current = null;
    suppressClickRef.current = false;
    setPhase("dismissed");
  }, [cancelAnimation, releaseFrames, setPhase]);

  useEffect(() => {
    const inLobby = !window.location.hash || window.location.hash === "#top";
    if (!inLobby) return;
    reset();
  }, [reset]);

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

  useEffect(() => () => {
    cancelAnimation();
    releaseFrames();
  }, [cancelAnimation, releaseFrames]);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      draw(Math.round(frameRef.current));
    };
    const wheel = (event: WheelEvent) => {
      // Once the user has chosen to enter, do not swallow their next gesture.
      // The closing animation may finish over the beginning of the walk.
      if (phaseRef.current === "closing") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openFromSwipe();
    };
    let clickResetTimer = 0;
    const armClickSuppression = () => {
      suppressClickRef.current = true;
      window.clearTimeout(clickResetTimer);
      clickResetTimer = window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 500);
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

      // The popup gets first refusal on a drag, so the mobile journey cannot
      // record the same pointerdown and advance to Store. We deliberately do
      // not prevent the default: an unmoved tap still produces its normal
      // click on a Lobby card or on the paper button.
      event.stopImmediatePropagation();
    };
    const pointerMove = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      const verticalDistance = Math.abs(gesture.y - event.clientY);
      const horizontalDistance = Math.abs(gesture.x - event.clientX);
      if (!gesture.opened && (verticalDistance < 28 || verticalDistance <= horizontalDistance * 1.1)) return;
      gesture.opened = true;
      armClickSuppression();
      event.preventDefault();
      event.stopImmediatePropagation();
      openFromSwipe();
    };
    const pointerEnd = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      pointerGestureRef.current = null;
      if (!gesture.opened) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const suppressSwipeClick = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("wheel", wheel, { passive: false, capture: true });
    window.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("pointerup", pointerEnd, true);
    window.addEventListener("pointercancel", pointerEnd, true);
    window.addEventListener("click", suppressSwipeClick, true);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("pointerup", pointerEnd, true);
      window.removeEventListener("pointercancel", pointerEnd, true);
      window.removeEventListener("click", suppressSwipeClick, true);
      window.clearTimeout(clickResetTimer);
    };
  }, [draw, openFromSwipe, visible]);

  if (!visible) return null;
  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none fixed inset-0 z-[25] h-full w-full transition-opacity duration-150 ${phase === "locked" ? "invisible" : "visible"}`} />
      {(phase === "locked" || phase === "closing") && (
        <button
          type="button"
          aria-label="Come in"
          onClick={enterLobby}
          disabled={phase === "closing"}
          className={`fixed left-[49.8%] top-[50.9%] z-[26] aspect-[1126/1397] w-[50vh] -translate-x-1/2 -translate-y-1/2 appearance-none border-0 bg-transparent p-0 transition-opacity duration-[420ms] ease-out ${phase === "closing" ? "pointer-events-none opacity-0" : "pointer-events-auto cursor-pointer opacity-100"}`}
        >
          <NextImage
            src="/sequences/popup/note-lock.png"
            alt=""
            fill
            priority
            sizes="50vh"
            className="object-contain"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[54%] top-[75%] h-[6.5%] w-[32%] -translate-x-1/2 -translate-y-1/2 -rotate-2 rounded-[50%] border-2 border-[var(--color-poster)] shadow-[0_0_18px_rgba(214,47,43,0.28)] animate-[pulse_1.8s_ease-in-out_infinite]"
          >
            <span className="absolute inset-[-5px] rotate-3 rounded-[48%] border border-[var(--color-poster)]/55" />
          </span>
        </button>
      )}
    </>
  );
}
