import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sequenceRoot = path.join(root, "public", "sequences");

test("sequence manifest is complete, ordered, and deployable", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(sequenceRoot, "manifest.json"), "utf8")
  );
  assert.deepEqual(manifest.rooms.map((room) => room.id), [
    "lobby",
    "store",
    "records",
    "lounge",
  ]);
  assert.equal(
    manifest.total,
    manifest.rooms.reduce((sum, room) => sum + room.count, 0)
  );
  assert.ok(manifest.total > 0);

  for (const room of manifest.rooms) {
    assert.equal(room.count, room.files.length);
    for (const file of room.files) {
      assert.match(file, /^\/sequences\/[a-z-]+\/.+\.(avif|jpe?g|png|webp)$/i);
      await fs.access(path.join(root, "public", file));
    }
  }
});

test("public sequences contain no render masters", async () => {
  const rooms = await fs.readdir(sequenceRoot, { withFileTypes: true });
  for (const room of rooms.filter((entry) => entry.isDirectory())) {
    const files = await fs.readdir(path.join(sequenceRoot, room.name));
    assert.equal(
      files.some((file) => /\.(tif|tiff|bmp)$/i.test(file)),
      false,
      `${room.name} contains a render master`
    );
  }
});

test("fireside loop is present and reasonably sized", async () => {
  const file = path.join(sequenceRoot, "fireside", "Fire and Stream Looping 4K.mp4");
  const stat = await fs.stat(file);
  assert.ok(stat.size > 0);
  assert.ok(stat.size < 25 * 1024 * 1024, "fireside video exceeds 25 MB");
});

test("production route boundaries and metadata files exist", async () => {
  for (const file of [
    "app/error.tsx",
    "app/global-error.tsx",
    "app/loading.tsx",
    "app/not-found.tsx",
    "app/robots.ts",
    "app/sitemap.ts",
  ]) {
    await fs.access(path.join(root, file));
  }
});
