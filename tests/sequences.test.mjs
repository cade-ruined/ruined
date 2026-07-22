import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const sequenceRoot = path.join(root, "public", "sequences");
const execFileAsync = promisify(execFile);

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
  assert.match(manifest.version, /^[a-f0-9]{12}$/);
  assert.equal(
    manifest.rooms[0]?.files[0],
    "/sequences/lobby/frame-0001.webp",
    "desktop bootstrap must match the first lobby frame"
  );
  assert.equal(
    manifest.total,
    manifest.rooms.reduce((sum, room) => sum + room.count, 0)
  );
  assert.ok(manifest.total > 0);

  const versionHash = createHash("sha256");
  for (const room of manifest.rooms) {
    assert.equal(room.count, 192, `${room.id} must keep its approved frame count`);
    assert.equal(room.count, room.files.length);
    for (const [index, file] of room.files.entries()) {
      assert.equal(
        file,
        `/sequences/${room.id}/frame-${String(index + 1).padStart(4, "0")}.webp`
      );
      const bytes = await fs.readFile(path.join(root, "public", file.slice(1)));
      versionHash.update(file);
      versionHash.update("\0");
      versionHash.update(bytes);
    }
  }

  assert.equal(manifest.version, versionHash.digest("hex").slice(0, 12));
  const generatedVersion = await fs.readFile(
    path.join(root, "src", "data", "sequence-version.ts"),
    "utf8"
  );
  assert.match(
    generatedVersion,
    new RegExp(`SEQUENCE_CACHE_VERSION = "${manifest.version}"`)
  );
});

test("obsolete sequence generators and assets stay retired", async () => {
  for (const retired of [
    "app/sequence",
    "public/frames",
    "sequence-sources",
    "scripts/capture-frames.mjs",
    "scripts/gen-push-frames.mjs",
    "src/components/sequence/FrameSequence.tsx",
    "public/ruined-hero-1-portrait.avif",
    "public/ruined-hero-1-portrait.jpg",
    "public/ruined-hero-1-portrait.webp",
    "public/ruined-hero-store-4-portrait.avif",
    "public/ruined-hero-store-4-portrait.jpg",
    "public/ruined-hero-store-4-portrait.webp",
    "public/ruined-hero-records-portrait.avif",
    "public/ruined-hero-records-portrait.jpg",
    "public/ruined-hero-records-portrait.webp",
    "public/ruined-hero-lounge-portrait.avif",
    "public/ruined-hero-lounge-portrait.jpg",
    "public/ruined-hero-lounge-portrait.webp",
  ]) {
    await assert.rejects(
      fs.access(path.join(root, retired)),
      undefined,
      `${retired} must not return to the deployable sequence pipeline`
    );
  }
});

test("converter rejects a partial render without changing approved frames", async () => {
  const source = await fs.mkdtemp(
    path.join(os.tmpdir(), "ruined-partial-sequence-")
  );
  const approvedFrame = path.join(
    sequenceRoot,
    "lobby",
    "frame-0001.webp"
  );
  const before = await fs.readFile(approvedFrame);

  try {
    await sharp({
      create: {
        width: 16,
        height: 9,
        channels: 3,
        background: "#000000",
      },
    })
      .png()
      .toFile(path.join(source, "render-0001.png"));

    let error;
    try {
      await execFileAsync(process.execPath, [
        path.join(root, "scripts", "convert-sequence.mjs"),
        "lobby",
        "16",
        "9",
        "70",
        `--source=${source}`,
      ]);
    } catch (caught) {
      error = caught;
    }

    assert.ok(error, "partial conversion should fail");
    assert.match(
      `${error.stdout ?? ""}${error.stderr ?? ""}`,
      /requires exactly 192 raw frames; found 1/
    );
    assert.deepEqual(await fs.readFile(approvedFrame), before);
  } finally {
    await fs.rm(source, { recursive: true, force: true });
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

test("mobile feed uses only versioned canonical arrival frames", async () => {
  const journey = await fs.readFile(
    path.join(root, "src", "components", "MobileImmersiveJourney.tsx"),
    "utf8"
  );

  assert.doesNotMatch(journey, /-portrait\.(?:avif|jpe?g|webp)/);
  assert.match(journey, /versionSequenceAsset/);
  for (const frame of [
    "/sequences/lobby/frame-0001.webp",
    "/sequences/lobby/frame-0192.webp",
    "/sequences/store/frame-0192.webp",
    "/sequences/records/frame-0192.webp",
    "/sequences/lounge/frame-0192.webp",
  ]) {
    assert.match(journey, new RegExp(frame.replaceAll("/", "\\/")));
  }
  await assert.rejects(
    fs.access(
      path.join(
        root,
        "src",
        "components",
        "sequence",
        "MobileSequenceCanvas.tsx"
      )
    ),
    undefined,
    "mobile feed must not reintroduce a scroll-scrub canvas"
  );
});

test("production route boundaries and metadata files exist", async () => {
  for (const file of [
    "app/error.tsx",
    "app/global-error.tsx",
    "app/loading.tsx",
    "app/not-found.tsx",
    "app/events/page.tsx",
    "app/robots.ts",
    "app/sitemap.ts",
    "src/data/events.ts",
  ]) {
    await fs.access(path.join(root, file));
  }
});
