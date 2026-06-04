"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type ProductTone = "warm" | "shadow" | "atelier";

export type Product = {
  id: string;
  code: string; // e.g. "RU—001"
  name: string; // e.g. "Field Coat"
  subtitle: string; // e.g. "FOR WEATHER"
  price: string; // e.g. "£ 420"
  description: string;
  material: string;
  origin: string;
  care: string;
  tone: ProductTone;
};

const TONES: Record<ProductTone, string> = {
  warm: "linear-gradient(135deg, #1c1108 0%, #3a2615 35%, #1d1410 70%, #0a0707 100%)",
  shadow: "linear-gradient(160deg, #0a0908 0%, #181513 50%, #0a0807 100%)",
  atelier:
    "linear-gradient(120deg, #14110e 0%, #2c2419 35%, #1a1612 65%, #0a0807 100%)",
};

const VISIBLE = 3;

type Props = { products: Product[] };

/**
 * Stacked product cards: the top card shows the image + name; tap (or "tap
 * for details") flips it to reveal the description and specs on the same
 * card — so image and copy are paired by construction. Use ◀ / ▶ to cycle
 * the stack; tap a progress dot to jump to a product.
 */
export default function ProductStack({ products }: Props) {
  const [stackOrder, setStackOrder] = useState<number[]>(() =>
    products.map((_, i) => i)
  );
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [flipped, setFlipped] = useState<number | null>(null);

  const visible = stackOrder
    .slice(0, VISIBLE)
    .map((productIndex, stackIndex) => ({ productIndex, stackIndex }));

  const cycleForward = () => {
    setDirection("next");
    setFlipped(null);
    setStackOrder((prev) => [...prev.slice(1), prev[0]]);
  };

  const cycleBackward = () => {
    setDirection("prev");
    setFlipped(null);
    setStackOrder((prev) => [prev[prev.length - 1], ...prev.slice(0, -1)]);
  };

  const jumpToProduct = (targetIndex: number) => {
    const currentPosition = stackOrder.indexOf(targetIndex);
    if (currentPosition <= 0) return;
    setFlipped(null);

    // Pick the shorter direction around the cycle.
    const forwardSteps = currentPosition;
    const backwardSteps = stackOrder.length - currentPosition;
    const goForward = forwardSteps <= backwardSteps;

    setDirection(goForward ? "next" : "prev");
    const steps = goForward ? forwardSteps : backwardSteps;

    for (let i = 0; i < steps; i++) {
      setTimeout(() => {
        setStackOrder((prev) =>
          goForward
            ? [...prev.slice(1), prev[0]]
            : [prev[prev.length - 1], ...prev.slice(0, -1)]
        );
      }, i * 110);
    }
  };

  const toggleFlip = (stackIndex: number) => {
    setFlipped((curr) => (curr === stackIndex ? null : stackIndex));
  };

  return (
    <div className="relative flex flex-col h-full w-full items-center">
      {/* Card stack — fills the available column space (capped to 540px tall)
          so the stack adapts when the section is constrained by a snap-frame. */}
      <div
        className="relative mx-auto flex-1 min-h-[260px] max-h-[540px] w-full"
        style={{
          maxWidth: 420,
          perspective: 1200,
        }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map(({ productIndex, stackIndex }) => {
            const product = products[productIndex];
            const isFlipped = flipped === stackIndex;
            const isTop = stackIndex === 0;

            const z = VISIBLE - stackIndex;
            const scale = 1 - stackIndex * 0.05;
            const yOffset = stackIndex * 22;
            const rotateZ = stackIndex === 0 ? -3 : stackIndex === 1 ? 2 : -1;

            return (
              <motion.div
                key={productIndex}
                className="absolute inset-0 will-change-transform"
                style={{
                  zIndex: z,
                  transformStyle: "preserve-3d",
                  transformOrigin: "center center",
                  cursor: isTop ? "pointer" : "default",
                }}
                initial={
                  direction === "next"
                    ? {
                        y: yOffset + 80,
                        rotateZ,
                        scale: scale - 0.15,
                        opacity: 0,
                      }
                    : {
                        y: -80,
                        rotateZ: -15,
                        scale: 1.1,
                        opacity: 0,
                      }
                }
                animate={{
                  y: yOffset,
                  rotateZ,
                  scale,
                  opacity: 1,
                  rotateY: isFlipped ? 180 : 0,
                  transition: {
                    duration: 0.45,
                    ease: [0.4, 0, 0.2, 1],
                    rotateY: { duration: 0.55, ease: [0.4, 0, 0.2, 1] },
                  },
                }}
                exit={
                  direction === "next"
                    ? {
                        y: 130,
                        rotateZ: rotateZ + 5,
                        scale: 0.72,
                        opacity: 0,
                        transition: { duration: 0.35, ease: [0.4, 0, 1, 1] },
                      }
                    : {
                        y: yOffset + 80,
                        rotateZ,
                        scale: scale - 0.15,
                        opacity: 0,
                        transition: { duration: 0.35, ease: [0.4, 0, 1, 1] },
                      }
                }
                whileHover={
                  isTop
                    ? { y: yOffset - 6, scale: scale * 1.02 }
                    : undefined
                }
                onClick={() => {
                  if (isTop) toggleFlip(stackIndex);
                }}
              >
                <div
                  className="relative w-full h-full"
                  style={{
                    transformStyle: "preserve-3d",
                    borderRadius: 14,
                    boxShadow: `0 ${22 + stackIndex * 12}px ${44 + stackIndex * 12}px rgba(42,42,42,${0.32 - stackIndex * 0.06}), 0 ${10 + stackIndex * 4}px ${20 + stackIndex * 4}px rgba(42,42,42,${0.22 - stackIndex * 0.05})`,
                  }}
                >
                  <CardFront product={product} />
                  <CardBack product={product} />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Progress dots */}
      <div className="mt-5 flex items-center justify-center gap-1.5">
        {products.map((p, index) => {
          const isTop = index === stackOrder[0];
          return (
            <motion.button
              key={p.id}
              onClick={() => jumpToProduct(index)}
              aria-label={`Show ${p.name}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                isTop
                  ? "w-6 bg-[var(--color-poster)]"
                  : "w-1.5 bg-[var(--color-faded)]/25 hover:bg-[var(--color-faded)]/45"
              }`}
              whileHover={{ scale: 1.25 }}
              whileTap={{ scale: 0.85 }}
            />
          );
        })}
      </div>

      {/* Prev / Next */}
      <div className="mt-4 flex items-center justify-center gap-6">
        <NavButton
          direction="prev"
          onClick={cycleBackward}
          label="Previous product"
        />
        <NavButton
          direction="next"
          onClick={cycleForward}
          label="Next product"
        />
      </div>
    </div>
  );
}

function NavButton({
  direction,
  onClick,
  label,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      whileTap={{ scale: 0.92 }}
      whileHover={{ scale: 1.05 }}
      className="group p-3 rounded-full border border-[var(--color-poster)]/35 hover:bg-[var(--color-poster)] hover:border-[var(--color-poster)] transition-colors duration-200"
    >
      <Icon className="w-5 h-5 text-[var(--color-poster)] group-hover:text-[var(--color-bone)] transition-colors duration-200" />
    </motion.button>
  );
}

function CardFront({ product }: { product: Product }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden border-l-4 border-l-[var(--color-poster)]"
      style={{
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        borderRadius: 14,
        background: TONES[product.tone],
      }}
    >
      {/* Texture overlays — same vocabulary as PlaceholderImage so cards
          read as part of the same "contact sheet" family */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(229,224,213,0.55) 0 1px, transparent 1px 72px)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(229,224,213,0.45) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />

      {/* "image goes here" marker */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[0.6rem] tracking-[0.45em] uppercase text-[var(--color-bone)]/28">
          [&nbsp;product&nbsp;image&nbsp;]
        </span>
      </div>

      {/* Top-right product code */}
      <span className="absolute top-5 right-5 font-mono text-[0.62rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/70 tabular-nums">
        {product.code}
      </span>

      {/* Bottom shade + content */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            "linear-gradient(to top, rgba(10,7,7,0.92) 0%, rgba(10,7,7,0.6) 45%, rgba(10,7,7,0) 100%)",
        }}
      />

      <div className="absolute inset-x-0 bottom-0 p-6 text-[var(--color-bone)]">
        <div className="font-mono text-[0.62rem] tracking-[0.4em] uppercase text-[var(--color-signal)] mb-3">
          {product.subtitle}
        </div>
        <h3 className="display text-3xl leading-[1.05]">{product.name}</h3>
        <div className="mt-5 flex items-center justify-between">
          <span className="font-mono text-sm tabular-nums text-[var(--color-bone)]">
            {product.price}
          </span>
          <span className="font-mono text-[0.62rem] tracking-[0.3em] uppercase text-[var(--color-bone)]/60">
            tap for details
          </span>
        </div>
      </div>
    </div>
  );
}

function CardBack({ product }: { product: Product }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden border-l-4 border-l-[var(--color-signal)]"
      style={{
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: "rotateY(180deg)",
        borderRadius: 14,
        background: "linear-gradient(155deg, #2A2A2A 0%, #1a1a1a 65%, #141414 100%)",
      }}
    >
      <div className="absolute inset-0 p-7 flex flex-col text-[var(--color-bone)]">
        <div>
          <div className="font-mono text-[0.62rem] tracking-[0.4em] uppercase text-[var(--color-signal)] mb-3">
            {product.subtitle}
          </div>
          <h3 className="display text-3xl leading-[1.05]">{product.name}</h3>
          <div className="mt-3 font-mono text-base tabular-nums text-[var(--color-bone)]/90">
            {product.price}
          </div>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-[var(--color-bone)]/85">
          {product.description}
        </p>

        <dl className="mt-auto space-y-2.5 border-t border-[var(--color-bone)]/15 pt-5 text-xs">
          <SpecRow label="Material" value={product.material} />
          <SpecRow label="Origin" value={product.origin} />
          <SpecRow label="Care" value={product.care} />
        </dl>

        <div className="mt-5 text-center font-mono text-[0.58rem] tracking-[0.32em] uppercase text-[var(--color-bone)]/45">
          tap to close
        </div>
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-mono uppercase tracking-[0.22em] text-[var(--color-bone)]/55">
        {label}
      </dt>
      <dd className="text-right text-[var(--color-bone)]/85">{value}</dd>
    </div>
  );
}
