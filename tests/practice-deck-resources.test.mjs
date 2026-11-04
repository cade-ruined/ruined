import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const source = file => readFileSync(new URL(file, root), "utf8");
function load(file, dependencies) {
  const code = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name.startsWith("node:")) return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function fixture({ visible = true, state = "authenticated", ownerId = "member-one", eligible = true, revisit = false, launched = true, released = true } = {}) {
  const calls = [];
  const gate = load("src/lib/practice/deck-access.ts", {
    "server-only": {},
    "@/lib/foundations/availability": { isFoundationsAvailableToMember: async id => { calls.push(["launch", id]); return launched; } },
    "@/lib/membership/access-policy": { deriveMemberAccessPolicy: x => x, memberCan: (_x, capability) => { assert.ok(["foundations.write", "foundations.revisit"].includes(capability)); return capability === "foundations.write" ? eligible : revisit; } },
    "@/lib/membership/page-context": { getMembershipPageContext: async () => ({ state, data: ["authenticated", "preview"].includes(state) ? {} : null, viewer: ownerId ? { authUserId: ownerId } : null }) },
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: {} },
    "@/lib/membership/repository": { getMemberIdentity: () => {} },
    "@/lib/platform/visibility": { isMyRuinedVisible: () => visible },
    "@/lib/practice/repository": { isPracticeCourseReleased: async (course, id) => { calls.push(["release", course, id]); return released; } },
  });
  const route = (file) => {
    const code = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", code)(name => {
      if (name === "@/lib/practice/deck-access") return gate;
      if (name === "next/navigation") return { redirect: url => { throw new Error(`redirect:${url}`); } };
      if (name === "node:fs/promises") return { readFile: async (path) => { calls.push(["read", path]); return '<html><head></head><body></body></html>'; } };
      return require(name);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  };
  return { gate, document: route("app/my/practice/deck/[course]/route.ts"), resource: route("app/my/practice/deck/[course]/resource/[...asset]/route.ts"), calls };
}
const params = (course = "f2", asset = ["data.js"]) => ({ params: Promise.resolve({ course, asset }) });

test("private deck documents and every resource deny access before curriculum reads", async () => {
  for (const [options, status] of [[{ visible: false }, 404], [{ state: "signed_out" }, 401], [{ state: "denied" }, 403], [{ ownerId: null }, 401], [{ eligible: false }, 403], [{ launched: false }, 403], [{ released: false }, 403]]) {
    const f = fixture(options);
    const response = await f.resource.GET(new Request("https://members.example.test"), params());
    assert.equal(response.status, status);
    assert.equal(await response.text(), "");
    assert.equal(f.calls.some(c => c[0] === "read"), false);
    if (status === 404) assert.equal((await f.document.GET(null, params())).status, 404);
    else await assert.rejects(f.document.GET(null, params()), { message: `redirect:${status === 401 ? "/my/access" : "/my/practice"}` });
    assert.equal(f.calls.some(c => c[0] === "read"), false);
  }
});

test("members with revisit access can read released decks without writing permission", async () => {
  const f = fixture({ eligible: false, revisit: true });
  assert.equal((await f.document.GET(null, params())).status, 200);
  assert.equal((await f.resource.GET(null, params())).status, 200);
});

test("known released resources are private, cookie-varying and confined to their course", async () => {
  const f = fixture();
  const response = await f.resource.GET(null, params("f3"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/javascript/);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(f.calls.find(c => c[0] === "read")[1], /\/src\/data\/practice-decks\/f3\/data\.js$/);
  for (const asset of [["..", "f4", "data.js"], ["f4", "data.js"], ["index.html"], ["provenance.json"], ["shared", "..", "f4", "data.js"]]) {
    const denied = fixture();
    assert.equal((await denied.resource.GET(null, params("f3", asset))).status, 404);
    assert.equal(denied.calls.some(c => c[0] === "read"), false);
  }
});

test("unknown course and F1 resources cannot expose arbitrary source; F1 redirects approved route", async () => {
  const f = fixture();
  assert.equal((await f.resource.GET(null, params("other"))).status, 404);
  assert.equal((await f.resource.GET(null, params("f1"))).status, 404);
  await assert.rejects(f.document.GET(null, params("f1")), { message: "redirect:/my/foundations/deck" });
  assert.equal(f.calls.some(c => c[0] === "read"), false);
});

test("resume namespace is per member, opaque, and separate from assignment completion", async () => {
  const a = await fixture().document.GET(null, params());
  const b = await fixture({ ownerId: "member-two" }).document.GET(null, params());
  const textA = await a.text(), textB = await b.text();
  assert.match(textA, /<base href="\/my\/practice\/deck\/f2\/resource\/">/);
  assert.notEqual(textA.match(/data-resume-key="([^"]+)/)[1], textB.match(/data-resume-key="([^"]+)/)[1]);
  assert.doesNotMatch(textA, /member-one/);
  for (const course of ["f2", "f3", "f4", "time"]) {
    assert.doesNotMatch(source(`src/data/practice-decks/${course}/app.js`), /fetch\(|localStorage|BroadcastChannel|badge|completeAssignment|\/api\//);
  }
});

function scenes(course) {
  return runInNewContext(source(`src/data/practice-decks/${course}/data.js`).replace("export const SCENES=", "globalThis.scenes="));
}
test("all approved audience scenes survive with no review forms, notes or mixed F3/F4 content", () => {
  for (const [course, count] of [["f2", 24], ["f3", 24], ["f4", 22]]) {
    const data = scenes(course);
    assert.equal(data.length, count);
    assert.ok(data.every(s => s.title && s.html));
    assert.ok(data.every(s => !Object.hasOwn(s, "notes") && !Object.hasOwn(s, "source")));
    assert.doesNotMatch(data.map(s => s.html).join(""), /<textarea|<form|members\.html|source wording|facilitator notes|data-timer-toggle/i);
  }
  assert.doesNotMatch(source("src/data/practice-decks/f3/data.js"), /ONE YEAR<br|A COMMITMENT/);
  const time = runInNewContext(source("src/data/practice-decks/time/data.js").replace("export const modes=", "globalThis.modes="));
  assert.equal(Object.values(time).reduce((n, v) => n + v.scenes.length, 0), 40);
  assert.ok(Object.values(time).every(v => v.scenes.every(s => s.length === 3)));
  assert.doesNotMatch(source("src/data/practice-decks/time/data.js"), /communications|facilitator|Host:/);
});

test("required imagery resolves locally and curriculum stays outside public files", () => {
  const provenance = JSON.parse(source("src/data/practice-decks/provenance.json"));
  for (const url of Object.values(provenance.assets)) assert.ok(existsSync(new URL(`public${url}`, root)), url);
  for (const course of ["f2", "f3", "f4", "time"]) assert.equal(existsSync(new URL(`public/membership/practice/${course}/data.js`, root)), false);
});

function illustrationFixture(course, { canvas = null, controls = [] } = {}) {
  const handlers = new Map(), properties = new Map();
  const illustration = canvas ? { dataset: { demoCanvas: canvas }, innerHTML: "" } : null;
  const controlNodes = controls.map(([key, value]) => ({ dataset: { demoRange: key }, value }));
  const body = { addEventListener: (type, handler) => handlers.set(type, handler) };
  const root = {
    style: { setProperty: (key, value) => properties.set(key, value) },
    querySelectorAll: selector => selector === "[data-demo-canvas]" ? (illustration ? [illustration] : []) : selector === "[data-demo-range]" ? controlNodes : [],
    querySelector: selector => selector === ".f34-scene-body" ? body : null,
  };
  Object.assign(body, root);
  const context = { root, console, result: null };
  runInNewContext(source(`src/data/practice-decks/${course}/interactions.js`).replaceAll("export function ", "function ") + "\nglobalThis.result={paint,bind};", context);
  context.result.paint(root);context.result.bind(root);
  return { illustration, properties, input: (key, value) => handlers.get("input")({ target: { dataset: { demoRange: key }, value } }) };
}

test("participation changes the connection model rather than revealing another paragraph", () => {
  const f = illustrationFixture("f3", { canvas: "network", controls: [["participation", 0]] });
  assert.match(f.illustration.innerHTML, />UNKNOWN</);
  assert.match(f.illustration.innerHTML, /opacity="0"/);
  f.input("participation", 100);
  assert.match(f.illustration.innerHTML, />KNOWN</);
  assert.match(f.illustration.innerHTML, /opacity="1"/);
});

test("F4 next-step control moves the person while the storm remains an independent background", () => {
  const f = illustrationFixture("f4", { controls: [["action", 0]] });
  assert.equal(f.properties.get("--demo-action"), 0);
  f.input("action", 100);
  assert.equal(f.properties.get("--demo-action"), 1);
  const fear = scenes("f4").find(s => s.html.includes('class="f34-storm-video"'));
  assert.ok(fear);
  assert.match(fear.html, /f34-storm-woman/);
  assert.match(fear.html, /f34-storm-video/);
});

test("F2 event-story slider changes composition weight and stays interactive on revisits", () => {
  const style = new Map(), balance = { style: { setProperty: (key, value) => style.set(key, value) }, dataset: {} };
  const range = { dataset: { control: "recap" }, value: 0, setAttribute() {} };
  const root = { querySelector: selector => selector === "[data-balance]" ? balance : null, querySelectorAll: selector => selector === "[data-control]" ? [range] : [] };
  const ctx = { result: null };
  runInNewContext(source("src/data/practice-decks/f2/interactions.js").replaceAll("export function ", "function ") + "\nglobalThis.result={paint,bind};", ctx);
  ctx.result.paint(root);ctx.result.bind(root, () => {});
  assert.equal(style.get("--balance"), 0);
  root.oninput({ target: { dataset: { control: "recap" }, value: 100 } });
  assert.equal(style.get("--balance"), 1);
  assert.equal(balance.dataset.dominant, "story");
  ctx.result.paint(root);
  assert.equal(range.value, 100);
});

test("every preserved F3/F4 concept illustration renders without missing dependencies", () => {
  for (const [course, canvases] of [["f3", ["network", "difference", "reciprocity", "response", "circle", "participation"]], ["f4", ["action", "identity", "carry", "scan", "week"]]]) {
    for (const canvas of canvases) {
      const f = illustrationFixture(course, { canvas });
      assert.ok(f.illustration.innerHTML.length > 100, `${course} ${canvas}`);
      assert.doesNotMatch(f.illustration.innerHTML, /undefined|NaN/);
    }
  }
});
