"use client";

import { useEffect, useRef } from "react";
import { archiveDustIllumination, getArchiveLightLayout } from "./archive-lighting";

/** Airborne paper dust, visible primarily where it crosses the room's light. */
export default function AmbientParticles({ className, archive = false }: { className?: string; archive?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const roomSource = window.matchMedia("(max-aspect-ratio: 4/5)");
    let width = 0, height = 0, frame = 0, last = 0, elapsed = 0, intersecting = true, logoReady = false;
    let seed = 19791;
    function random() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    const motes = Array.from({ length: archive ? 650 : 180 }, (_, index) => {
      const kind = index % 25 === 12 ? "leaf" : index % 19 === 7 ? "bokeh" : "fleck";
      const depth = kind === "bokeh" ? .8 + random() * .2 : .12 + random() * .65;
      return {
        kind, x: random(), y: random(), depth,
        size: kind === "bokeh" ? (archive ? 24 : 16) + random() * (archive ? 18 : 13)
          : kind === "leaf" ? (archive ? 14 : 11) + random() * (archive ? 8 : 7)
            : (archive ? 5 : 2.2) + random() * (archive ? 7 : 4.2),
        alpha: kind === "bokeh" ? (archive ? .14 : .075) + random() * (archive ? .1 : .055)
          : kind === "leaf" ? (archive ? .1 : .045) + random() * (archive ? .06 : .025)
            : (archive ? .45 : .2) + random() * (archive ? .35 : .18),
        speedX: (random() - .5) * (.45 + depth), speedY: .15 + random() * .5 + depth * .3,
        phase: random() * Math.PI * 2, frequency: .018 + random() * .03,
        angle: random() * Math.PI, rotation: (random() - .5) * .012,
        variant: Math.floor(random() * 6),
      };
    });
    // Rasterize once: irregular opaque bodies with soft focus, without additive
    // blending, bright halos, or a time-driven sparkle effect.
    function dustSprite(variant: number, outOfFocus: boolean) {
      const image = document.createElement("canvas"); image.width = 64; image.height = 64;
      const paint = image.getContext("2d");
      if (!paint) return image;
      paint.fillStyle = ["#d0c8b9", "#bdb6a9", "#ded6c7"][variant % 3];
      paint.filter = outOfFocus ? "blur(7px)" : variant % 3 === 2 ? "blur(2px)" : "blur(.5px)";
      paint.beginPath();
      for (let corner = 0; corner < 7; corner++) {
        const angle = corner / 7 * Math.PI * 2;
        const radius = 12 + Math.sin(corner * 2.6 + variant) * 4;
        const x = 32 + Math.cos(angle) * radius * (1 + variant * .06);
        const y = 32 + Math.sin(angle) * radius * (.58 + variant * .055);
        if (corner === 0) paint.moveTo(x, y); else paint.lineTo(x, y);
      }
      paint.closePath(); paint.fill();
      return image;
    }
    const flecks = Array.from({ length: 6 }, (_, index) => dustSprite(index, false));
    const blurred = Array.from({ length: 6 }, (_, index) => dustSprite(index, true));
    const symbol = document.createElement("canvas"); symbol.width = 96; symbol.height = 136;
    const leaf = new Image(); leaf.decoding = "async";
    // Preserve the exact proportions and paths of the supplied SVG's viewBox.
    const markAspect = 283.956 / 400;
    leaf.onload = () => {
      const paint = symbol.getContext("2d");
      if (!paint) return;
      const symbolHeight = Math.min(symbol.height, symbol.width / markAspect), symbolWidth = symbolHeight * markAspect;
      paint.drawImage(leaf, (symbol.width - symbolWidth) / 2, (symbol.height - symbolHeight) / 2, symbolWidth, symbolHeight);
      paint.globalCompositeOperation = "source-in";
      paint.fillStyle = "#b7b1a5"; paint.fillRect(0, 0, symbol.width, symbol.height);
      logoReady = true; sync();
    };
    // The supplied mark is optional; ordinary dust renders before it loads and
    // continues if it cannot be fetched.
    leaf.src = "/ruined-mark.svg";
    function draw() {
      if (!context || !width || !height) return;
      context.clearRect(0, 0, width, height);
      const area = width * height;
      // Keep the archive visibly inhabited even on phones; cached sprites and
      // viewport-specific caps bound the work as the room gets larger.
      const [minimum, maximum, areaPerMote] = archive
        ? width < 600 ? [130, 230, 1700] : [300, motes.length, 2400]
        : width < 600 ? [44, 70, 5200] : [98, motes.length, 8500];
      const count = Math.min(maximum, Math.max(minimum, Math.round(area / areaPerMote)));
      const lightLayout = archive ? getArchiveLightLayout(width, height, roomSource.matches) : null;
      // Seconds stay tied to visible time; archive drift needs enough travel to
      // read as airborne dust rather than stationary grain on the room image.
      const motionTime = elapsed * (archive ? 6 : 1);
      for (let index = 0; index < count; index++) {
        const mote = motes[index], isLeaf = mote.kind === "leaf" && logoReady;
        const sprite = isLeaf ? symbol : mote.kind === "bokeh" ? blurred[mote.variant] : flecks[mote.variant];
        const size = mote.kind === "leaf" && !logoReady ? (archive ? 6 : 3) : mote.size;
        const spriteWidth = size * sprite.width / sprite.height;
        const margin = Math.hypot(spriteWidth, size) / 2 + 12;
        const spanX = width + margin * 2, spanY = height + margin * 2;
        const drift = 4 + mote.depth * 12;
        const x = ((mote.x * spanX + Math.sin(motionTime * mote.frequency + mote.phase) * drift + motionTime * mote.speedX) % spanX + spanX) % spanX - margin;
        const y = ((mote.y * spanY - motionTime * mote.speedY + Math.cos(motionTime * mote.frequency * .73 + mote.phase) * drift * .65) % spanY + spanY) % spanY - margin;
        const light = lightLayout
          ? archiveDustIllumination(x, y, lightLayout)
          : .4 + .6 * Math.exp(-Math.pow((x / width - .5) * 1.8, 2));
        const alpha = mote.kind === "leaf" && !logoReady ? (archive ? .4 : .16) : mote.alpha;
        context.globalAlpha = alpha * light;
        context.save(); context.translate(x, y); context.rotate(mote.angle + elapsed * mote.rotation);
        context.drawImage(sprite, -spriteWidth / 2, -size / 2, spriteWidth, size);
        context.restore();
      }
      context.globalAlpha = 1;
    }
    function animate(now: number) {
      frame = 0;
      if (document.hidden || !intersecting || media.matches) return;
      const delta = last ? now - last : 0;
      if (!last || delta >= 1000 / 30) {
        elapsed += Math.min(delta, 80) / 1000; last = now;
        draw();
      }
      frame = requestAnimationFrame(animate);
    }
    function sync() {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      draw();
      if (!document.hidden && intersecting && !media.matches) frame = requestAnimationFrame(animate);
    }
    function resize() {
      if (!element || !context) return;
      const bounds = element.getBoundingClientRect(); width = bounds.width; height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0); sync();
    }
    const observer = new ResizeObserver(resize); observer.observe(element);
    const intersection = new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? false; sync(); }); intersection.observe(element);
    media.addEventListener("change", sync); roomSource.addEventListener("change", sync); document.addEventListener("visibilitychange", sync); resize();
    return () => { leaf.onload = null; cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); media.removeEventListener("change", sync); roomSource.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [archive]);
  return <canvas ref={canvas} className={className} aria-hidden="true" style={{ pointerEvents: "none" }} />;
}
