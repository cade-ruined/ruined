import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, dependencies = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "next/image") return { __esModule: true, default: ({ src, alt, sizes, className }) => React.createElement("img", { src, alt, sizes, className }) };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, property) => property }) };
    // Public editorial pages must not silently start loading accounts, billing, or private images.
    throw new Error(`Unexpected public page dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const membership = load("src/data/public-membership.ts");
const { MEMBERSHIP_INTRO, MEMBERSHIP_LINKS, MEMBERSHIP_PILLARS } = membership;
const publicDependencies = { "@/data/public-membership": membership };
const MembersPage = load("src/components/public-members/MembersPage.tsx", publicDependencies).default;
const JourneyMembersPreview = load("src/components/sequence/JourneyMembersPreview.tsx", publicDependencies).default;
const route = load("app/members/page.tsx", {
  ...publicDependencies,
  "@/components/public-members/MembersPage": { __esModule: true, default: MembersPage },
});
const pageHtml = renderToStaticMarkup(React.createElement(route.default));
const page = parseFragment(pageHtml);
const pillarIds = ["foundations", "circle", "academy", "experiences"];
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
function elements(node) {
  return [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
}
const descendants = (node, tag) => elements(node).filter((item) => item.tagName === tag);
function text(node) {
  return node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
}
function accessibleText(node) {
  if (attr(node, "aria-hidden") === "true") return "";
  return node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(accessibleText).join("");
}
function assertAccessibleStructure(document) {
  const nodes = elements(document);
  const ids = nodes.map((node) => attr(node, "id")).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "rendered IDs must be unique");
  for (const node of nodes) {
    for (const id of (attr(node, "aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
      const label = nodes.find((candidate) => attr(candidate, "id") === id);
      assert.ok(label, `${node.tagName} references missing label ${id}`);
      assert.ok(text(label).trim(), `label ${id} has no text`);
    }
    if (node.tagName === "a") {
      assert.ok(accessibleText(node).trim() || attr(node, "aria-label"), "every link has a name beyond decorative arrows");
    }
  }
}

test("the public membership story has four distinct pillars backed by existing public images", () => {
  assert.deepEqual(MEMBERSHIP_PILLARS.map((pillar) => pillar.id), pillarIds);
  for (const item of [MEMBERSHIP_INTRO, ...MEMBERSHIP_PILLARS]) {
    assert.match(item.image, /^\/(?!\/)/, "imagery is a local public asset");
    assert.doesNotMatch(item.image, /\/api\/|\/my\/|\/ops\//);
    assert.ok(statSync(new URL(`../public${item.image}`, import.meta.url)).size > 0, item.image);
    assert.ok(item.alt.trim().length > 0, `image ${item.image} needs descriptive alt text`);
  }
  const images = descendants(page, "img");
  assert.deepEqual(images.map((image) => attr(image, "src")), [MEMBERSHIP_INTRO, ...MEMBERSHIP_PILLARS].map((item) => item.image));
  assert.deepEqual(images.map((image) => attr(image, "alt")), [MEMBERSHIP_INTRO, ...MEMBERSHIP_PILLARS].map((item) => item.alt));
  for (const image of images) assert.ok(attr(image, "sizes"), "responsive images declare their display sizes");
});

test("the rendered Members page gives every pillar a working anchor and named section", () => {
  assertAccessibleStructure(page);
  assert.equal(descendants(page, "main").length, 1);
  assert.equal(descendants(page, "h1").length, 1);
  assert.ok(descendants(page, "h2").length >= pillarIds.length);
  assert.equal(elements(page).filter((node) => /^h[3-6]$/.test(node.tagName)).length, 0, "this two-level page does not skip heading levels");
  const index = descendants(page, "nav").find((nav) => attr(nav, "aria-label") === "Explore membership");
  assert.ok(index, "the pillar index is named navigation");
  assert.deepEqual(descendants(index, "a").map((link) => attr(link, "href")), pillarIds.map((id) => `#${id}`));
  for (const id of pillarIds) {
    const sections = descendants(page, "section").filter((section) => attr(section, "id") === id);
    assert.equal(sections.length, 1, `exactly one #${id} destination`);
    const heading = descendants(sections[0], "h2")[0];
    assert.equal(attr(sections[0], "aria-labelledby"), attr(heading, "id"));
  }
});

test("public calls to action inquire or sign in without offering unapproved checkout or prices", () => {
  assert.equal(MEMBERSHIP_LINKS.inquire, "/contact?topic=membership");
  assert.equal(MEMBERSHIP_LINKS.signIn, "https://members.theruinedproject.com/access");
  const links = descendants(page, "a").map((link) => attr(link, "href"));
  assert.ok(links.includes(MEMBERSHIP_LINKS.inquire));
  assert.ok(links.includes(MEMBERSHIP_LINKS.signIn));
  assert.ok(links.includes("/community"));
  const approvedDestinations = new Set([...pillarIds.map((id) => `#${id}`), MEMBERSHIP_LINKS.inquire, "/community", MEMBERSHIP_LINKS.signIn]);
  for (const href of links) assert.ok(approvedDestinations.has(href), `unexpected public action: ${href}`);
  assert.equal(elements(page).filter((node) => ["form", "input", "iframe"].includes(node.tagName)).length, 0);
  assert.doesNotMatch(text(page), /\$\s*\d|\bUSD\s*\d|\b\d+(?:\.\d{2})?\s*\/\s*(?:month|year|mo|yr)\b/i);
  assert.match(text(page), /by invitation/i);
});

test("the walk preview links to the same four public sections and the real member portal", () => {
  const preview = parseFragment(renderToStaticMarkup(React.createElement(JourneyMembersPreview, { headingId: "test-members-heading" })));
  assertAccessibleStructure(preview);
  assert.equal(descendants(preview, "h1").length, 0, "embedded content does not add a second page title");
  assert.equal(descendants(preview, "h2").length, 1);
  assert.equal(attr(descendants(preview, "h2")[0], "id"), "test-members-heading");
  assert.equal(attr(descendants(preview, "section")[0], "aria-labelledby"), "test-members-heading");
  const links = descendants(preview, "a").map((link) => attr(link, "href"));
  assert.deepEqual(links, [...pillarIds.map((id) => `/members#${id}`), "/members", MEMBERSHIP_LINKS.signIn]);
  assert.equal(attr(descendants(preview, "img")[0], "src"), MEMBERSHIP_INTRO.image);
  for (const href of links.filter((link) => link.startsWith("/members#"))) {
    assert.ok(elements(page).some((node) => attr(node, "id") === href.split("#")[1]), href);
  }
  const bothPreviews = parseFragment(renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(JourneyMembersPreview, { headingId: "desktop-members-heading" }),
    React.createElement(JourneyMembersPreview, { headingId: "mobile-members-heading" }),
  )));
  assertAccessibleStructure(bothPreviews);
});

test("the public route metadata describes Members rather than a private account screen", () => {
  assert.equal(route.metadata.alternates.canonical, "/members");
  assert.equal(route.metadata.openGraph.url, "/members");
  assert.equal(route.metadata.description, MEMBERSHIP_INTRO.description);
  assert.equal(route.metadata.openGraph.images[0].url, MEMBERSHIP_INTRO.image);
  assert.equal(pageHtml, renderToStaticMarkup(React.createElement(MembersPage)));
});

test("public Members styling uses the existing paper, typography, palette, and responsive treatment", () => {
  const pageStyles = source("src/components/public-members/MembersPage.module.css");
  const previewStyles = source("src/components/sequence/JourneyMembersPreview.module.css");
  for (const styles of [pageStyles, previewStyles]) {
    for (const token of ["--color-bone", "--color-faded", "--color-poster", "--color-verdigris", "--font-body"]) {
      assert.ok(styles.includes(`var(${token})`), `uses shared token ${token}`);
    }
    assert.match(styles, /\/textures\/member-paper\.svg/);
    assert.match(styles, /var\(--font-(?:cadehandy2|handwritten)\)/);
    assert.match(styles, /@media/);
    assert.match(styles, /minmax\(0,/);
  }
  assert.match(pageStyles, /var\(--color-highlight\)/);
  assert.match(pageStyles, /var\(--color-shop\)/);
  assert.match(pageStyles, /scroll-margin-top:/);
  assert.match(pageStyles, /:focus-visible/);
  assert.match(pageStyles, /prefers-reduced-motion: reduce/);
  assert.match(previewStyles, /var\(--font-header\)/);
  assert.ok(statSync(new URL("../public/textures/member-paper.svg", import.meta.url)).size > 0);
});
