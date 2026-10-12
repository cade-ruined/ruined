import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { createCanvas } from "@napi-rs/canvas";

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

function rendererHarness() {
  const requests = [];
  const renderer = artworkModule.createCardArtworkRenderer({
    createCanvas(width, height) {
      const surface = createCanvas(width, height), context = surface.getContext("2d"), fill = context.fillText.bind(context);
      surface.printed = [];
      context.fillText = (value, x, y) => { surface.printed.push(value); fill(value, x, y); };
      return surface;
    },
    loadImage: async url => { requests.push(url); return null; },
    loadFonts: async () => {}, handwritingFamily: () => "serif", editionYear: () => 2026,
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
    assert.doesNotMatch(printed(legacy), /PRIVATE|private_tag|private.example|2001|MEMBER SINCE|BASED IN|CURRENTLY BUILDING/);
    assert.equal(renderer.requests.includes("/private-portrait"), false);
    if (variant === "invitation") assert.deepEqual(legacy.back.printed, ["You’re allowed", "to become someone new."]);
  });
}

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
