"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

const FRAME_COUNT = 129;
const OPEN_FRAME = 31;
// Frames 93–114 in the source are a baked hold. Start on source frame 115 so
// the paper begins folding on the same instant the lock frame crossfades.
const CLOSE_START_FRAME = 114;
const framePath = (index: number) => index === OPEN_FRAME
  ? "/sequences/popup/open-frame-lossless.webp?v=1"
  : `/sequences/popup/frame-${String(index + 1).padStart(4, "0")}.webp?v=4`;

export default function LobbyPopupSequence() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const imagesRef = useRef(new Map<number, HTMLImageElement>());
  const pointerGestureRef = useRef<{
    id: number;
    x: number;
    y: number;
    opened: boolean;
  } | null>(null);
  const touchGestureRef = useRef<{
    x: number;
    y: number;
    opened: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const openingRef = useRef(false);
  const leftLobbyRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

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

  const advance = useCallback((delta: number) => {
    if (open || closing || openingRef.current) return;
    const next = Math.max(0, Math.min(OPEN_FRAME, frameRef.current + delta / 10));
    frameRef.current = next;
    const index = Math.round(next);
    loadFrame(index);
    for (let offset = 1; offset <= 5; offset += 1) loadFrame(index + offset);
    draw(index);
    if (next >= OPEN_FRAME) setOpen(true);
  }, [closing, draw, loadFrame, open]);

  const openFromSwipe = useCallback(() => {
    if (open || closing || openingRef.current) return;
    openingRef.current = true;
    const initialFrame = frameRef.current;
    const startedAt = performance.now();
    const duration = 720;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const index = Math.round(initialFrame + eased * (OPEN_FRAME - initialFrame));
      frameRef.current = index;
      loadFrame(index);
      draw(index);
      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }
      frameRef.current = OPEN_FRAME;
      openingRef.current = false;
      setOpen(true);
      draw(OPEN_FRAME);
    };
    requestAnimationFrame(animate);
  }, [closing, draw, loadFrame, open]);

  const enterLobby = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    frameRef.current = CLOSE_START_FRAME;
    loadFrame(CLOSE_START_FRAME);
    draw(CLOSE_START_FRAME);
    const startedAt = performance.now();
    const duration = 560;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const index = Math.round(CLOSE_START_FRAME + progress * (FRAME_COUNT - 1 - CLOSE_START_FRAME));
      frameRef.current = index;
      loadFrame(index);
      draw(index);
      if (progress < 1) {
        requestAnimationFrame(animate);
        return;
      }
      setVisible(false);
    };
    requestAnimationFrame(animate);
  }, [closing, draw, loadFrame, open]);

  useEffect(() => {
    const inLobby = !window.location.hash || window.location.hash === "#top";
    if (!inLobby) return;
    setVisible(true);
    loadFrame(0);
    for (let index = 1; index <= OPEN_FRAME; index += 1) loadFrame(index);
    for (let index = CLOSE_START_FRAME; index < FRAME_COUNT; index += 1) loadFrame(index);
  }, [loadFrame]);

  useEffect(() => {
    const reopen = () => {
      frameRef.current = 0;
      pointerGestureRef.current = null;
      touchGestureRef.current = null;
      suppressClickRef.current = false;
      openingRef.current = false;
      setOpen(false);
      setClosing(false);
      setVisible(true);
      requestAnimationFrame(() => {
        loadFrame(0);
        draw(0);
      });
    };
    const syncScene = (event: Event) => {
      const scene = event as CustomEvent<{ index?: number; atLobby?: boolean }>;
      const index = scene.detail?.index;
      if (typeof index !== "number") return;
      const atLobby = scene.detail?.atLobby ?? index === 0;
      if (!atLobby) {
        leftLobbyRef.current = true;
        setVisible(false);
        return;
      }
      if (atLobby && leftLobbyRef.current) {
        leftLobbyRef.current = false;
        reopen();
      }
    };
    const requestScene = (event: Event) => {
      const request = event as CustomEvent<{ hash?: string; index?: number }>;
      const leavesLobby =
        (typeof request.detail?.index === "number" && request.detail.index > 0) ||
        (request.detail?.hash != null && request.detail.hash !== "#top");
      if (!leavesLobby) return;
      leftLobbyRef.current = true;
      setVisible(false);
    };
    window.addEventListener("ruined:home-scene-change", syncScene);
    window.addEventListener("ruined:home-scene-request", requestScene);
    return () => {
      window.removeEventListener("ruined:home-scene-change", syncScene);
      window.removeEventListener("ruined:home-scene-request", requestScene);
    };
  }, [draw, loadFrame]);

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
      event.preventDefault();
      event.stopPropagation();
      advance(Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX);
    };
    let clickResetTimer = 0;
    const armClickSuppression = () => {
      suppressClickRef.current = true;
      window.clearTimeout(clickResetTimer);
      clickResetTimer = window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 500);
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchGestureRef.current = null;
        return;
      }
      const touch = event.touches[0];
      touchGestureRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        opened: false,
      };
    };
    const touchMove = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      const touch = event.touches[0];
      if (!gesture || !touch) return;
      const verticalDistance = Math.abs(gesture.y - touch.clientY);
      const horizontalDistance = Math.abs(gesture.x - touch.clientX);
      if (!gesture.opened && (verticalDistance < 28 || verticalDistance <= horizontalDistance * 1.1)) return;
      gesture.opened = true;
      armClickSuppression();
      event.preventDefault();
      event.stopImmediatePropagation();
      openFromSwipe();
    };
    const touchEnd = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      touchGestureRef.current = null;
      if (!gesture?.opened) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const pointerDown = (event: PointerEvent) => {
      if (
        event.pointerType === "touch" ||
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) return;
      pointerGestureRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        opened: false,
      };
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
    window.addEventListener("touchstart", touchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", touchMove, { passive: false, capture: true });
    window.addEventListener("touchend", touchEnd, { passive: false, capture: true });
    window.addEventListener("touchcancel", touchEnd, { passive: false, capture: true });
    window.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("pointerup", pointerEnd, true);
    window.addEventListener("pointercancel", pointerEnd, true);
    window.addEventListener("click", suppressSwipeClick, true);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("touchstart", touchStart, true);
      window.removeEventListener("touchmove", touchMove, true);
      window.removeEventListener("touchend", touchEnd, true);
      window.removeEventListener("touchcancel", touchEnd, true);
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("pointerup", pointerEnd, true);
      window.removeEventListener("pointercancel", pointerEnd, true);
      window.removeEventListener("click", suppressSwipeClick, true);
      window.clearTimeout(clickResetTimer);
    };
  }, [advance, draw, openFromSwipe, visible]);

  if (!visible) return null;
  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none fixed inset-0 z-[25] h-full w-full transition-opacity duration-150 ${open && !closing ? "invisible" : "visible"}`} />
      {open && (
        <span className={`pointer-events-none fixed left-[49.8%] top-[50.9%] z-[26] aspect-[1126/1397] w-[50vh] -translate-x-1/2 -translate-y-1/2 transition-opacity duration-[420ms] ease-out ${closing ? "opacity-0" : "opacity-100"}`}>
          <NextImage
            src="/sequences/popup/note-lock.png"
            alt=""
            fill
            priority
            sizes="50vh"
            className="object-contain"
          />
          {!closing && (
            <button
              type="button"
              aria-label="Come in"
              onClick={enterLobby}
              className="pointer-events-auto absolute left-[54%] top-[75%] h-[6.5%] w-[32%] -translate-x-1/2 -translate-y-1/2 -rotate-2 cursor-pointer rounded-[50%] border-2 border-[var(--color-poster)] bg-transparent shadow-[0_0_18px_rgba(214,47,43,0.28)] animate-[pulse_1.8s_ease-in-out_infinite]"
            >
              <span aria-hidden="true" className="absolute inset-[-5px] rotate-3 rounded-[48%] border border-[var(--color-poster)]/55" />
            </button>
          )}
        </span>
      )}
    </>
  );
}
