import assert from "node:assert/strict";
import test from "node:test";
import { applyStorePromotion } from "../public/linkinbio/promotion.js";
import { STORE_SALE_START, STORE_SALE_END } from "../public/store-promotion-config.js";

test("link-in-bio prices and notice follow the shared sale window and revert on expiry", () => {
  const notice = { textContent: "", hidden: true };
  const prices = [9600, 6800, 6400].map((cents) => {
    const current = { textContent: "" };
    const regular = { textContent: "", hidden: true };
    return {
      dataset: { regularCents: String(cents) }, current, regular,
      querySelector: (selector) => selector === "[data-current-price]" ? current : regular,
    };
  });
  const doc = { querySelectorAll: (selector) => selector === "[data-store-sale]" ? [notice] : prices };
  applyStorePromotion(doc, Date.parse(STORE_SALE_START) - 1);
  assert.equal(notice.hidden, true);
  assert.deepEqual(prices.map((price) => price.current.textContent), ["$96", "$68", "$64"]);
  applyStorePromotion(doc, Date.parse(STORE_SALE_START));
  assert.equal(notice.hidden, false);
  assert.deepEqual(prices.map((price) => price.current.textContent), ["$67.20", "$47.60", "$44.80"]);
  assert.ok(prices.every((price) => !price.regular.hidden));
  applyStorePromotion(doc, Date.parse(STORE_SALE_END));
  assert.equal(notice.hidden, true);
  assert.deepEqual(prices.map((price) => price.current.textContent), ["$96", "$68", "$64"]);
  assert.ok(prices.every((price) => price.regular.hidden));
});
