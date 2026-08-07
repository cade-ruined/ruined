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
const sequenceConfig = JSON.parse(
  await fs.readFile(
    path.join(root, "src", "data", "sequence-config.json"),
    "utf8"
  )
);
const mobileSequenceConfig = JSON.parse(
  await fs.readFile(
    path.join(root, "src", "data", "mobile-sequence-config.json"),
    "utf8"
  )
);

function sampleFrameNumbers(frameCount, sampleCount) {
  return Array.from({ length: sampleCount }, (_, index) =>
    Math.ceil((index * (frameCount - 1)) / (sampleCount - 1)) + 1
  );
}

test("sequence manifest is complete, ordered, and deployable", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(sequenceRoot, "manifest.json"), "utf8")
  );
  assert.deepEqual(
    manifest.rooms.map((room) => room.id),
    sequenceConfig.rooms.map((room) => room.id)
  );
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
  let desktopBytes = 0;
  let largestDesktopFrame = 0;
  for (const room of manifest.rooms) {
    const approvedRoom = sequenceConfig.rooms.find(
      (candidate) => candidate.id === room.id
    );
    assert.ok(approvedRoom, `${room.id} needs an approved sequence config`);
    assert.equal(
      room.count,
      approvedRoom.frameCount,
      `${room.id} must keep its approved frame count`
    );
    assert.equal(room.count, room.files.length);
    for (const [index, file] of room.files.entries()) {
      assert.equal(
        file,
        `/sequences/${room.id}/frame-${String(index + 1).padStart(4, "0")}.webp`
      );
      const bytes = await fs.readFile(path.join(root, "public", file.slice(1)));
      desktopBytes += bytes.length;
      largestDesktopFrame = Math.max(largestDesktopFrame, bytes.length);
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, sequenceConfig.desktop.width);
      assert.equal(metadata.height, sequenceConfig.desktop.height);
      versionHash.update(file);
      versionHash.update("\0");
      versionHash.update(bytes);
    }
  }
  assert.ok(
    desktopBytes <= sequenceConfig.desktop.maxTotalBytes,
    `desktop sequence exceeds ${sequenceConfig.desktop.maxTotalBytes} bytes`
  );
  assert.ok(
    largestDesktopFrame <= sequenceConfig.desktop.maxFrameBytes,
    `desktop frame exceeds ${sequenceConfig.desktop.maxFrameBytes} bytes`
  );

  const expectedMobileFiles = sequenceConfig.rooms.flatMap((room) =>
    sampleFrameNumbers(room.frameCount, mobileSequenceConfig.sampleCount)
      .slice(1, -1)
      .map(
        (frame) =>
          `/sequences/mobile/${room.id}/frame-${String(frame).padStart(4, "0")}.webp`
      )
  );
  assert.deepEqual(manifest.mobile, {
    ...mobileSequenceConfig,
    files: expectedMobileFiles,
  });
  let mobileBytes = 0;
  let largestMobileFrame = 0;
  for (const file of expectedMobileFiles) {
    const absolutePath = path.join(root, "public", file.slice(1));
    const bytes = await fs.readFile(absolutePath);
    mobileBytes += bytes.length;
    largestMobileFrame = Math.max(largestMobileFrame, bytes.length);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, mobileSequenceConfig.width);
    assert.equal(metadata.height, mobileSequenceConfig.height);
    versionHash.update(file);
    versionHash.update("\0");
    versionHash.update(bytes);
  }
  assert.ok(
    mobileBytes <= mobileSequenceConfig.maxTotalBytes,
    `mobile sequence exceeds ${mobileSequenceConfig.maxTotalBytes} bytes`
  );
  assert.ok(
    largestMobileFrame <= mobileSequenceConfig.maxFrameBytes,
    `mobile frame exceeds ${mobileSequenceConfig.maxFrameBytes} bytes`
  );

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
    "src/components/CameraDive.tsx",
    "src/components/sequence/FrameSequence.tsx",
    "public/dive-lobby.jpg",
    "public/dive-store.jpg",
    "public/dive-records.jpg",
    "public/dive-lounge.jpg",
    "public/ruined-hero-1.avif",
    "public/ruined-hero-1.webp",
    "public/ruined-hero-store-4.avif",
    "public/ruined-hero-records.avif",
    "public/ruined-hero-records.webp",
    "public/ruined-hero-lounge.avif",
    "public/ruined-hero-lounge.webp",
    "public/new sequences",
    "public/sequences/fireside/Fire and Stream Looping 4K.mp4",
    "public/sequences/lobby/.gitkeep",
    "public/sequences/store/.gitkeep",
    "public/sequences/records/.gitkeep",
    "public/sequences/lounge/.gitkeep",
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
      /requires exactly 240 raw frames; found 1/
    );
    assert.deepEqual(await fs.readFile(approvedFrame), before);
  } finally {
    await fs.rm(source, { recursive: true, force: true });
  }
});

test("converter rejects render masters anywhere under public", async () => {
  let error;
  try {
    await execFileAsync(process.execPath, [
      path.join(root, "scripts", "convert-sequence.mjs"),
      "lobby",
      "1600",
      "900",
      "80",
      "--source=public",
    ]);
  } catch (caught) {
    error = caught;
  }

  assert.ok(error, "public render-master sources should fail");
  assert.match(
    `${error.stdout ?? ""}${error.stderr ?? ""}`,
    /Render masters must live outside public\//
  );
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

test("only the optimized fireside loop is deployable", async () => {
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
  const [
    journey,
    walk,
    mobileData,
    header,
    indexes,
    homePage,
    desktop,
    bootstrap,
  ] = await Promise.all([
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
    fs.readFile(
      path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "ImmersiveParallax.tsx"),
      "utf8"
    ),
  ]);

  assert.doesNotMatch(journey, /-portrait\.(?:avif|jpe?g|webp)/);
  assert.match(journey, /MOBILE_ARRIVAL_FRAME_PATHS/);
  assert.match(mobileData, /sequenceFramePath\("lobby", 1\)/);
  assert.match(mobileData, /sequenceFramePath\("store", 1\)/);
  assert.match(mobileData, /sequenceFramePath\("records", 1\)/);
  assert.match(mobileData, /sequenceFramePath\("lounge", 1\)/);
  assert.match(mobileData, /room\.id/);
  assert.match(mobileData, /frameCount: room\.frameCount/);
  assert.match(journey, /MobileWalkTransition/);
  assert.match(
    mobileData,
    /MOBILE_TRANSITION_SAMPLE_COUNT = mobileSequenceConfig\.sampleCount/
  );
  assert.match(
    mobileData,
    /MOBILE_TRANSITION_FRAME_WIDTH = mobileSequenceConfig\.width/
  );
  assert.match(
    mobileData,
    /MOBILE_TRANSITION_FRAME_HEIGHT = mobileSequenceConfig\.height/
  );
  assert.match(walk, /MOBILE_TRANSITION_SAMPLE_COUNT/);
  assert.match(walk, /resizeWidth: MOBILE_TRANSITION_FRAME_WIDTH/);
  assert.match(walk, /resizeHeight: MOBILE_TRANSITION_FRAME_HEIGHT/);
  assert.match(walk, /sampleFrameNumbers\(frameCount\)/);
  assert.match(walk, /segmentBounds\.length/);
  assert.match(walk, /MOBILE_WALK_TRANSITIONS/);
  assert.match(walk, /mobileSequenceFramePath\(room, frame\)/);
  assert.match(walk, /fallbackSrc: versionSequenceAsset/);
  assert.match(walk, /index === frameNumbers\.length - 1/);
  assert.match(walk, /const ready = await waitForFrames\(frameIndices\)/);
  assert.match(walk, /TRANSITION_GATE_TIMEOUT_MS = 1500/);
  assert.match(walk, /LOADING_INDICATOR_DELAY_MS = 120/);
  assert.match(walk, /FRAME_RETRY_MAX_MS = 8000/);
  assert.match(walk, /frameIndices\.some\(\(index\) => !cache\.has\(index\)\)/);
  assert.doesNotMatch(walk, /const nearest/);
  assert.match(walk, /resolveAllWaiters\(false\)/);
  assert.match(walk, /inflight\.forEach\(\(controller\) => controller\.abort\(\)\)/);
  assert.match(walk, /Preparing walk/);
  assert.match(walk, /MAX_DECODED_PIXELS = 20_000_000/);
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
  assert.match(journey, /JourneyLobbyIndex/);
  assert.match(journey, /roomSelections/);
  assert.doesNotMatch(journey, /Enter Ruined|Begin the walk/);
  assert.match(homePage, /MobileImmersiveJourney products=\{products\}/);
  assert.match(desktop, /LobbyOpeningOverlay/);
  assert.match(desktop, /<JourneyLobbyIndex/);
  assert.match(bootstrap, /ruined-desktop-sequence-bootstrap__index/);
  assert.match(bootstrap, /<JourneyLobbyIndex/);
  assert.match(indexes, /const product = products\[0\]/);
  assert.match(indexes, /const project = projects\[0\]/);
  assert.match(indexes, /const event = events\[0\]/);
  const lobbyIndex = indexes.slice(
    indexes.indexOf("export function JourneyLobbyIndex"),
    indexes.indexOf("export function JourneyStoreIndex")
  );
  assert.match(lobbyIndex, /fetchPriority="low"/);
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
  assert.match(header, /aria-expanded=\{mobileMenuOpen\}/);
  assert.match(header, /aria-controls="mobile-quick-jump"/);
  assert.match(header, /hidden=\{!mobileMenuOpen\}/);
  assert.match(header, /event\.key !== "Escape"/);
  assert.match(header, /aria-current=\{active \? "location" : undefined\}/);
  assert.doesNotMatch(header, /grid-cols-5/);
  for (const room of ["lobby", "store", "records", "lounge"]) {
    assert.ok(
      sequenceConfig.rooms.some((candidate) => candidate.id === room),
      `${room} must remain in the shared sequence config`
    );
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

test("desktop sequence bounds decode, cache, and canvas pressure", async () => {
  const [canvas, desktop] = await Promise.all([
    fs.readFile(
      path.join(root, "src", "components", "sequence", "RoomSequenceCanvas.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"),
      "utf8"
    ),
  ]);

  assert.match(canvas, /const CAP = coarsePointer \? 32 : 48/);
  assert.match(canvas, /const AHEAD = coarsePointer \? 20 : 24/);
  assert.match(canvas, /const MAX_INFLIGHT = coarsePointer \? 3 : 4/);
  assert.match(
    canvas,
    /const MAX_SPECULATIVE_INFLIGHT = MAX_INFLIGHT - 1/
  );
  assert.match(canvas, /desynchronized: true/);
  assert.match(canvas, /new Map<number, AbortController>/);
  assert.match(canvas, /const urgentInflight = new Set<number>\(\)/);
  assert.match(canvas, /const urgentQueued = new Set<number>\(\)/);
  assert.match(
    canvas,
    /inflight\.size - urgentInflight\.size >= MAX_SPECULATIVE_INFLIGHT/
  );
  assert.match(canvas, /urgentQueued\.clear\(\)/);
  assert.match(canvas, /urgentInflight\.clear\(\)/);
  assert.match(canvas, /controller\.abort\(\)/);
  assert.match(canvas, /const targetChanged = target !== previousTarget/);
  assert.match(canvas, /Math\.min\(1, window\.devicePixelRatio \|\| 1\)/);
  assert.doesNotMatch(canvas, /ctx\.clearRect/);

  const schedule = canvas.slice(
    canvas.indexOf("function schedule"),
    canvas.indexOf("const discardStaleWork")
  );
  assert.doesNotMatch(schedule, /\.abort\(/);
  assert.match(desktop, /fire-stream-loop-mobile\.mp4/);
  assert.doesNotMatch(desktop, /Fire and Stream Looping 4K\.mp4/);
  assert.match(desktop, /manifest\.total \/ BASE_SEQUENCE_FRAME_COUNT/);
});

test("homepage sequence framing shares one optical axis across renderers", async () => {
  const [
    data,
    framing,
    frameImage,
    bootstrap,
    desktop,
    desktopCanvas,
    mobile,
    mobileCanvas,
  ] = await Promise.all([
    fs.readFile(path.join(root, "src", "data", "sequences.ts"), "utf8"),
    fs.readFile(
      path.join(root, "src", "utils", "sequenceFraming.ts"),
      "utf8"
    ),
    fs.readFile(
      path.join(
        root,
        "src",
        "components",
        "sequence",
        "SequenceFrameImage.tsx"
      ),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "ImmersiveParallax.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "sequence", "RoomSequenceCanvas.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "MobileImmersiveJourney.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "sequence", "MobileWalkTransition.tsx"),
      "utf8"
    ),
  ]);

  assert.match(data, /SEQUENCE_LOBBY_FOCAL_X = 847\.5 \/ 1600/);
  assert.match(framing, /destinationWidth \/ 2 - safeFocalX \* width/);
  assert.match(framing, /roomId === "store"/);
  assert.match(frameImage, /sequenceFocalMediaStyle\(sequenceAssetFocalX\(src\)\)/);
  assert.match(bootstrap, /sequenceFocalBoxGeometry\(OPENING_FOCAL_X\)/);
  assert.match(desktop, /<SequenceFrameImage src=\{openingFrame\} priority \/>/);
  assert.match(desktopCanvas, /sequenceCoverRect\(/);
  assert.match(mobile, /<SequenceFrameImage/);
  assert.match(mobileCanvas, /sequenceCoverRect\(/);

  const focalX = 847.5 / 1600;
  for (const [width, height] of [
    [430, 932],
    [1280, 1920],
    [1440, 900],
  ]) {
    const scale = Math.max(
      width / (1600 * 2 * Math.min(focalX, 1 - focalX)),
      height / 900
    );
    const renderedWidth = 1600 * scale;
    const renderedHeight = 900 * scale;
    const x = width / 2 - focalX * renderedWidth;
    const y = (height - renderedHeight) / 2;

    assert.ok(x <= 0 && x + renderedWidth >= width);
    assert.ok(y <= 0 && y + renderedHeight >= height);
    assert.ok(Math.abs(x + focalX * renderedWidth - width / 2) < 1e-9);
  }
});

test("production route boundaries and metadata files exist", async () => {
  for (const file of [
    "app/error.tsx",
    "app/global-error.tsx",
    "app/loading.tsx",
    "app/not-found.tsx",
    "app/events/page.tsx",
    "app/foundations/page.tsx",
    "src/components/foundations/PresentationShell.tsx",
    "src/data/foundations.ts",
    "app/robots.ts",
    "app/sitemap.ts",
    "src/data/events.ts",
  ]) {
    await fs.access(path.join(root, file));
  }
});
