// Standalone print-artwork proof, independent of browser or WebGL rendering.
// Usage: CARD_CANVAS_MODULE=/absolute/path/to/@napi-rs/canvas/index.js node scripts/render-member-card-artwork.mjs
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { createCanvas, Image, GlobalFonts } = require(process.env.CARD_CANVAS_MODULE || "@napi-rs/canvas");
GlobalFonts.registerFromPath(resolve("public/fonts/IvyOraText-Regular.ttf"), "IvyOra Text");
GlobalFonts.registerFromPath(resolve("public/fonts/Inter-Variable-Latin.woff2"), "Inter Variable");
class LocalImage extends Image {
  set src(value) { super.src = readFileSync(resolve(`public${value}`)); }
  get naturalWidth() { return this.width; }
  get naturalHeight() { return this.height; }
}
function proofCanvas() {
  const surface = createCanvas(1, 1), context = surface.getContext("2d");
  surface.printedText = []; surface.printedRules = [];
  const fillText = context.fillText.bind(context), strokeRect = context.strokeRect.bind(context);
  const beginPath = context.beginPath.bind(context), moveTo = context.moveTo.bind(context), lineTo = context.lineTo.bind(context), stroke = context.stroke.bind(context);
  let points = [];
  context.fillText = (text, x, y, ...args) => {
    const metrics = context.measureText(text);
    surface.printedText.push({ text, font: context.font, left: x - metrics.actualBoundingBoxLeft, top: y - metrics.actualBoundingBoxAscent, right: x + metrics.actualBoundingBoxRight, bottom: y + metrics.actualBoundingBoxDescent });
    return fillText(text, x, y, ...args);
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
const document = { createElement: proofCanvas, fonts: { load: () => Promise.resolve() } };
function load(file) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "document", "Image", "window", "require", code)(mod, mod.exports, document, LocalImage, { setTimeout, clearTimeout }, name => name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`)) : name.startsWith(".") ? load(resolve(dirname(file), `${name}.ts`)) : require(name));
  return mod.exports;
}
const artworkModule = load(resolve("src/components/membership/card/card-artwork.ts"));
const base = { name: "Alex Morgan", memberTag: "alex_morgan", avatarUrl: null, memberSince: "2026-08-01T00:00:00Z", location: "Alpine, Utah", buildingNow: "A more deliberate creative practice.", bio: "Making space for the work, people, and experiences worth keeping.", websiteUrl: "https://theruinedproject.com/", labels: ["Foundations completed"], wearSeed: "sample-member-card-artwork" };
const cases = [
  ["sample", base],
  ["maximum", { ...base, memberTag: "w".repeat(24), name: "W".repeat(64), location: "W".repeat(160), bio: "W".repeat(180), buildingNow: "W".repeat(100), websiteUrl: `https://${"w".repeat(60)}.${"w".repeat(60)}.example/`, labels: ["An exceptionally long verified milestone title that must remain readable without escaping the card edge", "Another recorded milestone for testing the lower border"] }],
  ["profile", { ...base, name: "W".repeat(120), location: "W".repeat(160), buildingNow: "W".repeat(500), bio: "W".repeat(1200) }],
  ["invitation", { ...base, name: "Alex Morgan", memberTag: "alex_morgan", avatarUrl: null, location: null, memberSince: null, labels: [] }, "invitation"],
  ["invitation-long-name", { ...base, name: "W".repeat(120), avatarUrl: null, location: null, memberSince: null, labels: [] }, "invitation"],
  ["tag-as-name", { ...base, name: "@alex_morgan" }],
  ["legacy", { ...base, memberTag: null }],
  ["minimal", { ...base, name: "Alex", avatarUrl: null, memberSince: null, location: null, buildingNow: null, bio: null, websiteUrl: null, labels: [] }],
];
await mkdir("output/member-card/qa", { recursive: true });
const layoutChecks = [];
for (const [name, card, variant] of cases) {
  const artwork = await artworkModule.createCardArtwork(card, variant);
  const printedTag = artwork.front.printedText.filter(item => item.text === `@${card.memberTag}`);
  assert.equal(printedTag.length, card.memberTag ? 1 : 0, `${name} must print the tag exactly once.`);
  for (const side of ["front", "back"]) await writeFile(`output/member-card/qa/artwork-${name}-${side}.png`, artwork[side].toBuffer("image/png"));
  if (name === "sample") {
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
  for (const side of ["front", "back"]) {
    const surface = artwork[side];
    // Check the actual text metrics and stroked rules against the entire foil
    // rectangle plus 24px of breathing room, rather than just its sparse pixels.
    for (const item of [...surface.printedText, ...surface.printedRules]) {
      const intersects = item.right > 755 && item.left < 963 && item.bottom > 1082 && item.top < 1354;
      assert.equal(intersects, false, `${name} ${side} print overlaps the foil's reserved area: ${item.text || JSON.stringify(item)}`);
    }
    surface.printedText.forEach((item, index) => {
      assert.ok(item.left >= 50 && item.right <= 955 && item.top >= 50 && item.bottom <= 1370, `${name} ${side} text must remain inside the print area.`);
      for (const other of surface.printedText.slice(index + 1)) {
        const intersects = item.right > other.left && item.left < other.right && item.bottom > other.top && item.top < other.bottom;
        assert.equal(intersects, false, `${name} ${side} text runs overlap: ${item.text} / ${other.text}`);
      }
    });
    const printedName = surface.printedText.filter(item => item.font.includes("IvyOra") && (side === "front" ? variant !== "invitation" || item.top > 700 : !card.buildingNow && !card.bio)).map(item => item.text).join("");
    if (side === "front" || !card.buildingNow && !card.bio) assert.equal(printedName.replace(/\s/g, ""), card.name.replace(/\s/g, ""), `${name} ${side} must preserve the full name.`);
    layoutChecks.push({ name, side, textRuns: surface.printedText.length, rules: surface.printedRules.length, foilClearance: 24, nameCheck: side === "front" || !card.buildingNow && !card.bio ? "passed" : "not printed on this face" });
  }
  if (name === "maximum") {
    const printed = (side, serif) => artwork[side].printedText.filter(item => /^W+$/.test(item.text) && item.font.includes("IvyOra") === serif).map(item => item.text).join("");
    assert.equal(printed("front", false), card.location, "All 160 location characters must survive the narrower metadata column.");
    assert.equal(printed("back", true), card.buildingNow, "All 100 building characters must remain visible.");
    assert.equal(printed("back", false), card.bio, "All 180 biography characters must remain visible.");
  }
}
await writeFile("output/member-card/qa/artwork-layout-checks.json", JSON.stringify(layoutChecks, null, 2));
console.log("Rendered standalone member, full-profile, and invitation artwork proofs. These do not verify browser layout or WebGL.");
