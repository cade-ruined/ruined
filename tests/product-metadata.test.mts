import test from "node:test";
import assert from "node:assert/strict";
import type { ProductVariant } from "../src/data/products.ts";
import { productMetadataDescription, productOffers } from "../src/lib/store/product-metadata.ts";
import { merchantReturnPolicy } from "../src/lib/store/return-policy.ts";

const origin = "https://theruinedproject.com";
const variant: ProductVariant = {
  id: "gid://shopify/ProductVariant/123", title: "Black / M", available: true,
  selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }],
  price: "$96", priceAmount: "96.00", currencyCode: "USD",
};
const policies = {
  shipping: { body: "<p>We currently ship within the United States.</p><p>Shipping methods and rates are shown at checkout.</p>" },
  returns: { body: `<p>Return requests must be made within <strong>14 days</strong> of delivery.</p>
    <p>Items must be unworn, unwashed, unused, and returned in their original condition.</p>
    <p>Return shipping is the customer&#39;s responsibility unless the item arrived damaged or incorrect.</p>
    <p>Preorders follow the same return terms after delivery.</p><p>Contact us before sending anything back.</p>` },
};

test("metadata preserves concise authored copy and creates readable excerpts without changing the source", () => {
  const concise = { name: "Hoodie", description: "Heavyweight cotton.\n Made for every day." };
  assert.equal(productMetadataDescription(concise), "Heavyweight cotton. Made for every day.");
  const sentence = "Heavyweight cotton with a relaxed fit, finished with a small embroidered mark.";
  const long = { name: "Hoodie", description: `${sentence} ${"More details on the fabric and finish. ".repeat(8)}` };
  const original = long.description;
  const summary = productMetadataDescription(long);
  assert.ok(summary.startsWith(sentence));
  assert.ok(summary.length <= 160);
  assert.ok(summary.endsWith("."));
  assert.equal(long.description, original);
  const continuous = productMetadataDescription({ name: "Hoodie", description: "A soft cotton hooded layer with ".repeat(14) });
  assert.ok(continuous.length <= 160);
  assert.ok(continuous.endsWith("…"));
  assert.ok(!continuous.endsWith(" wi…"), "a long sentence is shortened at a word boundary");
  assert.match(productMetadataDescription({ name: "Signal Cap", description: "  " }), /Signal Cap/);
});

test("offers preserve each real variant's price, currency and stock without inventing purchasable local variants", () => {
  const input = [variant, { ...variant, id: "gid://shopify/ProductVariant/124", priceAmount: "108.50", available: false },
    { ...variant, id: "local:placeholder" }, { ...variant, id: "gid://shopify/ProductVariant/125", priceAmount: "" },
    { ...variant, id: "gid://shopify/ProductVariant/126", priceAmount: "not-a-price" }];
  const offers = productOffers({ variants: input, productUrl: `${origin}/store/hoodie?color=Black` });
  assert.equal(offers.length, 2);
  assert.deepEqual(offers.map((offer) => [offer.price, offer.priceCurrency, offer.availability]), [
    ["96.00", "USD", "https://schema.org/InStock"], ["108.50", "USD", "https://schema.org/OutOfStock"],
  ]);
  assert.equal(new URL(offers[0].url).searchParams.get("color"), "Black");
  assert.equal(new URL(offers[0].url).searchParams.get("variant"), "123");
  assert.equal(new URL(offers[1].url).searchParams.get("variant"), "124");
  assert.ok(offers.every((offer) => !Object.hasOwn(offer, "shippingDetails")), "unknown shipping fees and times are not fabricated");
  assert.ok(offers.every((offer) => !Object.hasOwn(offer, "hasMerchantReturnPolicy")));
});

test("preorder offers retain unavailable status and reference only a confirmed return policy", () => {
  const returnPolicyId = `${origin}/shipping-returns#return-policy`;
  const offers = productOffers({
    variants: [variant, { ...variant, id: "gid://shopify/ProductVariant/124", available: false }],
    productUrl: `${origin}/store/hoodie`, expectedShipDate: "2026-11-10", returnPolicyId,
  });
  assert.equal(offers[0].availability, "https://schema.org/PreOrder");
  assert.equal(offers[1].availability, "https://schema.org/OutOfStock");
  assert.deepEqual(offers[0].hasMerchantReturnPolicy, { "@id": returnPolicyId });
});

test("return markup follows Shopify's published window and preserves exceptions", () => {
  const policy = merchantReturnPolicy(policies, origin);
  assert.ok(policy);
  assert.equal(policy.merchantReturnDays, 14);
  assert.equal(policy.applicableCountry, "US");
  assert.equal(policy["@id"], `${origin}/shipping-returns#return-policy`);
  assert.match(policy.description, /unless the item arrived damaged or incorrect/);
  assert.equal(merchantReturnPolicy({ ...policies, returns: { body: policies.returns.body.replace("14 days", "30 days") } }, origin)?.merchantReturnDays, 30);
});

test("unknown, unavailable, or changed policies fail closed instead of making stale return promises", () => {
  assert.equal(merchantReturnPolicy({ shipping: null, returns: null }, origin), undefined);
  assert.equal(merchantReturnPolicy({ ...policies, shipping: null }, origin), undefined);
  assert.equal(merchantReturnPolicy({ ...policies, shipping: { body: "We ship worldwide." } }, origin), undefined);
  for (const body of ["Returns are not accepted.", policies.returns.body.replace("14 days", "0 days"), `${policies.returns.body}<p>Sale items cannot be returned.</p>`]) {
    assert.equal(merchantReturnPolicy({ ...policies, returns: { body } }, origin), undefined);
  }
});
