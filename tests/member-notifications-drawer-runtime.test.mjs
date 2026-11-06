import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const css = { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) };

function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".module.css")) return css;
    throw Error(`Unexpected drawer dependency: ${name}`);
  }, result, result.exports, ...Object.values(globals));
  return result.exports;
}

function fixture(t, { intercepted = false } = {}) {
  const frames = new Map(), slots = [], effects = [], requests = [], replacements = [];
  let cursor = 0, frameId = 0, backs = 0, cleanups = [];
  const document = { activeElement: null, body: { style: { overflow: "auto" } }, querySelector: () => bell };
  class Element {
    constructor(name) { this.name = name; this.isConnected = true; this.focuses = 0; }
    focus() { this.focuses++; document.activeElement = this; }
    closest() { return null; }
  }
  const opener = new Element("opener"), bell = new Element("notification-bell"), closeButton = new Element("close");
  const dialog = new Element("notifications-drawer");
  Object.assign(dialog, { open: false, opens: 0, closes: 0,
    showModal() { this.open = true; this.opens++; }, close() { this.open = false; this.closes++; } });
  document.activeElement = opener;
  const hooks = { ...React,
    useId: () => "notifications-title",
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback) { const index = cursor++; if (!slots[index]) { slots[index] = true; effects.push(callback); } },
  };
  const Drawer = load("src/components/membership/MemberNotificationsDrawer.tsx", {
    react: hooks,
    "next/navigation": { useRouter: () => ({ back() { backs++; }, replace(...args) { replacements.push(args); } }) },
  }, { document, HTMLElement: Element,
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    fetch(...args) { requests.push(args); return Promise.resolve(Response.json({ ok: true })); },
  }).default;
  const render = () => {
    cursor = 0;
    const tree = Drawer({ intercepted, children: React.createElement("section", null, "Unread membership updates") });
    for (const node of nodes(tree)) if (node.props?.ref) node.props.ref.current = node.type === "dialog" ? dialog : closeButton;
    cleanups.push(...effects.splice(0).map(effect => effect()));
    return tree;
  };
  const cleanup = () => { cleanups.splice(0).forEach(callback => callback?.()); };
  t.after(cleanup);
  return { render, cleanup, dialog, document, opener, bell, closeButton, requests, replacements,
    backs: () => backs, flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test("Updates opens in a named native drawer with visible Close focus and no read request", t => {
  const f = fixture(t), tree = f.render();
  assert.equal(tree.type, "dialog");
  assert.equal(tree.props["aria-modal"], "true");
  const title = nodes(tree).find(node => /^h[1-6]$/.test(node.type));
  assert.ok(title);
  assert.equal(tree.props["aria-labelledby"], title.props.id);
  assert.match(text(tree), /Unread membership updates/);
  assert.ok(nodes(tree).some(node => node.type === "button" && /^Close/.test(text(node))));
  assert.equal(f.dialog.opens, 1, "The native dialog traps focus and makes background content inert");
  assert.equal(f.document.body.style.overflow, "hidden");
  f.flushFrames();
  assert.equal(f.document.activeElement, f.closeButton);
  assert.deepEqual(f.requests, []);
});

test("direct Updates Close always returns to the member home rather than unknown browser history", t => {
  const f = fixture(t), tree = f.render();
  nodes(tree).find(node => node.type === "button" && /^Close/.test(text(node))).props.onClick();
  assert.equal(f.backs(), 0);
  assert.deepEqual(f.replacements, [["/my", { scroll: false }]]);
  assert.deepEqual(f.requests, [], "Closing never marks notices as read");
});

test("intercepted Close, Escape and backdrop go back once while clicks inside stay open", t => {
  for (const action of ["close", "escape", "backdrop"]) {
    const f = fixture(t, { intercepted: true }), tree = f.render();
    let prevented = false;
    tree.props.onClick({ target: {}, currentTarget: f.dialog });
    assert.equal(f.backs(), 0);
    assert.equal(prevented, false);
    const close = nodes(tree).find(node => node.type === "button" && /^Close/.test(text(node)));
    if (action === "close") close.props.onClick();
    if (action === "escape") tree.props.onCancel({ target: f.dialog, currentTarget: f.dialog, preventDefault() { prevented = true; } });
    if (action === "backdrop") tree.props.onClick({ target: f.dialog, currentTarget: f.dialog });
    assert.equal(f.backs(), 1);
    if (action === "escape") assert.equal(prevented, true);
    close.props.onClick();
    tree.props.onClick({ target: f.dialog, currentTarget: f.dialog });
    assert.equal(f.backs(), 1, "Repeated close events cannot navigate back twice");
    assert.deepEqual(f.replacements, []);
    assert.deepEqual(f.requests, []);
  }
});

test("drawer cleanup restores scroll and the original opener without marking any notice read", t => {
  const f = fixture(t, { intercepted: true }); f.render(); f.flushFrames();
  f.cleanup(); f.flushFrames();
  assert.equal(f.dialog.open, false);
  assert.equal(f.dialog.closes, 1);
  assert.equal(f.document.body.style.overflow, "auto");
  assert.equal(f.document.activeElement, f.opener);
  assert.deepEqual(f.requests, []);
});

test("drawer cleanup does not focus an opener that was removed or hidden by an account change", t => {
  for (const change of [opener => { opener.isConnected = false; }, opener => { opener.closest = () => ({}); }]) {
    const f = fixture(t, { intercepted: true }); f.render(); f.flushFrames();
    change(f.opener);
    f.cleanup(); f.flushFrames();
    assert.equal(f.opener.focuses, 0);
    assert.equal(f.document.body.style.overflow, "auto");
    assert.deepEqual(f.requests, []);
  }
});

test("direct and intercepted routes reuse the same server-authorized content with distinct close modes", async () => {
  function Drawer() { return null; }
  function SharedContent() { return null; }
  const dependencies = {
    react: React,
    "@/components/membership/MemberNotificationsDrawer": Drawer,
    "@/components/membership/MemberUpdatesContent": SharedContent,
  };
  const Direct = load("app/my/updates/page.tsx", dependencies).default;
  const Intercepted = load("app/my/@notifications/(.)updates/page.tsx", dependencies).default;
  const Layout = load("app/my/@notifications/(.)updates/layout.tsx", dependencies).default;
  const direct = await Direct();
  assert.equal(direct.type, Drawer);
  assert.notEqual(direct.props.intercepted, true);
  assert.equal(direct.props.children.type, React.Suspense);
  assert.equal(direct.props.children.props.children.type, SharedContent);
  assert.equal(direct.props.children.props.fallback.props.role, "status");
  assert.equal(Intercepted, SharedContent);
  for (const state of ["loading", "error"]) {
    const State = load(`app/my/@notifications/(.)updates/${state}.tsx`).default;
    let retries = 0;
    const content = State({ reset: () => retries++ });
    const layout = await Layout({ children: content });
    assert.equal(layout.type, Drawer);
    assert.equal(layout.props.intercepted, true);
    assert.equal(layout.props.children, content, "Loading and errors retain the drawer's Close control");
    if (state === "error") {
      nodes(content).find(node => node.type === "button").props.onClick();
      assert.equal(retries, 1);
    }
  }
  for (const path of ["default.tsx", "page.tsx", "[...catchAll]/page.tsx"]) {
    assert.equal(load(`app/my/@notifications/${path}`).default(), null, "Other member destinations clear the notification slot");
  }
});

test("drawer content uses the existing member page authorization and never makes preview reads writable", async () => {
  const calls = [], snapshot = { items: [], unreadCount: 0 }, preview = { preview: true };
  let context = { state: "authenticated", data: snapshot };
  function Updates() { return null; }
  async function getMemberUpdates() { throw Error("The page context owns the authorized load"); }
  const Content = load("src/components/membership/MemberUpdatesContent.tsx", {
    "next/link": { __esModule: true, default: "a" },
    "next/navigation": { redirect(href) { throw Object.assign(Error("redirect"), { href }); } },
    "./MemberUpdates": Updates,
    "@/lib/membership/page-context": { getMembershipPageContext: async (...args) => { calls.push(args); return context; } },
    "@/lib/membership/preview": { PREVIEW_MEMBER_UPDATES: preview },
    "@/lib/membership/repository": { getMemberUpdates },
  }).default;
  const authenticated = await Content();
  assert.equal(authenticated.type, Updates);
  assert.equal(authenticated.props.initialUpdates, snapshot);
  assert.equal(authenticated.props.writable, true);
  assert.deepEqual(calls[0], [preview, getMemberUpdates, "updates"]);
  context = { state: "preview", data: snapshot };
  assert.equal((await Content()).props.writable, false);
  for (const state of ["denied", "unavailable"]) {
    context = { state, data: null };
    assert.notEqual((await Content()).type, Updates);
  }
  context = { state: "signed_out", data: null };
  await assert.rejects(Content(), error => error.href === "/my/access");
});
