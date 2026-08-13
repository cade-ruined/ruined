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
  const interactionRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef(0);
  const imagesRef = useRef(new Map<number, HTMLImageElement>());
  const touchYRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const openingRef = useRef(false);
  const completedRef = useRef(false);
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
      completedRef.current = true;
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
      touchYRef.current = null;
      touchStartYRef.current = null;
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
      const scene = event as CustomEvent<{ index?: number }>;
      const index = scene.detail?.index;
      if (typeof index !== "number") return;
      if (index > 0) {
        leftLobbyRef.current = true;
        return;
      }
      if (index === 0 && completedRef.current && leftLobbyRef.current) {
        leftLobbyRef.current = false;
        reopen();
      }
    };
    window.addEventListener("ruined:home-scene-change", syncScene);
    return () => window.removeEventListener("ruined:home-scene-change", syncScene);
  }, [draw, loadFrame]);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    const interaction = interactionRef.current;
    if (!canvas || !interaction) return;
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
    const touchStart = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      touchYRef.current = y;
      touchStartYRef.current = y;
    };
    const touchMove = (event: TouchEvent) => {
      if (touchYRef.current == null || touchStartYRef.current == null || !event.touches[0]) return;
      event.preventDefault();
      event.stopPropagation();
      const nextY = event.touches[0].clientY;
      if (Math.abs(touchStartYRef.current - nextY) >= 28) openFromSwipe();
      touchYRef.current = nextY;
    };
    const pointerDown = (event: PointerEvent) => {
      touchStartYRef.current = event.clientY;
    };
    const pointerMove = (event: PointerEvent) => {
      if (touchStartYRef.current == null || event.buttons === 0) return;
      event.preventDefault();
      if (Math.abs(touchStartYRef.current - event.clientY) >= 28) openFromSwipe();
    };
    resize();
    window.addEventListener("resize", resize);
    interaction.addEventListener("wheel", wheel, { passive: false });
    interaction.addEventListener("touchstart", touchStart, { passive: true });
    interaction.addEventListener("touchmove", touchMove, { passive: false });
    interaction.addEventListener("pointerdown", pointerDown);
    interaction.addEventListener("pointermove", pointerMove);
    return () => {
      window.removeEventListener("resize", resize);
      interaction.removeEventListener("wheel", wheel);
      interaction.removeEventListener("touchstart", touchStart);
      interaction.removeEventListener("touchmove", touchMove);
      interaction.removeEventListener("pointerdown", pointerDown);
      interaction.removeEventListener("pointermove", pointerMove);
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
          <span
            aria-hidden="true"
            className={`absolute left-[54%] top-[75%] h-[9%] w-[45%] -translate-x-1/2 -translate-y-1/2 -rotate-2 rounded-[50%] border-2 border-[var(--color-poster)] shadow-[0_0_18px_rgba(214,47,43,0.28)] transition-opacity duration-150 ${closing ? "opacity-0" : "animate-[pulse_1.8s_ease-in-out_infinite] opacity-100"}`}
          >
            <span className="absolute inset-[-5px] rotate-3 rounded-[48%] border border-[var(--color-poster)]/55" />
          </span>
        </span>
      )}
      <button
        ref={interactionRef}
        type="button"
        aria-label={open ? "Come in" : "Scroll to open the note"}
        onClick={enterLobby}
        className={`fixed inset-0 z-[30] touch-none bg-transparent ${open && !closing ? "cursor-pointer" : "cursor-default"}`}
      />
    </>
  );
}
