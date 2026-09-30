// Rasterize the exact brand font for email clients that cannot load web fonts.
// Transparent 2x artwork; run from the repository root.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

assert.ok(GlobalFonts.registerFromPath(resolve("public/fonts/CadeHandy2.otf"), "CadeHandy2"));

function visibleBounds(surface) {
  const { data } = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height);
  let left = surface.width, top = surface.height, right = -1, bottom = -1;
  for (let y = 0; y < surface.height; y += 1) {
    for (let x = 0; x < surface.width; x += 1) {
      if (data[(y * surface.width + x) * 4 + 3] > 0) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
  }
  assert.ok(right >= left && bottom >= top, "The font must produce visible text.");
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

await mkdir(resolve("public/membership/email"), { recursive: true });
for (const [filename, text, displayWidth] of [
  ["first-thank-you-cadehandy2.png", "First, thank you.", 250],
  ["after-the-fear-cadehandy2.png", "After the fear", 220],
]) {
  const measure = createCanvas(1, 1).getContext("2d");
  measure.font = '300px "CadeHandy2"';
  const metrics = measure.measureText(text);
  const source = createCanvas(Math.ceil(metrics.width + 600), 1000);
  const sourceContext = source.getContext("2d");
  sourceContext.font = measure.font;
  sourceContext.fillStyle = "#ffca2c";
  sourceContext.fillText(text, 300, 550);
  const bounds = visibleBounds(source);
  assert.ok(bounds.left > 0 && bounds.top > 0 && bounds.right < source.width - 1 && bounds.bottom < source.height - 1, "Source lettering is not clipped.");

  const padding = 12;
  const width = displayWidth * 2;
  const scale = (width - padding * 2) / bounds.width;
  const letteringHeight = bounds.height * scale;
  const height = Math.ceil((letteringHeight + padding * 2) / 2) * 2;
  const image = createCanvas(width, height);
  image.getContext("2d").drawImage(source, bounds.left, bounds.top, bounds.width, bounds.height, padding, (height - letteringHeight) / 2, width - padding * 2, letteringHeight);
  const finalBounds = visibleBounds(image);
  assert.ok(finalBounds.left >= padding && finalBounds.top >= padding && width - finalBounds.right - 1 >= padding && height - finalBounds.bottom - 1 >= padding, "At least six display pixels of transparent safety space surround the lettering.");
  const path = resolve("public/membership/email", filename);
  await writeFile(path, await image.encode("png"));
  console.log(JSON.stringify({ path, text, width, height, displayWidth, displayHeight: height / 2, visibleBounds: finalBounds }));
}
