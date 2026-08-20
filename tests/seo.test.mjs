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

test("sitemap includes only meaningful public launch pages", async () => {
  const sitemap = await read("app/sitemap.ts");

  for (const route of [
    "/about",
    "/community",
    "/contact",
    "/privacy",
  ]) {
    assert.match(sitemap, new RegExp(`path: "${route}"`));
  }

  for (const route of ["/store", "/work", "/foundations"]) {
    assert.doesNotMatch(sitemap, new RegExp(`path: "${route}"`));
  }

  assert.doesNotMatch(sitemap, /lastModified/);
  assert.doesNotMatch(sitemap, /PRODUCTS|PROJECTS/);
  assert.match(sitemap, /getShopPolicies/);
  assert.match(sitemap, /terms[\s\S]*path: "\/terms"/);
  assert.match(sitemap, /shipping[\s\S]*path: "\/shipping-returns"/);
});

test("global accessibility and empty legal routes are launch-safe", async () => {
  const [layout, shipping, terms] = await Promise.all([
    read("app/layout.tsx"),
    read("app/shipping-returns/page.tsx"),
    read("app/terms/page.tsx"),
  ]);

  assert.match(layout, /href="#main-content"/);
  assert.match(layout, /id="main-content" tabIndex=\{-1\}/);
  assert.match(shipping, /robots: shipping \? undefined : \{ index: false, follow: true \}/);
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

test("dormant Store and Artifacts routes stay out of search", async () => {
  const [storeLayout, workLayout] = await Promise.all([
    read("app/store/layout.tsx"),
    read("app/work/layout.tsx"),
  ]);

  for (const layout of [storeLayout, workLayout]) {
    assert.match(layout, /robots: \{ index: false, follow: true \}/);
  }
});

test("the dormant Store index returns visitors to the immersive shop", async () => {
  const [storePage, bagPage, bagClient, productPage] = await Promise.all([
    read("app/store/page.tsx"),
    read("app/bag/page.tsx"),
    read("src/components/store/BagPageClient.tsx"),
    read("app/store/[handle]/page.tsx"),
  ]);

  assert.match(storePage, /redirect\("\/#store"\)/);
  assert.doesNotMatch(storePage, /ComingSoonGate|Store · Coming Soon/);
  for (const source of [bagPage, bagClient, productPage]) {
    assert.match(source, /href="\/#store"/);
    assert.doesNotMatch(source, /href="\/store"/);
  }
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
