import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the home marquee puts the newest BYOB Tank first", async () => {
  const [indexSource, gallerySource] = await Promise.all([
    fs.readFile(
      path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "data", "eventGalleries.ts"),
      "utf8"
    ),
  ]);

  const byobPosition = indexSource.indexOf("key: `events-${byobOne.id}`");
  const castPosition = indexSource.indexOf('key: "meet-the-cast"');
  const aboutPosition = indexSource.indexOf('key: "what-is-this"');
  const tankPosition = indexSource.indexOf('key: "byob-tank"');

  assert.ok(tankPosition >= 0);
  assert.ok(tankPosition < byobPosition);
  assert.ok(byobPosition < castPosition);
  assert.ok(castPosition < aboutPosition);
  assert.match(indexSource, /candidate\.id === "byob-01"/);
  assert.match(
    indexSource,
    /products\.find\([\s\S]*?candidate\.id === (?:"byob-tank"|BYOB_TANK_FEATURE_FALLBACK\.id)[\s\S]*?\)/
  );
  assert.match(indexSource, /href: `\/community#\$\{byobOne\.id\}`/);
  assert.match(indexSource, /image: byobOne\.image/);
  assert.match(indexSource, /title:\s*tank\?\.name \?\? BYOB_TANK_FEATURE_FALLBACK\.title/);
  assert.match(indexSource, /href:\s*tank \? `\/store\/\$\{tank\.id\}` : undefined/);
  assert.match(indexSource, /tank\?\.images\?\.find\(\(image\) => image\.url\.includes\("BYOB_Tee_Product\.png"\)\)[\s\S]*?\?\?\s*tank\?\.image/);
  assert.match(indexSource, /href: "#about"/);
  assert.match(indexSource, /priority=\{index === 0\}/);
  assert.match(
    gallerySource,
    /src: "\/events\/byob-01\/gallery\/01-img-8059\.webp\?v=1"/
  );
});

test("the BYOB Tank stays in the home rail without Shopify and prefers live product data", async () => {
  const indexSource = await fs.readFile(
    path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"),
    "utf8"
  );
  const lobbyIndex = indexSource.slice(
    indexSource.indexOf("export function JourneyLobbyIndex"),
    indexSource.indexOf("export function JourneyStoreIndex")
  );
  const fallback = indexSource.match(
    /const BYOB_TANK_FEATURE_FALLBACK[^=]*=\s*\{([\s\S]*?)\n\} as const;/
  )?.[1];

  assert.ok(fallback, "the tank needs an editorial fallback when Shopify returns no products");
  assert.match(fallback, /id:\s*"byob-tank"/);
  assert.match(fallback, /title:\s*"BYOB Tank"/);
  assert.match(fallback, /meta:\s*"(?:\$32 · )?Preorder · Ships September"/);
  assert.match(fallback, /BYOB_Tee_Product\.png/);

  assert.match(
    lobbyIndex,
    /products\.find\([\s\S]*?candidate\.id === (?:"byob-tank"|BYOB_TANK_FEATURE_FALLBACK\.id)[\s\S]*?\)/
  );
  assert.match(lobbyIndex, /title:\s*tank\?\.name \?\? BYOB_TANK_FEATURE_FALLBACK\.title/);
  assert.match(
    lobbyIndex,
    /href:\s*tank \? `\/store\/\$\{tank\.id\}` : undefined/
  );
  assert.match(
    lobbyIndex,
    /meta:\s*tank\?\.expectedShipDate[\s\S]*?tank\.price[\s\S]*?formatJourneyShipDate\(tank\.expectedShipDate\)[\s\S]*?:\s*tank\?\.price \?\? BYOB_TANK_FEATURE_FALLBACK\.meta/
  );
  assert.match(lobbyIndex, /image:\s*tankImage\?\.url \?\? BYOB_TANK_FEATURE_FALLBACK\.image\.url/);
  assert.match(lobbyIndex, /alt:\s*tankImage\?\.alt \?\? BYOB_TANK_FEATURE_FALLBACK\.image\.alt/);
  assert.doesNotMatch(
    lobbyIndex,
    /\.\.\.\(tank\s*\?/,
    "the fallback card must not disappear when the products array is empty"
  );
});

test("the home marquee drifts continuously and gives people persistent control", async () => {
  const indexSource = await fs.readFile(
    path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"),
    "utf8"
  );
  const lobbyIndex = indexSource.slice(
    indexSource.indexOf("export function JourneyLobbyIndex"),
    indexSource.indexOf("export function JourneyStoreIndex")
  );

  assert.match(indexSource, /const HOME_MARQUEE_RESUME_DELAY_MS = 12000;/);
  assert.match(indexSource, /const HOME_MARQUEE_SPEED_PX_PER_SECOND = 20;/);
  assert.match(indexSource, /const HOME_MARQUEE_MAX_FRAME_MS = 48;/);
  assert.match(lobbyIndex, /requestAnimationFrame\s*\(/, "drift should follow the display refresh rate");
  assert.match(lobbyIndex, /cancelAnimationFrame\s*\(/, "the animation frame must be cleaned up");
  assert.doesNotMatch(lobbyIndex, /setInterval\s*\(|clearInterval\s*\(/);
  assert.doesNotMatch(
    lobbyIndex,
    /(?:scrollTo|scrollIntoView)\s*\([\s\S]*?behavior:\s*"smooth"/,
    "continuous drift must not be disguised card-step scrolling"
  );
  assert.match(
    lobbyIndex,
    /Math\.min\([\s\S]{0,160}?(?:delta|elapsed|frame)[\s\S]{0,160}?\)/i,
    "large frame gaps must be capped so returning to the tab cannot cause a jump"
  );
  assert.match(
    lobbyIndex,
    /HOME_MARQUEE_(?:DRIFT_)?SPEED_PX_PER_SECOND[\s\S]{0,180}?(?:delta|elapsed|frame)/i,
    "distance should be time-based rather than frame-count based"
  );
  assert.match(
    lobbyIndex,
    /(?:scrollWidth\s*-\s*marquee\.clientWidth|marquee\.scrollWidth\s*-\s*marquee\.clientWidth)/,
    "drift needs the real horizontal boundary"
  );
  assert.match(
    lobbyIndex,
    /marqueeDirectionRef\.current\s*=\s*-1[\s\S]*?marqueeDirectionRef\.current\s*=\s*1/,
    "the marquee should reverse at both ends rather than jump from end to start"
  );
  assert.match(lobbyIndex, /marquee\.scrollLeft\s*=/);
  assert.doesNotMatch(lobbyIndex, /%\s*(?:cards|positions|selections)\.length/);
  assert.match(
    lobbyIndex,
    /\)\s*\{[\s\S]*?marquee\.style\.removeProperty\("scroll-snap-type"\)[\s\S]*?return;[\s\S]*?marquee\.style\.scrollSnapType = "none"/,
    "native snap should be disabled only after all automation gates allow drift"
  );
  assert.ok(
    (lobbyIndex.match(/marquee\.style\.removeProperty\("scroll-snap-type"\)/g) ?? []).length >= 3,
    "native snap must be restored while gated, when syncing, and during cleanup"
  );
  assert.match(
    indexSource,
    /matchMedia\(\s*"\(prefers-reduced-motion:\s*reduce\)"\s*\)/,
    "reduced-motion preference must be detected"
  );
  assert.match(
    lobbyIndex,
    /motionPreference\.matches[\s\S]{0,200}?(?:return|marqueeCanDrift|shouldDrift)/,
    "reduced motion should prevent automatic drift"
  );

  for (const handlers of [
    ["onMouseEnter", "onPointerEnter"],
    ["onMouseLeave", "onPointerLeave"],
    ["onFocusCapture", "onFocus"],
    ["onBlurCapture", "onBlur"],
    ["onPointerDown"],
    ["onPointerUp"],
    ["onPointerCancel"],
  ]) {
    const pattern = new RegExp(`(?:${handlers.join("|")})=`);
    assert.match(
      lobbyIndex,
      pattern,
      `${handlers.join(" or ")} should participate in pausing or resuming the marquee`
    );
  }
  assert.match(
    lobbyIndex,
    /motionPreference\.matches\s*\|\|\s*marqueeStopped\s*\|\|\s*marqueePauseReasonsRef\.current\.size > 0\s*\|\|\s*!marqueeVisibleRef\.current\s*\|\|[\s\S]*?Date\.now\(\)\s*<\s*marqueeResumeAtRef\.current[\s\S]*?\)\s*\{[\s\S]*?return;/,
    "manual stop, overlapping interaction reasons, cooldown, and offscreen state must gate drift"
  );
  assert.match(
    lobbyIndex,
    /const drift = \([^)]*\) => \{[\s\S]*?requestAnimationFrame\(drift\)[\s\S]*?if \(\s*motionPreference\.matches/,
    "the next frame must be scheduled before a temporary pause gate so drift can resume"
  );
  assert.match(lobbyIndex, /new Set<"drag" \| "focus" \| "hover">\(\)/);
  assert.match(lobbyIndex, /marqueePauseReasonsRef\.current\.add\(reason\)/);
  assert.match(lobbyIndex, /marqueePauseReasonsRef\.current\.delete\(reason\)/);
  assert.match(lobbyIndex, /new IntersectionObserver\s*\(/);
  assert.match(lobbyIndex, /visibilityObserver\.observe\(marquee\)/);
  assert.match(lobbyIndex, /visibilityObserver\.disconnect\(\)/);

  assert.match(lobbyIndex, /const \[marqueeStopped, setMarqueeStopped\] = useState\(false\)/);
  assert.match(lobbyIndex, /onClick=\{\(\) => setMarqueeStopped\(\(current\) => !current\)\}/);
  assert.match(lobbyIndex, /aria-pressed=\{marqueeStopped\}/);
  assert.match(lobbyIndex, /aria-label=\{marqueeStopped \? "Play marquee" : "Pause marquee"\}/);
});

test("the home feature list remains a native horizontal rail during drift", async () => {
  const indexSource = await fs.readFile(
    path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"),
    "utf8"
  );
  const lobbyIndex = indexSource.slice(
    indexSource.indexOf("export function JourneyLobbyIndex"),
    indexSource.indexOf("export function JourneyStoreIndex")
  );
  const railClass = indexSource.match(
    /const JOURNEY_RAIL_CLASS\s*=\s*\n?\s*"([^"]+)"/
  )?.[1];
  const railCardClass = indexSource.match(
    /const JOURNEY_RAIL_CARD_CLASS\s*=\s*\n?\s*`([^`]+)`/
  )?.[1];

  assert.match(lobbyIndex, /data-journey-lobby-index/);
  assert.match(lobbyIndex, /className=\{JOURNEY_RAIL_CLASS\}/);
  assert.match(lobbyIndex, /className=\{JOURNEY_RAIL_CARD_CLASS\}/);
  assert.ok(railClass, "the shared homepage rail needs an explicit class contract");
  assert.ok(railCardClass, "the shared homepage rail card needs an explicit class contract");
  assert.match(railClass, /\bflex\b/);
  assert.match(railClass, /\btouch-pan-x\b/);
  assert.match(railClass, /\boverflow-x-auto\b/);
  assert.match(railClass, /\boverscroll-x-contain\b/);
  assert.match(railClass, /\bsnap-x\b/);
  assert.match(railClass, /\bsnap-mandatory\b/);
  assert.doesNotMatch(railClass, /\bgrid-cols-3\b/);
  assert.match(railCardClass, /\bsnap-start\b/);
  assert.match(railCardClass, /\b(?:shrink-0|flex-none)\b/);
});
