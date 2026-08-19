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

test("mobile popup frames keep the note animation portrait and lightweight", async () => {
  const popupRoot = path.join(sequenceRoot, "popup", "mobile");
  const files = (await fs.readdir(popupRoot)).sort();
  assert.equal(files.length, 47);
  assert.ok(files.includes("open-frame-lossless.webp"));
  assert.ok(files.includes("frame-0001.webp"));
  assert.ok(files.includes("frame-0129.webp"));

  let totalBytes = 0;
  for (const file of files) {
    const absolute = path.join(popupRoot, file);
    const [stat, metadata] = await Promise.all([
      fs.stat(absolute),
      sharp(absolute).metadata(),
    ]);
    totalBytes += stat.size;
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 608);
    assert.equal(metadata.height, 1080);
  }
  assert.ok(totalBytes < 2 * 1024 * 1024, "mobile popup frames exceed 2 MB");
});

test("responsive journey has no tablet or hybrid-input fallthrough", async () => {
  const [contract, bootstrap, journey, popup, indexes, comingSoon] =
    await Promise.all([
      fs.readFile(path.join(root, "src", "utils", "immersiveExperience.ts"), "utf8"),
      fs.readFile(path.join(root, "src", "components", "ImmersiveParallax.tsx"), "utf8"),
      fs.readFile(path.join(root, "src", "components", "MobileImmersiveJourney.tsx"), "utf8"),
      fs.readFile(path.join(root, "src", "components", "LobbyPopupSequence.tsx"), "utf8"),
      fs.readFile(path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"), "utf8"),
      fs.readFile(path.join(root, "src", "components", "sequence", "JourneyComingSoon.tsx"), "utf8"),
    ]);

  for (const pattern of [
    /min-width: 1025px/,
    /max-width: 1024px/,
    /hover: none/,
    /pointer: coarse/,
    /max-width: 1366px/,
    /any-pointer: coarse/,
    /desktop\.matches && !stage\.matches/,
  ]) assert.match(contract, pattern);
  assert.match(bootstrap, /@media \$\{DESKTOP_EXPERIENCE_QUERY\}/);
  assert.match(bootstrap, /@media \$\{MOBILE_STAGE_QUERY\}/);
  assert.match(journey, /immersiveExperienceMediaQueries/);
  assert.match(journey, /isMobileStageExperience/);
  assert.doesNotMatch(
    popup,
    /isMobileStageExperience|mobileFramesRef|framePath/
  );
  assert.match(journey, /max-width: min\(42rem, 92dvh\)/);
  assert.match(journey, /onPointerMove=\{handlePointerMove\}/);
  assert.match(journey, /onClickCapture=\{handleClickCapture\}/);
  assert.doesNotMatch(journey, /"a, button, input, select, textarea/);
  assert.match(indexes, /text-\[clamp\(0\.78rem,2\.2vw,1\.25rem\)\]/);
  assert.match(comingSoon, /text-\[clamp\(2\.25rem,6vw,3\.75rem\)\]/);
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
    eventsIndex,
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
    fs.readFile(
      path.join(root, "src", "components", "events", "EventsIndex.tsx"),
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
  assert.match(walk, /return await createImageBitmap\(blob\)/);
  assert.doesNotMatch(walk, /resizeWidth:\s*MOBILE_TRANSITION_FRAME_WIDTH/);
  assert.doesNotMatch(walk, /resizeHeight:\s*MOBILE_TRANSITION_FRAME_HEIGHT/);
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
  assert.match(journey, /<JourneyComingSoon key="store-selections" section="store"/);
  assert.match(journey, /<JourneyComingSoon key="work-selections" section="artifacts"/);
  assert.match(journey, /<JourneyAboutStatement[\s\S]*key="about-statement"[\s\S]*headingId="mobile-journey-about-statement-heading"/);
  assert.match(journey, /JourneyEventsIndex/);
  assert.match(journey, /JourneyLobbyIndex/);
  assert.match(journey, /atLobby: index === 0/);
  assert.match(journey, /roomSelections/);
  assert.doesNotMatch(journey, /Enter Ruined|Begin the walk/);
  assert.match(homePage, /<MobileImmersiveJourney \/>/);
  assert.match(desktop, /LobbyOpeningOverlay/);
  assert.match(desktop, /<JourneyLobbyIndex/);
  assert.match(desktop, /<JourneyAboutStatement headingId="desktop-journey-about-heading"/);
  assert.doesNotMatch(desktop, /kicker=/);
  assert.match(bootstrap, /ruined-desktop-sequence-bootstrap__index/);
  assert.match(bootstrap, /<JourneyLobbyIndex/);
  assert.match(indexes, /events\.find\(\(candidate\) => candidate\.status === "Upcoming"\) \?\? events\[0\]/);
  const lobbyIndex = indexes.slice(
    indexes.indexOf("export function JourneyLobbyIndex"),
    indexes.indexOf("export function JourneyStoreIndex")
  );
  assert.match(lobbyIndex, /priority=\{selection\.key === "what-is-this"\}/);
  assert.match(lobbyIndex, /fetchPriority=\{selection\.key === "what-is-this" \? "high" : "low"\}/);
  assert.match(lobbyIndex, /key: "what-is-this"/);
  assert.match(lobbyIndex, /href: "#about"/);
  assert.match(lobbyIndex, /selection\.href\?\.startsWith\("#"\)/);
  assert.match(lobbyIndex, /onClick=\{\(event\) => requestWalkRoom\(event, selection\.href!\)\}/);
  assert.match(indexes, /new CustomEvent\("ruined:home-scene-request"/);
  assert.match(indexes, /if \(!window\.dispatchEvent\(request\)\) event\.preventDefault\(\)/);
  assert.match(lobbyIndex, /image: "\/media\/what-is-this\.webp"/);
  assert.match(lobbyIndex, /key: "meet-the-cast"/);
  assert.match(lobbyIndex, /video: "\/media\/meet-the-cast\.mp4"/);
  assert.match(lobbyIndex, /href: "https:\/\/www\.instagram\.com\/theruinedproject\/"/);
  assert.match(lobbyIndex, /muted[\s\S]*loop[\s\S]*autoPlay[\s\S]*playsInline/);
  assert.match(lobbyIndex, /target=\{selection\.external \? "_blank" : undefined\}/);
  assert.match(lobbyIndex, /className="journey-card-title/);
  assert.match(indexes, /products\.slice\(0, 3\)/);
  assert.match(indexes, /projects\.slice\(0, 3\)/);
  assert.match(indexes, /events\.slice\(0, 3\)/);
  assert.match(indexes, /href=\{`\/community#\$\{event\.id\}`\}/);
  assert.match(indexes, /const nextAvailable = events\.find\(\(event\) => event\.status === "Upcoming"\)/);
  assert.match(indexes, /const isEnded = event\.status === "Ended"/);
  assert.match(indexes, /const isNextAvailable = event\.id === nextAvailable\?\.id/);
  assert.match(indexes, /data-event-dimmed=\{isDimmed \? "true" : undefined\}/);
  assert.match(indexes, /`Ended · 0\$\{index \+ 1\}`/);
  assert.match(indexes, /`Available · 0\$\{index \+ 1\}`/);
  assert.match(eventsIndex, /window\.location\.hash\.slice\(1\)/);
  assert.match(eventsIndex, /setSelectedId\(event\.id\)/);
  assert.match(eventsIndex, /window\.history\.replaceState/);
  assert.match(eventsIndex, /value=\{selected\.id\}/);
  assert.match(eventsIndex, /if \(nextEvent\) selectEvent\(nextEvent\)/);
  assert.match(eventsIndex, /aria-live="polite"/);
  assert.match(eventsIndex, /<details[\s\S]*<summary[\s\S]*Event details/);
  assert.match(eventsIndex, /\{selected\.title\}[\s\S]*<video/);
  assert.doesNotMatch(eventsIndex, /min-h-\[28rem\]/);
  assert.match(journey, /setSettledIndex\(index\)/);
  assert.match(journey, /settledIndex === activeIndex/);
  assert.match(journey, /locationFrame = requestAnimationFrame/);
  assert.match(journey, /cancelAnimationFrame\(locationFrame\)/);
  assert.match(journey, /muted[\s\S]*loop[\s\S]*playsInline/);
  assert.match(journey, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(journey, /scroll-snap|data-mobile-snap-scene/);
  assert.match(header, /ruined:home-scene-request/);
  assert.match(header, /ruined:home-scene-change/);
  assert.match(header, /aria-expanded=\{menuOpen\}/);
  assert.match(header, /aria-controls=\{MENU_ID\}/);
  assert.match(header, /role="dialog"/);
  assert.match(header, /aria-modal="true"/);
  assert.match(header, /event\.key !== "Escape"/);
  assert.match(header, /WALK_MENU_ITEMS\.map/);
  assert.match(header, /ExploreGlyph index=\{item\.glyphIndex\}/);
  assert.doesNotMatch(header, /MOBILE_DIRECT_ITEMS|ruined-mobile-nav-fab/);
  assert.match(desktop, /useDesktopJourneyScene/);
  assert.match(desktop, /roomLabelArrival\(bands\.lobby, 0\.2\)/);
  assert.match(desktop, /roomLabelArrival\(bands\.store, 0\.4\)/);
  assert.match(desktop, /roomLabelArrival\(bands\.records, 0\.6\)/);
  assert.doesNotMatch(desktop, /data-journey-room-rail/);
  assert.match(indexes, /data-journey-section-hero=\{room\.id\}/);
  assert.match(indexes, /room\.headline/);
  assert.match(indexes, /room\.description/);
  assert.match(header, /sectionLocatorForPathname/);
  assert.match(header, /data-section-breadcrumb/);
  assert.match(
    journey,
    /<h2 id=\{headingId\} className="sr-only">\{room\.headline\}<\/h2>/
  );
  assert.doesNotMatch(journey, /<JourneySectionHero/);
  assert.doesNotMatch(journey, /01 \/ Artifacts|02 \/ Project Hub|03 \/ Studio No\. 17/);
  assert.doesNotMatch(journey, /RU \/\/ AW26/);
  assert.doesNotMatch(desktop, /Lobby index · current selection/);
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
  assert.match(framing, /if \(match\[1\]\) return SEQUENCE_CENTER_FOCAL_X/);
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

test("the showroom resolves into a direct catalogue and conventional global utilities", async () => {
  const [
    header,
    desktop,
    mobile,
    indexes,
    gallery,
    purchase,
    bagStore,
    bagLink,
    bagGlyph,
    searchDialog,
    searchStyles,
    searchData,
    searchRoute,
    checkout,
    shopify,
    products,
    styles,
    navigation,
    footer,
    bootstrap,
  ] = await Promise.all([
    fs.readFile(path.join(root, "src", "components", "SiteHeader.tsx"), "utf8"),
    fs.readFile(
      path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "MobileImmersiveJourney.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "store", "StoreGallery.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "store", "ProductPurchase.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "store", "bag-store.ts"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "store", "BagLink.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "nav", "BagGlyph.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "search", "UniversalSearch.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "search", "UniversalSearch.module.css"),
      "utf8"
    ),
    fs.readFile(path.join(root, "src", "data", "search.ts"), "utf8"),
    fs.readFile(path.join(root, "app", "api", "search", "route.ts"), "utf8"),
    fs.readFile(
      path.join(root, "app", "api", "store", "checkout", "route.ts"),
      "utf8"
    ),
    fs.readFile(path.join(root, "src", "lib", "shopify.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "data", "products.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "styles", "index.css"), "utf8"),
    fs.readFile(path.join(root, "src", "data", "navigation.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "SiteFooter.tsx"), "utf8"),
    fs.readFile(
      path.join(root, "src", "components", "ImmersiveParallax.tsx"),
      "utf8"
    ),
  ]);

  assert.match(header, /WALK_MENU_ITEMS\.map/);
  assert.match(header, /ruined-header-rail/);
  assert.match(header, /ruined-header-menu-trigger/);
  assert.match(header, /ruined-header-search-trigger/);
  assert.match(header, /<UniversalSearch open=\{searchOpen\} onOpenChange=\{setSearchOpen\} \/>/);
  assert.match(header, /variant="icon"/);
  assert.match(header, /role="dialog"/);
  assert.match(header, /aria-modal="true"/);
  assert.match(header, /aria-haspopup="dialog"/);
  assert.match(header, /href=\{item\.href\}/);
  assert.match(header, /handleWalkLink\(event, item\)/);
  assert.doesNotMatch(
    header,
    /MOBILE_DIRECT_ITEMS|ruined-mobile-nav|feConvolveMatrix|navigationOpen|font-mono|monospace/
  );
  assert.match(header, /<BagLink/);
  assert.match(header, /pathname === SITE_ROUTES\.bag\.href/);
  assert.match(header, /ExploreGlyph index=\{item\.glyphIndex\}/);
  assert.match(bagLink, /data-bag-link=\{variant\}/);
  assert.match(bagLink, /data-bag-count/);
  assert.match(bagLink, /SITE_ROUTES\.bag\.href/);
  assert.match(bagLink, /<BagGlyph className="ruined-bag-glyph h-10 w-9"/);
  assert.doesNotMatch(bagLink, /CouchGlyph/);
  assert.match(bagGlyph, /<CouchGlyph index=\{1\} className=\{className\} \/>/);
  assert.doesNotMatch(bagLink, /font-mono/);
  assert.doesNotMatch(bagLink, /padStart|Bag\{.*·/s);
  assert.match(styles, /\.ruined-header-rail/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.ruined-site-menu-panel/);
  assert.match(styles, /\.ruined-site-menu-nav strong/);
  assert.match(
    styles,
    /\.ruined-site-menu-nav strong \{[^}]*font-family: var\(--font-header\);/s
  );
  assert.match(styles, /\.ruined-bag-glyph/);
  assert.match(styles, /drop-shadow\(3px 3px 0 rgb\(0 0 0 \/ 0\.62\)\)/);
  assert.doesNotMatch(
    styles,
    /ruined-mobile-nav|data-navigation-open|ruined-mobile-motion-blur|filter:\s*url\(/
  );
  const navigationStyles = styles.slice(
    styles.indexOf(".ruined-global-header"),
    styles.indexOf("/* Snap-frame")
  );
  assert.doesNotMatch(navigationStyles, /\bblur\(/);
  assert.match(searchDialog, /role="dialog"/);
  assert.match(searchDialog, /aria-modal="true"/);
  assert.match(searchDialog, /type="search"/);
  assert.match(searchDialog, /SEARCH_GROUPS\.map/);
  assert.match(searchDialog, /fetch\(`\/api\/search\?q=/);
  assert.match(searchDialog, /aria-live="polite"/);
  assert.doesNotMatch(searchDialog, /font-mono|monospace/);
  assert.match(searchStyles, /@media \(max-width: 640px\)/);
  assert.match(searchStyles, /min-height: 100dvh/);
  assert.match(searchData, /productDocuments/);
  assert.match(searchData, /PROJECT_DOCUMENTS/);
  assert.match(searchData, /EVENT_DOCUMENTS/);
  assert.match(searchData, /const PAGES/);
  assert.match(searchRoute, /getProducts\(\)/);
  assert.match(searchRoute, /searchSite\(products, query\)/);
  assert.match(navigation, /export const GLOBAL_NAV_ITEMS/);
  assert.match(navigation, /export const GLOBAL_MENU_ITEMS/);
  assert.match(navigation, /export const WALK_MENU_ITEMS = EXPLORE_ROOMS/);
  assert.match(navigation, /export const WALK_SECTION_ITEMS = EXPLORE_ROOMS\.slice\(1\)/);
  assert.match(navigation, /SITE_ROUTES\.store/);
  assert.match(navigation, /SITE_ROUTES\.work/);
  assert.match(navigation, /SITE_ROUTES\.about/);
  assert.match(navigation, /SITE_ROUTES\.events/);
  assert.match(navigation, /store: \{[^}]*glyphIndex: 1/);
  assert.match(navigation, /events: \{[^}]*glyphIndex: 4/);
  assert.doesNotMatch(
    navigation.slice(
      navigation.indexOf("export const GLOBAL_NAV_ITEMS"),
      navigation.indexOf("export const GLOBAL_MENU_ITEMS")
    ),
    /SITE_ROUTES\.home/
  );
  assert.match(navigation, /label: "Lobby"/);
  assert.match(navigation, /label: "Store"/);
  assert.match(navigation, /label: "Artifacts"/);
  assert.match(navigation, /label: "About"/);
  assert.match(navigation, /label: "Community"/);
  assert.match(navigation, /label: "Explore the Walk"/);
  assert.match(navigation, /store: \{ id: "store", label: "Store"/);
  assert.match(navigation, /href: "\/#top"/);
  assert.match(footer, /FOOTER_INDEX_ITEMS/);
  assert.match(footer, /SERVICE_NAV_ITEMS/);
  assert.match(footer, /pathname === "\/"/);
  assert.match(desktop, /WALK_SECTION_ITEMS\.map/);
  assert.doesNotMatch(desktop, /GLOBAL_NAV_ITEMS\.map/);
  for (const href of ["/#store", "/#work", "/#about", "/#events"]) {
    assert.match(searchData, new RegExp(`href: "${href.replace("/", "\\/")}"`));
  }
  assert.match(searchDialog, /href="\/#store"[\s\S]*Browse the shop instead/);
  assert.doesNotMatch(styles, /any-pointer: coarse/);
  assert.match(bootstrap, /MOBILE_STAGE_QUERY/);
  assert.doesNotMatch(desktop, /<JourneySectionHero/);
  assert.match(indexes, /const JOURNEY_GRID_CLASS/);
  assert.match(indexes, /const JOURNEY_CARD_CLASS/);
  assert.doesNotMatch(indexes, /sm:aspect-\[16\/9\]/);
  assert.match(desktop, /\[start - 0\.018, start\]/);
  assert.match(desktop, /preload=\{shouldLoad \? "auto" : "none"\}/);
  assert.doesNotMatch(mobile, /cta: "View all pieces"/);
  assert.doesNotMatch(mobile, /cta: "View all work"/);
  assert.doesNotMatch(mobile, /cta: "Read about Ruined"/);
  assert.match(indexes, />See all events<\/span>/);
  assert.doesNotMatch(`${desktop}\n${mobile}`, /Enter the store/i);
  assert.doesNotMatch(indexes, /href=\{`\/store\/\$\{product\.id\}`\}/);
  assert.doesNotMatch(indexes, /href=\{`\/work\/\$\{projectSlug\(project\)\}`\}/);
  assert.match(gallery, /featured=\{index === 0\}/);
  assert.match(gallery, /featured \? "col-span-2"/);
  assert.doesNotMatch(gallery, /FeaturedProduct|View · 02 \/ 04 columns/);
  assert.match(purchase, /Select \{option\.name\}/);
  assert.match(purchase, /Added to bag/);
  assert.doesNotMatch(purchase, /Acquire via Shopify/i);
  assert.match(bagStore, /ruined:bag:v1/);
  assert.match(checkout, /createCheckoutUrl\(lines\)/);
  assert.match(shopify, /variants\(first: 100\)/);
  assert.match(products, /variants: localVariants/);
});

test("launch navigation keeps dormant section routes out of visitor-facing links", async () => {
  const [navigation, footer, desktop, search, searchData, siblingNav, header] = await Promise.all([
    fs.readFile(path.join(root, "src", "data", "navigation.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "SiteFooter.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "search", "UniversalSearch.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "data", "search.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "SiblingNav.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "SiteHeader.tsx"), "utf8"),
  ]);

  assert.match(navigation, /export const WALK_SECTION_ITEMS = EXPLORE_ROOMS\.slice\(1\)/);
  assert.match(navigation, /FOOTER_INDEX_ITEMS = \[[\s\S]*\.\.\.WALK_SECTION_ITEMS,[\s\S]*SITE_ROUTES\.contact/);
  assert.match(footer, /FOOTER_INDEX_ITEMS/);
  assert.match(desktop, /WALK_SECTION_ITEMS\.map/);
  assert.doesNotMatch(desktop, /GLOBAL_NAV_ITEMS\.map/);
  assert.match(search, /href="\/#store"[\s\S]*Browse the shop instead/);
  assert.match(siblingNav, /WALK_SECTION_ITEMS\.map/);
  assert.match(siblingNav, /href=\{room\.href\}/);

  for (const href of ["/#store", "/#work", "/#about", "/#events"]) {
    assert.match(searchData, new RegExp(`href: "${href.replace("/", "\\/")}"`));
  }
  assert.match(searchData, /href: `\/community#\$\{event\.id\}`/);
  assert.match(navigation, /SERVICE_NAV_ITEMS = \[[\s\S]*SITE_ROUTES\.privacy/);
  assert.doesNotMatch(
    navigation.slice(
      navigation.indexOf("export const SERVICE_NAV_ITEMS"),
      navigation.indexOf("export const EXPLORE_ROOM_IDS")
    ),
    /shippingReturns|SITE_ROUTES\.terms/
  );
  assert.doesNotMatch(searchData, /href: "\/(?:shipping-returns|terms)"/);
  assert.doesNotMatch(header, />Shipping \+ Returns</);
});

test("BYOB explains what guests should bring", async () => {
  const [events, eventsIndex] = await Promise.all([
    fs.readFile(path.join(root, "src", "data", "events.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "events", "EventsIndex.tsx"), "utf8"),
  ]);

  assert.match(events, /summary: "Bring Your Own \(Bell or bodyweight\)\."/);
  assert.match(eventsIndex, /\{selected\.summary\}/);
});

test("BYOB Nº 01 is an ended recap and the next gathering stays current", async () => {
  const [events, eventsIndex, video, videoStat, posterStat, posterMetadata] =
    await Promise.all([
      fs.readFile(path.join(root, "src", "data", "events.ts"), "utf8"),
      fs.readFile(
        path.join(root, "src", "components", "events", "EventsIndex.tsx"),
        "utf8"
      ),
      fs.readFile(path.join(root, "public", "events", "byob-01-recap.mp4")),
      fs.stat(path.join(root, "public", "events", "byob-01-recap.mp4")),
      fs.stat(
        path.join(root, "public", "events", "byob-01-recap-poster.webp")
      ),
      sharp(
        path.join(root, "public", "events", "byob-01-recap-poster.webp")
      ).metadata(),
    ]);

  assert.match(events, /status: isFirstEvent \? "Ended" : "Upcoming"/);
  assert.match(events, /time: isFirstEvent \? "8:00 AM" : "Details to come"/);
  assert.match(events, /\/events\/byob-01-recap\.mp4\?v=2/);
  assert.match(events, /\/events\/byob-01-recap-poster\.webp\?v=2/);
  assert.match(eventsIndex, /const NEXT_AVAILABLE = EVENTS\.find/);
  assert.match(eventsIndex, /const DEFAULT_EVENT = NEXT_AVAILABLE \?\? EVENTS\[0\]/);
  assert.match(eventsIndex, /controls[\s\S]*playsInline[\s\S]*preload="metadata"/);
  assert.doesNotMatch(eventsIndex, /Watch the recap/);
  assert.match(eventsIndex, /Next available/);
  assert.match(eventsIndex, /<optgroup label="Archive">/);
  assert.match(eventsIndex, /<optgroup label="Upcoming">/);
  assert.match(eventsIndex, /value=\{selected\.id\}/);
  assert.doesNotMatch(
    eventsIndex,
    /calendarDays|monthCursor|Previous month|Next month/
  );

  assert.ok(videoStat.size < 10 * 1024 * 1024, "BYOB recap exceeds 10 MiB");
  assert.ok(
    posterStat.size < 200 * 1024,
    "BYOB recap poster exceeds 200 KiB"
  );
  assert.equal(posterMetadata.width, 720);
  assert.equal(posterMetadata.height, 1280);
  assert.ok(video.indexOf("moov") >= 0, "MP4 has no moov atom");
  assert.ok(video.indexOf("mdat") >= 0, "MP4 has no mdat atom");
  assert.ok(
    video.indexOf("moov") < video.indexOf("mdat"),
    "MP4 is not fast-start"
  );
});

test("the handwritten system preloads CadeHandy2 with the original face retained", async () => {
  const [fontFaces, theme, header, layout, landingStyles, siteStyles] = await Promise.all([
    fs.readFile(path.join(root, "src", "styles", "fonts.css"), "utf8"),
    fs.readFile(path.join(root, "src", "styles", "theme.css"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "SiteHeader.tsx"), "utf8"),
    fs.readFile(path.join(root, "app", "layout.tsx"), "utf8"),
    fs.readFile(path.join(root, "app", "lp", "lp.module.css"), "utf8"),
    fs.readFile(path.join(root, "src", "styles", "index.css"), "utf8"),
  ]);

  await fs.access(path.join(root, "public", "fonts", "CadeHandy2.otf"));
  await fs.access(path.join(root, "public", "fonts", "CadeHandy.otf"));
  assert.doesNotMatch(fontFaces, /font-family: "CadeHandy2"/);
  assert.match(layout, /import localFont from "next\/font\/local"/);
  assert.match(layout, /src: "\.\.\/public\/fonts\/CadeHandy2\.otf"/);
  assert.match(layout, /variable: "--font-cadehandy2"/);
  assert.match(layout, /preload: true/);
  assert.match(layout, /className=\{cadeHandy2\.variable\}/);
  assert.match(
    theme,
    /--font-handwritten: var\(--font-cadehandy2\), "CadeHandy", "Bradley Hand"/
  );
  assert.match(header, /ruined-section-locator/);
  assert.match(
    siteStyles,
    /\.ruined-section-locator \{[\s\S]*?pointer-events: none;/
  );
  assert.match(
    siteStyles,
    /@media \(max-width: 767px\) \{[\s\S]*?\.ruined-section-locator \{[\s\S]*?font-size: clamp\(0\.95rem, 4\.6vw, 1\.3rem\);[\s\S]*?translate\(-50%, 0\.1rem\)/
  );
  assert.match(landingStyles, /\.footer div \{[\s\S]*?flex-wrap: wrap;/);
});

test("the padded final wordmark is deployed across branded surfaces", async () => {
  const [
    wordmark,
    header,
    footer,
    landingPage,
    landingHero,
    foundations,
    foundationStyles,
    siteStyles,
  ] = await Promise.all([
      fs.readFile(path.join(root, "public", "ruined-wordmark.svg"), "utf8"),
      fs.readFile(path.join(root, "src", "components", "SiteHeader.tsx"), "utf8"),
      fs.readFile(path.join(root, "src", "components", "SiteFooter.tsx"), "utf8"),
      fs.readFile(path.join(root, "app", "lp", "future-page.tsx"), "utf8"),
      fs.readFile(path.join(root, "app", "lp", "parallax-hero.tsx"), "utf8"),
      fs.readFile(
        path.join(root, "src", "components", "foundations", "PresentationShell.tsx"),
        "utf8"
      ),
      fs.readFile(
        path.join(root, "src", "components", "foundations", "foundations.module.css"),
        "utf8"
      ),
      fs.readFile(path.join(root, "src", "styles", "index.css"), "utf8"),
    ]);

  assert.match(wordmark, /width="1000" height="300" viewBox="0 0 1000 300"/);
  assert.match(wordmark, /M122\.263,162\.484/);
  for (const surface of [header, footer, landingPage, landingHero, foundations]) {
    assert.match(surface, /src="\/ruined-wordmark\.svg"/);
    assert.match(surface, /height=\{300\}/);
    assert.doesNotMatch(surface, /height=\{206\}/);
  }
  assert.match(header, /ruined-header-wordmark/);
  assert.match(
    siteStyles,
    /\.ruined-header-wordmark \{[^}]*filter: brightness\(0\) invert\(1\);/s
  );
  assert.match(
    foundationStyles,
    /\.entryWordmark img \{[^}]*filter: brightness\(0\) invert\(1\);/s
  );
});

test("the botanical mark owns the favicon and fine-pointer cursor", async () => {
  const [layout, cursor, siteStyles, icon, pinned, brandAssets] = await Promise.all([
    fs.readFile(path.join(root, "app", "layout.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "BrandCursor.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "styles", "index.css"), "utf8"),
    fs.readFile(path.join(root, "public", "favicon-ruined-mark-v2.svg"), "utf8"),
    fs.readFile(path.join(root, "public", "safari-pinned-tab.svg"), "utf8"),
    fs.readFile(path.join(root, "scripts", "gen-brand-assets.mjs"), "utf8"),
  ]);

  assert.match(layout, /<BrandCursor \/>/);
  assert.match(layout, /favicon-ruined-mark-v2\.svg/);
  assert.match(layout, /mask-icon[\s\S]*color: "#080605"/);
  assert.match(cursor, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(cursor, /event\.pointerType !== "mouse"/);
  assert.match(cursor, /data-interactive/);
  assert.match(cursor, /data-cursor-native/);
  assert.match(siteStyles, /#00a9a1/);
  assert.match(siteStyles, /#bb204f/);
  assert.match(
    siteStyles,
    /data-interactive[^}]*mark--teal \{[^}]*opacity: 0\.62;[^}]*translate3d\(-2px, 1px, 0\);/s
  );
  assert.match(
    siteStyles,
    /data-interactive[^}]*mark--magenta \{[^}]*opacity: 0\.62;[^}]*translate3d\(2px, -1px, 0\);/s
  );
  assert.doesNotMatch(siteStyles, /ruined-cursor-(?:teal|magenta)-glitch/);
  assert.match(siteStyles, /prefers-reduced-motion: reduce/);
  assert.match(icon, /<rect width="64" height="64" fill="#080605"/);
  assert.match(icon, /M283\.824,342\.559/);
  assert.match(pinned, /M283\.824,342\.559/);
  assert.match(brandAssets, /--icons-only/);
  for (const file of [
    "public/favicon-ruined-mark-v2.png",
    "public/apple-touch-icon-ruined-mark-v2.png",
  ]) {
    const metadata = await sharp(path.join(root, file)).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, file.includes("apple") ? 180 : 512);
    assert.equal(metadata.height, file.includes("apple") ? 180 : 512);
  }
});

test("the Lobby note reveals one static paper and releases the next gesture", async () => {
  const [popup, packageJson, popupBuild] = await Promise.all([
    fs.readFile(
      path.join(root, "src", "components", "LobbyPopupSequence.tsx"),
      "utf8"
    ),
    fs.readFile(path.join(root, "package.json"), "utf8"),
    fs.readFile(path.join(root, "scripts", "build-popup-mobile.mjs"), "utf8"),
  ]);

  assert.match(
    popup,
    /type PopupPhase = "dismissed" \| "ready" \| "locked" \| "closing"/
  );
  assert.doesNotMatch(popup, /touchGestureRef|addEventListener\("touch(?:start|move|end|cancel)"/);
  assert.match(popup, /window\.addEventListener\("pointerdown", pointerDown, true\)/);
  assert.match(popup, /window\.addEventListener\("pointermove", pointerMove, true\)/);
  assert.match(
    popup,
    /pointerGestureRef\.current = \{[\s\S]*event\.stopImmediatePropagation\(\);/
  );
  assert.match(popup, /verticalDistance < 28/);
  assert.match(popup, /if \(gesture\.opened\) \{[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*return;/);
  assert.match(popup, /phaseRef\.current === "ready"\) revealPaper\(\)/);
  assert.match(popup, /window\.addEventListener\("click", handleClick, true\)/);
  assert.match(popup, /armClickSuppression\(500\)/);
  assert.match(
    popup,
    /phaseRef\.current !== "locked"\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*if \(paperReady\) enterLobby\(\);/
  );
  assert.match(popup, /phaseRef\.current === "closing"/);
  assert.match(popup, /DISMISS_DURATION_MS = 180/);
  assert.match(popup, /setPhase\("closing"\)[\s\S]*setPhase\("dismissed"\)/);
  assert.match(popup, /NOTE_LOCK_SRC = "\/sequences\/popup\/note-lock\.webp\?v=1"/);
  assert.match(popup, /const paperVisible = phase === "locked" && paperReady/);
  assert.doesNotMatch(
    popup,
    /<canvas|FRAME_COUNT|OPEN_FRAME|CLOSE_START_FRAME|imagesRef|animationFrameRef|requestAnimationFrame|getContext\("2d"\)/
  );
  assert.match(popup, /window\.addEventListener\("hashchange", syncLocation\)/);
  assert.match(popup, /window\.addEventListener\("pageshow", syncLocation\)/);
  assert.match(
    popup,
    /aria-label="Come in"[\s\S]*fixed left-1\/2 top-1\/2[\s\S]*transition-\[opacity,transform\][\s\S]*<NextImage/
  );
  assert.match(popup, /disabled=\{!paperVisible\}/);
  assert.match(popup, /src=\{NOTE_LOCK_SRC\}[\s\S]*unoptimized/);
  assert.match(popup, /onLoad=\{\(\) => setPaperReady\(true\)\}/);
  assert.match(popup, /aria-hidden="true"[\s\S]*pointer-events-none absolute left-\[54%\]/);
  assert.doesNotMatch(popup, /fixed inset-0 z-\[30\]/);
  assert.match(popup, /window\.addEventListener\("ruined:home-scene-request", requestScene\)/);
  assert.match(packageJson, /build-popup-mobile\.mjs/);
  assert.match(popupBuild, /LOCK_SOURCE = path\.join\(POPUP_ROOT, "note-lock\.png"\)/);
  assert.match(popupBuild, /LOCK_OUTPUT = path\.join\(POPUP_ROOT, "note-lock\.webp"\)/);
  assert.match(popupBuild, /alphaQuality: 100/);
});

test("desktop wheel gestures settle on one room waypoint", async () => {
  const [desktop, header] = await Promise.all([
    fs.readFile(
      path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"),
      "utf8"
    ),
    fs.readFile(path.join(root, "src", "components", "SiteHeader.tsx"), "utf8"),
  ]);

  assert.match(desktop, /DESKTOP_WHEEL_TRIGGER_PX = 40/);
  assert.match(desktop, /DESKTOP_WHEEL_ANIMATION_MS = 900/);
  assert.match(desktop, /const desktopWheelStops = useMemo/);
  assert.match(desktop, /useDesktopJourneyScene\(\{ progress: scrollYProgress, stops: journeyRoomStops \}\)/);
  assert.match(desktop, /storeArrivalB\?\.count \? storeArrivalB\.playEnd/);
  assert.match(desktop, /eventsArrivalB\?\.count \? eventsArrivalB\.playEnd/);
  assert.match(desktop, /const targetStopIndex = \(progress: number, direction: number\)/);
  assert.match(desktop, /navigationLocked = true/);
  assert.match(desktop, /event\.preventDefault\(\);[\s\S]*accumulatedDelta \+= delta/);
  assert.match(desktop, /window\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(desktop, /window\.addEventListener\("hashchange", cancelNavigation\)/);
  assert.match(header, /syncHeader\(undefined, false\)/);
  assert.match(header, /window\.addEventListener\("scroll", scheduleHeaderSolidSync/);
});

test("mobile fire waits for buffered motion and recovers from interruption", async () => {
  const [journey, config] = await Promise.all([
    fs.readFile(
      path.join(root, "src", "components", "MobileImmersiveJourney.tsx"),
      "utf8"
    ),
    fs.readFile(path.join(root, "next.config.mjs"), "utf8"),
  ]);

  assert.match(journey, /HAVE_FUTURE_DATA/);
  assert.match(journey, /requestVideoFrameCallback/);
  for (const event of ["canplay", "playing", "waiting", "stalled", "pause", "error"]) {
    assert.match(journey, new RegExp(`addEventListener\\("${event}"`));
  }
  assert.match(journey, /document\.addEventListener\("visibilitychange", handleVisibility\)/);
  assert.match(journey, /window\.addEventListener\("pageshow", attemptPlayback\)/);
  assert.match(journey, /prepare=\{stageEnabled && activeIndex >= 3\}/);
  assert.match(config, /"fireside"/);
  assert.match(config, /"popup"/);
});

test("production route boundaries and metadata files exist", async () => {
  for (const file of [
    "app/error.tsx",
    "app/global-error.tsx",
    "app/loading.tsx",
    "app/not-found.tsx",
    "app/events/page.tsx",
    "app/bag/page.tsx",
    "app/api/store/checkout/route.ts",
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
