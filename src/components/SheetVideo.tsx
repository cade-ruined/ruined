"use client";

import { useReducedMotion } from "motion/react";

// Sheet 2 (Position 3) bounding box within the warehouse image, as
// percentages. Sheet 2 is the second hanging banner from the left —
// the narrower banner just to the right of the "Yesterday" shirt.
// Values derived by scanning the source mask's silhouette
// (1938,330,321,691 inside the 3344×1882 mask canvas, which shares its
// aspect with the 6688×3764 warehouse photo).
const SHEET_LEFT = "57.95%";
const SHEET_TOP = "17.53%";
const SHEET_WIDTH = "9.60%";
const SHEET_HEIGHT = "36.72%";

type Props = {
  src?: string;
  poster?: string;
  /** Warehouse-aspect alpha mask. Opaque where the sheet sits, transparent elsewhere. */
  maskUrl?: string;
};

/**
 * Video clipped to the second warehouse sheet's silhouette. Sits as a
 * sibling of the warehouse <img> inside the parallax's inner transformed
 * <motion.div>, so it pans, scales, and fades with the photograph
 * exactly as the warehouse does — the sheet is part of the scene.
 *
 * No scroll-tied state: the sheet is always visible in the warehouse
 * (just smaller when zoomed out), so the video is always playing inside
 * it. Mask is the same dimensions as the warehouse image, so applying
 * it at 100%/100% lines up the sheet silhouette with the actual sheet
 * in the photo without any positioning math at the consumer site.
 *
 * The inner <video> is sized to the sheet's bounding box (not the full
 * warehouse) so a 9:16 source fills the sheet shape with only a tiny
 * horizontal center-crop via object-cover.
 */
export default function SheetVideo({
  src = "/sheet-2.mp4",
  poster,
  maskUrl = "/sheet-2-mask.png",
}: Props) {
  const prefersReducedMotion = useReducedMotion();

  const placedStyle: React.CSSProperties = {
    left: SHEET_LEFT,
    top: SHEET_TOP,
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
  };

  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        // Mask carries the sheet silhouette at warehouse-relative
        // coordinates; sized 100%/100% so it always aligns with the
        // warehouse <img> below it, no matter the wrapper dimensions.
        WebkitMaskImage: `url(${maskUrl})`,
        maskImage: `url(${maskUrl})`,
        WebkitMaskSize: "100% 100%",
        maskSize: "100% 100%",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        // Blend the entire masked layer (video clipped to the sheet
        // silhouette) against the warehouse <img> sibling behind it.
        // mask-image creates its own stacking context, so this MUST
        // live on the masked container — not on the inner <video> —
        // for the blend to see the photograph as its backdrop instead
        // of the transparent pixels inside the mask layer.
        //
        // Screen: dark video pixels disappear into the cloth, bright
        // pixels add additively on top — like footage projected onto
        // the banner. Sheet folds and stage lighting still read through
        // the dark parts of the video.
        mixBlendMode: "screen",
      }}
    >
      {prefersReducedMotion && poster ? (
        <img
          src={poster}
          alt=""
          className="absolute object-cover"
          style={placedStyle}
        />
      ) : (
        <video
          src={src}
          poster={poster}
          muted
          playsInline
          loop
          autoPlay
          // metadata (not auto): the poster covers first paint, so we don't
          // race the LCP hero image by eagerly pulling the full ~3.8MB clip.
          // autoPlay still drives the fetch once the hero is settled.
          preload="metadata"
          disableRemotePlayback
          className="absolute object-cover"
          style={placedStyle}
        />
      )}
    </div>
  );
}
