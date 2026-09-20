// Offline, reproducible share media. No member data, links or deadlines are baked in.
// Requires ffmpeg and @napi-rs/canvas; set CARD_CANVAS_MODULE to its absolute path
// when using a separate asset-production runtime. Run from the repository root.
import { createRequire } from "node:module";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { createCanvas, Image, GlobalFonts } = require(process.env.CARD_CANVAS_MODULE || "@napi-rs/canvas");
for (const [file, family] of [["IvyOraText-Regular.ttf", "IvyOra Text"], ["Inter-Variable-Latin.woff2", "Inter Variable"], ["CadeHandy2.otf", "CadeHandy2"]]) {
  assert.ok(GlobalFonts.registerFromPath(resolve("public/fonts", file), family), `Missing font: ${file}`);
}
const printedText = [];
class LocalImage extends Image {
  set src(value) { super.src = readFileSync(resolve(`public${value}`)); }
  get naturalWidth() { return this.width; }
  get naturalHeight() { return this.height; }
}
function canvas(width = 1, height = 1) {
  const surface = createCanvas(width, height), ctx = surface.getContext("2d");
  const print = ctx.fillText.bind(ctx);
  // This is a reusable public teaser, not an issued invitation. Keep the shared
  // artwork unchanged; transform only its generic caption at this export boundary.
  ctx.fillText = (text, ...args) => {
    if (text.startsWith("VALID ")) return;
    const caption = text === "A personal invitation from" ? "A personal invitation" : text;
    printedText.push(caption);
    return print(caption, ...args);
  };
  return surface;
}
const document = { body: {}, createElement: () => canvas(), fonts: { load: () => Promise.resolve() } };
const window = { setTimeout, clearTimeout, getComputedStyle: () => ({ getPropertyValue: name => name === "--font-cadehandy2" ? '"CadeHandy2"' : "" }) };
// Keep the archive edition reproducible when this script is run in a later year.
class EditionDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-01-01T00:00:00.000Z"])); }
}
function load(file) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "document", "Image", "window", "Date", "require", code)(loaded, loaded.exports, document, LocalImage, window, EditionDate, name => name.startsWith("@/") ? load(resolve("src", `${name.slice(2)}.ts`)) : name.startsWith(".") ? load(resolve(dirname(file), `${name}.ts`)) : require(name));
  return loaded.exports;
}
const { createCardArtwork, CARD_WIDTH, CARD_HEIGHT } = load(resolve("src/components/membership/card/card-artwork.ts"));
const artwork = await createCardArtwork({ name: "THE RUINED PROJECT", memberTag: null, avatarUrl: null, memberSince: null, location: null, buildingNow: null, bio: null, websiteUrl: null, labels: [], wearSeed: "ruined-public-invitation-share-v1" }, "invitation", null);
assert.ok(printedText.includes("A personal invitation"));
assert.ok(printedText.includes("THE RUINED PROJECT"));
assert.ok(!printedText.some(text => /VALID |@/.test(text)), "Share media must not include a deadline or member tag.");

const width = 960, height = 720, fps = 24, seconds = 10;
const destination = resolve("public/membership/card/share"), proof = resolve("output/member-card/share-preview");
await mkdir(destination, { recursive: true });
await mkdir(proof, { recursive: true });
const room = new Image();
await new Promise((resolveImage, rejectImage) => {
  room.onload = resolveImage; room.onerror = rejectImage;
  room.src = readFileSync("public/membership/card/archive-room-v1.webp");
});
const background = createCanvas(width, height), bg = background.getContext("2d");
bg.fillStyle = "#080807"; bg.fillRect(0, 0, width, height);
const roomScale = height / room.height;
bg.drawImage(room, (width - room.width * roomScale) / 2, 0, room.width * roomScale, height);
bg.fillStyle = "#08080744"; bg.fillRect(0, 0, width, height);
const vignette = bg.createRadialGradient(480, 345, 120, 480, 345, 580);
vignette.addColorStop(0, "#00000000"); vignette.addColorStop(1, "#00000085");
bg.fillStyle = vignette; bg.fillRect(0, 0, width, height);
const film = createCanvas(width, height), ctx = film.getContext("2d");
const face = createCanvas(width, height), fc = face.getContext("2d");
const facePixels = fc.createImageData(width, height);
const source = Object.fromEntries(["front", "back"].map(side => [side, {
  pixels: artwork[side].getContext("2d").getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT).data,
  foil: artwork[`${side}FoilMask`].getContext("2d").getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT).data,
}]));
const physicalWidth = 408, physicalHeight = physicalWidth * CARD_HEIGHT / CARD_WIDTH, thickness = 2.1;
const focal = 1700, distance = 1700, center = [500, 350];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const plus = (a, b) => a.map((v, i) => v + b[i]);
const scaled = (a, scalar) => a.map(v => v * scalar);
function basis(angle) {
  const yaw = angle - .13, pitch = -.055 + .025 * Math.sin(angle), roll = -.025 + .016 * Math.sin(angle);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  return [[cz * cy - sz * sx * sy, sz * cy + cz * sx * sy, -cx * sy], [-sz * cx, cz * cx, sx], [cz * sy + sz * sx * cy, sz * sy - cz * sx * cy, cx * cy]];
}
function world(b, x, y, z) { return plus(plus(scaled(b[0], x), scaled(b[1], y)), plus(scaled(b[2], z), [0, 0, distance])); }
function project(point) { return [center[0] + point[0] * focal / point[2], center[1] + point[1] * focal / point[2]]; }
function perimeter(b, z) {
  const w = physicalWidth / 2, h = physicalHeight / 2, radius = 43 / CARD_WIDTH * physicalWidth;
  ctx.beginPath();
  for (let corner = 0; corner < 4; corner++) {
    const x = (corner === 0 || corner === 3 ? 1 : -1) * (w - radius);
    const y = (corner < 2 ? 1 : -1) * (h - radius);
    for (let sample = 0; sample <= 10; sample++) {
      const a = (corner + sample / 10) * Math.PI / 2;
      const p = project(world(b, x + radius * Math.cos(a), y + radius * Math.sin(a), z));
      if (!corner && !sample) ctx.moveTo(...p); else ctx.lineTo(...p);
    }
  }
  ctx.closePath();
}
function bilinear(pixels, x, y, channel) {
  const ix = Math.min(CARD_WIDTH - 2, Math.max(0, Math.floor(x))), iy = Math.min(CARD_HEIGHT - 2, Math.max(0, Math.floor(y)));
  const dx = Math.max(0, Math.min(1, x - ix)), dy = Math.max(0, Math.min(1, y - iy));
  const at = (iy * CARD_WIDTH + ix) * 4 + channel, row = CARD_WIDTH * 4;
  return (pixels[at] * (1 - dx) + pixels[at + 4] * dx) * (1 - dy) + (pixels[at + row] * (1 - dx) + pixels[at + row + 4] * dx) * dy;
}
function drawCard(angle) {
  const b = basis(angle), front = b[2][2] > 0, direction = front ? -1 : 1;
  // Real layered stock: the distant face is drawn first, then the near print.
  for (let layer = 0; layer <= 6; layer++) {
    const z = direction * thickness * (layer / 6 - .5);
    perimeter(b, z); ctx.fillStyle = layer % 2 ? "#aaa48e" : "#757164"; ctx.fill();
  }
  const u = scaled(b[0], front ? 1 : -1), v = b[1], n = b[2];
  const origin = world(b, 0, 0, direction * thickness / 2), numerator = dot(n, origin);
  const texture = source[front ? "front" : "back"], pixels = facePixels.data;
  pixels.fill(0);
  const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => project(world(b, x * physicalWidth / 2, y * physicalHeight / 2, direction * thickness / 2)));
  const minX = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0])))), maxX = Math.min(width - 1, Math.ceil(Math.max(...corners.map(p => p[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1])))), maxY = Math.min(height - 1, Math.ceil(Math.max(...corners.map(p => p[1]))));
  const light = [-.27, -.32, -.91], normal = scaled(n, direction);
  const illumination = .69 + .38 * Math.max(0, dot(normal, light));
  const glint = Math.pow(Math.max(0, Math.sin(angle + .35)), 14);
  for (let y = minY; y <= maxY; y++) {
    const dy = (y + .5 - center[1]) / focal;
    for (let x = minX; x <= maxX; x++) {
      const dx = (x + .5 - center[0]) / focal, denominator = n[0] * dx + n[1] * dy + n[2];
      if (Math.abs(denominator) < 1e-7) continue;
      const t = numerator / denominator;
      const px = t * dx - origin[0], py = t * dy - origin[1], pz = t - origin[2];
      const tx = (px * u[0] + py * u[1] + pz * u[2]) / physicalWidth + .5;
      const ty = (px * v[0] + py * v[1] + pz * v[2]) / physicalHeight + .5;
      if (tx < 0 || tx >= 1 || ty < 0 || ty >= 1) continue;
      const sx = tx * (CARD_WIDTH - 1), sy = ty * (CARD_HEIGHT - 1), offset = (y * width + x) * 4;
      const alpha = bilinear(texture.pixels, sx, sy, 3);
      if (alpha < 1) continue;
      const foil = bilinear(texture.foil, sx, sy, 0) / 255;
      const sheen = glint * Math.exp(-Math.pow((tx - .42) * 3, 2)) * 16;
      const hue = ty * 7 + tx * 3 + angle * 2;
      for (let channel = 0; channel < 3; channel++) {
        const color = bilinear(texture.pixels, sx, sy, channel);
        const iridescence = [Math.sin(hue + 2.8), Math.sin(hue + .7), Math.sin(hue - .8)][channel];
        pixels[offset + channel] = color * illumination + sheen + foil * (8 + 15 * iridescence + 16 * glint);
      }
      pixels[offset + 3] = alpha;
    }
  }
  fc.putImageData(facePixels, 0, 0); ctx.drawImage(face, 0, 0);
}
function frame(index) {
  const angle = index / (seconds * fps) * Math.PI * 2;
  ctx.drawImage(background, 0, 0);
  // Small periodic drifting dust avoids a visible cut at the loop boundary.
  for (let p = 0; p < 42; p++) {
    const phase = p * 2.399963, x = 70 + (p * 127.17 % 820) + Math.sin(angle + phase) * 10;
    const y = 130 + (p * 73.81 % 475) + Math.sin(angle + phase * 1.3) * 14;
    const brightness = .07 + .18 * Math.pow(Math.max(0, Math.sin(phase + angle)), 2);
    ctx.fillStyle = `rgba(235,220,187,${brightness})`; ctx.beginPath(); ctx.arc(x, y, .6 + (p % 5) * .2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save(); ctx.translate(502, 655); ctx.scale(1, .15);
  const shadow = ctx.createRadialGradient(0, 0, 18, 0, 0, 235);
  shadow.addColorStop(0, "#00000090"); shadow.addColorStop(.48, "#00000050"); shadow.addColorStop(1, "#00000000");
  ctx.fillStyle = shadow; ctx.fillRect(-240, -240, 480, 480); ctx.restore();
  drawCard(angle);
  return film;
}
function ffmpeg(args) {
  const child = spawn(process.env.FFMPEG || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["pipe", "inherit", "inherit"] });
  return { child, completed: once(child, "close").then(([code]) => { assert.equal(code, 0, "ffmpeg encoding failed."); }) };
}
const base = resolve(destination, "invitation-spin-v1"), movie = ffmpeg(["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${width}x${height}`, "-framerate", String(fps), "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${base}.mp4`]);
for (let index = 0; index < seconds * fps; index++) {
  const rendered = frame(index);
  if (index === 0) await writeFile(`${base}.jpg`, rendered.toBuffer("image/jpeg", 92));
  if ([0, 36, 60, 120, 180, 239].includes(index)) await writeFile(resolve(proof, `frame-${String(index).padStart(3, "0")}.png`), rendered.toBuffer("image/png"));
  if (!movie.child.stdin.write(Buffer.from(ctx.getImageData(0, 0, width, height).data))) await once(movie.child.stdin, "drain");
  if (index % fps === 0) console.log(`Rendered ${index / fps}/${seconds} seconds`);
}
movie.child.stdin.end(); await movie.completed;
// The video retains full resolution; a 640px GIF stays light for other scrapers.
const gif = ffmpeg(["-i", `${base}.mp4`, "-filter_complex", "fps=10,scale=640:480:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", `${base}.gif`]);
gif.child.stdin.end(); await gif.completed;
const files = await Promise.all(["mp4", "gif", "jpg"].map(async extension => ({ path: `public/membership/card/share/invitation-spin-v1.${extension}`, bytes: (await stat(`${base}.${extension}`)).size })));
assert.ok(files.reduce((sum, file) => sum + file.bytes, 0) < 9_500_000, "Combined preview media must leave room for icons within the 10 MB link-preview budget.");
console.log(JSON.stringify({ width, height, seconds, fps, frames: fps * seconds, files, genericArtwork: true }, null, 2));
