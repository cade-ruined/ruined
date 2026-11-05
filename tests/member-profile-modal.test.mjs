import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const css = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".module.css")) return css;
    throw Error(`Unexpected profile modal dependency: ${name}`);
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}

function fixture(t) {
  const frames = new Map(), slots = [], effects = [];
  let cursor = 0, frameId = 0, backs = 0, cleanups = [];
  const document = { activeElement: null, body: { style: { overflow: "auto" } }, querySelector: () => searchTrigger };
  class Element {
    constructor(name) { this.name = name; this.isConnected = true; this.focuses = 0; }
    focus() { this.focuses++; document.activeElement = this; }
  }
  const opener = new Element("member-row"), searchTrigger = new Element("search-trigger"), closeButton = new Element("close");
  document.activeElement = opener;
  const dialog = new Element("profile-dialog");
  Object.assign(dialog, { open: false, opens: 0, closes: 0,
    showModal() { this.open = true; this.opens++; }, close() { this.open = false; this.closes++; } });
  const hooks = { ...React,
    useId: () => "member-profile-title",
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback) { const index = cursor++; if (!slots[index]) { slots[index] = true; effects.push(callback); } },
  };
  const Modal = load("src/components/membership/MemberProfileModal.tsx", {
    react: hooks, "next/navigation": { useRouter: () => ({ back() { backs++; } }) },
  }, { document, HTMLElement: Element,
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  }).default;
  const render = () => {
    cursor = 0;
    const tree = Modal({ profileHref: "/profile/cade", children: React.createElement("section", null, "Public identity, earned badges and Timeline") });
    for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = node.type === "dialog" ? dialog : closeButton;
    cleanups.push(...effects.splice(0).map(effect => effect()));
    return tree;
  };
  const cleanup = () => { cleanups.splice(0).forEach(callback => callback?.()); };
  t.after(cleanup);
  return { render, cleanup, dialog, document, opener, searchTrigger, closeButton,
    backs: () => backs, flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test("public profiles use a named native modal with initial Close focus and independent full-page link", t => {
  const f = fixture(t), tree = f.render();
  assert.equal(tree.type, "dialog");
  assert.equal(tree.props["aria-modal"], "true");
  assert.equal(tree.props["data-member-profile-dialog"], "true");
  const title = nodes(tree).find(node => node.type === "h2");
  assert.equal(tree.props["aria-labelledby"], title.props.id);
  assert.equal(f.dialog.opens, 1, "Native modal behavior keeps background content inert and traps focus");
  assert.equal(f.document.body.style.overflow, "hidden");
  f.flushFrames(); assert.equal(f.document.activeElement, f.closeButton);
  assert.match(text(tree), /Public identity, earned badges and Timeline/);
  const expand = nodes(tree).find(node => node.type === "a");
  assert.equal(expand.props.href, "/profile/cade");
  assert.equal(expand.props["aria-label"], "Open full profile page");
  assert.match(text(expand), /Open page/);
});

test("Close, Escape and backdrop return once while nested badge cancellation and profile clicks stay inside", t => {
  const f = fixture(t), tree = f.render();
  let prevented = false;
  tree.props.onCancel({ target: {}, currentTarget: f.dialog, preventDefault() { prevented = true; } });
  tree.props.onClick({ target: {}, currentTarget: f.dialog });
  assert.equal(f.backs(), 0); assert.equal(prevented, false);
  tree.props.onCancel({ target: f.dialog, currentTarget: f.dialog, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.backs(), 1);
  nodes(tree).find(node => node.type === "button").props.onClick();
  tree.props.onClick({ target: f.dialog, currentTarget: f.dialog });
  assert.equal(f.backs(), 1, "Repeated close events must not navigate back twice");
});

test("closing restores body scroll and the exact connected profile opener", t => {
  const f = fixture(t); f.render(); f.flushFrames();
  f.cleanup(); f.flushFrames();
  assert.equal(f.dialog.open, false); assert.equal(f.dialog.closes, 1);
  assert.equal(f.document.body.style.overflow, "auto");
  assert.equal(f.document.activeElement, f.opener);
  assert.equal(f.searchTrigger.focuses, 0);
});

test("a result removed with the search dialog restores focus to the persistent search trigger", t => {
  const f = fixture(t); f.render(); f.flushFrames();
  f.opener.isConnected = false;
  f.cleanup(); f.flushFrames();
  assert.equal(f.document.activeElement, f.searchTrigger);
});

test("profile links preserve canonical URLs, query scroll and modified browser navigation", () => {
  const Link = load("src/components/membership/MemberProfileLink.tsx", { "next/link": { __esModule: true, default: "a" } }).default;
  let navigations = 0, focuses = 0;
  const tree = Link({ href: "/profile/cade", children: "Cade", onNavigate: () => navigations++ });
  assert.equal(tree.props.href, "/profile/cade");
  assert.equal(tree.props.scroll, false); assert.equal(tree.props.prefetch, false);
  assert.equal(tree.props["aria-haspopup"], "dialog");
  const event = { button: 0, currentTarget: { focus() { focuses++; } } };
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    tree.props.onClick({ ...event, ...modifier });
  }
  assert.equal(navigations, 0); assert.equal(focuses, 0);
  tree.props.onClick(event);
  assert.equal(navigations, 1); assert.equal(focuses, 1);
});

test("intercepted route keeps its dialog layout around shared server public content and recovery states", async () => {
  function Modal() { return null; }
  function SharedProfile() { return null; }
  const Page = load("app/@modal/(.)profile/[memberTag]/page.tsx", { "@/components/membership/PublicMemberProfilePage": SharedProfile }).default;
  const Layout = load("app/@modal/(.)profile/[memberTag]/layout.tsx", { "@/components/membership/MemberProfileModal": Modal }).default;
  const page = await Page({ params: Promise.resolve({ memberTag: "cade" }) });
  assert.equal(page.type, SharedProfile); assert.equal(page.props.identifier, "cade"); assert.equal(page.props.embedded, true);
  for (const state of ["loading", "error", "not-found"]) {
    const State = load(`app/@modal/(.)profile/[memberTag]/${state}.tsx`).default;
    let reset = 0;
    const content = State({ reset: () => reset++ });
    const layout = await Layout({ params: Promise.resolve({ memberTag: "cade" }), children: content });
    assert.equal(layout.type, Modal); assert.equal(layout.props.profileHref, "/profile/cade");
    assert.equal(layout.props.children, content);
    if (state === "error") { nodes(content).find(node => node.type === "button").props.onClick(); assert.equal(reset, 1); }
  }
});
