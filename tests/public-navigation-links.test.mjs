import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected navigation dependency: ${name}`);
  }, cjsModule, cjsModule.exports, ...Object.values(globals));
  return cjsModule.exports;
}

const site = load("src/lib/site.ts");
const links = load("src/lib/navigation-link.ts", { "@/lib/site": site });
const navigation = load("src/data/navigation.ts");
const membership = load("src/data/public-membership.ts");
const searchContract = load("src/data/search-contract.ts");

function click(href, overrides = {}) {
  return {
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    currentTarget: { href, target: "", hasAttribute: () => false },
    ...overrides,
  };
}

test("link dismissal preserves focus for another browsing context or the current destination", () => {
  const current = "https://theruinedproject.com/members";
  for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    assert.equal(links.shouldRestoreLinkFocus(click("/store", overrides), current), true);
  }
  for (const target of ["_blank", "another-tab"]) {
    assert.equal(links.shouldRestoreLinkFocus(click("/store", {
      currentTarget: { href: "/store", target, hasAttribute: () => false },
    }), current), true);
  }
  assert.equal(links.shouldRestoreLinkFocus(click("/download", {
    currentTarget: { href: "/download", target: "", hasAttribute: (name) => name === "download" },
  }), current), true);
  for (const [href, location] of [["/members", current], ["/members#circle", `${current}#circle`], ["/members", `${current}#circle`]]) {
    assert.equal(links.shouldRestoreLinkFocus(click(href), location), true);
  }
});

test("a genuine same-tab page or new-fragment navigation does not steal focus from its destination", () => {
  const current = "https://theruinedproject.com/members";
  for (const href of ["/store", "/members?topic=membership", "/members#circle", "https://members.theruinedproject.com/my"]) {
    assert.equal(links.shouldRestoreLinkFocus(click(href), current), false, href);
  }
});

function withHost(origin, work) {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = origin;
  try { return work(); } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
}

test("search rewrites only public targets on the exact member deployment", () => {
  const publicPaths = ["/#top", "/members", "/about", "/store", "/store/first-coin", "/community#byob-01", "/contact?topic=membership"];
  const untouched = ["/my", "/my/profile", "/ops", "/ops/members", "/access?returnTo=%2Fmy", "/auth/callback?code=test", "https://external.example/path", "//external.example/path"];
  withHost("https://members.theruinedproject.com", () => {
    for (const href of publicPaths) assert.equal(links.publicSearchHref(href), `https://theruinedproject.com${href}`);
    for (const href of untouched) assert.equal(links.publicSearchHref(href), href);
  });
  for (const host of ["https://theruinedproject.com", "http://127.0.0.1:3001", "https://members.theruinedproject.com.example.test"]) {
    withHost(host, () => {
      for (const href of [...publicPaths, ...untouched]) assert.equal(links.publicSearchHref(href), href);
    });
  }
});

const emptyComponent = () => null;
const component = (value = emptyComponent) => ({ __esModule: true, default: value });
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
function hooks(initialStates) {
  let stateIndex = 0;
  const refs = [];
  const updates = [];
  return {
    refs, updates,
    react: {
      ...React,
      useId: () => "navigation-fixture",
      useEffect: () => {},
      useState: (initial) => {
        const index = stateIndex++;
        return [index in initialStates ? initialStates[index] : initial, (value) => updates.push([index, value])];
      },
      useRef: (initial) => { const ref = { current: initial }; refs.push(ref); return ref; },
    },
  };
}

function headerFixture(currentHref) {
  const harness = hooks([true, false, false, 0]);
  const Header = load("src/components/SiteHeader.tsx", {
    react: harness.react,
    "next/link": component(), "next/image": component(),
    "@/components/nav/CalendarGlyph": { CalendarGlyph: emptyComponent },
    "@/components/nav/CouchGlyph": { CouchGlyph: emptyComponent },
    "@/components/nav/PersonGlyph": { PersonGlyph: emptyComponent },
    "@/components/search/UniversalSearch": component(),
    "@/components/store/BagLink": component(),
    "@/data/navigation": navigation,
    "@/data/public-membership": membership,
    "@/lib/platform/visibility": { isMyRuinedVisible: () => true },
    "@/lib/site": site,
    "@/lib/navigation-link": links,
    "@/hooks/useBackgroundPathname": { useBackgroundPathname: () => new URL(currentHref).pathname },
  }, { window: { location: { href: currentHref } } }).default;
  return { ...harness, tree: Header() };
}

test("the actual menu restores its trigger for modified/current-page clicks but not a new page", () => {
  withHost("https://theruinedproject.com", () => {
    for (const [location, href, overrides, expected] of [
      ["https://theruinedproject.com/#top", "/store", { metaKey: true }, true],
      ["https://theruinedproject.com/#top", "/store", { ctrlKey: true }, true],
      ["https://theruinedproject.com/members", "/members", {}, true],
      ["https://theruinedproject.com/members", "/store", {}, false],
    ]) {
      const fixture = headerFixture(location);
      const link = descendants(fixture.tree).find((element) => element.props.href === href);
      assert.ok(link, href);
      link.props.onClick(click(href, overrides));
      assert.equal(fixture.refs.at(-1).current, expected);
      assert.deepEqual(fixture.updates.at(-1), [0, false], "the menu closes");
    }
  });
});

function searchFixture(currentHref, { failed = false } = {}) {
  const result = (group, href) => ({ group, href, id: href, title: href, description: "Test result", meta: "Test" });
  const response = { query: "Ruined", total: 5, groups: {
    pieces: [result("pieces", "/store/first-coin")], projects: [],
    events: [result("events", "/community#byob-01")],
    pages: [result("pages", "/members"), result("pages", "/my/profile"), result("pages", "/ops/members")],
  } };
  const harness = hooks(["Ruined", response, false, failed]);
  const openChanges = [];
  const Search = load("src/components/search/UniversalSearch.tsx", {
    react: harness.react,
    "next/link": component(),
    "@/data/search-contract": searchContract,
    "@/lib/navigation-link": links,
    "./UniversalSearch.module.css": component(new Proxy({}, { get: (_target, property) => property })),
  }, { window: { location: { href: currentHref } } }).default;
  return { ...harness, openChanges, tree: Search({ open: true, onOpenChange: (open) => openChanges.push(open) }) };
}

test("actual search result and failure links leave the member host without moving private targets", () => {
  withHost("https://members.theruinedproject.com", () => {
    const fixture = searchFixture("https://members.theruinedproject.com/my");
    const hrefs = descendants(fixture.tree).map((element) => element.props.href).filter(Boolean);
    assert.deepEqual(hrefs, [
      "https://theruinedproject.com/store/first-coin", "https://theruinedproject.com/community#byob-01",
      "https://theruinedproject.com/members", "/my/profile", "/ops/members",
    ]);
    const failed = searchFixture("https://members.theruinedproject.com/my", { failed: true });
    assert.equal(descendants(failed.tree).find((element) => element.props.href).props.href, "https://theruinedproject.com/store");
  });
});

test("actual search dismissal also restores focus when the visitor stays in this tab", () => {
  withHost("https://theruinedproject.com", () => {
    for (const [href, overrides, expected] of [["/members", {}, true], ["/store/first-coin", { metaKey: true }, true], ["/store/first-coin", {}, false]]) {
      const fixture = searchFixture("https://theruinedproject.com/members");
      const link = descendants(fixture.tree).find((element) => element.props.href === href);
      link.props.onClick(click(href, overrides));
      assert.equal(fixture.refs.at(-1).current, expected);
      assert.deepEqual(fixture.openChanges, [false]);
    }
  });
});
