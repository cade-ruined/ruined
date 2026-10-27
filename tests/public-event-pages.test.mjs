import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected event-page dependency: ${name}`);
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

const origin = "https://theruinedproject.com";
const preview = JSON.parse(readFileSync(new URL("../src/lib/sharing-previews.json", import.meta.url), "utf8"));
const sharing = load("src/lib/sharing.ts", { "./sharing-previews.json": preview, "./site": { SITE_URL: origin } });
const helpers = load("src/lib/events/public-event-page.ts", {
  "@/lib/site": { SITE_URL: origin }, "@/lib/sharing": sharing,
});
const event = {
  id: "byob-04", title: "BYOB Nº 04", eyebrow: "Monthly gathering",
  date: "14 November 2026", dateTime: "2026-11-14T16:00:00.000Z", time: "9:00 AM MST",
  location: "Details to come", admission: "", summary: "Bring Your Own (Bell or bodyweight).",
  timezone: "America/Denver", image: "/events/byob-key-art.png", status: "Upcoming",
};
const component = (fn) => ({ __esModule: true, default: fn });
function eventsIndex(dependencies = {}, globals = {}) {
  return load("src/components/events/EventsIndex.tsx", {
    react: React,
    "next/image": component((props) => React.createElement("img", Object.fromEntries(Object.entries(props).filter(([key]) => key !== "fill" && key !== "priority")))),
    "next/link": component((props) => React.createElement("a", props)),
    "next/navigation": { useRouter: () => ({ push: () => {} }) },
    "@/components/events/EventGallery": component(({ eventId }) => React.createElement("div", { "data-gallery": eventId })),
    "@/lib/events/use-public-events": { usePublicEvents: (events) => events },
    "@/lib/events/public-event-page": helpers,
    ...dependencies,
  }, globals).default;
}

test("event metadata names the actual published event and its own canonical URL", () => {
  const metadata = helpers.publicEventMetadata(event);
  assert.equal(metadata.title, event.title);
  assert.equal(metadata.alternates.canonical, "/community/byob-04");
  assert.equal(metadata.openGraph.url, `${origin}/community/byob-04`);
  assert.match(metadata.description, /14 November 2026 · 9:00 AM MST/);
  assert.equal(metadata.openGraph.images[0].url, `${origin}/events/byob-key-art.png`);
  assert.equal(helpers.publicEventHref("a/b"), "/community/a%2Fb");
});

test("event markup uses confirmed facts and never invents venue, price, end time, or availability", () => {
  for (const location of ["", "Details to come", "TBD", "Location to be announced", "Venue coming soon"]) {
    const schema = helpers.publicEventSchema({ ...event, location });
    assert.equal(schema["@type"], "WebPage", location);
    assert.equal(schema.startDate, undefined);
    assert.equal(schema.location, undefined);
  }
  const confirmed = helpers.publicEventSchema({ ...event, location: "Tibble Fork Reservoir · Hill south of the parking lot" });
  assert.equal(confirmed["@type"], "Event");
  assert.equal(confirmed.startDate, event.dateTime);
  assert.equal(confirmed.location.name, "Tibble Fork Reservoir · Hill south of the parking lot");
  assert.equal(confirmed.organizer["@id"], `${origin}/#organization`);
  for (const field of ["offers", "isAccessibleForFree", "endDate", "eventStatus"]) assert.equal(confirmed[field], undefined);
  assert.equal(confirmed.location.address, undefined);
  assert.equal(helpers.publicEventSchema({ ...event, dateOnly: true, location: "Confirmed venue" }).startDate, "2026-11-14");
  assert.equal(helpers.publicEventSchema({ ...event, dateTime: "invalid", location: "Confirmed venue" })["@type"], "WebPage");
});

test("event leaf is fully server-rendered, including details, archive media, and existing registration links", () => {
  const EventIndex = eventsIndex();
  const archive = { ...event, id: "byob-01", title: "BYOB Nº 01", status: "Ended", video: "/recap.mp4", gallery: [{ src: "/photo.webp" }] };
  const html = renderToStaticMarkup(React.createElement(EventIndex, { initialEvents: [archive, event], initialSelectedId: archive.id }));
  assert.match(html, /<h1[^>]*>BYOB Nº 01<\/h1>/);
  assert.match(html, /<details[^>]*open=""/);
  assert.match(html, /Bring Your Own \(Bell or bodyweight\)/);
  assert.match(html, /src="\/recap.mp4"/);
  assert.match(html, /data-gallery="byob-01"/);
  assert.match(html, /href="\/community"/);
  const registered = { ...event, registration: { status: "Open", href: "/community/byob-04/register", label: "Register" } };
  const registration = renderToStaticMarkup(React.createElement(EventIndex, { initialEvents: [registered], initialSelectedId: registered.id }));
  assert.match(registration, /href="\/community\/byob-04\/register"/);
});

test("overview cards expose native leaf links before any JavaScript runs", () => {
  const html = renderToStaticMarkup(React.createElement(eventsIndex(), { initialEvents: [event] }));
  assert.match(html, /href="\/community\/byob-04"/);
  assert.doesNotMatch(html, /href="\/community#byob-04"/);
});

test("legacy hash links still select the event while a leaf without a hash retains its initial selection", () => {
  for (const [hash, initialSelectedId, expected] of [["#byob-04", null, "byob-04"], ["", "byob-04", "byob-04"], ["#byob-04-gallery", "byob-04", "byob-04"], ["#%zz", null, null]]) {
    const effects = [], updates = [], listeners = [];
    const Index = eventsIndex({
      react: { ...React, useState: (initial) => [initial, (value) => updates.push(value)], useEffect: (effect) => effects.push(effect) },
    }, { window: { location: { hash }, addEventListener: (name) => listeners.push(name), removeEventListener: () => {} } });
    Index({ initialEvents: [event], initialSelectedId });
    effects[0]();
    assert.equal(updates[0], expected);
    assert.deepEqual(listeners, ["hashchange", "popstate"]);
  }
});

function routeFor(events) {
  const notFound = () => { throw new Error("NOT_FOUND"); };
  return load("app/community/[eventId]/page.tsx", {
    react: { cache: (fn) => fn }, "next/navigation": { notFound },
    "@/components/events/EventsIndex": component(eventsIndex()),
    "@/lib/events/community-event-repository": { getPublicCommunityEvents: async () => events },
    "@/lib/events/public-event-page": helpers,
  });
}

test("leaf metadata/content resolve only published feed entries and unknown or unpublished events fail closed", async () => {
  const props = { params: Promise.resolve({ eventId: event.id }) };
  const route = routeFor([event]);
  assert.equal((await route.generateMetadata(props)).alternates.canonical, "/community/byob-04");
  const html = renderToStaticMarkup(await route.default(props));
  assert.match(html, /<h1[^>]*>BYOB Nº 04<\/h1>/);
  assert.match(html, /"@type":"WebPage"/);
  for (const list of [[], [{ ...event, id: "some-other-event" }]]) {
    await assert.rejects(routeFor(list).default(props), /NOT_FOUND/);
    await assert.rejects(routeFor(list).generateMetadata(props), /NOT_FOUND/);
  }
});

test("sitemap includes exactly the supplied published event leaves, including recaps", async () => {
  for (const events of [[], [event, { ...event, id: "byob-01", status: "Ended" }]]) {
    const sitemap = load("app/sitemap.ts", {
      "@/lib/site": { SITE_URL: origin },
      "@/lib/shopify": { getProducts: async () => [], getShopPolicies: async () => ({}) },
      "@/lib/events/community-event-repository": { getPublicCommunityEvents: async () => events },
      "@/lib/events/public-event-page": helpers,
    });
    const urls = (await sitemap.default()).map((item) => item.url).filter((url) => url.startsWith(`${origin}/community/`));
    assert.deepEqual(urls, events.map((item) => `${origin}/community/${item.id}`));
  }
});
