import sharp from "sharp";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname } from "node:path";

// Re-encodes the full-screen parallax scene photos (and the /work backdrop)
// from JPEG to AVIF + WebP. These are rendered via raw <picture> in the hero
// (not next/image), so we precompute the modern formats and let the markup
// pick the lightest one the browser supports, falling back to the JPEG.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + "KB";

const SCENES = [
  "ruined-hero-1.jpg",
  "ruined-hero-store-4.jpg",
  "ruined-hero-records.jpg",
  "ruined-hero-lounge.jpg",
  "ruined-work-shelf.jpg",
];

async function run() {
  for (const file of SCENES) {
    const src = join(pub, file);
    const stem = basename(file, extname(file));
    const avif = join(pub, `${stem}.avif`);
    const webp = join(pub, `${stem}.webp`);

    await sharp(src).avif({ quality: 50, effort: 5 }).toFile(avif);
    await sharp(src).webp({ quality: 78, effort: 5 }).toFile(webp);

    console.log(
      `${stem.padEnd(22)} jpg ${kb(src).padStart(6)}  avif ${kb(avif).padStart(
        6
      )}  webp ${kb(webp).padStart(6)}`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
