"use client";

import { EMAIL_SIGN_OFF_LAYOUT } from "@/lib/communications/email-sign-off-layout";
import type { ResendEmailSignOffImage } from "@/lib/communications/resend-email-model";
import { normalizeResendEmailSignOff } from "@/lib/communications/resend-email-templates";

const FONT_FAMILY = "RuinedEmailHandwritingPreview";
let fontReady: Promise<void> | null = null;

function loadSignOffFont(): Promise<void> {
  if (!fontReady) {
    fontReady = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("The sign-off font could not load. Check your connection and try again.")), 10_000);
      const font = new FontFace(FONT_FAMILY, 'url("/fonts/CadeHandy2.otf")');
      font.load().then((loaded) => {
        window.clearTimeout(timeout);
        document.fonts.add(loaded);
        resolve();
      }, () => {
        window.clearTimeout(timeout);
        reject(new Error("The sign-off font could not load. Check your connection and try again."));
      });
    }).catch((error: unknown) => { fontReady = null; throw error; });
  }
  return fontReady;
}

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the sign-off preview.");
  return context;
}

/** Local-only artwork uses the same font, bounds and sizing as the server.
 * The image is passed to the trusted renderer, never stored in editor payloads. */
export async function renderEmailSignOffPreview(value: string): Promise<ResendEmailSignOffImage> {
  const signOff = normalizeResendEmailSignOff({ text: value })!;
  await loadSignOffFont();
  const { displayFontSize, rasterScale, padding, maxDisplayWidth, maxVisibleHeight, color } = EMAIL_SIGN_OFF_LAYOUT;
  const fontSize = displayFontSize * rasterScale;
  const font = `${fontSize}px "${FONT_FAMILY}"`;
  const measure = contextFor(document.createElement("canvas"));
  measure.font = font;
  const measuredWidth = measure.measureText(signOff.text).width;
  if (!Number.isFinite(measuredWidth) || measuredWidth > 12_000) throw new Error("Shorten the sign-off so the lettering stays readable.");
  const source = document.createElement("canvas");
  source.width = Math.ceil(measuredWidth + fontSize * 4);
  source.height = fontSize * 4;
  const context = contextFor(source);
  context.font = font;
  context.fillStyle = color;
  context.fillText(signOff.text, fontSize * 2, fontSize * 2);
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  let left = source.width, top = source.height, right = -1, bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3]) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top || left === 0 || top === 0 || right === source.width - 1 || bottom === source.height - 1) {
    throw new Error("Use visible lettering for the sign-off.");
  }
  const inkWidth = right - left + 1, inkHeight = bottom - top + 1;
  const scale = Math.min(1, (maxDisplayWidth - padding * 2) * rasterScale / inkWidth, maxVisibleHeight * rasterScale / inkHeight);
  if (scale < 0.45) throw new Error("Shorten the sign-off so the lettering stays readable.");
  const width = Math.ceil(inkWidth * scale / rasterScale + padding * 2);
  const height = Math.ceil(inkHeight * scale / rasterScale + padding * 2);
  const canvas = document.createElement("canvas");
  canvas.width = width * rasterScale;
  canvas.height = height * rasterScale;
  contextFor(canvas).drawImage(source, left, top, inkWidth, inkHeight, padding * rasterScale,
    padding * rasterScale, inkWidth * scale, inkHeight * scale);
  return { url: canvas.toDataURL("image/png"), width, height };
}
