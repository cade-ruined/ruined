import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const indexSource = await readFile(new URL("../src/components/sequence/JourneyIndexes.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(indexSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(react = React, environment = {}) {
  const dependencies = {
    react, "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/image": { default: ({ src, alt, className }) => React.createElement("img", { src, alt, className }) },
    "./JourneyQuickBuy": { default: () => null },
    "@/data/navigation": { EXPLORE_ROOMS: [] },
    "@/data/public-membership": { MEMBERSHIP_INTRO: { image: "/members.webp", alt: "Members gathered" } },
    "@/lib/store/catalog": { catalogNotice: () => "" },
  };
  const output = { exports: {} };
  new Function("require", "module", "exports", "window", "ResizeObserver", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, environment.window, environment.ResizeObserver);
  return output.exports.JourneyLobbyIndex;
}
const JourneyLobbyIndex = load();
const events = [
  { id: "byob-01", title: "BYOB Nº 01", status: "Ended", image: "/byob-community.webp" },
  { id: "byob-02", title: "BYOB Nº 02", date: "September 11", status: "Ended", registration: { status: "Closed", href: "/community/byob-02/register" } },
  { id: "byob-03", title: "BYOB Nº 03", date: "October 9", status: "Upcoming", registration: { status: "Open", href: "/community/byob-03/register" } },
];
const makeProduct = (id) => ({ id, name: id, price: "$64", available: true, image: { url: `/${id}.webp`, alt: id } });
const handles = ["ruined-hoodie", "ruined-tee", "womens-crop-tee", "mens-distressed-crop-tee", "mens-collared-script", "womens-crop-collared-script", "mens-less-permanent-tee", "womens-less-permanent-crop-tee", "sunday-clothes-hoodie"];
const products = [makeProduct("byob-tank"), ...[...handles].reverse().map(makeProduct), { ...makeProduct("missing-photo"), image: undefined }];
function nodes(node) { return [node, ...(node.childNodes ?? []).flatMap(nodes)]; }
function attr(node, name) { return node.attrs?.find((entry) => entry.name === name)?.value; }
function text(node) { return node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join(""); }
function render(props = {}) {
  const fragment = parseFragment(renderToStaticMarkup(React.createElement(JourneyLobbyIndex, { events, products, ...props })));
  return { all: nodes(fragment), cards: nodes(fragment).filter((node) => attr(node, "data-home-marquee-item") !== undefined) };
}

test("the opening cards lead with open BYOB registration, then new arrivals, the waitlist, and cast", () => {
  const { cards } = render();
  assert.deepEqual(cards.map((card) => attr(card, "href")), [
    "/community/byob-03/register", "/store", "#members", "https://www.instagram.com/theruinedproject/",
  ]);
  assert.match(text(cards[0]), /BYOB Nº 03/);
  assert.match(text(cards[0]), /Register now · October 9/);
  assert.equal(attr(nodes(cards[0]).find((node) => node.tagName === "img"), "src"), "/byob-community.webp");
  assert.match(text(cards[1]), /New arrivals/);
  assert.match(text(cards[1]), /Shop the collection/);
  assert.match(text(cards[2]), /Join waitlist/);
  assert.match(text(cards[3]), /Meet the Cast/);
  assert.ok(!cards.some((card) => /What is this|BYOB Tank/i.test(text(card))));
  assert.equal(attr(cards[3], "target"), "_blank");
  assert.equal(nodes(cards[3]).filter((node) => node.tagName === "video").length, 1);
});

test("new arrivals uses live non-tank product images in a single catalog-linked grid", () => {
  for (const count of [4, 9]) {
    const selected = handles.slice(0, count).map(makeProduct);
    const { cards } = render({ products: [makeProduct("byob-tank"), ...selected, { ...makeProduct("missing-photo"), image: undefined }] });
    const store = cards.find((card) => attr(card, "href") === "/store");
    assert.ok(store);
    const imageUrls = nodes(store).filter((node) => node.tagName === "img").map((node) => attr(node, "src"));
    assert.deepEqual([...imageUrls].sort(), selected.map(({ image }) => image.url).sort());
    const columns = count > 4 ? "grid-cols-3" : "grid-cols-2";
    const grid = nodes(store).find((node) => (attr(node, "class") ?? "").split(/\s+/).includes(columns));
    assert.ok(grid, `The ${count}-image collage must use ${columns}`);
    assert.equal(nodes(grid).filter((node) => node.tagName === "img").length, count);
    assert.equal(nodes(store).filter((node) => node.tagName === "a").length, 1, "The collage must not nest product links");
  }
  const store = render({ products: [...products, makeProduct("tenth-piece")] }).cards.find((card) => attr(card, "href") === "/store");
  assert.equal(nodes(store).filter((node) => node.tagName === "img").length, 9, "The collage stays bounded when more products are added");
});

test("an open event can lead with its own image even without the archive event", () => {
  const next = { ...events[2], image: "/byob-03.webp" };
  const { cards } = render({ events: [next] });
  assert.equal(attr(cards[0], "href"), "/community/byob-03/register");
  assert.equal(attr(nodes(cards[0]).find((node) => node.tagName === "img"), "src"), "/byob-03.webp");
});

test("missing products and closed events never resurrect obsolete promotions", () => {
  const { cards } = render({ products: [], events: events.slice(0, 2) });
  assert.deepEqual(cards.map((card) => attr(card, "href")), ["#members", "https://www.instagram.com/theruinedproject/"]);
  assert.doesNotMatch(cards.map(text).join(" "), /Register now|BYOB Tank|What is this|Preorder|Ships September/);
});

test("the carousel stays a native swipe rail with manual controls and no automatic motion", () => {
  const { all } = render();
  const rail = all.find((node) => attr(node, "data-home-marquee") !== undefined);
  assert.equal(attr(rail, "role"), "region");
  assert.equal(attr(rail, "tabindex"), "0");
  for (const token of ["flex", "touch-pan-x", "overflow-x-auto", "overscroll-x-contain", "snap-x", "snap-mandatory", "scroll-px-1", "sm:scroll-px-1.5"]) {
    assert.ok((attr(rail, "class") ?? "").split(/\s+/).includes(token), `${token} preserves native horizontal navigation`);
  }
  const labels = all.filter((node) => node.tagName === "button").map((node) => attr(node, "aria-label"));
  assert.equal(labels.filter((label) => /^Previous /i.test(label ?? "")).length, 1);
  assert.equal(labels.filter((label) => /^Next /i.test(label ?? "")).length, 1);
  assert.ok(!labels.some((label) => /Pause|Play marquee/i.test(label ?? "")));
  const lobby = indexSource.slice(indexSource.indexOf("export function JourneyLobbyIndex"), indexSource.indexOf("export function JourneyStoreIndex"));
  assert.doesNotMatch(lobby, /requestAnimationFrame|setInterval|setTimeout|marqueeStopped|pauseMarquee|resumeMarquee/);
  assert.doesNotMatch(indexSource, /HOME_MARQUEE_SPEED|HOME_MARQUEE_RESUME|HOME_MARQUEE_MAX_FRAME/);
});

test("late event data resets the rail to its new leading card while ordinary rerenders preserve its identity", () => {
  const effectDependencies = [];
  const Component = load({
    ...React,
    useRef: () => ({ current: null }),
    useEffect: (_effect, dependencies) => effectDependencies.push(dependencies),
    useState: (initial) => [initial, () => {}],
  });
  const elements = (node) => React.isValidElement(node)
    ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
  const rail = (eventData, productData = products) => elements(Component({ events: eventData, products: productData }))
    .find((node) => "data-home-marquee" in node.props);
  const pending = rail([]);
  const pendingDependencies = effectDependencies.at(-1);
  const populated = rail(events);
  const populatedDependencies = effectDependencies.at(-1);
  assert.notEqual(pending.key, null);
  assert.notEqual(populated.key, null);
  assert.notEqual(pending.key, populated.key, "A prepended event must remount the native scroller instead of retaining the old snapped card");
  assert.notDeepEqual(pendingDependencies, populatedDependencies);
  assert.equal(rail([]).key, pending.key);
  assert.equal(rail(events.map((event) => ({ ...event }))).key, populated.key);
  assert.equal(rail(events, products.map((product) => ({ ...product, price: "$72" }))).key, populated.key,
    "Unrelated refreshed product data must preserve a visitor's chosen carousel position");
  assert.deepEqual(effectDependencies.at(-1), populatedDependencies);
  const replacement = rail(events.map((event) => event.id === "byob-03" ? { ...event, id: "byob-04" } : event));
  assert.notEqual(replacement.key, populated.key);
  assert.notDeepEqual(effectDependencies.at(-1), populatedDependencies,
    "A new leading event with the same card count must reconnect the observer to the remounted rail");
});

test("manual arrows advance one card, honor reduced motion, and disable at the rail boundaries", () => {
  const calls = [];
  const effects = [];
  const state = [];
  let cursor = 0;
  let reducedMotion = false;
  const rail = {
    scrollLeft: 0, scrollWidth: 1280, clientWidth: 640,
    children: [{ offsetLeft: 10 }, { offsetLeft: 330 }],
    scrollBy(options) {
      calls.push(options);
      this.scrollLeft = Math.max(0, Math.min(640, this.scrollLeft + options.left));
    },
  };
  const Component = load({
    ...React,
    useRef: () => ({ current: rail }),
    useEffect: (effect) => effects.push(effect),
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], (value) => { state[slot] = value; }];
    },
  }, {
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  const elements = (node) => React.isValidElement(node)
    ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
  const draw = () => { cursor = 0; return elements(Component({ events, products })); };
  const button = (label) => draw().find((node) => node.props["aria-label"] === label);
  const update = () => draw().find((node) => "data-home-marquee" in node.props).props.onScroll();
  draw();
  effects[0]();
  assert.equal(calls.length, 0, "Mounting and measuring the rail must not move it");
  assert.equal(button("Previous feature").props.disabled, true);
  assert.equal(button("Next feature").props.disabled, false);
  button("Next feature").props.onClick();
  update();
  assert.deepEqual(calls[0], { left: 320, behavior: "smooth" });
  assert.equal(button("Previous feature").props.disabled, false);
  button("Next feature").props.onClick();
  update();
  assert.equal(button("Next feature").props.disabled, true);
  reducedMotion = true;
  button("Previous feature").props.onClick();
  assert.deepEqual(calls.at(-1), { left: -320, behavior: "instant" });
});
