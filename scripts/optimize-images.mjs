import sharp from "sharp";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + "KB";

async function run() {
  // ── Hero warehouse photo (no alpha) ──────────────────────────────
  // Kept at native 3344×1882 so the parallax push-in (up to ~2.3×) stays
  // sharp; just re-encoded from an 8.5MB PNG to AVIF + WebP.
  const heroSrc = join(root, "src/imports/Web Main BG 6_2.png");
  const heroAvif = join(root, "src/imports/web-main-bg.avif");
  const heroWebp = join(root, "src/imports/web-main-bg.webp");

  await sharp(heroSrc).avif({ quality: 52, effort: 5 }).toFile(heroAvif);
  await sharp(heroSrc).webp({ quality: 78, effort: 5 }).toFile(heroWebp);

  console.log(`hero  PNG  ${kb(heroSrc)}`);
  console.log(`hero  AVIF ${kb(heroAvif)}  -> ${basename(heroAvif)}`);
  console.log(`hero  WEBP ${kb(heroWebp)}  -> ${basename(heroWebp)}`);

  // ── Couch menu art (HAS alpha — must preserve transparency) ───────
  const couchSrc = join(
    root,
    "src/imports/Group5-1/0b4185b66f994a23d535cef5709e3b7e928643e3.png"
  );
  const couchWebp = join(root, "src/imports/Group5-1/couch.webp");
  await sharp(couchSrc).webp({ quality: 82, alphaQuality: 90, effort: 5 }).toFile(couchWebp);
  console.log(`couch PNG  ${kb(couchSrc)}`);
  console.log(`couch WEBP ${kb(couchWebp)}  -> ${basename(couchWebp)}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
