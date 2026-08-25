import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExpectedShipDateLanguage } from "../src/lib/store/product-copy.js";
import { parseShopifyProductDescription } from "../src/lib/store/shopify-description.ts";

test("Shopify rich descriptions retain semantic paragraphs, lists, and emphasis", () => {
  const nodes = parseShopifyProductDescription(
    "<p>One</p><p>Two</p><ul><li><strong>Three</strong></li></ul>"
  );

  assert.deepEqual(nodes.map((node) => node.type === "element" ? node.tag : node.type), [
    "p",
    "p",
    "ul",
  ]);
  const list = nodes[2];
  assert.equal(list.type, "element");
  assert.equal(list.children[0]?.type, "element");
  if (list.children[0]?.type === "element") {
    assert.equal(list.children[0].tag, "li");
    assert.equal(list.children[0].children[0]?.type, "element");
    if (list.children[0].children[0]?.type === "element") {
      assert.equal(list.children[0].children[0].tag, "strong");
    }
  }
});

test("common Shopify block wrappers preserve authored paragraph boundaries", () => {
  const nodes = parseShopifyProductDescription(
    "<div>One</div><section>Two</section><article>Three</article>"
  );

  assert.deepEqual(
    nodes.map((node) => node.type === "element" ? node.tag : node.type),
    ["div", "div", "div"]
  );
  assert.deepEqual(
    nodes.map((node) => node.type === "element" ? node.children[0] : undefined),
    [
      { type: "text", value: "One" },
      { type: "text", value: "Two" },
      { type: "text", value: "Three" },
    ]
  );
});

test("Shopify rich descriptions strip executable markup and unsafe attributes", () => {
  const nodes = parseShopifyProductDescription(
    '<script>alert(1)</script><p onclick="run()" style="color:red">Safe <a href="javascript:alert(1)">bad</a> <a href="java&#10;script:alert(2)">broken</a> <a href="data:text/html,unsafe">data</a> <a href="/shipping-returns" target="_blank">good</a></p><img src="x" onerror="run()"><iframe>hidden</iframe>'
  );
  const serialized = JSON.stringify(nodes);

  for (const forbidden of [
    "script",
    "iframe",
    "img",
    "onclick",
    "onerror",
    "style",
    "javascript:",
    "data:text/html",
    "target",
    "alert(1)",
    "hidden",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[()]/g, "\\$&"), "i"));
  }
  assert.match(serialized, /Safe/);
  assert.match(serialized, /bad/);
  assert.match(serialized, /\/shipping-returns/);
});

test("ship dates are reduced to the promised month inside rich text nodes", () => {
  const nodes = parseShopifyProductDescription(
    "<p>Expected to ship September 12, 2026.</p>",
    "2026-09-14"
  );

  assert.match(JSON.stringify(nodes), /Expected to ship September\./);
  assert.doesNotMatch(JSON.stringify(nodes), /September 12/);
  assert.equal(
    normalizeExpectedShipDateLanguage("Expected to ship Sep. 12, 2026.", "2026-09-14"),
    "Expected to ship September."
  );

  const emphasized = parseShopifyProductDescription(
    "<p>Expected to ship <strong>September 12, 2026</strong>.</p>",
    "2026-09-14"
  );
  assert.match(JSON.stringify(emphasized), /Expected to ship/);
  assert.match(JSON.stringify(emphasized), /September/);
  assert.doesNotMatch(JSON.stringify(emphasized), /September 12/);

  assert.equal(
    normalizeExpectedShipDateLanguage("Expected to ship SepX 12, 2026.", "2026-09-14"),
    "Expected to ship SepX 12, 2026."
  );
});
