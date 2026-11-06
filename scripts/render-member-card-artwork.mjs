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
  ["member-image-fallback", { ...base, avatarUrl: privatePortrait }],
  ["maximum", { ...base, memberTag: "w".repeat(24), name: "W".repeat(64), location: "W".repeat(160), bio: "W".repeat(180), buildingNow: "W".repeat(100), websiteUrl: `https://${"w".repeat(60)}.${"w".repeat(60)}.example/`, labels: ["An exceptionally long verified milestone title that must remain readable without escaping the card edge", "Another recorded milestone for testing the lower border"] }],
  ["profile", { ...base, name: "W".repeat(120), location: "W".repeat(160), buildingNow: "W".repeat(500), bio: "W".repeat(1200) }],
  ["invitation", { ...base, name: "Alex Morgan", memberTag: "alex_morgan", avatarUrl: null, location: null, memberSince: null, labels: [] }, "invitation"],
  ["invitation-long-name", { ...base, name: "W".repeat(120), avatarUrl: null, location: null, memberSince: null, labels: [] }, "invitation"],
  ["invitation-maximum-tag", { ...base, name: "W".repeat(120), memberTag: "w".repeat(24) }, "invitation"],
  ["invitation-tag-as-name", { ...base, name: "@alex_morgan" }, "invitation"],
  ["invitation-legacy", { ...base, memberTag: null }, "invitation"],
  ["invitation-private-profile", { ...base, avatarUrl: privatePortrait, location: "PRIVATE LOCATION", labels: ["PRIVATE LABEL"], buildingNow: "PRIVATE BUILDING", bio: "PRIVATE BIOGRAPHY", websiteUrl: "https://private-website.example/" }, "invitation"],
  ["invitation-legacy-fields", { ...base, memberTag: null, avatarUrl: null, websiteUrl: null }, "invitation"],
  ["invitation-image-fallback", { ...base, avatarUrl: privatePortrait }, "invitation"],
  ["invitation-unissued", { ...base }, "invitation", null],
  ["invitation-personal", { ...base }, "invitation", invitationExpiresAt, "Taylor"],
  ["invitation-personal-long", { ...base }, "invitation", invitationExpiresAt, "W".repeat(100)],
  ["invitation-personal-name", { ...base }, "invitation", invitationExpiresAt, "Alexandra Marie Rodríguez Williams"],
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
for (const [name, card, variant, expiresAt = invitationExpiresAt, recipientName = null] of cases) {
  // Pass raw legacy fields through: the renderer itself must ignore them.
  const fallback = name.endsWith("image-fallback");
  // A fresh module avoids the successful reference-image cache masking failure.
  const renderer = fallback ? load(resolve("src/components/membership/card/card-artwork.ts")) : artworkModule;
  const requestStart = imageRequests.length;
  if (fallback) rejectedImages.add(invitationPhoto);
  let artwork;
  try { artwork = await renderer.createCardArtwork(card, variant, variant === "invitation" ? expiresAt : null, recipientName); }
  finally { rejectedImages.delete(invitationPhoto); }
  const invitation = variant === "invitation";
  const requested = imageRequests.slice(requestStart);
  assert.equal(requested.includes(privatePortrait), false, `${name} must never fetch a private portrait.`);
  const photoDraws = artwork.front.printedImages.filter(item => item.source === invitationPhoto);
  assert.equal(photoDraws.length, fallback ? 0 : 1, `${name} must use the shared couch photograph when available.`);
  if (!fallback) assert.deepEqual(photoDraws[0].crop.slice(-4), [53, 154, 902, 646], `${name} must preserve the reference photo frame.`);
  const textBySide = [artwork.front, artwork.back].map(surface => surface.printedText.map(item => item.text));
  assert.doesNotMatch(textBySide.flat().join(" "), /PRIVATE|private-website|MEMBER SINCE|BASED IN|A LITTLE ABOUT ME|CURRENTLY BUILDING|Foundations completed|Making space|deliberate creative practice|Alpine, Utah/, `${name} must not print profile details.`);
  assert.equal(artwork.back.printedImages.some(item => item.source === invitationPhoto), false, `${name} must reserve the photograph for the front.`);
  if (name === "sample" || fallback) assert.ok(requested.includes(invitationPhoto), `${name} must request the shared couch photograph.`);
  if (invitation) {
    const invitationLabel = artwork.front.printedText.filter(item => item.text === "A personal invitation from");
    assert.equal(invitationLabel.length, 1, `${name} must identify the inviter exactly once.`);
    assert.ok(Number.parseFloat(invitationLabel[0].font.match(/([\d.]+)px/)[1]) >= 36, `${name} inviter label must retain readable type.`);
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
    const memberLabel = artwork.front.printedText.filter(item => item.text === "Ruined member");
    assert.equal(memberLabel.length, 1, `${name} must identify the member exactly once.`);
    assert.doesNotMatch(textBySide.flat().join(" "), /invitation from|VALID /i, `${name} must not include invitation-only copy.`);
    if (fallback) {
      assert.deepEqual(textBySide, [memberMaterials.artwork.front, memberMaterials.artwork.back].map(surface => surface.printedText.map(item => item.text)), "An unavailable photo must retain the member headline, identity, and back message.");
      assert.notDeepEqual(artwork.front.toBuffer("image/png"), memberMaterials.artwork.front.toBuffer("image/png"), "The member image failure must exercise the ink-only photo fallback.");
    }
  }
  if (name === "member-with-portrait") {
    assert.equal(requested.includes(memberPortrait), false, "Name-only member artwork must not fetch a profile portrait.");
    for (const side of ["front", "back"]) assert.deepEqual(artwork[side].toBuffer("image/png"), memberMaterials.artwork[side].toBuffer("image/png"), `A legacy portrait must not change the member ${side}.`);
  }
  const printedTagCount = artwork.front.printedText.map(item => item.text).join("").replace(/\s/g, "").split(`@${card.memberTag}`).length - 1;
  assert.equal(printedTagCount, card.memberTag && card.name === `@${card.memberTag}` ? 1 : 0, `${name} must not add a member tag to the name.`);
  for (const side of ["front", "back"]) await writeFile(`output/member-card/qa/artwork-${name}-${side}.png`, artwork[side].toBuffer("image/png"));
  if (name === "sample") {
    memberMaterials = { artwork, fingerprints: fingerprints(artwork) };
  }
  if (invitation) {
    assert.deepEqual(fingerprints(memberMaterials.artwork), memberMaterials.fingerprints, "An invitation sharing a member wear seed must not mutate that member's material maps.");
  }
  {
    const handwriting = artwork.front.printedText.filter(item => item.font.includes("CadeHandy2"));
    assert.ok(handwriting.length, "The card must use the supplied handwriting font.");
    assert.equal(handwriting.map(item => item.text).join("").replace(/\s/g, ""),
      (invitation && recipientName ? `This is for ${recipientName}.` : "This is for you.").replace(/\s/g, ""),
      "The chosen recipient name must be printed completely.");
    for (const line of handwriting) assert.ok(line.left >= 60 && line.right <= 946 && line.top >= 830 && line.bottom < 1073,
      `The handwriting must stay below the photograph and above the footer rule: ${JSON.stringify(line)}`);
    assert.deepEqual(artwork.back.printedText.map(item => item.text), ["You’re allowed", "to become someone new."], "The back must preserve the supplied message without extra fields.");
    const validity = artwork.front.printedText.filter(item => item.text.startsWith("VALID "));
    assert.equal(validity.length, invitation && expiresAt ? 1 : 0, `${name} must print only a service-issued deadline.`);
    if (invitation && expiresAt) {
      assert.equal(validity[0].text, "VALID UNTIL SEP. 20 8:45PM MDT", `${name} must print its issued deadline.`);
      assert.ok(validity[0].left >= 60 && validity[0].right <= 738 && validity[0].top >= 1300 && validity[0].bottom <= 1350, `${name} validity line must remain below the identity and clear of the foil: ${JSON.stringify(validity[0])}`);
    }
  }
  if (name === "sample" || name === "invitation") {
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
      await writeFile(`output/member-card/qa/${invitation ? "invitation" : "member"}-${side}-foil-mask.png`, artwork[`${side}FoilMask`].toBuffer("image/png"));
    }
    assert.notEqual(fingerprint(artwork.frontFoilMask), fingerprint(artwork.backFoilMask), "Card faces must use different foil sizes and positions.");
    await writeFile(`output/member-card/qa/${invitation ? "invitation" : "member"}-foil-checks.json`, JSON.stringify(reports, null, 2));
  }
  for (const side of ["front", "back"]) {
    const surface = artwork[side];
    // Check the actual text metrics and stroked rules against the entire foil
    // rectangle plus 24px of breathing room, rather than just its sparse pixels.
    const foilArea = side === "front" ? { left: 742, right: 961, top: 1082, bottom: 1370 } : { left: 303, right: 706, top: 430, bottom: 978 };
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
    const shouldPrintName = side === "front";
    const nameLines = surface.printedText.filter(item => item.font.includes("Inter Variable") && item.top > 1100 && /^700\s/.test(item.font));
    const printedName = nameLines.map(item => item.text).join("");
    for (const line of nameLines) assert.ok(line.left >= 60 && line.right <= 738 && line.top > 1100 && line.bottom <= 1275,
      `${name} must keep the member name in the footer, clear of the photo, headline, and foil: ${JSON.stringify(line)}`);
    const expectedIdentity = card.name;
    if (shouldPrintName) assert.equal(printedName.replace(/\s/g, ""), expectedIdentity.replace(/\s/g, ""), `${name} ${side} must preserve the full identity.`);
    layoutChecks.push({ name, side, textRuns: surface.printedText.length, rules: surface.printedRules.length, foilClearance: 24, nameCheck: shouldPrintName ? "passed" : "not printed on this face" });
  }
  if (name === "maximum") {
    const printed = side => artwork[side].printedText.filter(item => /^W+$/.test(item.text)).map(item => item.text).join("");
    assert.equal(printed("front"), card.name, "Only the complete member name must appear in the footer; no legacy location details.");
    assert.equal(printed("back"), "", "The back must retain its fixed message without member details.");
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
assert.equal(invitationBefore.frontFoilMask, memberBefore.frontFoilMask, "Both card variants must preserve the approved front foil placement.");
assert.equal(invitationBefore.backFoilMask, memberBefore.backFoilMask, "Both card variants must preserve the approved back foil placement.");
for (const key of ["frontRoughness", "backRoughness", "frontBump", "backBump"]) assert.notStrictEqual(firstInvitation[key], nextMember[key], `Variants must own their ${key} canvas even when the approved artwork matches.`);
assert.deepEqual(fingerprints(memberMaterials.artwork), memberMaterials.fingerprints, "All proof variants must leave the original member materials unchanged.");
await writeFile("output/member-card/qa/artwork-layout-checks.json", JSON.stringify(layoutChecks, null, 2));
await writeFile("output/member-card/qa/invitation-artwork-checks.json", JSON.stringify(invitationChecks, null, 2));
console.log("Rendered name-only member and invitation artwork proofs, including recipient personalization. These do not verify browser layout or WebGL.");
