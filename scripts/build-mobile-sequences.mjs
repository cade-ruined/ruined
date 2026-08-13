// Build the compact frame set used by the mobile walk. Desktop frames remain
// the canonical source, while mobile only ships the intermediate samples that
// can actually appear during each transition. Arrival endpoints continue to
// use the canonical desktop assets so the scene handoff stays pixel-identical.
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const SEQUENCE_ROOT = path.join(REPO_ROOT, "public", "sequences");
const MOBILE_ROOT = path.join(SEQUENCE_ROOT, "mobile");
const SEQUENCE_CONFIG_FILE = path.join(
  REPO_ROOT,
  "src",
  "data",
  "sequence-config.json"
);
const MOBILE_CONFIG_FILE = path.join(
  REPO_ROOT,
  "src",
  "data",
  "mobile-sequence-config.json"
);
const PAD = 4;
const CENTER_FOCAL_X = 0.5;
const LOBBY_FOCAL_X = 847.5 / 1600;

const sequenceConfig = JSON.parse(
  await fs.readFile(SEQUENCE_CONFIG_FILE, "utf8")
);
const mobileConfig = JSON.parse(
  await fs.readFile(MOBILE_CONFIG_FILE, "utf8")
);

function sampleFrameNumbers(frameCount) {
  return Array.from({ length: mobileConfig.sampleCount }, (_, index) =>
    Math.ceil(
      (index * (frameCount - 1)) / (mobileConfig.sampleCount - 1)
    ) + 1
  );
}

function frameName(frameNumber) {
  return `frame-${String(frameNumber).padStart(PAD, "0")}.webp`;
}

function frameFocalX(roomId, frameNumber, frameCount) {
  if (roomId === "lobby") return LOBBY_FOCAL_X;
  if (roomId === "store") {
    const progress = Math.min(1, Math.max(0, (frameNumber - 1) / Math.max(1, frameCount - 1)));
    return LOBBY_FOCAL_X + (CENTER_FOCAL_X - LOBBY_FOCAL_X) * progress;
  }
  return CENTER_FOCAL_X;
}

async function portraitCrop(input, room, frameNumber) {
  const image = sharp(input);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read dimensions for ${input}`);
  }
  const targetRatio = mobileConfig.width / mobileConfig.height;
  const cropWidth = Math.min(metadata.width, Math.round(metadata.height * targetRatio));
  const focalX = frameFocalX(room.id, frameNumber, room.frameCount);
  const left = Math.min(
    metadata.width - cropWidth,
    Math.max(0, Math.round(metadata.width * focalX - cropWidth / 2))
  );
  return image.extract({ left, top: 0, width: cropWidth, height: metadata.height });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function replaceMobileRoot(stagingDirectory) {
  const backup = path.join(
    SEQUENCE_ROOT,
    `.mobile-previous-${process.pid}-${Date.now()}`
  );
  const hadCurrent = await exists(MOBILE_ROOT);

  if (hadCurrent) await fs.rename(MOBILE_ROOT, backup);
  try {
    await fs.rename(stagingDirectory, MOBILE_ROOT);
  } catch (error) {
    if (hadCurrent) await fs.rename(backup, MOBILE_ROOT);
    throw error;
  }

  if (hadCurrent) await fs.rm(backup, { recursive: true, force: true });
}

async function main() {
  if (
    !Number.isInteger(mobileConfig.sampleCount) ||
    mobileConfig.sampleCount < 3 ||
    !Number.isInteger(mobileConfig.width) ||
    mobileConfig.width < 1 ||
    !Number.isInteger(mobileConfig.height) ||
    mobileConfig.height < 1 ||
    !Number.isInteger(mobileConfig.quality) ||
    mobileConfig.quality < 1 ||
    mobileConfig.quality > 100
  ) {
    throw new Error("mobile-sequence-config.json contains invalid values");
  }

  await fs.mkdir(SEQUENCE_ROOT, { recursive: true });
  const staging = await fs.mkdtemp(
    path.join(SEQUENCE_ROOT, ".mobile-staging-")
  );
  let committed = false;
  let outputCount = 0;

  try {
    for (const room of sequenceConfig.rooms) {
      const outputDirectory = path.join(staging, room.id);
      await fs.mkdir(outputDirectory, { recursive: true });
      const intermediateFrames = sampleFrameNumbers(room.frameCount).slice(1, -1);

      for (const frameNumber of intermediateFrames) {
        const name = frameName(frameNumber);
        const input = path.join(SEQUENCE_ROOT, room.id, name);
        const output = path.join(outputDirectory, name);
        const portrait = await portraitCrop(input, room, frameNumber);
        await portrait
          .resize(mobileConfig.width, mobileConfig.height, { fit: "fill", kernel: "lanczos3" })
          .webp({
            quality: mobileConfig.quality,
            effort: 6,
            smartSubsample: true,
          })
          .toFile(output);
        outputCount += 1;
      }
    }

    await replaceMobileRoot(staging);
    committed = true;
  } finally {
    if (!committed) await fs.rm(staging, { recursive: true, force: true });
  }

  console.log(
    `Built ${outputCount} mobile transition frames at ${mobileConfig.width}x${mobileConfig.height}, q${mobileConfig.quality}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
