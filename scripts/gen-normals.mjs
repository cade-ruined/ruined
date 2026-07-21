// Derive tangent-space normal maps from the albedo textures. We treat each
// texture's luminance as a height field and run a Sobel filter to get surface
// gradients, then encode the normal into RGB. Tileable (samples wrap at edges).
//
// Usage: node scripts/gen-normals.mjs
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEX = path.join(__dirname, "..", "public", "textures");

// name -> bump strength (higher = deeper relief)
const TEXTURES = {
  concrete: 1.6,
  brick: 3.2,
  floor: 0.6,
  wood: 2.6,
  leather: 1.4,
  steel: 0.8,
  plaster: 1.0,
};

const SIZE = 512; // normal maps can be lower-res than albedo

const wrap = (v, n) => (v + n) % n;

async function build(name, strength) {
  const src = path.join(TEX, `${name}.jpg`);
  const { data, info } = await sharp(src)
    .resize(SIZE, SIZE, { fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const height = (x, y) => data[wrap(y, h) * w + wrap(x, w)] / 255;

  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel
      const tl = height(x - 1, y - 1);
      const t = height(x, y - 1);
      const tr = height(x + 1, y - 1);
      const l = height(x - 1, y);
      const r = height(x + 1, y);
      const bl = height(x - 1, y + 1);
      const b = height(x, y + 1);
      const br = height(x + 1, y + 1);

      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);

      let nx = dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const i = (y * w + x) * 3;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }

  await sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(TEX, `${name}_n.png`));
  console.log(`  ${name}_n.png`);
}

const run = async () => {
  console.log("Building normal maps…");
  for (const [name, strength] of Object.entries(TEXTURES)) {
    await build(name, strength);
  }
  console.log("Done.");
};

run();
