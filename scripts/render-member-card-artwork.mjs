// Standalone print-artwork proof, independent of browser or WebGL rendering.
// Usage: CARD_CANVAS_MODULE=/absolute/path/to/@napi-rs/canvas/index.js node scripts/render-member-card-artwork.mjs
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { createCanvas, Image, GlobalFonts } = require(process.env.CARD_CANVAS_MODULE || "@napi-rs/canvas");
GlobalFonts.registerFromPath(resolve("public/fonts/IvyOraText-Regular.ttf"), "IvyOra Text");
GlobalFonts.registerFromPath(resolve("public/fonts/Inter-Variable-Latin.woff2"), "Inter Variable");
GlobalFonts.registerFromPath(resolve("public/fonts/CadeHandy2.otf"), "CadeHandy2");
const invitationPhoto = "/membership/foundations/beginning.webp";
const memberPortrait = "/membership/portrait-pending-editorial.webp";
const privatePortrait = "/api/my/photo/private-invitation-proof";
const imageRequests = [], rejectedImages = new Set();
class LocalImage extends Image {
  set src(value) {
    this.requestedSource = value; imageRequests.push(value);
    if (rejectedImages.has(value)) {
      queueMicrotask(() => this.onerror?.(new Error("Simulated unavailable proof image")));
      return;
    }
    super.src = readFileSync(resolve(`public${value}`));
  }
  get naturalWidth() { return this.width; }
  get naturalHeight() { return this.height; }
}
function proofCanvas() {
  const surface = createCanvas(1, 1), context = surface.getContext("2d");
  surface.printedText = []; surface.printedRules = []; surface.printedImages = [];
  const fillText = context.fillText.bind(context), strokeRect = context.strokeRect.bind(context);
  const drawImage = context.drawImage.bind(context);
  const beginPath = context.beginPath.bind(context), moveTo = context.moveTo.bind(context), lineTo = context.lineTo.bind(context), stroke = context.stroke.bind(context);
  let points = [];
  context.fillText = (text, x, y, ...args) => {
    const metrics = context.measureText(text);
    surface.printedText.push({ text, font: context.font, left: x - metrics.actualBoundingBoxLeft, top: y - metrics.actualBoundingBoxAscent, right: x + metrics.actualBoundingBoxRight, bottom: y + metrics.actualBoundingBoxDescent });
    return fillText(text, x, y, ...args);
  };
  context.drawImage = (source, ...args) => {
    if (source.requestedSource) surface.printedImages.push({ source: source.requestedSource, width: source.naturalWidth, height: source.naturalHeight, crop: args });
    return drawImage(source, ...args);
  };
  context.strokeRect = (x, y, width, height) => {
    if (width > 500 && y > 150) surface.printedRules.push({ left: x, top: y, right: x + width, bottom: y + height });
    return strokeRect(x, y, width, height);
  };
  context.beginPath = () => { points = []; return beginPath(); };
  context.moveTo = (x, y) => { points.push({ x, y }); return moveTo(x, y); };
  context.lineTo = (x, y) => { points.push({ x, y }); return lineTo(x, y); };
  context.stroke = (...args) => {
    if (points.length === 2 && points[0].y === points[1].y && Math.abs(points[1].x - points[0].x) > 500) surface.printedRules.push({ left: Math.min(points[0].x, points[1].x), top: points[0].y, right: Math.max(points[0].x, points[1].x), bottom: points[0].y });
    return stroke(...args);
  };
  return surface;
}
const document = { body: {}, createElement: proofCanvas, fonts: { load: () => Promise.resolve() } };
const window = { setTimeout, clearTimeout, getComputedStyle: () => ({ getPropertyValue: name => name === "--font-cadehandy2" ? '"CadeHandy2"' : "" }) };
const invitationExpiresAt = "2026-09-21T02:45:00.000Z";
let proofNow = Date.parse(invitationExpiresAt) - 48 * 60 * 60 * 1000;
class ProofDate extends Date {
  constructor(...args) { super(...(args.length ? args : [proofNow])); }
  static now() { return proofNow; }
}
function load(file) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "document", "Image", "window", "Date", "require", code)(mod, mod.exports, document, LocalImage, window, ProofDate, name => name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`)) : name.startsWith(".") ? load(resolve(dirname(file), `${name}.ts`)) : require(name));
  return mod.exports;
}
const artworkModule = load(resolve("src/components/membership/card/card-artwork.ts"));
const base = { name: "Alex Morgan", memberTag: "alex_morgan", avatarUrl: null, memberSince: "2026-08-01T00:00:00Z", location: "Alpine, Utah", buildingNow: "A more deliberate creative practice.", bio: "Making space for the work, people, and experiences worth keeping.", websiteUrl: "https://theruinedproject.com/", labels: ["Foundations completed"], wearSeed: "sample-member-card-artwork" };
const cases = [
  ["sample", base],
  ["member-with-portrait", { ...base, avatarUrl: memberPortrait }],
  ["maximum", { ...base, memberTag: "w".repeat(24), name: "W".repeat(64), location: "W".repeat(160), bio: "W".repeat(180), buildingNow: "W".repeat(100), websiteUrl: `https://${"w".repeat(60)}.${"w".repeat(60)}.example/`, labels: ["An exceptionally long verified milestone title that must remain readable without escaping the card edge", "Another recorded milestone for testing the lower border"] }],
  ["profile", { ...base, name: "W".repeat(120), location: "W".repeat(160), buildingNow: "W".repeat(500), bio: "W".repeat(1200) }],
  ["invitation", { ...base, name: "Alex Morgan", memberTag: "alex_morgan", avatarUrl: null, location: null, memberSince: null, labels: [] }, "invitation"],
  ["invitation-long-name", { ...base, name: "W".repeat(120), avatarUrl: null, location: null, memberSince: null, labels: [] }, "invitation"],
  ["invitation-maximum-tag", { ...base, name: "W".repeat(120), memberTag: "w".repeat(24) }, "invitation"],
  ["invitation-tag-as-name", { ...base, name: "@alex_morgan" }, "invitation"],
  ["invitation-legacy", { ...base, memberTag: null }, "invitation"],
  ["invitation-private-profile", { ...base, avatarUrl: privatePortrait, location: "PRIVATE LOCATION", labels: ["PRIVATE LABEL"], buildingNow: "PRIVATE BUILDING", bio: "PRIVATE BIOGRAPHY", websiteUrl: "https://private-website.example/" }, "invitation"],
  ["invitation-image-fallback", { ...base, avatarUrl: privatePortrait }, "invitation"],
  ["invitation-unissued", { ...base }, "invitation", null],
  ["tag-as-name", { ...base, name: "@alex_morgan" }],
  ["legacy", { ...base, memberTag: null }],
  ["minimal", { ...base, name: "Alex", avatarUrl: null, memberSince: null, location: null, buildingNow: null, bio: null, websiteUrl: null, labels: [] }],
];
await mkdir("output/member-card/qa", { recursive: true });
const layoutChecks = [];
const invitationChecks = [];
const materialKeys = ["frontRoughness", "backRoughness", "frontBump", "backBump", "frontFoilMask", "backFoilMask"];
const fingerprint = surface => createHash("sha256").update(surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data).digest("hex");
const fingerprints = artwork => Object.fromEntries(materialKeys.map(key => [key, fingerprint(artwork[key])]));
let memberMaterials, publicInvitationPrint, publicInvitationText;
for (const [name, card, variant, expiresAt = invitationExpiresAt] of cases) {
  const fallback = name === "invitation-image-fallback";
  // A fresh module avoids the successful reference-image cache masking failure.
  const renderer = fallback ? load(resolve("src/components/membership/card/card-artwork.ts")) : artworkModule;
  const requestStart = imageRequests.length;
  if (fallback) rejectedImages.add(invitationPhoto);
  let artwork;
  try { artwork = await renderer.createCardArtwork(card, variant, variant === "invitation" ? expiresAt : null); }
  finally { rejectedImages.delete(invitationPhoto); }
  const invitation = variant === "invitation";
  const requested = imageRequests.slice(requestStart);
  assert.equal(requested.includes(privatePortrait), false, `${name} must never fetch a private portrait.`);
  if (invitation) {
    const invitationLabel = artwork.front.printedText.filter(item => item.text === "A personal invitation from");
    assert.equal(invitationLabel.length, 1, `${name} must identify the inviter exactly once.`);
    assert.ok(Number.parseFloat(invitationLabel[0].font.match(/([\d.]+)px/)[1]) >= 36, `${name} inviter label must retain readable type.`);
    const photoDraws = artwork.front.printedImages.filter(item => item.source === invitationPhoto);
    assert.equal(photoDraws.length, fallback ? 0 : 1, `${name} must use the shared couch photograph when available.`);
    if (!fallback) assert.deepEqual(photoDraws[0].crop.slice(-4), [53, 154, 902, 646], `${name} must preserve the reference photo frame.`);
    const textBySide = [artwork.front, artwork.back].map(surface => surface.printedText.map(item => item.text));
    assert.doesNotMatch(textBySide.flat().join(" "), /PRIVATE|private-website|MEMBER SINCE|BASED IN|A LITTLE ABOUT ME|CURRENTLY BUILDING|Foundations completed/, `${name} must not print member-only profile details.`);
    assert.equal(artwork.back.printedImages.some(item => item.source === invitationPhoto), false, `${name} must reserve the photograph for the front.`);
    if (name === "invitation" || fallback) assert.ok(requested.includes(invitationPhoto), `${name} must request the static invitation photograph.`);
    if (name === "invitation") {
      publicInvitationPrint = [artwork.front, artwork.back].map(surface => surface.toBuffer("image/png"));
      publicInvitationText = textBySide;
    }
    if (name === "invitation-private-profile") {
      for (const [index, side] of ["front", "back"].entries()) assert.deepEqual(artwork[side].toBuffer("image/png"), publicInvitationPrint[index], `Private profile fields must not affect the invitation ${side}.`);
    }
    if (fallback) {
      assert.deepEqual(textBySide, publicInvitationText, "An unavailable photo must retain the invitation headline, identity, and back message.");
      assert.notDeepEqual(artwork.front.toBuffer("image/png"), publicInvitationPrint[0], "The image failure must actually exercise the ink-only photo fallback.");
    }
    invitationChecks.push({ name, staticPhoto: invitationPhoto, photoDraws: photoDraws.length, privatePortraitFetched: false, labelFont: invitationLabel[0].font, imageFallback: fallback, expiresAt });
  } else {
    assert.equal(requested.includes(invitationPhoto), false, `${name} member artwork must not fetch the invitation photograph.`);
    assert.equal(artwork.front.printedImages.some(item => item.source === invitationPhoto), false, `${name} member artwork must not render the invitation photograph.`);
  }
  if (name === "member-with-portrait") {
    assert.ok(requested.includes(memberPortrait), "Member artwork must still fetch its own portrait.");
    const portraits = artwork.front.printedImages.filter(item => item.source === memberPortrait);
    assert.equal(portraits.length, 1, "Member artwork must still render its own portrait once.");
    const { width, height, crop: [sx, sy, sw, sh, x, y, w, h] } = portraits[0];
    assert.equal(sx, (width - sw) / 2, "Member portraits must retain their horizontal crop.");
    assert.equal(sy, (height - sh) * .4, "Member portraits must retain their existing vertical crop.");
    assert.deepEqual([x, y, w], [53, 154, 902], "Member portraits must retain their established placement.");
    assert.ok(h > 0 && h <= 766, "Member portrait height must stay within its existing frame.");
  }
  const printedTagCount = invitation
    ? artwork.front.printedText.map(item => item.text).join("").replace(/\s/g, "").split(`@${card.memberTag}`).length - 1
    : artwork.front.printedText.filter(item => item.text === `@${card.memberTag}`).length;
  assert.equal(printedTagCount, card.memberTag ? 1 : 0, `${name} must print the tag exactly once.`);
  for (const side of ["front", "back"]) await writeFile(`output/member-card/qa/artwork-${name}-${side}.png`, artwork[side].toBuffer("image/png"));
  if (name === "sample") {
    memberMaterials = { artwork, fingerprints: fingerprints(artwork) };
    const { width, height } = artwork.front;
    const mask = artwork.frontFoilMask.getContext("2d").getImageData(0, 0, width, height).data;
    const backMask = artwork.backFoilMask.getContext("2d").getImageData(0, 0, width, height).data;
    assert.deepEqual(mask, backMask, "Both foil stamps must share the same full-face UV position.");
    const bounds = { minX: width, minY: height, maxX: 0, maxY: 0 };
    let maskPixels = 0, interiorPixels = 0;
    for (let i = 0; i < mask.length; i += 4) {
      assert.equal(mask[i + 3], 255, "Foil masks must be opaque.");
      assert.equal(mask[i], mask[i + 1]); assert.equal(mask[i], mask[i + 2]);
      if (!mask[i]) continue;
      const x = i / 4 % width, y = Math.floor(i / 4 / width);
      bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
      maskPixels++; if (mask[i] === 255) interiorPixels++;
    }
    assert.ok(bounds.minX >= 779 && bounds.minY >= 1106, "The foil must stay in its reserved lower-right area.");
    assert.ok(bounds.maxX <= width - 70 && bounds.maxY <= height - 78, "The foil must retain comfortable right and bottom padding.");
    assert.ok(bounds.maxY - bounds.minY >= 221, "The exact leaf must retain its new 224px height.");
    for (const [key, value] of [["frontRoughness", 58], ["backRoughness", 58], ["frontBump", 128], ["backBump", 128]]) {
      const pixels = artwork[key].getContext("2d").getImageData(0, 0, width, height).data;
      for (let i = 0; i < pixels.length; i += 4) if (mask[i] === 255) assert.equal(pixels[i], value, `${key} must stay smooth inside the foil.`);
    }
    await writeFile("output/member-card/qa/foil-mask.png", artwork.frontFoilMask.toBuffer("image/png"));
    await writeFile("output/member-card/qa/foil-checks.json", JSON.stringify({ maskPixels, interiorPixels, antialiasPixels: maskPixels - interiorPixels, bounds, roughness: 58, bump: 128, sharedFaceMask: true }, null, 2));
  }
  if (invitation) {
    assert.deepEqual(fingerprints(memberMaterials.artwork), memberMaterials.fingerprints, "An invitation sharing a member wear seed must not mutate that member's material maps.");
    const handwriting = artwork.front.printedText.find(item => item.text === "This is for you.");
    assert.ok(handwriting?.font.includes("CadeHandy2"), "The invitation must use the supplied handwriting font.");
    assert.ok(handwriting.top >= 830 && handwriting.bottom < 1030, "The handwriting must sit below the photograph with space above the footer rule.");
    assert.deepEqual(artwork.back.printedText.map(item => item.text), ["You’re allowed", "to become someone new."], "The back must preserve the supplied message without member-only labels.");
    const validity = artwork.front.printedText.filter(item => item.text.startsWith("VALID "));
    assert.equal(validity.length, 1, `${name} must print exactly one validity line.`);
    assert.equal(validity[0].text, expiresAt ? "VALID UNTIL SEP. 20 8:45PM MDT" : "VALID FOR 48 HOURS ONCE CREATED", `${name} must print its issued deadline or clearly identify an unissued card.`);
    assert.ok(validity[0].left >= 60 && validity[0].right <= 738 && validity[0].top >= 1300 && validity[0].bottom <= 1350, `${name} validity line must remain below the identity and clear of the foil: ${JSON.stringify(validity[0])}`);
  }
  if (name === "invitation") {
    const reports = {};
    for (const [side, position] of [["front", { x: 766, y: 1106, width: 240 * 283.956 / 400, height: 240 }], ["back", { x: 327, y: 454, width: 500 * 283.956 / 400, height: 500 }]]) {
      const { width, height } = artwork[side];
      const mask = artwork[`${side}FoilMask`].getContext("2d").getImageData(0, 0, width, height).data;
      const bounds = { minX: width, minY: height, maxX: 0, maxY: 0 };
      const roughness = artwork[`${side}Roughness`].getContext("2d").getImageData(0, 0, width, height).data;
      const bump = artwork[`${side}Bump`].getContext("2d").getImageData(0, 0, width, height).data;
      let interiorPixels = 0;
      for (let i = 0; i < mask.length; i += 4) {
        assert.equal(mask[i + 3], 255, `${side} foil mask must be opaque.`);
        assert.equal(mask[i], mask[i + 1]); assert.equal(mask[i], mask[i + 2]);
        if (!mask[i]) continue;
        const x = i / 4 % width, y = Math.floor(i / 4 / width);
        bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
        if (mask[i] === 255) {
          interiorPixels++;
          assert.equal(roughness[i], 58, `${side} foil must retain its smooth material.`);
          assert.equal(bump[i], 128, `${side} foil must not inherit the paper bump.`);
        }
      }
      assert.ok(interiorPixels > 1000, `${side} foil must contain the actual leaf silhouette.`);
      assert.ok(bounds.minX >= position.x && bounds.minY >= position.y && bounds.maxX <= Math.ceil(position.x + position.width) && bounds.maxY <= position.y + position.height, `${side} foil must occupy its own reference position.`);
      assert.ok(bounds.maxY - bounds.minY >= position.height - 3, `${side} foil must retain its intended height.`);
      reports[side] = { bounds, interiorPixels, roughness: 58, bump: 128 };
      await writeFile(`output/member-card/qa/invitation-${side}-foil-mask.png`, artwork[`${side}FoilMask`].toBuffer("image/png"));
    }
    assert.notEqual(fingerprint(artwork.frontFoilMask), fingerprint(artwork.backFoilMask), "Invitation faces must use different foil sizes and positions.");
    await writeFile("output/member-card/qa/invitation-foil-checks.json", JSON.stringify(reports, null, 2));
  }
  for (const side of ["front", "back"]) {
    const surface = artwork[side];
    // Check the actual text metrics and stroked rules against the entire foil
    // rectangle plus 24px of breathing room, rather than just its sparse pixels.
    const foilArea = invitation
      ? side === "front" ? { left: 742, right: 961, top: 1082, bottom: 1370 } : { left: 303, right: 706, top: 430, bottom: 978 }
      : { left: 755, right: 963, top: 1082, bottom: 1354 };
    for (const item of [...surface.printedText, ...surface.printedRules]) {
      const intersects = item.right > foilArea.left && item.left < foilArea.right && item.bottom > foilArea.top && item.top < foilArea.bottom;
      assert.equal(intersects, false, `${name} ${side} print overlaps the foil's reserved area: ${item.text || JSON.stringify(item)}`);
    }
    surface.printedText.forEach((item, index) => {
      assert.ok(item.left >= 50 && item.right <= 955 && item.top >= 50 && item.bottom <= 1370, `${name} ${side} text must remain inside the print area.`);
      for (const other of surface.printedText.slice(index + 1)) {
        const intersects = item.right > other.left && item.left < other.right && item.bottom > other.top && item.top < other.bottom;
        assert.equal(intersects, false, `${name} ${side} text runs overlap: ${item.text} / ${other.text}`);
      }
    });
    const shouldPrintName = side === "front" || !invitation && !card.buildingNow && !card.bio;
    const printedName = surface.printedText.filter(item => invitation
      ? item.font.includes("Inter Variable") && item.top > 1100 && /^700\s/.test(item.font)
      : item.font.includes("IvyOra") && (side === "front" || !card.buildingNow && !card.bio)).map(item => item.text).join("");
    const expectedIdentity = invitation && card.memberTag && card.name !== `@${card.memberTag}` ? `${card.name} @${card.memberTag}` : card.name;
    if (shouldPrintName) assert.equal(printedName.replace(/\s/g, ""), expectedIdentity.replace(/\s/g, ""), `${name} ${side} must preserve the full identity.`);
    layoutChecks.push({ name, side, textRuns: surface.printedText.length, rules: surface.printedRules.length, foilClearance: 24, nameCheck: shouldPrintName ? "passed" : "not printed on this face" });
  }
  if (name === "maximum") {
    const printed = (side, serif) => artwork[side].printedText.filter(item => /^W+$/.test(item.text) && item.font.includes("IvyOra") === serif).map(item => item.text).join("");
    assert.equal(printed("front", false), card.location, "All 160 location characters must survive the narrower metadata column.");
    assert.equal(printed("back", true), card.buildingNow, "All 100 building characters must remain visible.");
    assert.equal(printed("back", false), card.bio, "All 180 biography characters must remain visible.");
  }
}
// Exercise both cache orders. Rendering one variant must never stamp its foil
// into material canvases already held by the other variant's live 3D scene.
const isolationCard = { ...base, wearSeed: "invitation-first-material-isolation" };
const firstInvitation = await artworkModule.createCardArtwork(isolationCard, "invitation", invitationExpiresAt);
const invitationBefore = fingerprints(firstInvitation);
const nextMember = await artworkModule.createCardArtwork(isolationCard, "member");
const memberBefore = fingerprints(nextMember);
assert.deepEqual(fingerprints(firstInvitation), invitationBefore, "Rendering a member card must not mutate an existing invitation's materials.");
// Copying, revisiting, and even viewing after expiry retain the service's date;
// another browser render must never invent a fresh 48-hour invitation window.
proofNow += 72 * 60 * 60 * 1000;
const repeatedInvitation = await artworkModule.createCardArtwork(isolationCard, "invitation", invitationExpiresAt);
assert.deepEqual(fingerprints(nextMember), memberBefore, "Rendering an invitation must not mutate an existing member card's materials.");
assert.deepEqual(fingerprints(repeatedInvitation), invitationBefore, "Invitation material generation must remain deterministic across cache orders.");
for (const side of ["front", "back"]) assert.deepEqual(repeatedInvitation[side].toBuffer("image/png"), firstInvitation[side].toBuffer("image/png"), `Rendering the same issued invitation three days later must not change its ${side} print.`);
const renewedInvitation = await artworkModule.createCardArtwork(isolationCard, "invitation", "2026-09-24T02:45:00.000Z");
assert.equal(renewedInvitation.front.printedText.find(item => item.text.startsWith("VALID ")).text, "VALID UNTIL SEP. 23 8:45PM MDT", "Only a new service deadline changes the printed expiry.");
assert.notDeepEqual(renewedInvitation.front.toBuffer("image/png"), firstInvitation.front.toBuffer("image/png"), "A new issued deadline must invalidate the rendered front print.");
assert.deepEqual(fingerprints(renewedInvitation), invitationBefore, "A changed deadline must not alter the physical card materials.");
assert.notEqual(invitationBefore.backFoilMask, memberBefore.backFoilMask, "Variant material isolation must preserve different back foil masks.");
assert.deepEqual(fingerprints(memberMaterials.artwork), memberMaterials.fingerprints, "All proof variants must leave the original member materials unchanged.");
await writeFile("output/member-card/qa/artwork-layout-checks.json", JSON.stringify(layoutChecks, null, 2));
await writeFile("output/member-card/qa/invitation-artwork-checks.json", JSON.stringify(invitationChecks, null, 2));
console.log("Rendered standalone member, full-profile, and invitation artwork proofs. These do not verify browser layout or WebGL.");
