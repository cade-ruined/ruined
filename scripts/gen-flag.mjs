import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Rebuilds the hanging canvas-flag masthead:
//   1. key the near-white studio background of the linen-sheet photo to
//      transparent (flood-fill from the borders so bright folds in the cloth
//      interior are never punched out),
//   2. screen-print the RUINED "After the Fear" lockup onto the cloth with a
//      `multiply` blend so the linen weave/folds show THROUGH the dark ink
//      (pigment soaked into the cloth, not a sticker),
//   3. trim the transparent margins so the asset is tightly the sheet.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets =
  "/Users/cademangelson/.cursor/projects/Users-cademangelson-Projects-Ruined-Ruined-Repo/assets";

const flagPath = join(assets, "ruined-flag.png");
const lockupPath = join(root, "public/Ruined_Wordmark_Final_Lockup_No_Padding.svg");

const PRINT_WIDTH_FRAC = 0.62; // print width as a fraction of the cloth width
const PRINT_TOP_FRAC = 0.17; // print top as a fraction of the sheet height
const INK = "#2a2018"; // dark warm ink

// The studio backdrop is near-white: every channel very bright (min ≥ 226),
// whereas the beige linen's darkest channel sits far lower (~170), so a simple
// brightness floor cleanly separates them. Border-only flood-fill keeps bright
// interior folds safe.
const isBg = (r, g, b) => Math.min(r, g, b) >= 226;

async function keyBackground() {
  const { data, info } = await sharp(flagPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info; // 4
  const seen = new Uint8Array(width * height);
  const stack = [];

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    const o = p * channels;
    if (!isBg(data[o], data[o + 1], data[o + 2])) return;
    seen[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  let cleared = 0;
  for (let p = 0; p < width * height; p++) {
    if (seen[p]) {
      data[p * channels + 3] = 0;
      cleared++;
    }
  }
  const pct = ((cleared / (width * height)) * 100).toFixed(1);
  console.log(`keyed ${pct}% of pixels to transparent`);
  return { data: Buffer.from(data), width, height };
}

async function run() {
  const keyed = await keyBackground();

  // Trim the transparent margins first, so all placement is relative to the
  // final sheet canvas.
  const { data: td, info: ti } = await sharp(keyed.data, {
    raw: { width: keyed.width, height: keyed.height, channels: 4 },
  })
    .trim()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = ti;

  // Detect the cloth's horizontal span on a mid-height row (below the batten),
  // so the print centres on the CLOTH rather than the bounding box (the batten
  // rope can extend the box asymmetrically).
  const row = Math.round(height * 0.55);
  let minX = width;
  let maxX = 0;
  for (let x = 0; x < width; x++) {
    if (td[(row * width + x) * channels + 3] > 20) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  const clothWidth = maxX - minX;
  const clothCenter = (minX + maxX) / 2;

  const printW = Math.round(clothWidth * PRINT_WIDTH_FRAC);
  const printLeft = Math.round(clothCenter - printW / 2);
  const printTop = Math.round(height * PRINT_TOP_FRAC);

  let svg = readFileSync(lockupPath, "utf8");
  svg = svg.replace("<svg ", `<svg fill="${INK}" `);
  const printBuf = await sharp(Buffer.from(svg))
    .resize({ width: printW })
    .png()
    .toBuffer();

  await sharp(td, { raw: { width, height, channels } })
    .composite([
      { input: printBuf, left: printLeft, top: printTop, blend: "multiply" },
    ])
    .webp({ quality: 88, alphaQuality: 100, effort: 5 })
    .toFile(join(root, "public/ruined-flag.webp"));

  console.log(
    `sheet ${width}x${height}  cloth ${clothWidth}px @${Math.round(
      clothCenter
    )}  print ${printW}px @(${printLeft},${printTop}) -> public/ruined-flag.webp`
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
