import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  getProductSizeGuide,
  getProductSizeGuideConfig,
} from "../src/data/product-size-guides.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BYOB Tank resolves each exact Shopify Fit to the correct chart", () => {
  const women = getProductSizeGuide("byob-tank", "Women's");
  const men = getProductSizeGuide("byob-tank", "Men's");

  assert.equal(women?.image.src, "/store/byob-tank/size-chart-womens.webp");
  assert.equal(women?.fit, "Women's");
  assert.equal(men?.image.src, "/store/byob-tank/size-chart-mens.webp");
  assert.equal(men?.fit, "Men's");
});

test("size guides fail closed for unknown products, fits, and missing selection", () => {
  assert.equal(getProductSizeGuide("byob-tank", undefined), undefined);
  assert.equal(getProductSizeGuide("byob-tank", "Unisex"), undefined);
  assert.equal(getProductSizeGuide("another-product", "Men's"), undefined);
});

test("BYOB Tank size-guide configuration follows its live Fit and Size options", () => {
  assert.deepEqual(
    {
      fitOption: getProductSizeGuideConfig("byob-tank")?.fitOption,
      sizeOption: getProductSizeGuideConfig("byob-tank")?.sizeOption,
    },
    { fitOption: "Fit", sizeOption: "Size" }
  );
});

test("BYOB Tank size-guide assets exist at their declared dimensions", async () => {
  for (const fit of ["Men's", "Women's"] as const) {
    const guide = getProductSizeGuide("byob-tank", fit);
    assert.ok(guide);

    const assetPath = path.join(root, "public", guide.image.src.replace(/^\//, ""));
    const [asset, metadata] = await Promise.all([
      stat(assetPath),
      sharp(assetPath).metadata(),
    ]);

    assert.ok(asset.size > 0, `${fit} chart must not be empty`);
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, guide.image.width);
    assert.equal(metadata.height, guide.image.height);
    assert.match(guide.image.alt, new RegExp(`^${fit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} BYOB Tank size chart`));
  }
});
