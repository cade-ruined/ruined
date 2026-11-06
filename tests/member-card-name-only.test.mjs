import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

// Use the production artwork fonts so layout and pixels do not depend on fonts
// installed on the test runner.
for (const [file, family] of [
  ["IvyOraText-Regular.ttf", "IvyOra Text"],
  ["Inter-Variable-Latin.woff2", "Inter Variable"],
  ["CadeHandy2.otf", "CadeHandy2"],
]) {
  assert.ok(GlobalFonts.registerFromPath(fileURLToPath(new URL(`../public/fonts/${file}`, import.meta.url)), family), `Bundled artwork font ${family} must load.`);
}

function load(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}

const artworkModule = load("src/components/membership/card/card-artwork.ts", {
  "@/lib/membership/invitation-expiry": load("src/lib/membership/invitation-expiry.ts"),
  "./card-text-layout": load("src/components/membership/card/card-text-layout.ts"),
});
const baseCard = Object.freeze({ name: "Alex Morgan", memberTag: null, avatarUrl: null, memberSince: null, location: null, bio: null, buildingNow: null, websiteUrl: null, labels: Object.freeze([]), wearSeed: "name-only-card-proof" });
const legacyCard = Object.freeze({ ...baseCard, memberTag: "private_tag", bio: "PRIVATE BIOGRAPHY", location: "PRIVATE LOCATION", buildingNow: "PRIVATE BUILDING", labels: Object.freeze(["PRIVATE LABEL"]), avatarUrl: "/private-portrait", websiteUrl: "https://private.example", memberSince: "2001-01-01T00:00:00Z" });
const printed = artwork => [...artwork.front.printed, ...artwork.back.printed].join(" ");
const fingerprint = surface => createHash("sha256").update(surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data).digest("hex");
const fingerprintKeys = ["front", "back", "frontRoughness", "backRoughness", "frontBump", "backBump", "frontFoilMask", "backFoilMask"];

function rendererHarness({ assets = false } = {}) {
  const requests = [], imageSources = new WeakMap();
  const renderer = artworkModule.createCardArtworkRenderer({
    createCanvas(width, height) {
      const surface = createCanvas(width, height), context = surface.getContext("2d"), fill = context.fillText.bind(context), draw = context.drawImage.bind(context);
      surface.printed = [];
      surface.images = [];
      surface.textBounds = [];
      context.fillText = (value, x, y) => {
        surface.printed.push(value);
        const metrics = context.measureText(value);
        surface.textBounds.push({ value, left: x - metrics.actualBoundingBoxLeft, right: x + metrics.actualBoundingBoxRight, top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent });
        fill(value, x, y);
      };
      context.drawImage = (source, ...coordinates) => {
        if (imageSources.has(source)) surface.images.push({ source: imageSources.get(source), coordinates });
        draw(source, ...coordinates);
      };
      return surface;
    },
    loadImage: async url => {
      requests.push(url);
      if (!assets) return null;
      const image = await loadImage(fileURLToPath(new URL(`../public${url}`, import.meta.url)));
      imageSources.set(image, url);
      return image;
    },
    loadFonts: async () => {}, handwritingFamily: () => '"CadeHandy2"', editionYear: () => 2026,
  });
  return { ...renderer, requests };
}

for (const variant of ["member", "invitation"]) {
  test(`${variant} artwork ignores every legacy profile field, including the portrait request`, async () => {
    const renderer = rendererHarness();
    const plain = await renderer.createCardArtwork(baseCard, variant);
    const legacy = await renderer.createCardArtwork(legacyCard, variant);
    for (const key of fingerprintKeys) assert.equal(fingerprint(legacy[key]), fingerprint(plain[key]), `${key} must depend only on name and artwork seed.`);
    assert.match(printed(legacy), /Alex Morgan/);
    assert.doesNotMatch(printed(legacy), /PRIVATE|private_tag|private.example|2001|MEMBER SINCE|BASED IN|CURRENTLY BUILDING|A LITTLE ABOUT ME/);
    assert.equal(renderer.requests.includes("/private-portrait"), false);
    assert.deepEqual(legacy.back.printed, ["You’re allowed", "to become someone new."]);
  });
}

test("member cards restore the approved photograph, message, and centered back foil", async () => {
  const renderer = rendererHarness({ assets: true });
  const artwork = await renderer.createCardArtwork(legacyCard, "member");
  const photo = "/membership/foundations/beginning.webp";
  assert.ok(renderer.requests.includes(photo));
  const photograph = artwork.front.images.filter(image => image.source === photo);
  assert.equal(photograph.length, 1);
  assert.deepEqual(photograph[0].coordinates.slice(-4), [53, 154, 902, 646]);
  assert.equal(artwork.back.images.some(image => image.source === photo), false);
  assert.match(artwork.front.printed.join(" "), /This is for you\./);
  assert.match(artwork.front.printed.join(" "), /Ruined member Alex Morgan/);
  assert.doesNotMatch(printed(artwork), /invitation|VALID|PRIVATE|A LITTLE ABOUT ME/i);
  assert.deepEqual(artwork.back.printed, ["You’re allowed", "to become someone new."]);
  const mask = artwork.backFoilMask.getContext("2d").getImageData(0, 0, 1008, 1408).data;
  let pixels = 0;
  for (let y = 0; y < 1408; y++) for (let x = 0; x < 1008; x++) {
    if (!mask[(y * 1008 + x) * 4]) continue;
    pixels++;
    assert.ok(x >= 327 && x <= 682 && y >= 454 && y <= 954, "Back foil must fill the approved center placement.");
  }
  assert.ok(pixels > 10_000, "The exact leaf must render, not just an empty mask.");
  assert.notEqual(fingerprint(artwork.frontFoilMask), fingerprint(artwork.backFoilMask));
  assert.ok(renderer.cardArtworkFontRequests("member").some(font => font.includes("CadeHandy2")));
});

test("member artwork ignores invitation-only inputs and retains complete names", async () => {
  const renderer = rendererHarness();
  const plain = await renderer.createCardArtwork(baseCard, "member");
  const extra = await renderer.createCardArtwork(baseCard, "member", "2026-09-21T02:45:00Z", "Taylor Rivers", "ruined_direct");
  for (const key of fingerprintKeys) assert.equal(fingerprint(plain[key]), fingerprint(extra[key]), `Member ${key} must not inherit invitation-only inputs.`);
  for (const name of ["Ty", "Alexandra Montgomery-Wellington de la Cruz", "W".repeat(120)]) {
    const artwork = await renderer.createCardArtwork({ ...baseCard, name }, "member");
    assert.ok(artwork.front.printed.join("").replace(/\s/g, "").includes(name.replace(/\s/g, "")));
    const lines = artwork.front.textBounds.filter(line => line.top >= 1090 && line.value !== "Ruined member");
    assert.ok(lines.length);
    for (const line of lines) assert.ok(line.left >= 60 && line.right <= 738 && line.bottom <= 1275, `Full name must stay clear of the footer and foil: ${JSON.stringify(line)}`);
  }
});

test("recipient personalization changes only the invitation front and retains the issued deadline", async () => {
  const renderer = rendererHarness(), expiresAt = "2026-09-21T02:45:00.000Z";
  const generic = await renderer.createCardArtwork(legacyCard, "invitation", expiresAt);
  const personal = await renderer.createCardArtwork(legacyCard, "invitation", expiresAt, "Taylor Rivers");
  assert.match(personal.front.printed.join(" "), /This is for Taylor Rivers\./);
  assert.match(personal.front.printed.join(" "), /Alex Morgan/);
  assert.match(personal.front.printed.join(" "), /VALID UNTIL SEP\. 20 8:45PM MDT/);
  assert.doesNotMatch(printed(personal), /PRIVATE|private_tag|private.example/);
  assert.notEqual(fingerprint(personal.front), fingerprint(generic.front));
  for (const key of fingerprintKeys.filter(key => key !== "front")) assert.equal(fingerprint(personal[key]), fingerprint(generic[key]), `Recipient personalization must preserve ${key}.`);
  const longRecipient = "W".repeat(100);
  const long = await renderer.createCardArtwork(legacyCard, "invitation", expiresAt, longRecipient);
  assert.ok(long.front.printed.join("").replace(/\s/g, "").includes(`Thisisfor${longRecipient}.`));
});

test("direct invitations keep the Ruined identity and recipient while ignoring member profile fields", async () => {
  const renderer = rendererHarness();
  const direct = await renderer.createCardArtwork(legacyCard, "invitation", null, "Taylor Rivers", "ruined_direct");
  assert.match(printed(direct), /The Ruined Project/);
  assert.match(printed(direct), /This is for Taylor Rivers\./);
  assert.match(printed(direct), /VALID FOR 48 HOURS ONCE CREATED/);
  assert.doesNotMatch(printed(direct), /Alex Morgan|PRIVATE|private_tag|private.example|2001/);
  assert.equal(renderer.requests.includes("/private-portrait"), false);
  assert.deepEqual(direct.back.printed, ["You’re allowed", "to become someone new."]);
});
