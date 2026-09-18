import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern.js";
import nextConfig from "../next.config.mjs";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = await load("src/lib/membership/public-card-model.ts");
const token = "M".repeat(43);
const fixture = { name: "Chosen <name>", avatarUrl: null, memberSince: null, location: null, bio: null, buildingNow: null, websiteUrl: null, labels: [], wearSeed: "safe-seed" };
const notFound = () => { throw Object.assign(new Error("Not found"), { status: 404 }); };
const redirect = href => { throw Object.assign(new Error("Redirect"), { href }); };
const renderCard = ({ card, preview }) => React.createElement("article", { "data-preview": String(!!preview) }, JSON.stringify(card));
async function publicRoute(read) {
  return load("app/card/[token]/page.tsx", {
    "next/navigation": { notFound },
    "@/lib/membership/public-card-repository": { getPublicMemberCard: read },
    "@/lib/membership/public-card-model": model,
    "@/components/membership/card/PublicMemberCardPage": renderCard,
  });
}
const params = value => ({ params: Promise.resolve({ token: value }) });

test("unknown and revoked public cards have generic metadata and no member output", async () => {
  let reads = 0;
  const page = await publicRoute(async () => { reads++; return null; });
  for (const invalid of ["preview", "../my", "00000000-0000-4000-8000-000000000003"]) {
    const metadata = await page.generateMetadata(params(invalid));
    assert.equal(metadata.title, "Card unavailable");
    await assert.rejects(page.default(params(invalid)), { status: 404 });
  }
  assert.equal(reads, 0, "malformed public links must not reach membership queries");
  const metadata = await page.generateMetadata(params(token));
  assert.equal(metadata.title, "Card unavailable"); assert.deepEqual(metadata.openGraph.images, []);
  assert.deepEqual(metadata.twitter.images, []); assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.alternates.canonical, null);
  assert.doesNotMatch(JSON.stringify(metadata), /Chosen|public_token|memberId|personId|snapshot|safe-seed/);
  await assert.rejects(page.default(params(token)), { status: 404 });
});

test("public render accepts only the approved projection and metadata does not promote optional profile fields", async () => {
  let current = fixture;
  const page = await publicRoute(async value => { assert.equal(value, token); return current; });
  const result = await page.default(params(token));
  assert.deepEqual(Object.keys(result.props), ["card"]); assert.deepEqual(result.props.card, fixture);
  const html = renderToStaticMarkup(result);
  assert.match(html, /Chosen &lt;name&gt;/); assert.doesNotMatch(html, /PRIVATE|memberId|personId|email|sourceRevision/);
  const metadata = await page.generateMetadata(params(token));
  assert.equal(metadata.referrer, "no-referrer"); assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.openGraph.images[0].url, `https://members.theruinedproject.com/api/cards/${token}/image`);
  assert.equal(metadata.alternates.canonical, `https://members.theruinedproject.com/card/${token}`);
  current = null;
  await assert.rejects(page.default(params(token)), { status: 404 }, "a second request cannot reuse a formerly published card");
  assert.equal((await page.generateMetadata(params(token))).title, "Card unavailable");
});

test("preview is unavailable in production even when PLATFORM_MODE asks for sample content", async () => {
  const keys = ["NODE_ENV", "PLATFORM_MODE", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const configuration = await load("src/lib/platform/config.ts", { "server-only": {} });
    let sampleCalls = 0;
    const preview = await load("app/card/preview/page.tsx", {
      "next/navigation": { notFound }, "@/lib/platform/config": configuration,
      "@/lib/membership/public-card-preview": { memberCardPreviewSnapshot: () => { sampleCalls++; return { card: fixture }; } },
      "@/components/membership/card/PublicMemberCardPage": renderCard,
    });
    process.env.NODE_ENV = "production"; process.env.PLATFORM_MODE = "preview";
    for (const key of keys.slice(2)) delete process.env[key];
    assert.equal(configuration.getPlatformConfiguration().mode, "unavailable");
    assert.throws(() => preview.default(), { status: 404 });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test"; process.env.DATABASE_URL = "test";
    assert.equal(configuration.getPlatformConfiguration().mode, "connected");
    assert.throws(() => preview.default(), { status: 404 }); assert.equal(sampleCalls, 0);
    process.env.NODE_ENV = "development";
    assert.equal(preview.default().props.preview, true); assert.equal(sampleCalls, 1);
  } finally { for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; } }
});

test("owner route redirects signed-out visitors and connection failures never substitute sample content", async () => {
  let mode = "connected"; let viewer = null; let sampleCalls = 0; let fail = null;
  const snapshot = { settings: {}, card: fixture, writable: false };
  const page = await load("app/my/card/page.tsx", {
    "next/navigation": { redirect },
    "@/components/membership/MemberCardEditor": () => null,
    "@/components/platform/PlatformUnavailable": () => null,
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/public-card-repository": { getOwnMemberCard: async id => {
      assert.equal(id, "verified-user"); if (fail) throw fail; return snapshot;
    } },
    "@/lib/membership/public-card-preview": { memberCardPreviewSnapshot: () => { sampleCalls++; return snapshot; } },
    "@/lib/membership/public-card-model": model,
  });
  await assert.rejects(page.default(), { href: "/my/access" }); assert.equal(sampleCalls, 0);
  viewer = { authUserId: "verified-user" };
  const rendered = await page.default(); assert.equal(rendered.props.initialSnapshot, snapshot); assert.equal(rendered.props.writable, false);
  fail = new Error("PRIVATE DATABASE ERROR");
  const failed = await page.default(); assert.equal(failed.props.initialSnapshot, null);
  assert.doesNotMatch(JSON.stringify(failed.props), /PRIVATE DATABASE ERROR/); assert.equal(sampleCalls, 0);
  fail = new model.PublicCardError(403, "PRIVATE ACCESS DETAIL");
  assert.equal((await page.default()).props.reason, "member_access"); assert.equal(sampleCalls, 0);
  mode = "unavailable"; assert.equal((await page.default()).props.accessHref, "/my/access"); assert.equal(sampleCalls, 0);
  mode = "preview";
  const preview = await page.default(); assert.equal(preview.props.preview, true); assert.equal(preview.props.writable, false); assert.equal(sampleCalls, 1);
});

test("card bytes cannot enter Next's public image cache, while static assets and sequence versions still optimize", async () => {
  const patterns = nextConfig.images.localPatterns;
  for (const path of [
    `/api/cards/${token}/portrait`, `/api/cards/${token}/portrait?v=2`, `/api/cards/${token}/image`,
    `/membership/../api/cards/${token}/image`, `/membership/%2e%2e/api/cards/${token}/image`,
    `/api%2Fcards%2F${token}%2Fimage`, `/api/%63ards/${token}/portrait`,
  ]) assert.equal(hasLocalMatch(patterns, path), false, path);
  for (const path of ["/ruined-hero-1.jpg", "/ruined-wordmark.svg", "/membership/portrait-pending-editorial.webp", "/sequences/lobby/frame-001.webp?v=2", "/_next/static/media/image.hash.png", "/store/size-guide.png"]) {
    assert.equal(hasLocalMatch(patterns, path), true, path);
  }
  const headers = await nextConfig.headers();
  const cardHeaders = Object.fromEntries(headers.find(rule => rule.source === "/card/:path*").headers.map(header => [header.key, header.value]));
  assert.match(cardHeaders["Cache-Control"], /private, no-store/); assert.equal(cardHeaders["Referrer-Policy"], "no-referrer");
  assert.equal(cardHeaders["X-Robots-Tag"], "noindex, nofollow");
  assert.ok(headers.findIndex(rule => rule.source === "/card/:path*") > headers.findIndex(rule => rule.source === "/(.*)"), "specific privacy headers must override the global referrer policy");
});

test("card analytics are suppressed before effects and after navigation, with beacon and fetch transports", async () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const savedFetch = globalThis.fetch;
  const savedEndpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
  let pathname = "/about"; let reported = null; let effect = null; let visited = { current: false };
  const sends = [];
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { get pathname() { return pathname; } } } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: (...args) => { sends.push(["beacon", ...args]); return true; } } });
    globalThis.fetch = async (...args) => { sends.push(["fetch", ...args]); return new Response(null); };
    process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = "https://analytics.example.test";
    const vitals = await load("src/components/WebVitals.tsx", {
      "next/web-vitals": { useReportWebVitals: callback => { reported = callback; } },
      "next/navigation": { usePathname: () => pathname },
      react: { useRef: () => visited, useEffect: callback => { effect = callback; } },
    });
    const metric = { name: "LCP", value: 100, entries: [{ name: `https://members.theruinedproject.com/card/${token}` }] };
    vitals.default(); effect(); reported({ name: "LCP", value: 100, entries: [] });
    assert.equal(sends.length, 1); assert.equal(sends[0][0], "beacon", "ordinary pages keep existing analytics");
    for (const cardPath of [`/card/${token}`, "/card/preview", "/my/card"]) {
      visited = { current: false }; pathname = cardPath;
      vitals.default(); reported(metric);
      assert.equal(sends.length, 1, "current card location must suppress reports even before useEffect");
      effect(); pathname = "/about"; vitals.default(); effect(); reported(metric);
      assert.equal(sends.length, 1, "the persistent flag must suppress delayed card entries after SPA navigation");
    }
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    visited = { current: false }; pathname = "/work";
    vitals.default(); effect(); reported({ name: "CLS", value: 0, entries: [] });
    assert.equal(sends.length, 2); assert.equal(sends[1][0], "fetch");
    pathname = `/card/${token}`; vitals.default(); reported(metric); effect();
    pathname = "/work"; vitals.default(); effect(); reported(metric);
    assert.equal(sends.length, 2); assert.doesNotMatch(JSON.stringify(sends), new RegExp(token));
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow); else delete globalThis.window;
    if (savedNavigator) Object.defineProperty(globalThis, "navigator", savedNavigator); else delete globalThis.navigator;
    globalThis.fetch = savedFetch;
    if (savedEndpoint === undefined) delete process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT; else process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = savedEndpoint;
  }
});

test("database failures reach a generic retry boundary without rendering the error or example member", async () => {
  const failure = new Error(`PRIVATE DATABASE PATH /card/${token}`);
  const page = await publicRoute(async () => { throw failure; });
  await assert.rejects(page.default(params(token)), error => error === failure);
  await assert.rejects(page.generateMetadata(params(token)), error => error === failure);
  const boundary = await load("app/card/error.tsx");
  let resets = 0;
  const element = boundary.default({ error: failure, reset: () => { resets++; } });
  const html = renderToStaticMarkup(element);
  assert.match(html, /try again shortly/i); assert.doesNotMatch(html, /PRIVATE DATABASE PATH|Chosen|safe-seed/);
  const button = element.props.children.find(child => child.type === "button");
  button.props.onClick(); assert.equal(resets, 1);
});
