import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { CARD_HEIGHT, CARD_WIDTH, createCardArtworkRenderer } from "@/components/membership/card/card-artwork";

/** An immutable snapshot of the invitation that admitted this registration. */
export type RegistrationInvitationCard = {
  recipientName: string;
  inviterName: string;
  inviterTag: string | null;
  invitationSource: "member" | "ruined_direct";
  issuedAt: string;
  expiresAt: string | null;
  wearSeed: string;
};

export const REGISTRATION_INVITATION_IMAGE_WIDTH = 1200;
export const REGISTRATION_INVITATION_IMAGE_HEIGHT = 1060;
// Keep these paths literal so deployment tracing includes this small artwork set,
// rather than treating the whole public directory as a dynamic file dependency.
const assetPaths: Readonly<Record<string, string>> = {
  "/ruined-mark.svg": join(process.cwd(), "public/ruined-mark.svg"),
  "/ruined-wordmark.svg": join(process.cwd(), "public/ruined-wordmark.svg"),
  "/membership/design/distressed-paper.jpg": join(process.cwd(), "public/membership/design/distressed-paper.jpg"),
  "/membership/design/printers-ink.jpg": join(process.cwd(), "public/membership/design/printers-ink.jpg"),
  "/membership/foundations/beginning.webp": join(process.cwd(), "public/membership/foundations/beginning.webp"),
  "/membership/card/archive-room-v1.webp": join(process.cwd(), "public/membership/card/archive-room-v1.webp"),
};
const fontPaths = [
  [join(process.cwd(), "public/fonts/IvyOraText-Regular.ttf"), "IvyOra Text"],
  [join(process.cwd(), "public/fonts/Inter-Variable-Latin.woff2"), "Inter Variable"],
  [join(process.cwd(), "public/fonts/CadeHandy2.otf"), "CadeHandy2"],
] as const;
const imageCache = new Map<string, Promise<Image>>();
let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  for (const [file, family] of fontPaths) {
    if (!GlobalFonts.registerFromPath(file, family)) throw new Error("Invitation artwork font is unavailable.");
  }
  fontsRegistered = true;
}

function localImage(src: string): Promise<Image> {
  // The renderer accepts identity text only. No recipient-controlled path or URL
  // can reach the image decoder or trigger a network request.
  const file = Object.prototype.hasOwnProperty.call(assetPaths, src) ? assetPaths[src] : null;
  if (!file) throw new Error("Invitation artwork source is not allowed.");
  let image = imageCache.get(src);
  if (!image) {
    image = readFile(file).then(bytes => loadImage(bytes));
    imageCache.set(src, image);
    void image.catch(() => { if (imageCache.get(src) === image) imageCache.delete(src); });
  }
  return image;
}

function validate(input: RegistrationInvitationCard) {
  const validDeadline = input.expiresAt === null
    ? input.invitationSource === "member"
    : typeof input.expiresAt === "string" && Number.isFinite(Date.parse(input.expiresAt));
  if (![input.recipientName, input.inviterName, input.wearSeed].every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 256)
    || (input.inviterTag !== null && (typeof input.inviterTag !== "string" || input.inviterTag.length > 64))
    || !["member", "ruined_direct"].includes(input.invitationSource)
    || !Number.isFinite(Date.parse(input.issuedAt)) || !validDeadline) {
    throw new Error("Invitation artwork requires a complete issued invitation.");
  }
}

type Vec3 = [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaled = (a: Vec3, scale: number): Vec3 => [a[0] * scale, a[1] * scale, a[2] * scale];

/** Same physical-card projection used by the invitation's public share artwork. */
function projectCard(context: SKRSContext2D, print: Canvas, foilMask: Canvas) {
  const width = REGISTRATION_INVITATION_IMAGE_WIDTH, height = REGISTRATION_INVITATION_IMAGE_HEIGHT;
  const physicalWidth = 610, physicalHeight = physicalWidth * CARD_HEIGHT / CARD_WIDTH;
  const focal = 2200, distance = 2200, center = [618, 519], thickness = 3;
  const yaw = -.13, pitch = -.055, roll = -.025;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  const basis: [Vec3, Vec3, Vec3] = [[cz * cy - sz * sx * sy, sz * cy + cz * sx * sy, -cx * sy], [-sz * cx, cz * cx, sx], [cz * sy + sz * sx * cy, sz * sy - cz * sx * cy, cx * cy]];
  const world = (x: number, y: number, z: number): Vec3 => plus(plus(scaled(basis[0], x), scaled(basis[1], y)), plus(scaled(basis[2], z), [0, 0, distance]));
  const project = (point: Vec3) => [center[0] + point[0] * focal / point[2], center[1] + point[1] * focal / point[2]];
  const radius = 43 / CARD_WIDTH * physicalWidth;
  for (let layer = 0; layer <= 6; layer++) {
    context.beginPath();
    for (let corner = 0; corner < 4; corner++) {
      const x = (corner === 0 || corner === 3 ? 1 : -1) * (physicalWidth / 2 - radius);
      const y = (corner < 2 ? 1 : -1) * (physicalHeight / 2 - radius);
      for (let sample = 0; sample <= 10; sample++) {
        const angle = (corner + sample / 10) * Math.PI / 2;
        const point = project(world(x + radius * Math.cos(angle), y + radius * Math.sin(angle), -thickness * (layer / 6 - .5)));
        if (!corner && !sample) context.moveTo(point[0], point[1]); else context.lineTo(point[0], point[1]);
      }
    }
    context.closePath(); context.fillStyle = layer % 2 ? "#aaa48e" : "#757164"; context.fill();
  }
  const face = createCanvas(width, height), faceContext = face.getContext("2d");
  const output = faceContext.createImageData(width, height);
  const colors = print.getContext("2d").getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT).data;
  const foil = foilMask.getContext("2d").getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT).data;
  const sample = (pixels: Uint8ClampedArray, x: number, y: number, channel: number) => {
    const ix = Math.min(CARD_WIDTH - 2, Math.max(0, Math.floor(x))), iy = Math.min(CARD_HEIGHT - 2, Math.max(0, Math.floor(y)));
    const dx = Math.max(0, Math.min(1, x - ix)), dy = Math.max(0, Math.min(1, y - iy));
    const at = (iy * CARD_WIDTH + ix) * 4 + channel, row = CARD_WIDTH * 4;
    return (pixels[at] * (1 - dx) + pixels[at + 4] * dx) * (1 - dy) + (pixels[at + row] * (1 - dx) + pixels[at + row + 4] * dx) * dy;
  };
  const [u, v, n] = basis, origin = world(0, 0, -thickness / 2), numerator = dot(n, origin);
  const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => project(world(x * physicalWidth / 2, y * physicalHeight / 2, -thickness / 2)));
  const minX = Math.max(0, Math.floor(Math.min(...corners.map(point => point[0])))), maxX = Math.min(width - 1, Math.ceil(Math.max(...corners.map(point => point[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map(point => point[1])))), maxY = Math.min(height - 1, Math.ceil(Math.max(...corners.map(point => point[1]))));
  const illumination = .69 + .38 * Math.max(0, dot(scaled(n, -1), [-.27, -.32, -.91]));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const dx = (x + .5 - center[0]) / focal, dy = (y + .5 - center[1]) / focal;
    const denominator = n[0] * dx + n[1] * dy + n[2];
    if (Math.abs(denominator) < 1e-7) continue;
    const t = numerator / denominator, offset = (y * width + x) * 4;
    const point: Vec3 = [t * dx - origin[0], t * dy - origin[1], t - origin[2]];
    const tx = dot(point, u) / physicalWidth + .5, ty = dot(point, v) / physicalHeight + .5;
    if (tx < 0 || tx >= 1 || ty < 0 || ty >= 1) continue;
    const px = tx * (CARD_WIDTH - 1), py = ty * (CARD_HEIGHT - 1), alpha = sample(colors, px, py, 3);
    if (alpha < 1) continue;
    const mask = sample(foil, px, py, 0) / 255, hue = ty * 7 + tx * 3;
    for (let channel = 0; channel < 3; channel++) {
      const iridescence = [Math.sin(hue + 2.8), Math.sin(hue + .7), Math.sin(hue - .8)][channel];
      output.data[offset + channel] = sample(colors, px, py, channel) * illumination + mask * (8 + 15 * iridescence);
    }
    output.data[offset + 3] = alpha;
  }
  faceContext.putImageData(output, 0, 0); context.drawImage(face, 0, 0);
}

/** Produces private attachment bytes only; never persists personal artwork into
 * the public directory, and never calls a browser, external URL, or provider. */
export async function renderRegistrationInvitationHero(input: RegistrationInvitationCard): Promise<Buffer> {
  validate(input);
  registerFonts();
  const renderer = createCardArtworkRenderer({
    createCanvas: (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
    loadImage: async src => await localImage(src) as unknown as HTMLImageElement,
    loadFonts: () => Promise.resolve(),
    handwritingFamily: () => '"CadeHandy2"',
    editionYear: () => new Date(input.issuedAt).getUTCFullYear(),
  });
  const [artwork, room] = await Promise.all([
    renderer.createCardArtwork({ name: input.inviterName, memberTag: input.inviterTag, wearSeed: input.wearSeed, avatarUrl: null, memberSince: null, location: null, buildingNow: null, bio: null, websiteUrl: null, labels: [] }, "invitation", input.expiresAt, input.recipientName, input.invitationSource),
    localImage("/membership/card/archive-room-v1.webp"),
  ]);
  const width = REGISTRATION_INVITATION_IMAGE_WIDTH, height = REGISTRATION_INVITATION_IMAGE_HEIGHT;
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  context.fillStyle = "#10100f"; context.fillRect(0, 0, width, height);
  const scale = Math.max(width / room.width, height / room.height);
  context.drawImage(room, (width - room.width * scale) / 2, 0, room.width * scale, room.height * scale);
  context.fillStyle = "#0808073b"; context.fillRect(0, 0, width, height);
  const vignette = context.createRadialGradient(600, 520, 180, 600, 520, 760);
  vignette.addColorStop(0, "#00000000"); vignette.addColorStop(1, "#00000092");
  context.fillStyle = vignette; context.fillRect(0, 0, width, height);
  for (let particle = 0; particle < 62; particle++) {
    const phase = particle * 2.399963;
    context.fillStyle = `rgba(235,220,187,${.06 + .16 * Math.pow(Math.max(0, Math.sin(phase)), 2)})`;
    context.beginPath(); context.arc(55 + (particle * 159.17 % 1090), 90 + (particle * 83.81 % 800), .7 + particle % 5 * .22, 0, Math.PI * 2); context.fill();
  }
  context.save(); context.translate(619, 954); context.scale(1, .14);
  const shadow = context.createRadialGradient(0, 0, 20, 0, 0, 330);
  shadow.addColorStop(0, "#000000a0"); shadow.addColorStop(.5, "#00000050"); shadow.addColorStop(1, "#00000000");
  context.fillStyle = shadow; context.fillRect(-335, -335, 670, 670); context.restore();
  projectCard(context, artwork.front as unknown as Canvas, artwork.frontFoilMask as unknown as Canvas);
  const fade = context.createLinearGradient(0, 938, 0, height);
  fade.addColorStop(0, "#10100f00"); fade.addColorStop(1, "#10100fff");
  context.fillStyle = fade; context.fillRect(0, 938, width, height - 938);
  return canvas.encode("jpeg", 88);
}
