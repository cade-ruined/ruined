import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const styles = new Proxy({}, { get: (_target, name) => String(name) });
function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name.endsWith(".module.css")) return { __esModule: true, default: styles };
    throw new Error(`Unexpected dependency: ${name}`);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports.default;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object") return text(typeof node.type === "function" ? node.type(node.props) : node.props?.children);
  return String(node);
}
function fixture(path, props, extraDependencies = {}) {
  const states = [], refs = [];
  let stateIndex, refIndex, tree;
  const Component = load(path, {
    react: {
      ...React,
      useMemo: callback => callback(),
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    },
    ...extraDependencies,
  });
  const draw = () => { stateIndex = 0; refIndex = 0; tree = Component(props); return tree; };
  draw();
  return {
    draw,
    all: () => nodes(tree),
    text: () => text(tree),
    find(predicate) { const match = nodes(tree).find(predicate); assert.ok(match, "Expected matching element"); return match; },
  };
}
const recording = {
  id: "recording-1", title: "Foundations 01", summary: "The first Foundations call.", collectionName: "Foundations",
  href: "/my/library/foundations-01", resourceType: "video", durationLabel: "43 min", featured: true,
  presenter: null, publishedAt: "2026-11-06T12:00:00Z", thumbnailUrl: "/membership/library/foundations-01.jpg", videoUrl: null, captionsUrl: null,
};
const detail = { ...recording, slug: "foundations-01", bodyMarkdown: null, externalUrl: null, storageBucket: "member-library", storagePath: "foundations-01/video.mp4", version: 1 };
const learning = { collections: [{ id: "foundations", slug: "foundations", name: "Foundations", description: null, resources: [recording] }], uncollected: [] };
const libraryPath = "src/components/membership/MemberLearningLibrary.tsx";

test("the first recording is featured once without a duplicate or empty shelf", () => {
  for (const snapshot of [learning, { collections: [], uncollected: [recording] }]) {
    const f = fixture(libraryPath, { learning: snapshot });
    assert.equal(f.all().filter(node => node.type === "h2").length, 1);
    assert.equal(text(f.find(node => node.type === "h2")), "Foundations 01");
    assert.equal(f.all().filter(node => node.props?.["data-library-resource-card"]).length, 0);
    assert.doesNotMatch(f.text(), /More to explore|Nothing here yet/);
    assert.equal(f.find(node => node.type === "a" && text(node).includes("Watch recording")).props.href, recording.href);
  }
});

test("Library search, collection selection, no results, and clearing keep the recording discoverable", () => {
  const f = fixture(libraryPath, { learning });
  f.find(node => node.type === "button" && text(node) === "Foundations").props.onClick(); f.draw();
  assert.equal(f.find(node => node.props?.["data-library-resource-card"] !== undefined).props.href, recording.href);
  const search = () => f.find(node => node.type === "input" && node.props.type === "search");
  search().props.onChange({ target: { value: "  FOUNDATIONS  " } }); f.draw();
  assert.match(f.text(), /1 resource/);
  search().props.onChange({ target: { value: "missing recording" } }); f.draw();
  assert.match(f.find(node => node.props?.role === "status").props.children, /Nothing matches/);
  f.find(node => node.type === "button" && text(node) === "Clear").props.onClick(); f.draw();
  assert.equal(search().props.value, "");
  assert.match(f.text(), /Featured recording/);
});

test("an empty Library links to existing Work and invents no future content", () => {
  const f = fixture(libraryPath, { learning: { collections: [], uncollected: [] } });
  assert.match(f.text(), /Nothing here yet/);
  assert.equal(f.find(node => node.type === "a").props.href, "/my/practice");
  assert.equal(f.all().filter(node => node.props?.["data-library-resource-card"]).length, 0);
});

test("a private recording uses the authenticated stream and excludes itself from both related URLs", () => {
  const f = fixture("src/components/membership/MemberLearningArticle.tsx", {
    resource: { ...detail, videoUrl: "https://example.test/stale-public-video.mp4" },
    related: [recording, { ...recording, id: "legacy", href: "/my/learn/foundations-01" }],
  }, { "@/components/membership/MemberLibraryVideo": { __esModule: true, default: "library-video" } });
  assert.equal(f.find(node => node.type === "library-video").props.src, "/api/my/learn/foundations-01/stream");
  assert.equal(f.all().some(node => node.type === "aside"), false);
  assert.doesNotMatch(f.find(node => node.type === "section").props.className, /lg:grid-cols/);
  assert.equal(f.find(node => node.type === "a" && text(node).includes("Open The Work")).props.href, "/my/practice?course=f1");
});

test("the video player has native controls, an accessible title, and retry without autoplay", () => {
  const f = fixture("src/components/membership/MemberLibraryVideo.tsx", { title: recording.title, poster: recording.thumbnailUrl, captionsUrl: null, src: "/api/my/learn/foundations-01/stream" });
  const player = () => f.find(node => node.type === "video");
  assert.equal(player().props.controls, true);
  assert.equal(player().props.playsInline, true);
  assert.equal(player().props.autoPlay, undefined);
  assert.equal(player().props["aria-label"], recording.title);
  assert.equal(player().props.poster, recording.thumbnailUrl);
  player().props.onError(); f.draw();
  assert.match(text(f.find(node => node.props?.role === "status")), /couldn’t load/);
  let loads = 0;
  player().props.ref.current = { load() { loads += 1; } };
  f.find(node => node.type === "button").props.onClick(); f.draw();
  assert.equal(loads, 1);
  assert.equal(f.all().some(node => node.props?.role === "status"), false);
});
