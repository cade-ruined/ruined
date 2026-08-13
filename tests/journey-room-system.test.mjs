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

  for (const label of ["Lobby", "Store", "Artifacts", "About", "Community"]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
  assert.match(mobile, /MOBILE_SCENE_LABELS = EXPLORE_ROOMS\.map/);
  assert.match(mobile, /ruined-mobile-journey__position/);
  assert.match(mobile, /String\(activeIndex \+ 1\)\.padStart\(2, "0"\)/);
  assert.match(mobile, /Swipe to walk/);
  assert.match(mobile, /setHasWalked\(true\)/);
  assert.match(desktop, /useDesktopJourneyScene/);
  assert.doesNotMatch(desktop, /data-journey-room-rail/);
  assert.doesNotMatch(desktop, /<JourneySectionHero/);
  assert.match(desktop, /<h2 className="sr-only">\{room\.headline\}<\/h2>/);
  assert.match(desktop, /ruined:home-scene-change/);
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
