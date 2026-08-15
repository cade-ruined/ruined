// Build portrait-only versions of the popup frames that can actually appear.
// Desktop remains the canonical source; this keeps mobile decoded-image memory
// low without changing the timing or crop of the paper animation.
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const POPUP_ROOT = path.join(REPO_ROOT, "public", "sequences", "popup");
const OUTPUT_ROOT = path.join(POPUP_ROOT, "mobile");
const LOCK_SOURCE = path.join(POPUP_ROOT, "note-lock.png");
const LOCK_OUTPUT = path.join(POPUP_ROOT, "note-lock.webp");
const WIDTH = 608;
const HEIGHT = 1080;
const QUALITY = 84;
const OPEN_FRAME = 31;
const CLOSE_START_FRAME = 114;
const FRAME_COUNT = 129;

const usedFrames = [
  ...Array.from({ length: OPEN_FRAME + 1 }, (_, index) => index),
  ...Array.from(
    { length: FRAME_COUNT - CLOSE_START_FRAME },
    (_, index) => CLOSE_START_FRAME + index
  ),
];

function frameName(index) {
  return index === OPEN_FRAME
    ? "open-frame-lossless.webp"
    : `frame-${String(index + 1).padStart(4, "0")}.webp`;
}

async function outputIsCurrent(source, output) {
  try {
    const [sourceStat, outputStat, metadata] = await Promise.all([
      fs.stat(source),
      fs.stat(output),
      sharp(output).metadata(),
    ]);
    return (
      outputStat.mtimeMs >= sourceStat.mtimeMs &&
      metadata.width === WIDTH &&
      metadata.height === HEIGHT &&
      metadata.format === "webp"
    );
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function buildFrame(index) {
  const name = frameName(index);
  const source = path.join(POPUP_ROOT, name);
  const output = path.join(OUTPUT_ROOT, name);
  if (await outputIsCurrent(source, output)) return false;

  await sharp(source)
    .resize(WIDTH, HEIGHT, {
      fit: "cover",
      position: "centre",
      kernel: "lanczos3",
    })
    .webp({ quality: QUALITY, effort: 6, smartSubsample: true })
    .toFile(output);
  return true;
}

async function buildLockImage() {
  try {
    const [sourceStat, outputStat, metadata] = await Promise.all([
      fs.stat(LOCK_SOURCE),
      fs.stat(LOCK_OUTPUT),
      sharp(LOCK_OUTPUT).metadata(),
    ]);
    if (
      outputStat.mtimeMs >= sourceStat.mtimeMs &&
      metadata.width === 1122 &&
      metadata.height === 1402 &&
      metadata.format === "webp"
    ) {
      return false;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await sharp(LOCK_SOURCE)
    .webp({
      quality: 92,
      alphaQuality: 100,
      smartSubsample: true,
      effort: 6,
    })
    .toFile(LOCK_OUTPUT);
  return true;
}

async function main() {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  let built = 0;
  for (const index of usedFrames) {
    if (await buildFrame(index)) built += 1;
  }
  const builtLock = await buildLockImage();
  console.log(
    `Popup mobile frames ready: ${usedFrames.length} at ${WIDTH}x${HEIGHT} (${built} rebuilt); lock ${builtLock ? "rebuilt" : "ready"}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
