import "server-only";

import { resolve } from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { AdminEmailError } from "./admin-email-model";
import { uploadAdminEmailImage } from "./admin-email-images";
import { EMAIL_SIGN_OFF_LAYOUT } from "./email-sign-off-layout";
import { normalizeResendEmailSignOff } from "./resend-email-templates";

let fontReady = false;

/** Render from the actual brand font. Never fetch a font or interpolate SVG. */
export async function renderAdminEmailSignOff(value: string) {
  const signOff = normalizeResendEmailSignOff({ text: value })!;
  if (!fontReady) {
    fontReady = Boolean(GlobalFonts.registerFromPath(resolve(process.cwd(), "public/fonts/CadeHandy2.otf"), "RuinedEmailHandwriting"));
    if (!fontReady) throw new AdminEmailError(503, "The sign-off font is unavailable. Try again shortly.");
  }
  const { displayFontSize, rasterScale, padding, maxDisplayWidth, maxVisibleHeight, color } = EMAIL_SIGN_OFF_LAYOUT;
  const fontSize = displayFontSize * rasterScale;
  const font = `${fontSize}px "RuinedEmailHandwriting"`;
  const measure = createCanvas(1, 1).getContext("2d");
  measure.font = font;
  const measuredWidth = measure.measureText(signOff.text).width;
  if (!Number.isFinite(measuredWidth) || measuredWidth > 12_000) throw new AdminEmailError(400, "Shorten the sign-off so the lettering stays readable.");
  const source = createCanvas(Math.ceil(measuredWidth + fontSize * 4), fontSize * 4);
  const context = source.getContext("2d");
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
    throw new AdminEmailError(400, "Use visible lettering for the sign-off.");
  }
  const inkWidth = right - left + 1, inkHeight = bottom - top + 1;
  const scale = Math.min(1, (maxDisplayWidth - padding * 2) * rasterScale / inkWidth, maxVisibleHeight * rasterScale / inkHeight);
  // Very long phrases should be shortened, rather than becoming illegible.
  if (scale < 0.45) throw new AdminEmailError(400, "Shorten the sign-off so the lettering stays readable.");
  const width = Math.ceil(inkWidth * scale / rasterScale + padding * 2);
  const height = Math.ceil(inkHeight * scale / rasterScale + padding * 2);
  const canvas = createCanvas(width * rasterScale, height * rasterScale);
  canvas.getContext("2d").drawImage(source, left, top, inkWidth, inkHeight, padding * rasterScale,
    padding * rasterScale, inkWidth * scale, inkHeight * scale);
  const data = await canvas.encode("png");
  return { data, width, height };
}

/** Preview stays in memory. Only a saved draft or recipient review persists artwork. */
export async function prepareAdminEmailSignOff(actor: string, text: string, persist: boolean) {
  const image = await renderAdminEmailSignOff(text);
  if (!persist) return { url: `data:image/png;base64,${image.data.toString("base64")}`, width: image.width, height: image.height };
  const file = new File([new Uint8Array(image.data)], "sign-off.png", { type: "image/png" });
  const uploaded = await uploadAdminEmailImage(actor, file);
  return { url: uploaded.url, width: image.width, height: image.height };
}
