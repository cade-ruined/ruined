// Convert a room's raw render frames (TIFF/PNG/large JPEG) into web-optimized,
// sequentially-numbered WebP, then remove the raw originals from public/ so the
// served payload stays light. Keep your render originals OUTSIDE the repo.
//
// Usage: node scripts/convert-sequence.mjs <room> [width] [height] [quality]
//        [--keep] [--source=<directory>]
//   e.g. node scripts/convert-sequence.mjs lobby 1600 900 80 --keep \
//          --source=sequence-masters/lobby
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const room = process.argv[2];
if (!room) {
  console.error("Usage: node scripts/convert-sequence.mjs <room> [width] [height] [quality]");
  process.exit(1);
}
const WIDTH = Number(process.argv[3] || 1600);
const HEIGHT = Number(process.argv[4] || 900);
const QUALITY = Number(process.argv[5] || 80);
const KEEP_ORIGINALS = process.argv.includes("--keep");
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const PAD = 4;

const DIR = path.join(__dirname, "..", "public", "sequences", room);
const INPUT_DIR = sourceArg
  ? path.resolve(path.join(__dirname, ".."), sourceArg.slice("--source=".length))
  : DIR;
// Raw formats we convert from (not already web-served webp/jpg we produced).
const RAW = /\.(tiff?|png|bmp|jpe?g)$/i;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

async function main() {
  const entries = (await fs.readdir(INPUT_DIR)).filter((f) => RAW.test(f)).sort(natural);
  if (!entries.length) {
    console.log(`No raw frames found in ${INPUT_DIR}`);
    return;
  }
  console.log(`Converting ${entries.length} frames in "${room}" → ${WIDTH}×${HEIGHT} webp q${QUALITY} …`);

  let i = 0;
  for (const name of entries) {
    i += 1;
    const src = path.join(INPUT_DIR, name);
    const out = path.join(DIR, `frame-${String(i).padStart(PAD, "0")}.webp`);
    await sharp(src).resize(WIDTH, HEIGHT, { fit: "cover" }).webp({ quality: QUALITY }).toFile(out);
    if (i % 20 === 0 || i === entries.length) process.stdout.write(`\r  ${i}/${entries.length}`);
  }
  process.stdout.write("\n");

  if (!KEEP_ORIGINALS) {
    // Remove the raw originals now that webp exists.
    for (const name of entries) {
      await fs.rm(path.join(INPUT_DIR, name), { force: true });
    }
    console.log(`Done. Removed ${entries.length} raw originals from public/sequences/${room}/.`);
  } else {
    console.log(`Done. Kept ${entries.length} raw originals in ${INPUT_DIR}.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
