// Scan public/sequences/<room>/ for uploaded frame sequences and write a
// manifest the homepage reads back. Run after adding/replacing frames:
//
//   npm run sequences
//
// Room order + ids come from src/data/sequences.ts (kept in sync manually — a
// tiny hardcoded list here avoids importing TS from a plain node script).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "public", "sequences");

// Keep in sync with src/data/sequences.ts
const ROOM_IDS = ["lobby", "store", "records", "lounge"];
const IMG = /\.(jpe?g|png|webp|avif)$/i;

// Natural sort so frame-2 < frame-10 (not string order).
const natural = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

async function listFrames(id) {
  const dir = path.join(ROOT, id);
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((f) => IMG.test(f)).sort(natural).map((f) => `/sequences/${id}/${f}`);
}

async function main() {
  const rooms = [];
  let total = 0;
  for (const id of ROOM_IDS) {
    const files = await listFrames(id);
    rooms.push({ id, count: files.length, files });
    total += files.length;
    console.log(`  ${id}: ${files.length} frames`);
  }

  const manifest = { rooms, total };
  await fs.writeFile(path.join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote manifest.json (${total} frames total).`);
  if (total === 0) {
    console.log("No frames found yet — drop images into public/sequences/<room>/ and re-run.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
