import assert from "node:assert/strict";
import test from "node:test";
import { RANCH_PRODUCT_IDS, isRanchProduct, getRanchProducts, getRanchRackSelections, getRanchCollectionHref } from "../src/lib/store/ranch-catalog.js";
import { getCatalogEntries, getProductColorImages, getVariantImage } from "../src/lib/store/product-colors.ts";
import { filterCatalogProducts, getCollectionFilters, getProductCategory } from "../src/lib/store/catalog-filters.ts";

const colors = ["Black", "Blue", "Brown"];
const collection = { handle: "ruined-ranch", title: "Ruined Ranch" };
const definitions = [
  ["mens-ruined-ranch-hoodie", "Men's Ruined Ranch Hoodie", "Mens", "Top"],
  ["womens-ruined-ranch-crop-hoodie", "Women's Ruined Ranch Crop Hoodie", "Womens", "Top"],
  ["mens-ruined-ranch-sweatpants", "Men's Ruined Ranch Sweatpants", "Mens", "Bottom"],
  ["womens-ruined-ranch-sweatpants", "Women's Ruined Ranch Sweatpants", "Womens", "Bottom"],
];
function makeRanch(index) {
  const [id, name, gender, garment] = definitions[index];
  const photos = colors.flatMap((color) => {
    const part = garment === "Top" ? "Top" : gender === "Mens" ? color === "Black" ? "Bottoms" : "Bottom" : color === "Brown" ? "Bottom" : "Bottoms";
    return (garment === "Top" ? ["", "_Back"] : [""]).map((view) => ({
      url: `https://cdn.shopify.com/s/files/1/1001/files/RR_${gender}_${part}_${color}${view}_Concrete_Flash.png?v=123`, alt: name,
    }));
  });
  const product = {
    id, name, shopifyProductGid: RANCH_PRODUCT_IDS[index], price: garment === "Top" ? "$96" : "$72", available: true,
    options: [{ name: "Color", values: colors }, { name: "Size", values: ["S", "M"] }],
    collections: [collection], image: photos[0], images: [...photos].reverse(),
    variants: colors.flatMap((color, colorIndex) => ["S", "M"].map((size, sizeIndex) => ({
      id: `gid://shopify/ProductVariant/${index}${colorIndex}${sizeIndex}`, available: true,
      selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: size }],
      priceAmount: garment === "Top" ? "96.00" : "72.00", currencyCode: "USD", image: photos[0],
    }))),
  };
  return product;
}

test("Ranch color galleries use exact garment and color filenames, front before back, without changing media", () => {
  for (let index = 0; index < 4; index++) {
    const product = makeRanch(index);
    const before = JSON.stringify(product);
    for (const color of colors) {
      const images = getProductColorImages(product, color);
      assert.equal(images.length, index < 2 ? 2 : 1);
      assert.match(images[0].url, new RegExp(`_${color}_Concrete_Flash\\.png`));
      assert.equal(images[0].alt, `${product.name} — ${color}, front`);
      if (index < 2) {
        assert.match(images[1].url, new RegExp(`_${color}_Back_Concrete_Flash\\.png`));
        assert.equal(images[1].alt, `${product.name} — ${color}, back`);
      }
      const selected = product.variants.find(({ selectedOptions }) => selectedOptions[0].value === color);
      assert.equal(getVariantImage(product, selected)?.url, images[0].url);
    }
    assert.equal(JSON.stringify(product), before);
    assert.equal(getCatalogEntries([product]).length, 3);
  }
});

test("Ranch media cannot cross gender, style, or color even when a variant is assigned the wrong file", () => {
  const product = makeRanch(0);
  for (const wrong of [makeRanch(1).image, makeRanch(2).image, product.images.find(({ url }) => url.includes("_Brown_Concrete"))]) {
    const variant = { ...product.variants[2], image: wrong };
    const mixed = { ...product, images: [...product.images, wrong], variants: [variant] };
    assert.match(getVariantImage(mixed, variant).url, /RR_Mens_Top_Blue_Concrete_Flash\.png/);
    assert.deepEqual(getProductColorImages(mixed, "Blue").map(({ url }) => url), getProductColorImages(product, "Blue").map(({ url }) => url));
  }
  const unrelated = { ...product, shopifyProductGid: "gid://shopify/Product/999", variants: product.variants.map((variant) => ({ ...variant, image: undefined })) };
  assert.deepEqual(getProductColorImages(unrelated, "Blue"), []);
});

test("Shopify UUID-renamed brown hoodie files retain the front and back gallery", () => {
  const product = makeRanch(0);
  product.images = product.images.map((image) => ({ ...image, url: image.url
    .replace("RR_Mens_Top_Brown_Concrete_Flash.png", "RR_Mens_Top_Brown_Concrete_Flash_b239a6db-f442-4bfb-9d08-31c9cac8d2dc.png")
    .replace("RR_Mens_Top_Brown_Back_Concrete_Flash.png", "RR_Mens_Top_Brown_Back_Concrete_Flash_95fbd648-71e3-4820-895f-bd41509d0523.png") }));
  const brown = getProductColorImages(product, "Brown");
  assert.equal(brown.length, 2);
  assert.match(brown[0].url, /_Brown_Concrete_Flash_b239/);
  assert.match(brown[1].url, /_Brown_Back_Concrete_Flash_95fb/);
  const wrong = { ...product, variants: [{ ...product.variants[2], image: brown[0] }] };
  assert.match(getVariantImage(wrong, wrong.variants[0]).url, /_Blue_Concrete_Flash/);
});

test("homepage selections use published Shopify identities and actual colors, preserving input order", () => {
  const products = [3, 1, 2, 0].map(makeRanch);
  const before = JSON.stringify(products);
  assert.deepEqual(getRanchProducts(products).map(({ shopifyProductGid }) => shopifyProductGid), RANCH_PRODUCT_IDS);
  assert.deepEqual(getRanchRackSelections(products).map(({ product, color }) => [product.shopifyProductGid, color]), [
    [RANCH_PRODUCT_IDS[0], "Blue"], [RANCH_PRODUCT_IDS[1], "Brown"], [RANCH_PRODUCT_IDS[2], "Black"], [RANCH_PRODUCT_IDS[3], "Blue"],
  ]);
  assert.equal(getRanchCollectionHref(products), "/store?collection=ruined-ranch");
  assert.equal(getRanchCollectionHref(products.map((product) => ({ ...product, collections: [] }))), "/store");
  assert.equal(isRanchProduct({ name: "Ruined Ranch Hoodie" }), false);
  assert.deepEqual(getRanchProducts([]), []);
  assert.equal(getRanchRackSelections([{ ...makeRanch(0), options: [{ name: "Colour", values: ["Black"] }] }])[0].color, "Black");
  assert.equal(JSON.stringify(products), before);
});

test("Pants and Ranch collection filters preserve fit intersections and other collections", () => {
  const products = [0, 1, 2, 3].map(makeRanch);
  assert.deepEqual(products.map(getProductCategory), ["hoodies", "hoodies", "pants", "pants"]);
  assert.deepEqual(filterCatalogProducts(products, { category: "pants", collection: "ruined-ranch", fit: "womens" }).map(({ id }) => id), ["womens-ruined-ranch-sweatpants"]);
  assert.equal(filterCatalogProducts(products, { category: "pants" }).length, 2);
  assert.deepEqual(getCollectionFilters([...products, { id: "tee", name: "Tee", collections: [{ handle: "staples", title: "Staples" }] }]), [collection, { handle: "staples", title: "Staples" }]);
});
