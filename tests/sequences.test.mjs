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

  const mobileFile = path.join(
    sequenceRoot,
    "fireside",
    "fire-stream-loop-mobile.mp4"
  );
  const mobileStat = await fs.stat(mobileFile);
  assert.ok(mobileStat.size > 0);
  assert.ok(
    mobileStat.size < 5 * 1024 * 1024,
    "mobile fireside video exceeds 5 MB"
  );
});

test("mobile stage combines canonical arrivals with in-place walk frames", async () => {
  const [journey, walk, mobileData, header, indexes, homePage] = await Promise.all([
    fs.readFile(
      path.join(root, "src", "components", "MobileImmersiveJourney.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(
        root,
        "src",
        "components",
        "sequence",
        "MobileWalkTransition.tsx"
      ),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "data", "mobileJourney.ts"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "SiteHeader.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"),
      "utf8"
    ),
    fs.readFile(path.join(root, "app", "page.tsx"), "utf8"),
  ]);

  assert.doesNotMatch(journey, /-portrait\.(?:avif|jpe?g|webp)/);
  assert.match(journey, /MOBILE_ARRIVAL_FRAME_PATHS/);
  for (const frame of [
    "/sequences/lobby/frame-0001.webp",
    "/sequences/store/frame-0001.webp",
    "/sequences/records/frame-0001.webp",
    "/sequences/lounge/frame-0001.webp",
    "/sequences/lounge/frame-0192.webp",
  ]) {
    assert.match(mobileData, new RegExp(frame.replaceAll("/", "\\/")));
  }
  assert.match(journey, /MobileWalkTransition/);
  assert.match(walk, /TRANSITION_FRAME_STRIDE = 16/);
  assert.match(walk, /MOBILE_WALK_TRANSITIONS/);
  assert.match(walk, /index === TRANSITION_FRAME_NUMBERS\.length - 1/);
  assert.match(walk, /data-walking/);
  assert.match(walk, /MobileWalkTransitionHandle/);
  assert.doesNotMatch(walk, /IntersectionObserver|window\.scrollY/);
  assert.match(journey, /data-mobile-stage/);
  assert.match(journey, /data-active-scene/);
  assert.match(journey, /touch-action: pan-x pinch-zoom/);
  assert.match(journey, /ruined-mobile-stage-active/);
  assert.match(journey, /onPointerDown/);
  assert.match(journey, /fire-stream-loop-mobile\.mp4/);
  assert.match(journey, /JourneyStoreIndex/);
  assert.match(journey, /JourneyWorkIndex/);
  assert.match(journey, /JourneyAboutIndex/);
  assert.match(journey, /JourneyEventsIndex/);
  assert.match(journey, /roomSelections/);
  assert.match(homePage, /MobileImmersiveJourney products=\{products\}/);
  assert.match(indexes, /products\.slice\(0, 3\)/);
  assert.match(indexes, /projects\.slice\(0, 3\)/);
  assert.match(indexes, /events\.slice\(0, 3\)/);
  assert.match(indexes, /href=\{`\/events#\$\{event\.id\}`\}/);
  assert.match(journey, /setSettledIndex\(index\)/);
  assert.match(journey, /settledIndex === activeIndex/);
  assert.match(journey, /muted[\s\S]*loop[\s\S]*playsInline/);
  assert.match(journey, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(journey, /scroll-snap|data-mobile-snap-scene/);
  assert.match(header, /ruined:home-scene-request/);
  assert.match(header, /ruined:home-scene-change/);
  for (const room of ["lobby", "store", "records", "lounge"]) {
    assert.match(mobileData, new RegExp(`"${room}"`));
  }
  assert.match(
    mobileData,
    /startFrame: MOBILE_ARRIVAL_FRAME_PATHS\[index\]/
  );
  assert.match(
    mobileData,
    /endFrame: MOBILE_ARRIVAL_FRAME_PATHS\[index \+ 1\]/
  );
});

test("desktop journey retries a transient sequence bootstrap failure", async () => {
  const immersive = await fs.readFile(
    path.join(root, "src", "components", "ImmersiveParallax.tsx"),
    "utf8"
  );

  assert.match(immersive, /DESKTOP_JOURNEY_RETRY_BASE_MS/);
  assert.match(immersive, /DESKTOP_JOURNEY_RETRY_MAX_MS/);
  assert.match(
    immersive,
    /setDesktopLoadAttempt\(\(attempt\) => attempt \+ 1\)/
  );
  assert.match(immersive, /window\.clearTimeout\(retryTimer\)/);
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
