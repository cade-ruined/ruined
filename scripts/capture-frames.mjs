// Render the real /dive 3D scene to an offline frame sequence.
//
// We drive the actual running scene (not a re-implementation): a headless
// Chromium loads /dive?capture, which hands us window.__ruinedSetProgress and
// snaps the camera exactly onto the spline (no easing/breathing). We step
// progress 0→1, screenshot the canvas each step, and write a manifest the
// /sequence player reads back.
//
// Prereqs: dev server running on localhost:3000, `npm i -D puppeteer`.
// Usage: node scripts/capture-frames.mjs [frames] [width] [height]
import puppeteer from "puppeteer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public", "frames");

const FRAMES = Number(process.argv[2] || 120);
const WIDTH = Number(process.argv[3] || 1280);
const HEIGHT = Number(process.argv[4] || 720);
const URL = "http://localhost:3000/dive?capture";
const PAD = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--hide-scrollbars",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    page.on("console", (m) => {
      const t = m.text();
      if (t.toLowerCase().includes("error")) console.log("  [page]", t);
    });

    console.log(`Loading ${URL} …`);
    await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });

    // Wait until every texture is loaded and the progress hook is installed.
    await page.waitForFunction(
      () => window.__ruinedReady === true && typeof window.__ruinedSetProgress === "function",
      { timeout: 60000 }
    );

    // Hide the global brand mark / bottom menu so only the canvas is captured.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      for (const el of Array.from(document.body.children)) {
        if (!el.contains(canvas)) el.style.display = "none";
      }
    });

    const canvas = await page.$("canvas");
    if (!canvas) throw new Error("no canvas found");

    console.log(`Rendering ${FRAMES} frames at ${WIDTH}×${HEIGHT} …`);
    for (let i = 0; i < FRAMES; i++) {
      const p = FRAMES === 1 ? 0 : i / (FRAMES - 1);
      await page.evaluate((pp) => window.__ruinedSetProgress(pp), p);
      // Let the rig reposition + the scene (incl. post-fx) render a couple frames.
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
          )
      );
      await sleep(40);

      const name = `frame-${String(i + 1).padStart(PAD, "0")}.jpg`;
      await canvas.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 82 });
      if ((i + 1) % 10 === 0 || i === FRAMES - 1) {
        process.stdout.write(`\r  ${i + 1}/${FRAMES}`);
      }
    }
    process.stdout.write("\n");

    const manifest = { count: FRAMES, pad: PAD, ext: "jpg", width: WIDTH, height: HEIGHT };
    await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log("Wrote manifest.json");
  } finally {
    await browser.close();
  }
}

main().then(
  () => {
    console.log("Done. Open /sequence to play it back.");
    process.exit(0);
  },
  (e) => {
    console.error("Capture failed:", e.message);
    process.exit(1);
  }
);
