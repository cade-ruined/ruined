"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input[type='button']:not([disabled])",
  "input[type='submit']:not([disabled])",
  "input[type='reset']:not([disabled])",
  "label[for]",
  "summary",
  "[role='button']",
  "[role='link']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const NATIVE_CURSOR_SELECTOR = [
  "input:not([type='button']):not([type='submit']):not([type='reset'])",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[disabled]",
  "[aria-disabled='true']",
  "[data-cursor-native]",
  ".cursor-grab",
  ".cursor-grabbing",
  ".cursor-wait",
  ".cursor-not-allowed",
  ".cursor-ew-resize",
].join(",");

export default function BrandCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let x = -100;
    let y = -100;

    const render = () => {
      frame = 0;
      cursor.style.setProperty("--cursor-x", `${x}px`);
      cursor.style.setProperty("--cursor-y", `${y}px`);
    };

    const scheduleRender = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    const syncTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      const nativeCursor = element?.closest(NATIVE_CURSOR_SELECTOR);
      const passive = element?.closest("[data-cursor-passive]");
      const interactive = !nativeCursor && !passive && element?.closest(INTERACTIVE_SELECTOR);
      cursor.toggleAttribute("data-native", Boolean(nativeCursor));
      cursor.toggleAttribute("data-interactive", Boolean(interactive));
    };

    const syncTargetAtPointer = () => {
      if (x < 0 || y < 0) return;
      syncTarget(document.elementFromPoint(x, y));
    };

    const pointerMove = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType !== "mouse") return;
      x = event.clientX;
      y = event.clientY;
      cursor.setAttribute("data-visible", "true");
      syncTarget(event.target);
      scheduleRender();
    };

    const pointerDown = () => cursor.setAttribute("data-pressed", "true");
    const pointerUp = () => cursor.removeAttribute("data-pressed");
    const hide = () => cursor.removeAttribute("data-visible");
    const refreshTarget = () => requestAnimationFrame(syncTargetAtPointer);
    const syncCapability = () => {
      document.documentElement.classList.toggle(
        "ruined-brand-cursor-active",
        finePointer.matches
      );
      if (!finePointer.matches) hide();
    };

    syncCapability();
    finePointer.addEventListener("change", syncCapability);
    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("pointerdown", pointerDown, { passive: true });
    window.addEventListener("pointerup", pointerUp, { passive: true });
    window.addEventListener("pointercancel", pointerUp, { passive: true });
    window.addEventListener("scroll", refreshTarget, { passive: true });
    window.addEventListener("ruined:home-scene-change", refreshTarget);
    window.addEventListener("blur", hide);
    document.addEventListener("transitionend", refreshTarget, true);
    document.documentElement.addEventListener("pointerleave", hide);

    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove("ruined-brand-cursor-active");
      finePointer.removeEventListener("change", syncCapability);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("scroll", refreshTarget);
      window.removeEventListener("ruined:home-scene-change", refreshTarget);
      window.removeEventListener("blur", hide);
      document.removeEventListener("transitionend", refreshTarget, true);
      document.documentElement.removeEventListener("pointerleave", hide);
    };
  }, []);

  return (
    <div ref={cursorRef} className="ruined-brand-cursor" aria-hidden="true">
      <span className="ruined-brand-cursor__mark ruined-brand-cursor__mark--teal" />
      <span className="ruined-brand-cursor__mark ruined-brand-cursor__mark--magenta" />
      <span className="ruined-brand-cursor__mark ruined-brand-cursor__mark--base" />
    </div>
  );
}
