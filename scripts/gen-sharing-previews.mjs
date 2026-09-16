import { readFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

/** Preserve the approved cassette artwork byte-for-byte. No crop, overlay or re-encoding. */
export async function generateSharingPreviews() {
  const preview = JSON.parse(await readFile(join(root, "src/lib/sharing-previews.json"), "utf8"));
  const source = join(pub, preview.source);
  const metadata = await sharp(source).metadata();
  if (metadata.format !== "jpeg" || metadata.width !== preview.width || metadata.height !== preview.height) {
    throw new Error("The approved sharing artwork must match its declared JPEG dimensions.");
  }
  // Keep old URLs working without allowing a rejected room card to resurface.
  // These stay in public/, never Next's automatic app/ image conventions.
  const legacyFiles = [
    "opengraph-image.jpg", "twitter-image.jpg",
    ...["home", "store", "about", "community", "members", "work"].map((key) => `sharing/${key}-v2.jpg`),
  ];
  await Promise.all(legacyFiles.map((file) => copyFile(source, join(pub, file))));
  console.log(`Approved cassette artwork: ${metadata.width}×${metadata.height}; ${legacyFiles.length} compatibility copies updated.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateSharingPreviews().catch((error) => { console.error(error); process.exitCode = 1; });
}
