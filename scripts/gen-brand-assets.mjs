import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Generates the file-based metadata assets Next.js picks up automatically:
//   app/icon.png          — favicon / tab icon
//   app/apple-icon.png    — iOS home-screen icon
//   app/opengraph-image.png + app/twitter-image.png — link-share card
//
// The OG card is the lead hero photo, cropped to 1200×630 with a scrim and the
// RUINED lockup screen-printed over it, so a shared link looks like the site.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "app");
const pub = join(root, "public");

const POSTER = "#d0312d";
const BONE = "#e5e0d5";
const INK = "#0b0908";

// ── App icon (square) ───────────────────────────────────────────────
const iconSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="112" fill="${INK}"/>
  <rect x="16" y="16" width="480" height="480" rx="100" fill="none" stroke="${BONE}" stroke-opacity="0.14" stroke-width="6"/>
  <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-weight="700"
        font-size="340" fill="${BONE}">R</text>
  <circle cx="378" cy="150" r="26" fill="${POSTER}"/>
</svg>`;

// ── OG / Twitter card overlay (1200×630) ────────────────────────────
const ogOverlay = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0.30"/>
      <stop offset="55%" stop-color="#000" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#scrim)"/>
  <g font-family="'Courier New', monospace">
    <circle cx="84" cy="92" r="9" fill="${POSTER}"/>
    <text x="108" y="100" font-size="30" letter-spacing="10" fill="${BONE}">RUINED</text>
  </g>
  <text x="80" y="430" font-family="Georgia, 'Times New Roman', serif" font-weight="700"
        font-size="170" fill="${BONE}" letter-spacing="2">RUINED</text>
  <text x="86" y="500" font-family="Georgia, serif" font-style="italic"
        font-size="58" fill="${POSTER}">After the Fear</text>
  <text x="86" y="565" font-family="'Courier New', monospace" font-size="24"
        letter-spacing="8" fill="${BONE}" fill-opacity="0.7">DROP 01 · SS / MMXXVI · RUINED.STUDIO</text>
</svg>`;

async function run() {
  await sharp(Buffer.from(iconSvg(512))).png().toFile(join(app, "icon.png"));
  await sharp(Buffer.from(iconSvg(180))).png().toFile(join(app, "apple-icon.png"));
  console.log("icons        -> app/icon.png, app/apple-icon.png");

  const og = await sharp(join(pub, "ruined-hero-1.jpg"))
    .resize(1200, 630, { fit: "cover", position: "centre" })
    .composite([{ input: Buffer.from(ogOverlay) }])
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();
  await sharp(og).toFile(join(app, "opengraph-image.jpg"));
  await sharp(og).toFile(join(app, "twitter-image.jpg"));
  console.log("share card   -> app/opengraph-image.jpg, app/twitter-image.jpg");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
