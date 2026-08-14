import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Generates the versioned public icons declared in app/layout.tsx:
//   public/favicon-ruined-mark-v2.png        — favicon / app icon
//   public/apple-touch-icon-ruined-mark-v2.png — iOS home-screen icon
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

const markPaths = `
  <path d="M283.824,342.559c-.246.323-.816.154-1.309-.2-9.068-6.559-9.484-7.76-21.169-15.381-2.756-1.801-8.529-4.942-11.424-6.466-2.079-1.093-8.391-4.126-8.391-4.126-9.915-3.649-29.961-12.609-37.735-18.66l-14.595-11.331-14.087-9.361c-11.27-8.206-13.164-10.284-26.466-9.114-14.819,1.303-17.675,13.514-17.402,26.401.656,30.901,7.102,58.305,19.126,86.713,2.079,4.865,5.188,5.958-6.836,14.58-.539.385-4.988,3.634-6.051,4.111-5.82,2.675-5.687-14.883-6.221-18.079-1.451-8.69-3.313-17.305-5.208-25.907-3.717-16.874-7.642-33.782-9.023-51.047-1.843-23.045.895-46.162,4.975-68.828,1.609-8.941,3.254-17.907,5.101-26.802.876-4.217,1.834-8.427,3.03-12.566.545-1.886,7.931-37.271,9.979-58.749.816-8.468-.724-9.561,1.37-19.753,1.078-5.265,2.294-9.73,3.449-15.103,1.139-5.358,2.91-10.1,4.788-15.196,3.68-10.038,9.053-18.845,15.827-26.635l5.758-6.589c5.188-5.974,11.254-11.101,18.383-14.149,8.206-3.495,21.647-12.271,29.298-17.013l7.698-3.987,4.188-1.801c4.157-1.771,7.836-4.203,11.532-6.99,3.787-2.848,7.098-6.035,9.407-10.515.477-.893-1.694,41.107-2.402,49.113-.985,6.143-2.279,11.947-4.218,17.782-1.17,3.495-2.802,6.62-4.603,9.761-3.064,5.373-5.219,10.823-7.544,16.566-3.541,8.776-8.791,15.827-14.78,22.586-14.688,16.597-22.309,19.63-30.407,27.405l-20.43,16.843c-7.298,6.312-12.779,12.117-17.105,18.722-1.586,3.603-3.156,7.328-4.942,11.008-3.403,6.99-8.298,39.506-10.361,47.389l12.748-11.562,6.959-5.142c.277-.215.616-.462,1.016-.724,4.049-5.065,7.421-10.639,9.776-16.674,3.708-9.499,9.609-18.156,17.265-24.908,7.83-6.905,17.705-10.568,27.413-13.968,9.587-3.358,18.538-6.969,27.159-12.392,3.849-2.433,6.851-5.389,9.715-9.13.862,0,1.016,1.386.754,2.171-.945,2.82-2.093,5.638-2.897,8.495-1.527,5.424-4.281,10.358-6.479,15.516-2.261,5.308-4.075,10.867-7.067,15.833-2.905,4.837-7.751,8.196-11.585,12.206-4.165,4.356-8.474,8.612-13.34,12.189-5.75,4.227-12.041,7.105-19.064,8.381-6.995,1.271-14.244,1.958-20.935,4.544-5.296,3.403-12.086,8.791-17.305,13.672-.062.077-.139.139-.216.2-2.094,1.971-3.911,3.849-5.265,5.481-5.004,5.974-8.653,16.274-10.639,24.264,12.024-5.081,24.264-4.157,37.304-1.262l8.406,1.093,13.872,3.018,22.232,5.835c8.899,2.34,16.828,6.559,24.449,12.04,7.837,5.65,14.364,12.117,20.138,20.323l18.383,26.081,5.866,8.422c.323.446.339,1.124.139,1.37Z"/>
  <path d="M148.288,236.651c-.061.077-.122.168-.184.245l-.031-.046c.077-.061.153-.122.214-.199Z"/>
  <path d="M96.251,201.786c-3.321-3.461-5.926-7.542-7.665-12.013-4.373-11.25-4.449-16.825-9.798-26.513-5.573-10.092-11.063-21.599-19.535-29.327-5.17-4.715-14.677-13.386-20.869-16.497-8.966-4.504-16.316-8.112-24.978-13.148L0,93.408c3.306,6.681,5.551,12.32,7.64,19.169,5.855,19.199,6.309,39.46,17.343,56.418,9.383,14.421,31.199,31.917,47.439,36.299,16.948,4.574,22.893,12.615,28.807,18.327l2.385-12.492c.121-.878-.097-1.766-.61-2.49l-6.753-6.854Z"/>`;

// ── App icon (square) ───────────────────────────────────────────────
const iconSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="${INK}"/>
  <g fill="${BONE}" transform="translate(94.3 25.6) scale(1.152)">${markPaths}</g>
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
  await sharp(Buffer.from(iconSvg(512))).png().toFile(join(pub, "favicon-ruined-mark-v2.png"));
  await sharp(Buffer.from(iconSvg(180))).png().toFile(join(pub, "apple-touch-icon-ruined-mark-v2.png"));
  console.log("icons        -> public/favicon-ruined-mark-v2.png, public/apple-touch-icon-ruined-mark-v2.png");

  if (process.argv.includes("--icons-only")) return;

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
