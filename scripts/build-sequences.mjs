// Scan public/sequences/<room>/ for uploaded frame sequences and write a
// manifest the homepage reads back. Run after adding/replacing frames:
//
//   npm run sequences
//
// Room order and approved frame counts come from the shared sequence config.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "public", "sequences");
const VERSION_FILE = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "sequence-version.ts"
);
const CONFIG_FILE = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "sequence-config.json"
);
const MOBILE_CONFIG_FILE = path.join(
  __dirname,
  "..",
  "src",
  "data",
  "mobile-sequence-config.json"
);

const IMG = /\.(jpe?g|png|webp|avif)$/i;
const FRAME = /^frame-(\d{4})\.webp$/;

// Natural sort so frame-2 < frame-10 (not string order).
const natural = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

async function readSequenceConfig() {
  const config = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
  if (!Array.isArray(config.rooms) || config.rooms.length === 0) {
    throw new Error("sequence-config.json must define at least one room");
  }
  if (
    !config.desktop ||
    !Number.isInteger(config.desktop.width) ||
    config.desktop.width < 1 ||
    !Number.isInteger(config.desktop.height) ||
    config.desktop.height < 1 ||
    !Number.isInteger(config.desktop.quality) ||
    config.desktop.quality < 1 ||
    config.desktop.quality > 100 ||
    !Number.isInteger(config.desktop.maxTotalBytes) ||
    config.desktop.maxTotalBytes < 1 ||
    !Number.isInteger(config.desktop.maxFrameBytes) ||
    config.desktop.maxFrameBytes < 1
  ) {
    throw new Error("sequence-config.json contains an invalid desktop budget");
  }
  const rooms = config.rooms.map((room) => {
    if (
      !room ||
      typeof room.id !== "string" ||
      !Number.isInteger(room.frameCount) ||
      room.frameCount < 2
    ) {
      throw new Error("Every sequence room needs an id and frameCount >= 2");
    }
    return room;
  });
  return { desktop: config.desktop, rooms };
}

async function readMobileConfig() {
  const config = JSON.parse(await fs.readFile(MOBILE_CONFIG_FILE, "utf8"));
  if (
    !Number.isInteger(config.sampleCount) ||
    config.sampleCount < 3 ||
    !Number.isInteger(config.width) ||
    config.width < 1 ||
    !Number.isInteger(config.height) ||
    config.height < 1 ||
    !Number.isInteger(config.quality) ||
    config.quality < 1 ||
    config.quality > 100 ||
    !Number.isInteger(config.maxTotalBytes) ||
    config.maxTotalBytes < 1 ||
    !Number.isInteger(config.maxFrameBytes) ||
    config.maxFrameBytes < 1
  ) {
    throw new Error("mobile-sequence-config.json contains invalid values");
  }
  return config;
}

function sampleFrameNumbers(frameCount, sampleCount) {
  return Array.from({ length: sampleCount }, (_, index) =>
    Math.ceil((index * (frameCount - 1)) / (sampleCount - 1)) + 1
  );
}

async function listFrames({ id, frameCount }) {
  const directory = path.join(ROOT, id);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const imageNames = entries
    .filter((entry) => entry.isFile() && IMG.test(entry.name))
    .map((entry) => entry.name);
  const unexpected = imageNames.filter((name) => !FRAME.test(name));
  if (unexpected.length) {
    throw new Error(`${id} contains unexpected images: ${unexpected.join(", ")}`);
  }

  const names = imageNames.sort(natural);
  if (names.length !== frameCount) {
    throw new Error(
      `${id} must contain exactly ${frameCount} approved frames; found ${names.length}`
    );
  }
  names.forEach((name, index) => {
    const frameNumber = Number(name.match(FRAME)?.[1]);
    if (frameNumber !== index + 1) {
      throw new Error(
        `${id} frame sequence is not contiguous at ${name}; expected frame-${String(index + 1).padStart(4, "0")}.webp`
      );
    }
  });

  return names.map((name) => `/sequences/${id}/${name}`);
}

async function listMobileFrames(rooms, mobileConfig) {
  const files = [];
  for (const room of rooms) {
    const directory = path.join(ROOT, "mobile", room.id);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && IMG.test(entry.name))
      .map((entry) => entry.name)
      .sort(natural);
    const expected = sampleFrameNumbers(
      room.frameCount,
      mobileConfig.sampleCount
    )
      .slice(1, -1)
      .map((frameNumber) =>
        `frame-${String(frameNumber).padStart(4, "0")}.webp`
      )
      .sort(natural);

    if (
      names.length !== expected.length ||
      names.some((name, index) => name !== expected[index])
    ) {
      throw new Error(
        `mobile/${room.id} must contain exactly: ${expected.join(", ")}`
      );
    }
    files.push(...names.map((name) => `/sequences/mobile/${room.id}/${name}`));
  }
  return files;
}

async function contentVersion(rooms, mobileFiles, desktopConfig, mobileConfig) {
  const hash = createHash("sha256");
  const desktopFiles = rooms.flatMap((room) => room.files);
  const files = [...desktopFiles, ...mobileFiles];
  let desktopBytes = 0;
  let mobileBytes = 0;
  let largestDesktopFrame = 0;
  let largestMobileFrame = 0;
  for (const file of files) {
    const bytes = await fs.readFile(
      path.join(ROOT, file.replace(/^\/sequences\//, ""))
    );
    const isMobile = file.startsWith("/sequences/mobile/");
    const expected = isMobile ? mobileConfig : desktopConfig;
    const metadata = await sharp(bytes).metadata();
    if (
      metadata.format !== "webp" ||
      metadata.width !== expected.width ||
      metadata.height !== expected.height
    ) {
      throw new Error(
        `${file} must be a ${expected.width}x${expected.height} WebP; found ${metadata.width ?? "unknown"}x${metadata.height ?? "unknown"} ${metadata.format ?? "unknown"}.`
      );
    }
    hash.update(file);
    hash.update("\0");
    hash.update(bytes);
    if (isMobile) {
      mobileBytes += bytes.length;
      largestMobileFrame = Math.max(largestMobileFrame, bytes.length);
    } else {
      desktopBytes += bytes.length;
      largestDesktopFrame = Math.max(largestDesktopFrame, bytes.length);
    }
  }
  if (
    desktopBytes > desktopConfig.maxTotalBytes ||
    largestDesktopFrame > desktopConfig.maxFrameBytes
  ) {
    throw new Error(
      `Desktop sequence exceeds its delivery budget: ${desktopBytes} bytes total, ${largestDesktopFrame} bytes largest frame.`
    );
  }
  if (
    mobileBytes > mobileConfig.maxTotalBytes ||
    largestMobileFrame > mobileConfig.maxFrameBytes
  ) {
    throw new Error(
      `Mobile sequence exceeds its delivery budget: ${mobileBytes} bytes total, ${largestMobileFrame} bytes largest frame.`
    );
  }
  console.log(
    `  budgets: desktop ${desktopBytes}/${desktopConfig.maxTotalBytes} bytes; mobile ${mobileBytes}/${mobileConfig.maxTotalBytes} bytes`
  );
  return hash.digest("hex").slice(0, 12);
}

async function main() {
  const sequenceConfig = await readSequenceConfig();
  const roomConfig = sequenceConfig.rooms;
  const mobileConfig = await readMobileConfig();
  const rooms = [];
  let total = 0;
  for (const room of roomConfig) {
    const files = await listFrames(room);
    rooms.push({ id: room.id, count: files.length, files });
    total += files.length;
    console.log(`  ${room.id}: ${files.length} frames`);
  }

  const mobileFiles = await listMobileFrames(roomConfig, mobileConfig);
  console.log(`  mobile: ${mobileFiles.length} intermediate frames`);
  const version = await contentVersion(
    rooms,
    mobileFiles,
    sequenceConfig.desktop,
    mobileConfig
  );
  const manifest = {
    version,
    rooms,
    total,
    mobile: { ...mobileConfig, files: mobileFiles },
  };
  await fs.writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(
    VERSION_FILE,
    `// Generated by scripts/build-sequences.mjs. Do not edit manually.\nexport const SEQUENCE_CACHE_VERSION = "${version}" as const;\n`
  );
  console.log(`Wrote manifest.json (${total} frames, version ${version}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
