import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";

const require = createRequire(import.meta.url);
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const fixture = (changes = {}) => ({
  name: "Alex Morgan", memberTag: null, avatarUrl: null, memberSince: null, location: null,
  bio: null, buildingNow: null, websiteUrl: null, labels: [], wearSeed: "test-seed", ...changes,
});

async function load(file, dependencies) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}

async function imageModule(imageResponse = require("next/og").ImageResponse) {
  return load("src/lib/membership/public-card-image.tsx", {
    "server-only": {}, "node:fs/promises": fs, "node:path": path,
    "next/og": { ImageResponse: imageResponse }, sharp,
    "./public-card-model": { MEMBER_CARD_HEADERS: headers },
  });
}

function nodes(tree) {
  return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
}
function text(tree) {
  return Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : typeof tree === "string" ? tree : "";
}

test("social image creates a real 1200 by 630 PNG with shipped brand assets and no portrait", async () => {
  const renderer = await imageModule();
  const image = Buffer.from(await renderer.renderPublicMemberCardImage(fixture(), null));
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.ok(image.length > 20_000, "renders a composed image rather than an empty surface");
});

test("social image contains only the member name even when obsolete profile fields are supplied", async () => {
  let tree;
  class Capture extends Response { constructor(node) { super("rendered"); tree = node; } }
  const renderer = await imageModule(Capture);
  const card = fixture({
    memberTag: "alex_morgan", memberSince: "2026-08-12T20:10:00Z", avatarUrl: "http://127.0.0.1:1/private", websiteUrl: "https://private.example.test",
    location: "Sensitive address", bio: "Private notes", buildingNow: "Private project", email: "private@example.test",
  });
  await renderer.renderPublicMemberCardImage(card, null);
  const visible = text(tree);
  assert.match(visible, /Alex Morgan/);
  assert.equal(visible.match(/Alex Morgan/g)?.length, 2, "both name blocks retain the member name");
  assert.doesNotMatch(visible, /@alex_morgan|SINCE|2026|Sensitive address|Private notes|Private project|private@example/);
  for (const node of nodes(tree).filter((node) => node.type === "img")) assert.match(node.props.src, /^data:image\/(?:svg\+xml|jpeg);base64,/);
});

test("obsolete portrait fields and bytes are ignored while logo geometry stays exact", async () => {
  let tree;
  class Capture extends Response { constructor(node) { super("rendered"); tree = node; } }
  const renderer = await imageModule(Capture);
  const portrait = { arrayBuffer() { throw Error("Name-only cards must never read portrait bytes"); } };
  await renderer.renderPublicMemberCardImage(fixture({ avatarUrl: "/api/cards/test/portrait" }), portrait);
  assert.equal(nodes(tree).filter((node) => node.type === "img" && node.props.width === 296).length, 0);
  const brand = nodes(tree).find((node) => node.type === "img" && node.props.width === 14.2);
  const originalMark = await readFile(new URL("../public/ruined-mark.svg", import.meta.url), "utf8");
  assert.equal(Buffer.from(brand.props.src.split(",")[1], "base64").toString(), originalMark);
  const foil = nodes(tree).find((node) => node.type === "img" && node.props.height === 76);
  assert.equal(foil.props.width / foil.props.height, 283.956 / 400, "the larger foil keeps the supplied SVG proportions");
  const foilSvg = Buffer.from(foil.props.src.split(",")[1], "base64").toString();
  const paths = (svg) => [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(match => match[1]);
  assert.deepEqual(paths(foilSvg), paths(originalMark), "foil changes color while preserving every supplied path");
});

async function route(dependencies = {}) {
  return load("app/api/cards/[token]/image/route.ts", {
    "@/lib/membership/public-card-model": { MEMBER_CARD_HEADERS: headers },
    "@/lib/membership/public-card-repository": {
      getPublicMemberCard: async () => fixture(), getPublicMemberCardPortrait: async () => null,
      ...dependencies,
    },
    "@/lib/membership/public-card-image": { renderPublicMemberCardImage: dependencies.render ?? (async () => new Uint8Array([137, 80, 78, 71]).buffer) },
  });
}
const request = () => new Request("http://localhost/api/cards/test/image");
const params = () => ({ params: Promise.resolve({ token: "test" }) });

test("unknown and revoked tokens return generic no-store 404 without downloading or rendering", async () => {
  let accesses = 0;
  const endpoint = await route({ getPublicMemberCard: async () => null, getPublicMemberCardPortrait: async () => { accesses += 1; }, render: async () => { accesses += 1; } });
  const response = await endpoint.GET(request(), params());
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Card unavailable.");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(accesses, 0);
});

test("image route rechecks current card availability and identity after rendering", async () => {
  for (const changed of [null, fixture({ name: "Updated Name" }), fixture({ wearSeed: "new-card" })]) {
    let reads = 0;
    const published = fixture();
    const endpoint = await route({
      getPublicMemberCard: async () => ++reads === 1 ? published : changed,
      render: async () => new TextEncoder().encode("sensitive rendered bytes").buffer,
    });
    const response = await endpoint.GET(request(), params());
    assert.equal(reads, 2);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /sensitive/);
  }
});

test("successful PNG and backend failures use no-store headers without leaking errors", async () => {
  const successful = await route();
  const response = await successful.GET(request(), params());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  const failed = await route({ getPublicMemberCard: async () => { throw new Error("private member storage path"); } });
  const failure = await failed.GET(request(), params());
  assert.equal(failure.status, 503);
  assert.equal(await failure.text(), "Card unavailable.");
  assert.match(failure.headers.get("cache-control"), /no-store/);
});

test("image route never fetches portraits even when given an obsolete avatar field", async () => {
  let rendered;
  const endpoint = await route({
    getPublicMemberCard: async () => fixture({ avatarUrl: "/api/cards/test/portrait" }),
    getPublicMemberCardPortrait: async () => { throw Error("Unexpected portrait read"); },
    render: async (...args) => { rendered = args; return new Uint8Array([137, 80, 78, 71]).buffer; },
  });
  assert.equal((await endpoint.GET(request(), params())).status, 200);
  assert.equal(rendered.length, 1, "the image renderer only receives the card");
});

test("a full-length name retains its print space without secondary identity fields", async () => {
  let tree;
  class Capture extends Response { constructor(node) { super("rendered"); tree = node; } }
  const renderer = await imageModule(Capture);
  const name = "W".repeat(180);
  await renderer.renderPublicMemberCardImage(fixture({ name, memberTag: "w".repeat(24) }));
  const nameBlocks = nodes(tree).filter(node => node.props?.children === name);
  assert.equal(nameBlocks.length, 2, "the entire name is retained in both positions");
  assert.doesNotMatch(text(tree), /@wwww/);
  const actual = await imageModule();
  const png = Buffer.from(await actual.renderPublicMemberCardImage(fixture({ name })));
  assert.equal((await sharp(png).metadata()).width, 1200);
});
