import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

async function read(file) {
  return fs.readFile(path.join(root, file), "utf8");
}

test("production metadata uses the brand domain and restrained positioning", async () => {
  const [site, layout, env] = await Promise.all([
    read("src/lib/site.ts"),
    read("app/layout.tsx"),
    read(".env.example"),
  ]);

  assert.match(site, /https:\/\/theruinedproject\.com/);
  assert.match(site, /SITE_URL = PRODUCTION_SITE_URL/);
  assert.doesNotMatch(site, /VERCEL_PROJECT_PRODUCTION_URL|NEXT_PUBLIC_SITE_URL/);
  assert.match(env, /NEXT_PUBLIC_SITE_URL=https:\/\/theruinedproject\.com/);
  assert.match(layout, /A Creative Company in Alpine, Utah/);
  assert.match(layout, /Ruined refines potential into identity/);
  assert.match(layout, /openGraph:[\s\S]*title: SITE_NAME/);
  assert.match(layout, /twitter:[\s\S]*title: SITE_NAME/);
  assert.doesNotMatch(layout, /keywords:/);
  assert.match(layout, /"@type": "PostalAddress"/);
  assert.match(layout, /https:\/\/www\.instagram\.com\/theruinedproject/);
});

test("sitemap includes the public catalogue and product routes", async () => {
  const sitemap = await read("app/sitemap.ts");

  for (const route of [
    "/about",
    "/community",
    "/contact",
    "/privacy",
    "/store",
  ]) {
    assert.match(sitemap, new RegExp(`path: "${route}"`));
  }

  for (const route of ["/work", "/foundations"]) {
    assert.doesNotMatch(sitemap, new RegExp(`path: "${route}"`));
  }

  assert.doesNotMatch(sitemap, /lastModified/);
  assert.doesNotMatch(sitemap, /PRODUCTS|PROJECTS/);
  assert.match(sitemap, /getProducts/);
  assert.match(sitemap, /products\.map/);
  assert.match(sitemap, /\/store\/\$\{encodeURIComponent\(product\.id\)\}/);
  assert.match(sitemap, /getShopPolicies/);
  assert.match(sitemap, /terms[\s\S]*path: "\/terms"/);
  assert.match(
    sitemap,
    /\.\.\.\(shipping \|\| returns[\s\S]*path: "\/shipping-returns"/,
  );
});

test("global accessibility and empty legal routes are launch-safe", async () => {
  const [layout, shipping, terms] = await Promise.all([
    read("app/layout.tsx"),
    read("app/shipping-returns/page.tsx"),
    read("app/terms/page.tsx"),
  ]);

  assert.match(layout, /href="#main-content"/);
  assert.match(layout, /id="main-content" tabIndex=\{-1\}/);
  assert.match(
    shipping,
    /robots: shipping \|\| returns \? undefined : \{ index: false, follow: true \}/,
  );
  assert.match(terms, /robots: terms \? undefined : \{ index: false, follow: true \}/);
});

test("About is crawlable content and internal Foundations is noindex", async () => {
  const [about, foundations] = await Promise.all([
    read("app/about/page.tsx"),
    read("app/foundations/page.tsx"),
  ]);

  assert.match(about, /title: "About"/);
  assert.match(about, /Ruined exists to refine potential into identity/);
  assert.match(about, /This site is still being built/);
  assert.doesNotMatch(about, /ComingSoonGate/);
  assert.match(foundations, /robots: \{ index: false, follow: false \}/);
});

test("the live Store is crawlable while dormant Artifacts stays out of search", async () => {
  const [storeLayout, storeOpenGraph, workLayout] = await Promise.all([
    read("app/store/layout.tsx"),
    read("app/store/opengraph-image.tsx"),
    read("app/work/layout.tsx"),
  ]);

  assert.doesNotMatch(storeLayout, /robots:/);
  assert.doesNotMatch(storeOpenGraph, /COMING SOON/i);
  assert.match(storeOpenGraph, /CURRENT PIECES/);
  assert.match(workLayout, /robots: \{ index: false, follow: true \}/);
});

test("the live Store catalogue and commerce routes remain internally connected", async () => {
  const [storePage, storeGallery, bagPage, bagClient, productPage, purchase, search] = await Promise.all([
    read("app/store/page.tsx"),
    read("src/components/store/StoreGallery.tsx"),
    read("app/bag/page.tsx"),
    read("src/components/store/BagPageClient.tsx"),
    read("app/store/[handle]/page.tsx"),
    read("src/components/store/ProductPurchase.tsx"),
    read("src/data/search.ts"),
  ]);

  assert.match(storePage, /getProducts\(\)/);
  assert.match(storePage, /<StoreGallery products=\{products\}/);
  assert.doesNotMatch(storePage, /redirect\(/);
  assert.match(storeGallery, /if \(!products\.length\)/);
  assert.match(storeGallery, /The catalogue is closed\./);
  for (const source of [bagPage, bagClient, productPage]) {
    assert.match(source, /href="\/store"/);
    assert.doesNotMatch(source, /href="\/#store"/);
  }
  assert.match(search, /href: "\/store"/);
  assert.match(productPage, /product\.images\?\.length/);
  assert.match(productPage, /slice\(0, 2\)/);
  assert.match(productPage, /"@type": "Product"/);
  assert.match(productPage, /"@type": "AggregateOffer"/);
  assert.match(productPage, /spec\.value\.trim\(\)/);
  assert.match(purchase, /Secure checkout/);
  assert.doesNotMatch(
    `${storePage}${bagPage}${bagClient}${productPage}${purchase}`,
    /Checkout secured by Shopify|secured by Shopify/
  );
});

test("Store removes the redundant guide copy and Shipping + Returns mirrors Shopify policies", async () => {
  const [storeGallery, shippingPage, shopify] = await Promise.all([
    read("src/components/store/StoreGallery.tsx"),
    read("app/shipping-returns/page.tsx"),
    read("src/lib/shopify.ts"),
  ]);

  assert.doesNotMatch(
    storeGallery,
    /Select a piece for its material,[\s\S]*?What matters is kept visible before payment\./,
  );
  assert.match(storeGallery, /href="\/shipping-returns"/);

  assert.match(
    shopify,
    /shop\s*\{[\s\S]*?shippingPolicy\s*\{\s*title\s+body\s*\}[\s\S]*?refundPolicy\s*\{\s*title\s+body\s*\}[\s\S]*?\}/,
    "Shopify remains the source of truth for both policy sections",
  );
  assert.match(shopify, /shipping:\s*data\?\.shop\.shippingPolicy\s*\?\?\s*null/);
  assert.match(shopify, /returns:\s*data\?\.shop\.refundPolicy\s*\?\?\s*null/);

  assert.match(
    shippingPage,
    /shipping[\s\S]*?title:\s*shipping\.title[\s\S]*?shipping\.body/,
    "the Shopify shipping policy should render first",
  );
  assert.match(
    shippingPage,
    /returns[\s\S]*?title:\s*returns\.title[\s\S]*?returns\.body/,
    "the Shopify return policy should render second",
  );
  assert.doesNotMatch(
    shippingPage,
    /Shipping and returns will be published with the first collection\./,
    "the linked page should not fall back to stale placeholder copy",
  );
});

test("the future programme implementation stays dormant but retained", async () => {
  const futureLandingPage = await read("app/lp/future-page.tsx");

  await assert.rejects(fs.access(path.join(root, "app/lp/page.tsx")));
  assert.match(futureLandingPage, /Dormant for launch/);
  assert.match(futureLandingPage, /Rename this file to `page\.tsx`/);
  assert.match(futureLandingPage, /After the Fear/);
});

test("Community uses collection metadata until events have leaf URLs", async () => {
  const community = await read("app/community/page.tsx");

  assert.match(community, /"@type": "CollectionPage"/);
  assert.match(community, /openGraph:/);
  assert.match(community, /twitter:/);
  assert.doesNotMatch(community, /"@type": "Event"/);
  assert.doesNotMatch(community, /\/community#/);
});
