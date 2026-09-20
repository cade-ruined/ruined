import { memberCardExcerpt, type PublicMemberCard } from "@/lib/membership/public-card-model";
import { memberInvitationDeadline } from "@/lib/membership/invitation-expiry";
import { abbreviateCardText, fitCardText, type CardTextLayout } from "./card-text-layout";

export const CARD_WIDTH = 1008;
export const CARD_HEIGHT = 1408;
// The membership website's Ink theme, including its shipped print texture.
const palette = { ink: "#141413", panel: "#20201e", bone: "#e5e0d5", muted: "#b8b3a9", rule: "#e5e0d52c", edgeRule: "#e5e0d55c" } as const;
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

function canvas(width = CARD_WIDTH, height = CARD_HEIGHT) {
  const value = document.createElement("canvas"); value.width = width; value.height = height; return value;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const value = new Image();
    value.decoding = "async";
    const timer = window.setTimeout(() => { value.onload = null; value.onerror = null; resolve(null); }, 9000);
    value.onload = () => { clearTimeout(timer); resolve(value); };
    value.onerror = () => { clearTimeout(timer); resolve(null); };
    // Public and private portraits are same-origin, consent-filtered routes.
    value.src = src;
  });
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string = palette.muted, size = 19) {
  ctx.fillStyle = color; ctx.font = `500 ${size}px "Inter Variable", Inter, sans-serif`;
  ctx.letterSpacing = "2px"; ctx.fillText(text.toUpperCase(), x, y); ctx.letterSpacing = "0px";
}

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
const foilPosition = { x: 779, y: 1106, width: 224 * 283.956 / 400, height: 224 } as const;
const invitationFrontFoil = { x: 766, y: 1106, width: 240 * 283.956 / 400, height: 240 } as const;
const invitationBackFoil = { x: 327, y: 454, width: 500 * 283.956 / 400, height: 500 } as const;
type FoilStamp = { print: HTMLCanvasElement; mask: HTMLCanvasElement; roughness: HTMLCanvasElement; bump: HTMLCanvasElement; position: FoilPosition };
const foilCache = new WeakMap<HTMLImageElement, Map<FoilPosition, FoilStamp>>();
const stampedMaterials = new WeakSet<HTMLCanvasElement>();

/** A single supplied leaf silhouette; no badge outline or substitute geometry. */
function authenticityFoil(leaf: HTMLImageElement | null, position: FoilPosition = foilPosition): FoilStamp {
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
  // Each layout stamps its own foil positions without changing the physical wear.
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

export type CardVariant = "member" | "invitation";

function handwritingFamily() {
  return window.getComputedStyle(document.body).getPropertyValue("--font-cadehandy2").trim() || '"CadeHandy", cursive';
}

export function cardArtworkFontRequests(variant: CardVariant) {
  return ['400 72px "IvyOra Text"', '500 20px "Inter Variable"', ...(variant === "invitation" ? ['700 38px "Inter Variable"', `400 118px ${handwritingFamily()}`] : [])];
}

/** The invitation is its own print layout, using only consented identity fields. */
function printInvitation(front: CanvasRenderingContext2D, back: CanvasRenderingContext2D, card: PublicMemberCard, photo: HTMLImageElement | null, wordmark: HTMLImageElement | null, expiresAt: string | null, recipientName: string | null) {
  const cream = "#fff9e9";
  mark(front, wordmark, 52, 49, 266, 80, "#ffffff");
  front.fillStyle = cream; front.font = '700 38px "Inter Variable", Inter, sans-serif';
  front.textBaseline = "top"; front.textAlign = "right";
  const year = String(new Date().getUTCFullYear());
  front.fillText(year.slice(0, 2), 936, 52); front.fillText(year.slice(2), 936, 86);
  front.textAlign = "left";

  if (photo) cover(front, photo, 53, 154, 902, 646, .59);
  front.strokeStyle = palette.rule; front.lineWidth = 2; front.strokeRect(53, 154, 902, 646);
  // Match the actual visible handwriting bounds, including its low underline.
  front.font = `400 112px ${handwritingFamily()}`; front.fillStyle = cream;
  const handwritten = recipientName ? `This is for ${recipientName}.` : "This is for you.";
  front.textBaseline = "alphabetic";
  if (recipientName) {
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
  const identity = card.memberTag && card.name !== `@${card.memberTag}` ? `${card.name} @${card.memberTag}` : card.name;
  const identityFont = (size: number) => `700 ${size}px "Inter Variable", Inter, sans-serif`;
  const identityLayout = fitCardText(identity, { width: 674, height: 138, maxSize: 38, minSize: 20, leading: 1.16,
    measure: (value, size) => { front.font = identityFont(size); return front.measureText(value).width; } });
  const identityTop = Math.min(1206, 1274 - identityLayout.height);
  printText(front, textLayout(front, "A personal invitation from", 674, 48, 40, 40, true), 62, identityTop - 50, cream, true);
  front.fillStyle = cream; front.font = identityFont(identityLayout.size); front.textBaseline = "top";
  identityLayout.lines.forEach((line, index) => front.fillText(line, 62, identityTop + index * identityLayout.lineHeight));
  // Use the issued deadline from the service, never a rolling browser timer.
  const deadline = memberInvitationDeadline(expiresAt);
  const footer = deadline ? `VALID UNTIL ${deadline}` : "VALID FOR 48 HOURS ONCE CREATED";
  front.letterSpacing = "2px";
  let footerSize = 28;
  do { front.font = `400 ${footerSize}px "Courier New", monospace`; if (front.measureText(footer).width <= 674) break; footerSize -= 1; } while (footerSize > 18);
  front.fillText(footer, 62, 1310); front.letterSpacing = "0px";

  back.textAlign = "center";
  printText(back, textLayout(back, "You’re allowed", 880, 70, 50, 50, true), CARD_WIDTH / 2, 235, cream, true);
  printText(back, textLayout(back, "to become someone new.", 880, 70, 50, 50, true), CARD_WIDTH / 2, 1134, cream, true);
  back.textAlign = "left";
}

export async function createCardArtwork(source: PublicMemberCard, variant: CardVariant = "member", invitationExpiresAt: string | null = null, invitationRecipientName: string | null = null): Promise<CardArtwork> {
  const invitation = variant === "invitation";
  const card = invitation ? { ...source, avatarUrl: null, memberSince: null, location: null, labels: [], websiteUrl: null, buildingNow: null, bio: null } : { ...source, bio: source.bio ? memberCardExcerpt(source.bio, 180) : null, buildingNow: source.buildingNow ? memberCardExcerpt(source.buildingNow, 100) : null };
  const fonts = document.fonts ? Promise.allSettled(cardArtworkFontRequests(variant).map(font => document.fonts.load(font))) : Promise.resolve();
  let fontTimer: ReturnType<typeof setTimeout> | undefined;
  const [, [portrait, leaf, wordmark, paperPhoto, inkPhoto, invitationPhoto]] = await Promise.all([
    Promise.race([fonts, new Promise<void>(resolve => { fontTimer = setTimeout(resolve, 1800); })]).finally(() => { if (fontTimer) clearTimeout(fontTimer); }),
    Promise.all([card.avatarUrl ? loadImage(card.avatarUrl) : Promise.resolve(null), referenceImage("/ruined-mark.svg"), referenceImage("/ruined-wordmark.svg"), referenceImage("/membership/design/distressed-paper.jpg"), referenceImage("/membership/design/printers-ink.jpg"), invitation ? referenceImage("/membership/foundations/beginning.webp") : Promise.resolve(null)]),
  ]);
  const materials = cardMaterials(card.wearSeed, paperPhoto, variant);
  const foil = authenticityFoil(leaf, invitation ? invitationFrontFoil : foilPosition);
  const backFoil = invitation ? authenticityFoil(leaf, invitationBackFoil) : foil;
  stampMaterial(materials.front, foil); stampMaterial(materials.back, backFoil);
  const front = canvas(), back = canvas(); const f = front.getContext("2d")!, b = back.getContext("2d")!;
  for (const ctx of [f, b]) { rounded(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 43); ctx.clip(); }
  if (invitation) {
    for (const ctx of [f, b]) {
      inkBase(ctx, inkPhoto); ctx.strokeStyle = palette.edgeRule; ctx.lineWidth = 2;
      rounded(ctx, 25, 25, CARD_WIDTH - 50, CARD_HEIGHT - 50, 24); ctx.stroke();
    }
    printInvitation(f, b, card, invitationPhoto, wordmark, invitationExpiresAt, invitationRecipientName?.trim() || null);
    f.drawImage(materials.front.wear, 0, 0); b.drawImage(materials.back.wear, 0, 0);
    f.drawImage(foil.print, foil.position.x, foil.position.y); b.drawImage(backFoil.print, backFoil.position.x, backFoil.position.y);
    const roughness = canvas(512, 512); roughness.getContext("2d")!.drawImage(materials.front.roughness, 0, 0, 512, 512);
    return { front, back, roughness, frontRoughness: materials.front.roughness, backRoughness: materials.back.roughness, frontBump: materials.front.bump, backBump: materials.back.bump, frontFoilMask: foil.mask, backFoilMask: backFoil.mask, materialSeed: card.wearSeed };
  }
  inkBase(f, inkPhoto);
  f.strokeStyle = palette.edgeRule; f.lineWidth = 2; rounded(f, 25, 25, CARD_WIDTH - 50, CARD_HEIGHT - 50, 24); f.stroke();
  mark(f, wordmark, 64, 67, 196, 58.8, palette.bone);
  label(f, "MEMBERSHIP", 730, 106, palette.muted, 17);
  // Let a full name or location claim space from the portrait, never from legibility.
  const nameLayout = textLayout(f, card.name, 880, 292, 92, 30, true, 1.12);
  // Reserve the lower-right corner for the larger foil seal on both faces.
  const locationLayout = card.location ? textLayout(f, card.location, 674, 280, 30, 28, false, 1.24) : null;
  const metadataHeight = (card.memberSince ? 58 : 0) + (locationLayout ? 36 + locationLayout.height : 0);
  const metadataTop = Math.min(1110, 1306 - metadataHeight);
  const nameRule = metadataTop - 38;
  const tag = card.memberTag && card.name !== `@${card.memberTag}` ? `@${card.memberTag}` : null;
  const tagHeight = tag ? 52 : 0;
  const nameTop = nameRule - 28 - nameLayout.height - tagHeight;
  const px = 53, py = 154, pw = 902, ph = Math.min(766, nameTop - py - 50);
  f.fillStyle = palette.panel; f.fillRect(px, py, pw, ph);
  if (portrait) {
    f.save(); f.beginPath(); f.rect(px, py, pw, ph); f.clip(); cover(f, portrait, px, py, pw, ph);
    f.fillStyle = "#1414130d"; f.fillRect(px, py, pw, ph);
    const shade = f.createLinearGradient(0, py, 0, py + ph); shade.addColorStop(0, "#14141308"); shade.addColorStop(.6, "#14141300"); shade.addColorStop(1, "#0808076b"); f.fillStyle = shade; f.fillRect(px, py, pw, ph); f.restore();
  }
  f.strokeStyle = palette.rule; f.lineWidth = 3; f.strokeRect(px, py, pw, ph);
  printText(f, nameLayout, 64, nameTop, palette.bone, true);
  if (tag) printText(f, textLayout(f, tag, 880, 40, 29, 29), 66, nameTop + nameLayout.height + 16, palette.muted);
  f.strokeStyle = palette.rule; f.lineWidth = 1; f.beginPath(); f.moveTo(64, nameRule); f.lineTo(944, nameRule); f.stroke();
  let bottom = metadataTop;
  if (card.memberSince) { label(f, "MEMBER SINCE", 64, bottom + 20, palette.muted, 16); label(f, new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(card.memberSince)), 582, bottom + 20, palette.bone, 23); bottom += 58; }
  if (locationLayout) { label(f, "BASED IN", 64, bottom + 15, palette.muted, 16); printText(f, locationLayout, 64, bottom + 36, palette.bone); }
  label(f, "THE RUINED PROJECT", 64, 1350, palette.muted, 14);
  f.drawImage(materials.front.wear, 0, 0);
  f.drawImage(foil.print, foilPosition.x, foilPosition.y);

  inkBase(b, inkPhoto);
  b.strokeStyle = palette.edgeRule; b.lineWidth = 2; rounded(b, 25, 25, CARD_WIDTH - 50, CARD_HEIGHT - 50, 24); b.stroke();
  mark(b, wordmark, 65, 70, 196, 58.8, palette.bone); label(b, "A LITTLE ABOUT ME", 598, 108, palette.muted, 16);
  b.strokeStyle = palette.rule; b.beginPath(); b.moveTo(64, 165); b.lineTo(944, 165); b.stroke();
  const labels = card.labels.slice(0, 2).map(value => abbreviateCardText(textLayout(b, value, 638, 68, 26, 26), 2, 638, measure(b)));
  const labelHeight = labels.reduce((total, value) => total + value.height + 27, 0);
  const labelTop = 1205 - labelHeight;
  const contentBottom = Math.min(labels.length ? labelTop - 48 : 1070, 1070);
  const contentHeight = contentBottom - 235;
  const both = Boolean(card.buildingNow && card.bio);
  const textHeight = contentHeight - (card.buildingNow ? 55 : 0) - (card.bio ? 45 : 0) - (both ? 45 : 0);
  let y = 235;
  if (card.buildingNow) {
    label(b, "CURRENTLY BUILDING", 66, y + 18, palette.muted, 18); y += 55;
    const layout = textLayout(b, card.buildingNow, 864, both ? textHeight * .46 : textHeight, 60, 36, true);
    printText(b, layout, 64, y, palette.bone, true); y += layout.height + (both ? 45 : 0);
  }
  if (card.bio) {
    label(b, "ABOUT", 66, y + 18, palette.muted, 18); y += 45;
    const layout = textLayout(b, card.bio, 864, contentBottom - y, 32, 28, false, 1.35);
    printText(b, layout, 64, y, palette.bone);
  }
  if (!card.buildingNow && !card.bio) {
    printText(b, textLayout(b, card.name, 864, 280, 73, 30, true), 64, Math.min(850, contentBottom - 280), palette.bone, true);
  }
  if (labels.length) {
    let labelY = labelTop;
    labels.forEach((layout) => { b.strokeStyle = palette.edgeRule; b.strokeRect(65, labelY, 674, layout.height + 17); printText(b, layout, 83, labelY + 9, palette.bone); labelY += layout.height + 27; });
  }
  b.strokeStyle = palette.rule; b.beginPath(); b.moveTo(64, 1245); b.lineTo(742, 1245); b.stroke();
  if (card.websiteUrl) {
    const website = new URL(card.websiteUrl).hostname.replace(/^www\./, "");
    printText(b, abbreviateCardText(textLayout(b, website, 610, 58, 26, 26), 1, 610, measure(b)), 65, 1282, palette.bone); label(b, "↗", 710, 1303, palette.bone, 28);
  } else label(b, "THE RUINED PROJECT", 65, 1303, palette.muted, 16);
  label(b, "WHAT REMAINS MATTERS.", 65, 1360, palette.muted, 13);
  b.drawImage(materials.back.wear, 0, 0);
  b.drawImage(foil.print, foilPosition.x, foilPosition.y);

  const roughness = canvas(512, 512); roughness.getContext("2d")!.drawImage(materials.front.roughness, 0, 0, 512, 512);
  return { front, back, roughness, frontRoughness: materials.front.roughness, backRoughness: materials.back.roughness, frontBump: materials.front.bump, backBump: materials.back.bump, frontFoilMask: foil.mask, backFoilMask: foil.mask, materialSeed: card.wearSeed };
}

export async function downloadCardArtwork(card: PublicMemberCard, artwork: CardArtwork, side: "front" | "back", variant: CardVariant = "member") {
  const blob = await new Promise<Blob | null>(resolve => artwork[side].toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The card image could not be prepared.");
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${card.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member"}-ruined-${variant === "invitation" ? "invitation" : "card"}-${side}.png`;
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
