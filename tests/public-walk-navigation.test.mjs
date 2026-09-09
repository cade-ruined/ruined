import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  EXPLORE_ROOM_IDS,
  EXPLORE_ROOMS,
  FOOTER_INDEX_ITEMS,
  GLOBAL_MENU_ITEMS,
  GLOBAL_NAV_ITEMS,
  SITE_ROUTES,
  WALK_MENU_ITEMS,
  activeGlobalNavigationId,
  sectionLocatorForPathname,
} from "../src/data/navigation.ts";

async function compile(relativePath, dependencies = {}) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const searchContract = await compile("src/data/search-contract.ts");
const { searchSite } = await compile("src/data/search.ts", {
  "@/data/events": { EVENTS: [] },
  "@/data/search-contract": searchContract,
});

test("the public walk has exactly five ordered stops with the existing scene glyphs", () => {
  assert.deepEqual(EXPLORE_ROOM_IDS, ["top", "store", "about", "members", "events"]);
  assert.deepEqual(EXPLORE_ROOMS.map((room) => room.id), EXPLORE_ROOM_IDS);
  assert.deepEqual(EXPLORE_ROOMS.map((room) => room.label), [
    "Lobby", "Store", "About", "Members", "Community",
  ]);
  for (const [index, room] of EXPLORE_ROOMS.entries()) {
    assert.equal(room.sceneIndex, index);
    assert.equal(room.glyphIndex, index);
    assert.equal(room.hash, `#${room.id}`);
    assert.equal(room.href, `/${room.hash}`);
  }
  assert.equal(WALK_MENU_ITEMS, EXPLORE_ROOMS);
});

test("canonical navigation distinguishes public Members from signed-in membership", () => {
  assert.deepEqual(GLOBAL_NAV_ITEMS.map((item) => item.href), [
    "/store", "/about", "/members", "/community",
  ]);
  assert.deepEqual(GLOBAL_MENU_ITEMS.map((item) => item.id), [
    "home", "store", "about", "members", "events",
  ]);
  assert.deepEqual(GLOBAL_MENU_ITEMS.map((item) => [item.label, item.href]), [
    ["Lobby", "/#top"], ["Store", "/store"], ["About", "/about"],
    ["Members", "/members"], ["Community", "/community"],
  ]);
  assert.equal(SITE_ROUTES.about.glyphIndex, 2);
  assert.equal(SITE_ROUTES.members.glyphIndex, 3);
  assert.equal(SITE_ROUTES.members.href, "/members");
  assert.equal(SITE_ROUTES.my.href, "/my");
  assert.equal(activeGlobalNavigationId("/members"), "members");
  assert.equal(activeGlobalNavigationId("/members/details"), "members");
  assert.equal(activeGlobalNavigationId("/membership"), null);
  assert.equal(activeGlobalNavigationId("/my"), null);
  assert.equal(sectionLocatorForPathname("/members"), "MEMBERS");
  assert.equal(sectionLocatorForPathname("/about"), "ABOUT");
  assert.equal(sectionLocatorForPathname("/my/account"), "MEMBERS");
});

test("footer links go straight to public destinations without another walk step", () => {
  assert.deepEqual(FOOTER_INDEX_ITEMS.map((item) => [item.label, item.href]), [
    ["Store", "/store"],
    ["About", "/about"],
    ["Members", "/members"],
    ["Community", "/community"],
    ["Contact", "/contact"],
  ]);
});

test("legacy Work remains a standalone destination without becoming a sixth walk stop", () => {
  assert.equal(SITE_ROUTES.work.href, "/work");
  assert.equal(sectionLocatorForPathname("/work"), "ARTIFACTS");
  assert.equal(sectionLocatorForPathname("/work/example"), "ARTIFACTS");
  assert.equal(activeGlobalNavigationId("/work"), null);
  assert.ok(!WALK_MENU_ITEMS.some((room) => room.id === "work"));
  assert.ok(!GLOBAL_NAV_ITEMS.some((item) => item.id === "work"));
});

test("search discovers public membership and never sends Artifacts searches to the renamed room", () => {
  for (const query of ["members", "membership", "foundations", "circles"]) {
    const memberPage = searchSite([], query).groups.pages.find((page) => page.id === "members");
    assert.ok(memberPage, `Members should be discoverable using ${query}`);
    assert.equal(memberPage.href, "/members");
  }
  assert.equal(searchSite([], "about").groups.pages[0].href, "/about");
  assert.equal(searchSite([], "community").groups.pages[0].href, "/community");
  assert.equal(searchSite([], "artifacts").groups.pages[0].href, "/work");
  const walk = searchSite([], "walk").groups.pages.find((page) => page.id === "walk");
  assert.equal(walk.description, "Move through the Lobby, Store, About, Members, and Community.");
});

test("the generated sitemap includes the canonical public Members route, not a private account route", async () => {
  const { default: sitemap } = await compile("app/sitemap.ts", {
    "@/lib/site": { SITE_URL: "https://theruinedproject.com" },
    "@/lib/shopify": {
      getShopPolicies: async () => ({ shipping: null, returns: null, terms: null }),
      getProducts: async () => [],
    },
  });
  const entries = await sitemap();
  const urls = entries.map((entry) => entry.url);
  assert.deepEqual(urls.slice(0, 5), [
    "https://theruinedproject.com",
    "https://theruinedproject.com/store",
    "https://theruinedproject.com/about",
    "https://theruinedproject.com/members",
    "https://theruinedproject.com/community",
  ]);
  assert.equal(urls.filter((url) => url.endsWith("/members")).length, 1);
  assert.ok(urls.every((url) => !/\/(my|ops|access)(\/|$)/.test(new URL(url).pathname)));
});
