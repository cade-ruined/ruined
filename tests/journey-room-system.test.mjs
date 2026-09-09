import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("the immersive walk uses one direct five-stop vocabulary", async () => {
  const [navigation, mobile, desktop] = await Promise.all([
    fs.readFile(path.join(root, "src", "data", "navigation.ts"), "utf8"),
    fs.readFile(
      path.join(root, "src", "components", "MobileImmersiveJourney.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"),
      "utf8"
    ),
  ]);

  const rooms = navigation.slice(
    navigation.indexOf("export const EXPLORE_ROOMS = ["),
    navigation.indexOf("export const WALK_MENU_ITEMS")
  );
  assert.deepEqual(
    [...rooms.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]),
    ["Lobby", "Store", "About", "Members", "Community"]
  );
  assert.match(mobile, /MOBILE_SCENE_LABELS = EXPLORE_ROOMS\.map/);
  assert.match(mobile, /ruined-mobile-journey__position/);
  assert.match(mobile, /String\(activeIndex \+ 1\)\.padStart\(2, "0"\)/);
  assert.match(mobile, /Swipe to walk/);
  assert.match(mobile, /setHasWalked\(true\)/);
  assert.match(desktop, /useDesktopJourneyScene/);
  assert.match(desktop, /function roomLabelArrival/);
  assert.match(desktop, /roomLabelArrival\(bands\.lobby, 0\.2\)/);
  assert.match(desktop, /roomLabelArrival\(bands\.store, 0\.4\)/);
  assert.match(desktop, /roomLabelArrival\(bands\.records, 0\.6\)/);
  assert.match(desktop, /const atLobby = nextIndex === 0 && value <= 0\.002/);
  assert.doesNotMatch(desktop, /data-journey-room-rail/);
  assert.doesNotMatch(desktop, /<JourneySectionHero/);
  assert.match(desktop, /<h2 className="sr-only">\{room\.headline\}<\/h2>/);
  assert.match(desktop, /ruined:home-scene-change/);
});

test("About and Members own their destination panels without changing the physical walk", async () => {
  const [mobile, desktop, mobileData] = await Promise.all([
    fs.readFile(path.join(root, "src", "components", "MobileImmersiveJourney.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "data", "mobileJourney.ts"), "utf8"),
  ]);

  // A sequence folder names the room the camera leaves, not the panel it arrives at.
  assert.match(desktop, /const aboutArrivalB = bands\["store"\]/);
  assert.match(desktop, /const membersArrivalB = bands\["records"\]/);
  const overlays = [...desktop.matchAll(/<RoomOverlay\b[\s\S]*?<\/RoomOverlay>/g)]
    .map((match) => match[0]);
  const about = overlays.filter((overlay) => overlay.includes("<JourneyAboutStatement"));
  const members = overlays.filter((overlay) => overlay.includes("<JourneyMembersPreview"));
  assert.equal(about.length, 1, "About appears once at the second destination");
  assert.equal(members.length, 1, "Members appears once at the third destination");
  assert.match(about[0], /band=\{aboutArrivalB\}[\s\S]*room=\{EXPLORE_ROOMS\[2\]\}/);
  assert.match(members[0], /band=\{membersArrivalB\}[\s\S]*room=\{EXPLORE_ROOMS\[3\]\}/);
  assert.match(desktop, /room: EXPLORE_ROOMS\[2\], at: roomLabelArrival\(bands\.store, 0\.4\)/);
  assert.match(desktop, /room: EXPLORE_ROOMS\[3\], at: roomLabelArrival\(bands\.records, 0\.6\)/);
  assert.match(desktop, /\{ id: "work", band: aboutArrivalB \}/);
  assert.match(desktop, /\{ id: "about", band: aboutArrivalB \}/);
  assert.match(desktop, /\{ id: "members", band: membersArrivalB \}/);

  const scenes = mobile.slice(mobile.indexOf("const MOBILE_SCENES = ["), mobile.indexOf("const SWIPE_DISTANCE_PX"));
  assert.match(scenes, /id: "about",\s*image: versionSequenceAsset\(MOBILE_ARRIVAL_FRAME_PATHS\[2\]\),\s*heading: EXPLORE_ROOMS\[2\]\.label/);
  assert.match(scenes, /id: "members",\s*image: versionSequenceAsset\(MOBILE_ARRIVAL_FRAME_PATHS\[3\]\),\s*heading: EXPLORE_ROOMS\[3\]\.label/);
  const selections = mobile.match(/const roomSelections: readonly ReactNode\[\] = \[([\s\S]*?)\n  \];/)?.[1];
  assert.ok(selections, "mobile keeps one selection per scene");
  assert.deepEqual(
    [...selections.matchAll(/<(Journey\w+)\b/g)].map((match) => match[1]),
    ["JourneyLobbyIndex", "JourneyStoreIndex", "JourneyAboutStatement", "JourneyMembersPreview"]
  );
  assert.match(mobile, /selection=\{roomSelections\[index\]\}/);
  assert.doesNotMatch(mobile, /JourneyComingSoon|work-selections/);
  assert.doesNotMatch(desktop, /<JourneyComingSoon section="artifacts"/);
  assert.match(mobileData, /sequenceFramePath\("records", 1\),\s*sequenceFramePath\("lounge", 1\)/);
  assert.match(mobileData, /hash === "#work" \? "about"/);
  assert.match(mobile, /mobileSceneIndexFromHash\(window\.location\.hash\)/);
  // Off-screen mobile selections must remain inaccessible to keyboard and screen readers.
  assert.match(mobile, /aria-hidden=\{enhanced && !active \? true : undefined\}/);
  assert.match(mobile, /hidden=\{enhanced && !active\}/);
});

test("desktop room panels leave the tab order while hidden", async () => {
  const desktop = await fs.readFile(path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"), "utf8");
  const overlay = desktop.slice(desktop.indexOf("function RoomOverlay("), desktop.indexOf("function LobbyOpeningOverlay("));

  assert.match(overlay, /useState\(\(\) => opacity\.get\(\) > 0\.6\)/);
  assert.match(overlay, /const next = value > 0\.6/);
  assert.match(overlay, /return opacity\.on\("change", sync\)/);
  assert.match(overlay, /aria-hidden=\{!interactive\}/);
  assert.match(overlay, /inert=\{!interactive\}/);
  assert.match(overlay, /o > 0\.6 \? "auto" : "none"/);
});

test("the opening lobby and closing links also leave the tab order outside their visible moments", async () => {
  const desktop = await fs.readFile(path.join(root, "src", "components", "DesktopImmersiveParallax.tsx"), "utf8");
  const lobby = desktop.slice(desktop.indexOf("function LobbyOpeningOverlay("), desktop.indexOf("function AfterTheFear("));
  const closing = desktop.slice(desktop.indexOf("function AfterTheFear("), desktop.indexOf("function FiresideLoop("));
  assert.match(lobby, /useState\(\(\) => opacity\.get\(\) > 0\.6\)/);
  assert.match(lobby, /return opacity\.on\("change", sync\)/);
  assert.match(lobby, /aria-hidden=\{!interactive\}/);
  assert.match(lobby, /inert=\{!interactive\}/);
  assert.match(closing, /useState\(\(\) => footerOpacity\.get\(\) > 0\.6\)/);
  assert.match(closing, /return footerOpacity\.on\("change", sync\)/);
  assert.match(closing, /aria-hidden=\{!footerInteractive\}/);
  assert.match(closing, /inert=\{!footerInteractive\}/);
});

test("reduced-motion desktop keeps the readable mobile stack instead of hidden desktop panels", async () => {
  const [contract, bootstrap, mobile, page] = await Promise.all([
    fs.readFile(path.join(root, "src", "utils", "immersiveExperience.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "ImmersiveParallax.tsx"), "utf8"),
    fs.readFile(path.join(root, "src", "components", "MobileImmersiveJourney.tsx"), "utf8"),
    fs.readFile(path.join(root, "app", "page.tsx"), "utf8"),
  ]);

  assert.match(contract, /DESKTOP_EXPERIENCE_QUERY =\s*"[^"\n]*\(prefers-reduced-motion: no-preference\)"/);
  assert.match(contract, /return desktop\.matches && !stage\.matches/);
  assert.match(bootstrap, /const showDesktop = desktopEligible && desktopJourney !== null/);
  assert.match(bootstrap, /@media \$\{DESKTOP_EXPERIENCE_QUERY\}/);
  assert.match(bootstrap, /className="ruined-responsive-static-journey">\{fallback\}/);
  assert.match(page, /fallback=\{<MobileImmersiveJourney products=\{products\} catalogStatus=\{catalog.status\} \/>\}/);
  assert.match(mobile, /\[stageEnabled, setStageEnabled\] = useState\(false\)/);
  assert.match(mobile, /enhanced=\{stageEnabled\}/);
  assert.match(mobile, /hidden=\{enhanced && !active\}/);
});

test("mobile room travel owns a restrained directional smear", async () => {
  const walk = await fs.readFile(
    path.join(
      root,
      "src",
      "components",
      "sequence",
      "MobileWalkTransition.tsx"
    ),
    "utf8"
  );

  assert.match(walk, /MOTION_SMEAR_TAPS = 4/);
  assert.match(walk, /MOTION_SMEAR_DISTANCE_RATIO = 0\.18/);
  assert.match(walk, /MOTION_SMEAR_TAP_ALPHA = 0\.11/);
  assert.match(walk, /Math\.sin\(progress \* Math\.PI\) \*\* 0\.65/);
  assert.match(walk, /data-motion-smear/);
  assert.match(walk, /for \(let tap = MOTION_SMEAR_TAPS/);
  assert.match(walk, /FILM_BURN_MAX_ALPHA = 0\.32/);
  assert.match(walk, /createRadialGradient/);
  assert.match(walk, /globalCompositeOperation = "screen"/);
  assert.match(walk, /reducedMotion\.matches/);
  assert.match(walk, /return await createImageBitmap\(blob\)/);
  assert.doesNotMatch(walk, /resizeWidth:\s*MOBILE_TRANSITION_FRAME_WIDTH/);
  assert.doesNotMatch(walk, /resizeHeight:\s*MOBILE_TRANSITION_FRAME_HEIGHT/);
  assert.doesNotMatch(walk, /feGaussianBlur|filter:\s*blur/);
});
