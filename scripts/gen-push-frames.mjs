// Synthesize a smooth forward-dolly ("2.5D push") frame sequence for each room
// from a single still, then bridge rooms with short crossfades. This is the
// deterministic, watermark-free alternative to a re-rendered video walk: each
// still has a locked central vanishing point, so a progressive crop toward that
// point reads as walking forward. A baked film grade (warm curve + animated
// grain + vignette) unifies the rooms and softens the flat-photo tell.
//
//   node scripts/gen-push-frames.mjs
//
// Sources: sequence-sources/<room>.png   →   public/sequences/<room>/frame-####.webp
// Rebuild the manifest afterward with `npm run sequences`.

import sharp from "sharp";
import { readFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const OUT_W = 1600;
const OUT_H = 900;
const PUSH = 48; // frames of forward dolly per room
const XFADE = 8; // crossfade frames appended at each room→room seam
const S_END = 0.6; // final crop fraction (how far the camera pushes in)

// Per-room push target — the vanishing point / focal the camera walks toward,
// in normalized coords of the 16:9 base crop. Centered horizontally throughout.
const ROOMS = [
  { id: "lobby", tx: 0.5, ty: 0.47 },
  { id: "store", tx: 0.5, ty: 0.46 },
  { id: "records", tx: 0.5, ty: 0.45 },
  { id: "lounge", tx: 0.5, ty: 0.47 },
];

const SRC_DIR = "sequence-sources";
const OUT_DIR = "public/sequences";

const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Vignette overlay (built once, reused).
const vignette = Buffer.from(
  `<svg width="${OUT_W}" height="${OUT_H}"><defs><radialGradient id="g" cx="50%" cy="47%" r="75%"><stop offset="58%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.30"/></radialGradient></defs><rect width="${OUT_W}" height="${OUT_H}" fill="url(#g)"/></svg>`
);

async function grain() {
  // Fresh gaussian noise per frame → grain that shimmers instead of sitting
  // "stuck" on the glass.
  return sharp({
    create: { width: OUT_W, height: OUT_H, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 10 } },
  })
    .png()
    .toBuffer();
}

// Apply the shared cinematic grade to a raw RGB crop buffer → graded webp buffer.
async function grade(cropBuf) {
  const g = await grain();
  return sharp(cropBuf)
    .resize(OUT_W, OUT_H)
    .modulate({ saturation: 0.97 })
    .linear([1.1, 1.07, 1.02], [-10, -11, -13]) // warm per-channel S-curve
    .composite([
      { input: g, blend: "soft-light", opacity: 0.5 },
      { input: vignette, blend: "over" },
    ])
    .sharpen({ sigma: 0.5 })
    .webp({ quality: 80 })
    .toBuffer();
}

function clearRoom(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (/^frame-\d+\.webp$/i.test(f)) unlinkSync(join(dir, f));
  }
}

const pad = (n) => String(n).padStart(4, "0");

async function main() {
  // Pass 1 — render each room's push frames. Remember every room's first &
  // last frame path so we can crossfade seams in pass 2.
  const roomFrames = {}; // id → [buffers written count], plus first/last paths
  for (const room of ROOMS) {
    const src = join(SRC_DIR, `${room.id}.png`);
    if (!existsSync(src)) {
      console.warn(`skip ${room.id}: missing ${src}`);
      continue;
    }
    const outDir = join(OUT_DIR, room.id);
    clearRoom(outDir);

    const meta = await sharp(src).metadata();
    const baseH = Math.round((meta.width * 9) / 16);
    const baseTop = Math.round((meta.height - baseH) / 2);
    const base = await sharp(src)
      .extract({ left: 0, top: clamp(baseTop, 0, meta.height - baseH), width: meta.width, height: baseH })
      .toBuffer();
    const BW = meta.width;
    const BH = baseH;

    for (let i = 0; i < PUSH; i++) {
      const t = smoothstep(i / (PUSH - 1));
      const s = 1 - (1 - S_END) * t;
      const cw = Math.round(BW * s);
      const ch = Math.round(BH * s);
      const left = clamp(Math.round(room.tx * BW - cw / 2), 0, BW - cw);
      const top = clamp(Math.round(room.ty * BH - ch / 2), 0, BH - ch);
      const crop = await sharp(base).extract({ left, top, width: cw, height: ch }).toBuffer();
      const graded = await grade(crop);
      await sharp(graded).toFile(join(outDir, `frame-${pad(i + 1)}.webp`));
    }
    roomFrames[room.id] = { outDir, count: PUSH };
    console.log(`${room.id}: ${PUSH} push frames`);
  }

  // Pass 2 — crossfade seams. Blend room A's last frame into room B's first
  // frame across XFADE frames, appended to the END of room A so playback flows
  // A → (dissolve) → B without a hard cut through the doorway.
  for (let r = 0; r < ROOMS.length - 1; r++) {
    const a = roomFrames[ROOMS[r].id];
    const b = roomFrames[ROOMS[r + 1].id];
    if (!a || !b) continue;
    const aLast = join(a.outDir, `frame-${pad(a.count)}.webp`);
    const bFirst = join(b.outDir, `frame-${pad(1)}.webp`);
    const aBuf = readFileSync(aLast);
    const bBuf = readFileSync(bFirst);
    for (let k = 1; k <= XFADE; k++) {
      const t = k / (XFADE + 1);
      const blended = await sharp(bBuf)
        .composite([{ input: aBuf, blend: "over", opacity: 1 - t }])
        .webp({ quality: 80 })
        .toBuffer();
      await sharp(blended).toFile(join(a.outDir, `frame-${pad(a.count + k)}.webp`));
    }
    console.log(`${ROOMS[r].id}→${ROOMS[r + 1].id}: ${XFADE} crossfade frames`);
  }

  console.log("done.");
}

main();
