import sharp from "sharp";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname } from "node:path";

// Regenerates only the modern scene formats that still have runtime consumers.
// Sequence frames have their own conversion pipeline and must not be recreated
// here as parallel still-image variants.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + "KB";

const TARGETS = [
  { file: "ruined-hero-store-4.jpg", formats: ["webp"] },
  { file: "ruined-work-shelf.jpg", formats: ["avif", "webp"] },
];

async function run() {
  for (const { file, formats } of TARGETS) {
    const src = join(pub, file);
    const stem = basename(file, extname(file));
    const sizes = [`jpg ${kb(src)}`];

    if (formats.includes("avif")) {
      const avif = join(pub, `${stem}.avif`);
      await sharp(src).avif({ quality: 50, effort: 5 }).toFile(avif);
      sizes.push(`avif ${kb(avif)}`);
    }

    if (formats.includes("webp")) {
      const webp = join(pub, `${stem}.webp`);
      await sharp(src).webp({ quality: 78, effort: 5 }).toFile(webp);
      sizes.push(`webp ${kb(webp)}`);
    }

    console.log(`${stem.padEnd(22)} ${sizes.join("  ")}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
