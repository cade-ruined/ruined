import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the home feature grid leads with the BYOB Nº 01 recap", async () => {
  const [indexSource, gallerySource] = await Promise.all([
    fs.readFile(
      path.join(root, "src", "components", "sequence", "JourneyIndexes.tsx"),
      "utf8"
    ),
    fs.readFile(
      path.join(root, "src", "data", "eventGalleries.ts"),
      "utf8"
    ),
  ]);

  const byobPosition = indexSource.indexOf("key: `events-${byobOne.id}`");
  const castPosition = indexSource.indexOf('key: "meet-the-cast"');
  const aboutPosition = indexSource.indexOf('key: "what-is-this"');

  assert.ok(byobPosition >= 0);
  assert.ok(byobPosition < castPosition);
  assert.ok(castPosition < aboutPosition);
  assert.match(indexSource, /candidate\.id === "byob-01"/);
  assert.match(indexSource, /href: `\/community#\$\{byobOne\.id\}`/);
  assert.match(indexSource, /image: byobOne\.gallery\?\.\[0\]\?\.src \?\? byobOne\.image/);
  assert.match(indexSource, /href: "#about"/);
  assert.match(indexSource, /priority=\{index === 0\}/);
  assert.match(
    gallerySource,
    /src: "\/events\/byob-01\/gallery\/01-img-8059\.webp\?v=1"/
  );
});
