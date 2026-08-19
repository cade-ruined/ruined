import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const galleryRoot = path.join(
  root,
  "public",
  "events",
  "byob-01",
  "gallery"
);

function declaredGalleryImages(source) {
  return [
    ...source.matchAll(
      /src: "(\/events\/byob-01\/gallery\/([^"?]+\.webp))\?v=1",\s+width: (\d+),\s+height: (\d+)/g
    ),
  ].map((match) => ({
    src: match[1],
    file: match[2],
    width: Number(match[3]),
    height: Number(match[4]),
  }));
}

test("BYOB Nº 01 gallery data preserves the requested credit split", async () => {
  const [data, events, index, component, nextConfig] = await Promise.all([
    fs.readFile(path.join(root, "src", "data", "eventGalleries.ts"), "utf8"),
    fs.readFile(path.join(root, "src", "data", "events.ts"), "utf8"),
    fs.readFile(
      path.join(root, "src", "components", "events", "EventsIndex.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "components", "events", "EventGallery.tsx"),
      "utf8"
    ),
    fs.readFile(path.join(root, "next.config.mjs"), "utf8"),
  ]);

  const declaredImages = declaredGalleryImages(data);
  const paths = declaredImages.map((image) => image.src);

  assert.equal(paths.length, 28);
  assert.equal(new Set(paths).size, 28);
  assert.equal((data.match(/credited\(\{/g) ?? []).length, 27);
  assert.match(data, /const BYOB_01_LABEL = "BYOB Nº 01"/);
  assert.match(
    data,
    /const CODY_WHITING_CREDIT = "Cody Whiting Photography"/
  );

  const firstImage = data.slice(
    data.indexOf("src: \"/events/byob-01/gallery/01-img-8059.webp"),
    data.indexOf("credited({")
  );
  assert.doesNotMatch(firstImage, /credit:/);

  assert.match(events, /gallery\?: readonly EventGalleryImage\[\]/);
  assert.match(
    events,
    /gallery: isFirstEvent \? BYOB_01_GALLERY : undefined/
  );
  assert.match(index, /aria-labelledby="event-index-heading"/);
  assert.match(index, /const ARCHIVE_EVENTS = EVENTS\.filter/);
  assert.match(index, /const UPCOMING_EVENTS = EVENTS\.filter/);
  assert.match(index, /<select[\s\S]*value=\{selected\.id\}[\s\S]*onChange=/);
  assert.match(index, /<optgroup label="Archive">/);
  assert.match(index, /<optgroup label="Upcoming">/);
  assert.match(index, /if \(nextEvent\) selectEvent\(nextEvent\)/);
  assert.doesNotMatch(index, /aria-pressed=\{active\}|xl:grid-cols-12/);
  assert.match(index, /-mt-\[3\.25rem\][\s\S]*sm:-mt-\[3\.5rem\]/);
  assert.match(
    index,
    /Archive below · \{selected\.gallery\.length\} photographs/
  );
  assert.doesNotMatch(
    index,
    /calendarDays|monthCursor|Previous month|Next month/
  );
  assert.match(component, /<section[\s\S]*aria-labelledby=/);
  assert.match(component, /id=\{`\$\{eventId\}-gallery`\}/);
  assert.match(component, /<ol[\s\S]*<figure[\s\S]*<figcaption/);
  assert.match(component, /columns-2[\s\S]*sm:columns-3[\s\S]*lg:columns-4/);
  assert.match(component, /setActiveIndex\(index\)/);
  assert.match(component, /<dialog/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /dialog\.showModal\(\)/);
  assert.match(component, /onClose=\{handleDialogClose\}/);
  assert.match(component, /event\.key !== "Escape"/);
  assert.match(
    component,
    /download=\{activeImage\.src\.split\("\/"\)\.pop\(\)\?\.split\("\?"\)\[0\]\}/
  );
  assert.match(component, />\s*Save image\s*</);
  assert.match(component, />\s*Open original\s*</);
  assert.doesNotMatch(component, /<figcaption[\s\S]*\{image\.label\}/);
  assert.match(component, /image\.credit \?/);
  assert.match(component, /\{image\.credit\}/);
  assert.match(nextConfig, /"\/events\/byob-01\/gallery\/:path\*"/);
});

test("BYOB Nº 01 gallery serves only bounded WebP derivatives", async () => {
  const data = await fs.readFile(
    path.join(root, "src", "data", "eventGalleries.ts"),
    "utf8"
  );
  const declaredImages = declaredGalleryImages(data);
  const declaredByFile = new Map(
    declaredImages.map((image) => [image.file, image])
  );
  const files = (await fs.readdir(galleryRoot)).sort();
  assert.equal(files.length, 28);
  assert.ok(files.every((file) => /^\d{2}-[a-z0-9-]+\.webp$/.test(file)));
  assert.deepEqual(
    files,
    declaredImages.map((image) => image.file).sort(),
    "gallery data and on-disk filenames must match exactly"
  );

  let totalBytes = 0;
  for (const file of files) {
    const filePath = path.join(galleryRoot, file);
    const [metadata, stat] = await Promise.all([
      sharp(filePath).metadata(),
      fs.stat(filePath),
    ]);
    const declared = declaredByFile.get(file);
    assert.ok(declared, `${file} must be declared in gallery data`);
    totalBytes += stat.size;
    assert.equal(metadata.format, "webp", `${file} must be WebP`);
    assert.equal(metadata.width, declared.width, `${file} width is stale`);
    assert.equal(metadata.height, declared.height, `${file} height is stale`);
    assert.ok((metadata.width ?? 0) <= 2000, `${file} is too wide`);
    assert.ok((metadata.height ?? 0) <= 2000, `${file} is too tall`);
    assert.ok(stat.size < 1024 * 1024, `${file} exceeds 1 MiB`);
  }

  assert.ok(totalBytes < 15 * 1024 * 1024, "gallery exceeds 15 MiB");
});
