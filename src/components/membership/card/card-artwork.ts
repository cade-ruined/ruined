import type { PublicMemberCard } from "@/lib/membership/public-card-model";
import { memberInvitationDeadline } from "@/lib/membership/invitation-expiry";
import { fitCardText, type CardTextLayout } from "./card-text-layout";

export const CARD_WIDTH = 1008;
export const CARD_HEIGHT = 1408;
// The membership website's Ink theme, including its shipped print texture.
const palette = { ink: "#141413", rule: "#e5e0d52c", edgeRule: "#e5e0d55c" } as const;
export type CardArtwork = {
  front: HTMLCanvasElement; back: HTMLCanvasElement; roughness: HTMLCanvasElement;
  frontRoughness: HTMLCanvasElement; backRoughness: HTMLCanvasElement;
  frontBump: HTMLCanvasElement; backBump: HTMLCanvasElement; materialSeed: string;
  frontFoilMask: HTMLCanvasElement; backFoilMask: HTMLCanvasElement;
};

function randomFrom(seed: string) {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => { value |= 0; value = value + 0x6d2b79f5 | 0; let n = Math.imul(value ^ value >>> 15, 1 | value); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

export type CardVariant = "member" | "invitation";
export type CardArtworkEnvironment = {
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  loadImage: (src: string) => Promise<HTMLImageElement | null>;
  loadFonts: (requests: string[]) => Promise<unknown>;
  handwritingFamily: () => string;
  editionYear: () => number;
};

/** The browser and transactional email print the same artwork. Each renderer owns
 * its cache and drawing runtime; server rendering never mutates browser globals. */
export function createCardArtworkRenderer(environment: CardArtworkEnvironment) {
function canvas(width = CARD_WIDTH, height = CARD_HEIGHT) { return environment.createCanvas(width, height); }
const loadImage = environment.loadImage;

const font = (size: number, serif = false) => `400 ${size}px ${serif ? '"IvyOra Text", Georgia, serif' : '"Inter Variable", Inter, sans-serif'}`;
function measure(ctx: CanvasRenderingContext2D, serif = false) {
  return (value: string, size: number) => { ctx.font = font(size, serif); return ctx.measureText(value).width; };
}
function textLayout(ctx: CanvasRenderingContext2D, value: string, width: number, height: number, maxSize: number, minSize: number, serif = false, leading = 1.2) {
  return fitCardText(value, { width, height, maxSize, minSize, leading, measure: measure(ctx, serif) });
}
function printText(ctx: CanvasRenderingContext2D, layout: CardTextLayout, x: number, y: number, color: string, serif = false) {
  ctx.save(); ctx.font = font(layout.size, serif); ctx.fillStyle = color; ctx.textBaseline = "top";
  layout.lines.forEach((line, index) => ctx.fillText(line, x, y + layout.lineHeight * index)); ctx.restore();
}

function cover(ctx: CanvasRenderingContext2D, photo: HTMLImageElement, x: number, y: number, width: number, height: number, positionY = .4) {
  const scale = Math.max(width / photo.naturalWidth, height / photo.naturalHeight);
  const sw = width / scale, sh = height / scale;
  ctx.drawImage(photo, (photo.naturalWidth - sw) / 2, (photo.naturalHeight - sh) * positionY, sw, sh, x, y, width, height);
}

function inkBase(ctx: CanvasRenderingContext2D, photo: HTMLImageElement | null) {
  ctx.fillStyle = palette.ink; ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  if (!photo) return;
  cover(ctx, photo, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = "#00000038"; ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

function mark(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, x: number, y: number, width: number, height: number, color: string) {
  if (!image) return;
  const tint = canvas(Math.ceil(width), Math.ceil(height)); const t = tint.getContext("2d")!;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const imageWidth = image.naturalWidth * scale, imageHeight = image.naturalHeight * scale;
  t.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight); t.globalCompositeOperation = "source-in"; t.fillStyle = color; t.fillRect(0, 0, width, height);
  ctx.drawImage(tint, x, y);
}

type CardMaterial = { wear: HTMLCanvasElement; roughness: HTMLCanvasElement; bump: HTMLCanvasElement };
type FoilPosition = { x: number; y: number; width: number; height: number };
const invitationFrontFoil = { x: 766, y: 1106, width: 240 * 283.956 / 400, height: 240 } as const;
const invitationBackFoil = { x: 327, y: 454, width: 500 * 283.956 / 400, height: 500 } as const;
type FoilStamp = { print: HTMLCanvasElement; mask: HTMLCanvasElement; roughness: HTMLCanvasElement; bump: HTMLCanvasElement; position: FoilPosition };
const foilCache = new WeakMap<HTMLImageElement, Map<FoilPosition, FoilStamp>>();
const stampedMaterials = new WeakSet<HTMLCanvasElement>();

/** A single supplied leaf silhouette; no badge outline or substitute geometry. */
function authenticityFoil(leaf: HTMLImageElement | null, position: FoilPosition): FoilStamp {
  const cached = leaf ? foilCache.get(leaf)?.get(position) : null;
  if (cached) return cached;
  const { x, y, width, height } = position;
  const shape = canvas(Math.ceil(width), height), s = shape.getContext("2d")!;
  mark(s, leaf, 0, 0, width, height, "#ffffff");
  const print = canvas(shape.width, height), p = print.getContext("2d")!;
  const gradient = p.createLinearGradient(0, 0, width, height);
  for (const [offset, color] of [[0, "#a9c4c6"], [.18, "#e0e2dc"], [.34, "#78abb3"], [.5, "#b7a6ce"], [.68, "#e7e4da"], [.84, "#9abaca"], [1, "#b2c2b7"]] as const) gradient.addColorStop(offset, color);
  p.fillStyle = gradient; p.fillRect(0, 0, print.width, print.height);
  p.globalCompositeOperation = "destination-in"; p.drawImage(shape, 0, 0);
  // Three reads grayscale RGB, so bake exact antialias coverage onto opaque black.
  const mask = canvas(), m = mask.getContext("2d")!;
  m.fillStyle = "#000000"; m.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT); m.drawImage(shape, x, y);
  const patches = [58, 128].map(value => {
    const patch = canvas(shape.width, height), context = patch.getContext("2d")!;
    context.drawImage(shape, 0, 0); context.globalCompositeOperation = "source-in";
    context.fillStyle = `rgb(${value},${value},${value})`; context.fillRect(0, 0, patch.width, patch.height);
    return patch;
  });
  const result = { print, mask, roughness: patches[0], bump: patches[1], position };
  if (leaf) {
    const stamps = foilCache.get(leaf) ?? new Map<FoilPosition, FoilStamp>();
    stamps.set(position, result); foilCache.set(leaf, stamps);
  }
  return result;
}

function stampMaterial(material: CardMaterial, foil: FoilStamp) {
  if (stampedMaterials.has(material.roughness)) return;
  // Smooth foil only inside the exact leaf; preserve the worn paper everywhere else.
  material.roughness.getContext("2d")!.drawImage(foil.roughness, foil.position.x, foil.position.y);
  material.bump.getContext("2d")!.drawImage(foil.bump, foil.position.x, foil.position.y);
  stampedMaterials.add(material.roughness);
}

const materialCache = new Map<string, { front: CardMaterial; back: CardMaterial }>();
const referenceImages = new Map<string, Promise<HTMLImageElement | null>>();
function referenceImage(src: string) {
  if (!referenceImages.has(src)) referenceImages.set(src, loadImage(src));
  return referenceImages.get(src)!;
}
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function noiseField(seed: string, spacing: number) {
  const cols = Math.ceil(CARD_WIDTH / spacing) + 2, rows = Math.ceil(CARD_HEIGHT / spacing) + 2;
  const values = new Float32Array(cols * rows), random = randomFrom(seed);
  for (let index = 0; index < values.length; index++) values[index] = random();
  return (x: number, y: number) => {
    const gx = x / spacing, gy = y / spacing, ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = values[iy * cols + ix], b = values[iy * cols + ix + 1], c = values[(iy + 1) * cols + ix], d = values[(iy + 1) * cols + ix + 1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

/** Extract real fine paper structure without importing the source's large folds. */
function paperFibers(image: HTMLImageElement | null) {
  const w = CARD_WIDTH, h = CARD_HEIGHT, detail = new Float32Array(w * h);
  if (!image) return detail;
  const sample = canvas(), ctx = sample.getContext("2d")!;
  cover(ctx, image, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data, integral = new Float32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const index = y * w + x, rgba = index * 4;
      const value = (pixels[rgba] * .2126 + pixels[rgba + 1] * .7152 + pixels[rgba + 2] * .0722) / 255;
      detail[index] = value; sum += value; integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + sum;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - 7), x1 = Math.min(w, x + 8), y0 = Math.max(0, y - 7), y1 = Math.min(h, y + 8);
    const average = (integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    detail[y * w + x] -= average;
  }
  return detail;
}

function stockMaterial(seed: string, dark: boolean, fibers: Float32Array, edgeWear = 0): CardMaterial {
  const w = CARD_WIDTH, h = CARD_HEIGHT, wear = canvas(), roughness = canvas(), bump = canvas();
  const a = wear.getContext("2d")!, r = roughness.getContext("2d")!, b = bump.getContext("2d")!;
  const surface = a.createImageData(w, h), finish = r.createImageData(w, h), height = b.createImageData(w, h);
  const broad = noiseField(`${seed}:handling`, 78), chips = noiseField(`${seed}:chips`, 6), rnd = randomFrom(seed);
  const corners = Array.from({ length: 4 }, () => .35 + rnd() * .9);
  const rubX = w * (.77 + rnd() * .16), rubY = h * (.2 + rnd() * .27);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const index = y * w + x, rgba = index * 4;
    // Signed distance follows the rounded cut, including the four actual corners.
    const qx = Math.abs(x - w / 2) - (w / 2 - 43), qy = Math.abs(y - h / 2) - (h / 2 - 43);
    const edge = 43 - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0);
    const region = broad(x, y), fleck = chips(x, y), grain = rnd() - .5;
    const cornerIndex = (x > w / 2 ? 1 : 0) + (y > h / 2 ? 2 : 0);
    const corner = Math.exp(-Math.hypot(Math.min(x, w - x), Math.min(y, h - y)) / 112) * corners[cornerIndex];
    const oxidation = Math.exp(-Math.max(edge, 0) / 19) * (.24 + region * .76);
    const wornDepth = region * 1.2 + corner * (4 + region * 17) + Math.pow(fleck, 8) * 5 + edgeWear * (.45 + region * .8);
    const bare = edge < 0 ? 0 : clamp((wornDepth - edge + .5) / 2) * clamp(.2 + fleck * 1.1) * clamp(region * 2.15 - .2);
    const paper = fibers[dark ? (h - y - 1) * w + (w - x - 1) : index];
    const rubbed = Math.exp(-((x - rubX) ** 2 / 155 ** 2 + (y - rubY) ** 2 / 235 ** 2)) * Math.max(0, region - .2);
    const fine = Math.min(Math.abs(paper), dark ? .065 : .072) * (dark ? .42 : .85) + Math.abs(grain) * .01;
    const tint = oxidation * (dark ? .1 : .22);
    const baseAlpha = clamp(fine + tint + rubbed * .018, 0, .25), stockAlpha = bare * (dark ? .87 : .95);
    const alpha = stockAlpha + baseAlpha * (1 - stockAlpha);
    const baseColor = tint > fine ? dark ? [157, 149, 114] : [94, 83, 62] : paper + grain * .02 > 0 ? [240, 234, 211] : [32, 28, 19];
    const stock = dark ? [222 + grain * 15, 210 + grain * 12, 184 + grain * 9] : [214 + grain * 15, 207 + grain * 12, 192 + grain * 9];
    for (let channel = 0; channel < 3; channel++) surface.data[rgba + channel] = alpha ? (stock[channel] * stockAlpha + baseColor[channel] * baseAlpha * (1 - stockAlpha)) / alpha : 0;
    surface.data[rgba + 3] = edge >= 0 ? alpha * 255 : 0;
    const rough = clamp(176 + region * 26 + rubbed * 29 + Math.abs(paper) * 90 + grain * 6 + bare * 49, 0, 255);
    const relief = clamp(128 + paper * 85 + grain * 3 - bare * (15 + fleck * 7) - rubbed * 2, 0, 255);
    for (let channel = 0; channel < 3; channel++) { finish.data[rgba + channel] = rough; height.data[rgba + channel] = relief; }
    finish.data[rgba + 3] = 255; height.data[rgba + 3] = 255;
  }
  a.putImageData(surface, 0, 0); r.putImageData(finish, 0, 0); b.putImageData(height, 0, 0);
  // Hairlines roughen the coating; only their shallowest tonal trace is printed.
  for (let index = 0; index < 19; index++) {
    const side = rnd() > .5, x = side ? w - 14 - rnd() * 55 : 14 + rnd() * 55, y = 65 + rnd() * (h - 130);
    const dx = (side ? -1 : 1) * (5 + rnd() * 29), dy = (rnd() - .5) * 34;
    for (const [ctx, color, width] of [[a, dark ? "#d4ccb72b" : "#60544338", .65], [r, "#ececec9c", 1.3], [b, "#55555567", .8]] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + dx * .46, y + dy * .38, x + dx, y + dy); ctx.stroke();
    }
  }
  // One shallow corner compression, far from the identity and reading area.
  const right = rnd() > .5, creaseX = right ? w : 0, inward = right ? -1 : 1, startY = h - 105 - rnd() * 65, reach = 72 + rnd() * 46;
  for (const [ctx, color, width, offset] of [[a, "#231f1824", 1.4, 0], [a, "#f1e6cb28", .8, 1.1], [r, "#ebebeb8c", 3, 0], [b, "#5252527a", 1.8, 0], [b, "#b4b4b432", 1, 1.2]] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(creaseX, startY + offset); ctx.bezierCurveTo(creaseX + inward * reach * .24, startY + 31 + offset, creaseX + inward * reach * .69, h - 28 + offset, creaseX + inward * reach, h + offset); ctx.stroke();
  }
  return { wear, roughness, bump };
}

function cardMaterials(seed: string, photo: HTMLImageElement | null, variant: CardVariant) {
  // Preserve each variant's physical wear while sharing the approved print layout.
  const key = `${variant}:${seed}`;
  const existing = materialCache.get(key);
  if (existing) return existing;
  const fibers = paperFibers(photo);
  const edgeWear = variant === "invitation" ? 3.5 : 0;
  const material = { front: stockMaterial(seed, true, fibers, edgeWear), back: stockMaterial(`${seed}:back`, true, fibers, edgeWear) };
  materialCache.set(key, material);
  // A live editor reuses its physical stock while the selected text changes.
  if (materialCache.size > 2) materialCache.delete(materialCache.keys().next().value!);
  return material;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); }

function handwritingFamily() { return environment.handwritingFamily(); }

function cardArtworkFontRequests() {
  return ['400 72px "IvyOra Text"', '500 20px "Inter Variable"', '700 38px "Inter Variable"', `400 118px ${handwritingFamily()}`];
}

/** Both cards retain the supplied Ruined artwork. Only an invitation may print
 * a recipient, sender wording or deadline; member cards identify their owner. */
function printCard(front: CanvasRenderingContext2D, back: CanvasRenderingContext2D, card: PublicMemberCard, photo: HTMLImageElement | null, wordmark: HTMLImageElement | null, variant: CardVariant, expiresAt: string | null, recipientName: string | null, invitationSource: "member" | "ruined_direct") {
  const invitation = variant === "invitation";
  const cream = "#fff9e9";
  mark(front, wordmark, 52, 49, 266, 80, "#ffffff");
  front.fillStyle = cream; front.font = '700 38px "Inter Variable", Inter, sans-serif';
  front.textBaseline = "top"; front.textAlign = "right";
  const year = String(environment.editionYear());
  front.fillText(year.slice(0, 2), 936, 52); front.fillText(year.slice(2), 936, 86);
  front.textAlign = "left";

  if (photo) cover(front, photo, 53, 154, 902, 646, .59);
  front.strokeStyle = palette.rule; front.lineWidth = 2; front.strokeRect(53, 154, 902, 646);
  // Match the actual visible handwriting bounds, including its low underline.
  front.font = `400 112px ${handwritingFamily()}`; front.fillStyle = cream;
  const handwritten = invitation && recipientName ? `This is for ${recipientName}.` : "This is for you.";
  front.textBaseline = "alphabetic";
  if (invitation && recipientName) {
    const layout = fitCardText(handwritten, { width: 870, height: 208, maxSize: 112, minSize: 28, leading: 1.12,
      measure: (value, size) => { front.font = `400 ${size}px ${handwritingFamily()}`; const metrics = front.measureText(value); return Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight); } });
    front.font = `400 ${layout.size}px ${handwritingFamily()}`;
    layout.lines.forEach((line, index) => {
      const metrics = front.measureText(line);
      front.fillText(line, 62 + metrics.actualBoundingBoxLeft, 839 + metrics.actualBoundingBoxAscent + index * layout.lineHeight);
    });
  } else {
    const handwritingMetrics = front.measureText(handwritten);
    front.fillText(handwritten, 62 + handwritingMetrics.actualBoundingBoxLeft, 839 + handwritingMetrics.actualBoundingBoxAscent);
  }

  front.strokeStyle = palette.rule; front.lineWidth = 1;
  front.beginPath(); front.moveTo(62, 1073); front.lineTo(944, 1073); front.stroke();
  const identity = card.name;
  const identityFont = (size: number) => `700 ${size}px "Inter Variable", Inter, sans-serif`;
  const identityLayout = fitCardText(identity, { width: 674, height: 138, maxSize: 38, minSize: 20, leading: 1.16,
    measure: (value, size) => { front.font = identityFont(size); return front.measureText(value).width; } });
  const identityTop = Math.min(1206, 1274 - identityLayout.height);
  printText(front, textLayout(front, invitation ? invitationSource === "ruined_direct" ? "An invitation from" : "A personal invitation from" : "Ruined member", 674, 48, 40, 40, true), 62, identityTop - 50, cream, true);
  front.fillStyle = cream; front.font = identityFont(identityLayout.size); front.textBaseline = "top";
  identityLayout.lines.forEach((line, index) => front.fillText(line, 62, identityTop + index * identityLayout.lineHeight));
  // Use the issued deadline from the service, never a rolling browser timer.
  const deadline = invitation ? memberInvitationDeadline(expiresAt) : null;
  const footer = deadline ? `VALID UNTIL ${deadline}` : invitation && invitationSource === "ruined_direct" ? "VALID FOR 48 HOURS ONCE CREATED" : null;
  if (footer) {
    front.letterSpacing = "2px";
    let footerSize = 28;
    do { front.font = `400 ${footerSize}px "Courier New", monospace`; if (front.measureText(footer).width <= 674) break; footerSize -= 1; } while (footerSize > 18);
    front.fillText(footer, 62, 1310); front.letterSpacing = "0px";
  }

  back.textAlign = "center";
  printText(back, textLayout(back, "You’re allowed", 880, 70, 50, 50, true), CARD_WIDTH / 2, 235, cream, true);
  printText(back, textLayout(back, "to become someone new.", 880, 70, 50, 50, true), CARD_WIDTH / 2, 1134, cream, true);
  back.textAlign = "left";
}

async function createCardArtwork(source: PublicMemberCard, variant: CardVariant = "member", invitationExpiresAt: string | null = null, invitationRecipientName: string | null = null, invitationSource: "member" | "ruined_direct" = "member"): Promise<CardArtwork> {
  const invitation = variant === "invitation";
  // Keep the print boundary name-only even if a caller supplies legacy profile fields.
  const card: PublicMemberCard = {
    name: invitation && invitationSource === "ruined_direct" ? "The Ruined Project" : source.name,
    wearSeed: source.wearSeed,
    memberTag: null, avatarUrl: null, memberSince: null, location: null,
    bio: null, buildingNow: null, websiteUrl: null, labels: [],
  };
  const fonts = environment.loadFonts(cardArtworkFontRequests());
  let fontTimer: ReturnType<typeof setTimeout> | undefined;
  const [, [leaf, wordmark, paperPhoto, inkPhoto, cardPhoto]] = await Promise.all([
    Promise.race([fonts, new Promise<void>(resolve => { fontTimer = setTimeout(resolve, 1800); })]).finally(() => { if (fontTimer) clearTimeout(fontTimer); }),
    Promise.all([referenceImage("/ruined-mark.svg"), referenceImage("/ruined-wordmark.svg"), referenceImage("/membership/design/distressed-paper.jpg"), referenceImage("/membership/design/printers-ink.jpg"), referenceImage("/membership/foundations/beginning.webp")]),
  ]);
  const materials = cardMaterials(card.wearSeed, paperPhoto, variant);
  const foil = authenticityFoil(leaf, invitationFrontFoil);
  const backFoil = authenticityFoil(leaf, invitationBackFoil);
  stampMaterial(materials.front, foil); stampMaterial(materials.back, backFoil);
  const front = canvas(), back = canvas(); const f = front.getContext("2d")!, b = back.getContext("2d")!;
  for (const ctx of [f, b]) { rounded(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 43); ctx.clip(); }
  for (const ctx of [f, b]) {
    inkBase(ctx, inkPhoto); ctx.strokeStyle = palette.edgeRule; ctx.lineWidth = 2;
    rounded(ctx, 25, 25, CARD_WIDTH - 50, CARD_HEIGHT - 50, 24); ctx.stroke();
  }
  printCard(f, b, card, cardPhoto, wordmark, variant, invitationExpiresAt, invitationRecipientName?.trim() || null, invitationSource);
  f.drawImage(materials.front.wear, 0, 0); b.drawImage(materials.back.wear, 0, 0);
  f.drawImage(foil.print, foil.position.x, foil.position.y); b.drawImage(backFoil.print, backFoil.position.x, backFoil.position.y);
  const roughness = canvas(512, 512); roughness.getContext("2d")!.drawImage(materials.front.roughness, 0, 0, 512, 512);
  return { front, back, roughness, frontRoughness: materials.front.roughness, backRoughness: materials.back.roughness, frontBump: materials.front.bump, backBump: materials.back.bump, frontFoilMask: foil.mask, backFoilMask: backFoil.mask, materialSeed: card.wearSeed };
}

return { createCardArtwork, cardArtworkFontRequests };
}

const browserArtworkRenderer = createCardArtworkRenderer({
  createCanvas: (width, height) => { const value = document.createElement("canvas"); value.width = width; value.height = height; return value; },
  loadImage: src => new Promise(resolve => {
    const value = new Image();
    value.decoding = "async";
    const timer = window.setTimeout(() => { value.onload = null; value.onerror = null; resolve(null); }, 9000);
    value.onload = () => { clearTimeout(timer); resolve(value); };
    value.onerror = () => { clearTimeout(timer); resolve(null); };
    // Card artwork loads only the fixed, shipped Ruined assets.
    value.src = src;
  }),
  loadFonts: requests => document.fonts ? Promise.allSettled(requests.map(font => document.fonts.load(font))) : Promise.resolve(),
  handwritingFamily: () => window.getComputedStyle(document.body).getPropertyValue("--font-cadehandy2").trim() || '"CadeHandy", cursive',
  editionYear: () => new Date().getUTCFullYear(),
});
export const createCardArtwork = browserArtworkRenderer.createCardArtwork;
export const cardArtworkFontRequests = browserArtworkRenderer.cardArtworkFontRequests;

export async function downloadCardArtwork(card: PublicMemberCard, artwork: CardArtwork, side: "front" | "back", variant: CardVariant = "member") {
  const blob = await new Promise<Blob | null>(resolve => artwork[side].toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The card image could not be prepared.");
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${card.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member"}-ruined-${variant === "invitation" ? "invitation" : "card"}-${side}.png`;
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
