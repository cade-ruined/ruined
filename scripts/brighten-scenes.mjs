import sharp from "sharp";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Lifts the darkness out of the parallax scene photos so you can actually see
// INTO each room (and through the doorways/hatch into the next). It always
// reads from the pristine dark originals in scripts/scene-originals/, so it's
// idempotent — re-run with different MUL/OFF/GAMMA/SAT to re-tune without ever
// compounding a previous pass. Writes the brightened JPG (+ AVIF/WebP) into
// public/, and a full-res brightened PNG back into scene-originals/ for hand
// editing / re-cropping.
//
//   node scripts/brighten-scenes.mjs                 # default tuning
//   MUL=1.1 OFF=28 GAMMA=1.25 SAT=1.1 node scripts/brighten-scenes.mjs
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const orig = join(root, "scripts", "scene-originals");
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + "KB";

// Tone: gamma opens the midtones, the linear offset lifts the deepest shadows
// (the room interiors) up off pure black, and a touch of saturation keeps it
// from going grey/milky as it brightens.
//
// The moody originals (store / lounge / work-shelf) get the strong lift. The
// entrance + records were RE-RENDERED already bright with lit interiors showing
// through their doorways, so they only need a gentle, near-natural pass to sit
// at the same brightness as the rest. `ext` picks the source in scene-originals
// (the re-rendered ones are PNG, the rest the pristine dark JPG). All are
// cover-resized to a common 1536×1024 so portal coordinates stay consistent.
const STRONG = { gamma: 1.55, mul: 1.1, off: 18, sat: 1.1 };
const GENTLE = { gamma: 1.12, mul: 1.03, off: 6, sat: 1.04 };
const SCENES = [
  { stem: "ruined-hero-1", ext: "png", tone: GENTLE },
  { stem: "ruined-hero-store-4", ext: "jpg", tone: STRONG },
  { stem: "ruined-hero-records", ext: "png", tone: GENTLE },
  { stem: "ruined-hero-lounge", ext: "jpg", tone: STRONG },
  { stem: "ruined-work-shelf", ext: "jpg", tone: STRONG },
];

async function run() {
  for (const { stem, ext, tone } of SCENES) {
    const src = join(orig, `${stem}.${ext}`);
    const t = {
      gamma: Number(process.env.GAMMA ?? tone.gamma),
      mul: Number(process.env.MUL ?? tone.mul),
      off: Number(process.env.OFF ?? tone.off),
      sat: Number(process.env.SAT ?? tone.sat),
    };

    const toned = () =>
      sharp(src)
        .resize(1536, 1024, { fit: "cover" })
        .gamma(t.gamma)
        .linear(t.mul, t.off)
        .modulate({ saturation: t.sat });

    const jpg = join(pub, `${stem}.jpg`);
    const avif = join(pub, `${stem}.avif`);
    const webp = join(pub, `${stem}.webp`);
    const brightPng = join(orig, `${stem}-bright.png`);

    await toned().jpeg({ quality: 92 }).toFile(jpg);
    await toned().avif({ quality: 50, effort: 5 }).toFile(avif);
    await toned().webp({ quality: 78, effort: 5 }).toFile(webp);
    await toned().png().toFile(brightPng);

    console.log(
      `${stem.padEnd(22)} jpg ${kb(jpg).padStart(6)}  avif ${kb(avif).padStart(
        6
      )}  webp ${kb(webp).padStart(6)}`
    );
  }
  console.log(
    `\nbrightened originals (PNG) written to scripts/scene-originals/*-bright.png`
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
