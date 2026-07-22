// Convert one room's raw render masters into the exact canonical sequence.
// Conversion happens in a clean staging directory, then replaces the room in
// one swap so frames from an older render can never survive at the tail.
//
// Usage: node scripts/convert-sequence.mjs <room> [width] [height] [quality]
//        --source=<directory> [--delete-source]
//   e.g. node scripts/convert-sequence.mjs lobby 1600 900 80 \
//          --source=sequence-masters/lobby
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const SEQUENCE_ROOT = path.join(REPO_ROOT, "public", "sequences");
const CANONICAL_ROOMS = new Set(["lobby", "store", "records", "lounge"]);
const EXPECTED_COUNT = 192;
const PAD = 4;
const RAW = /\.(tiff?|png|bmp|jpe?g)$/i;
const natural = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const room = process.argv[2];
const WIDTH = Number(process.argv[3] || 1600);
const HEIGHT = Number(process.argv[4] || 900);
const QUALITY = Number(process.argv[5] || 80);
const DELETE_SOURCE = process.argv.includes("--delete-source");
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));

const failUsage = (message) => {
  console.error(message);
  console.error(
    "Usage: node scripts/convert-sequence.mjs <room> [width] [height] [quality] --source=<directory> [--delete-source]"
  );
  process.exit(1);
};

if (!room || !CANONICAL_ROOMS.has(room)) {
  failUsage(`Room must be one of: ${[...CANONICAL_ROOMS].join(", ")}`);
}
if (!sourceArg || !sourceArg.slice("--source=".length)) {
  failUsage("A render-master directory is required via --source=.");
}
if (
  !Number.isInteger(WIDTH) ||
  WIDTH <= 0 ||
  !Number.isInteger(HEIGHT) ||
  HEIGHT <= 0 ||
  !Number.isInteger(QUALITY) ||
  QUALITY < 1 ||
  QUALITY > 100
) {
  failUsage("Width and height must be positive integers; quality must be 1-100.");
}

const DIR = path.join(SEQUENCE_ROOT, room);
const INPUT_DIR = path.resolve(REPO_ROOT, sourceArg.slice("--source=".length));
const sourceRelativeToPublic = path.relative(SEQUENCE_ROOT, INPUT_DIR);
if (
  sourceRelativeToPublic === "" ||
  (!sourceRelativeToPublic.startsWith("..") &&
    !path.isAbsolute(sourceRelativeToPublic))
) {
  failUsage("Render masters must live outside public/sequences/.");
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

async function replaceRoom(stagingDirectory) {
  const backup = path.join(
    SEQUENCE_ROOT,
    `.${room}-previous-${process.pid}-${Date.now()}`
  );
  const hadCurrentRoom = await exists(DIR);

  if (hadCurrentRoom) await fs.rename(DIR, backup);
  try {
    await fs.rename(stagingDirectory, DIR);
  } catch (error) {
    if (hadCurrentRoom) await fs.rename(backup, DIR);
    throw error;
  }

  if (hadCurrentRoom) {
    await fs.rm(backup, { recursive: true, force: true });
  }
}

async function main() {
  const entries = (await fs.readdir(INPUT_DIR))
    .filter((file) => RAW.test(file))
    .sort(natural);

  if (entries.length !== EXPECTED_COUNT) {
    throw new Error(
      `${room} conversion requires exactly ${EXPECTED_COUNT} raw frames; found ${entries.length}. The current approved sequence was not changed.`
    );
  }

  await fs.mkdir(SEQUENCE_ROOT, { recursive: true });
  const staging = await fs.mkdtemp(
    path.join(SEQUENCE_ROOT, `.${room}-staging-`)
  );
  let committed = false;

  try {
    console.log(
      `Converting ${entries.length} ${room} frames -> ${WIDTH}x${HEIGHT} WebP q${QUALITY} ...`
    );
    await fs.writeFile(path.join(staging, ".gitkeep"), "");

    for (const [index, name] of entries.entries()) {
      const output = path.join(
        staging,
        `frame-${String(index + 1).padStart(PAD, "0")}.webp`
      );
      await sharp(path.join(INPUT_DIR, name))
        .resize(WIDTH, HEIGHT, { fit: "cover" })
        .webp({ quality: QUALITY })
        .toFile(output);
      if ((index + 1) % 20 === 0 || index + 1 === entries.length) {
        process.stdout.write(`\r  ${index + 1}/${entries.length}`);
      }
    }
    process.stdout.write("\n");

    await replaceRoom(staging);
    committed = true;
  } finally {
    if (!committed) {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  if (DELETE_SOURCE) {
    for (const name of entries) {
      await fs.rm(path.join(INPUT_DIR, name), { force: true });
    }
    console.log(`Done. Replaced ${room} and removed ${entries.length} source frames.`);
  } else {
    console.log(`Done. Replaced ${room}; source masters remain in ${INPUT_DIR}.`);
  }
  console.log("Run `npm run sequences` to validate and version the new sequence.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
