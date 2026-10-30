import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { loadFoundationsAvailability } from "./helpers/foundations-availability-fixture.mjs";

const require = createRequire(import.meta.url);
const routeSource = readFileSync(new URL("../app/my/foundations/deck/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const template = '<!doctype html><html><head><title>Foundations 01</title><link rel="stylesheet" href="style.css"></head><body><a href="#stage">Skip</a><main id="stage"></main><script src="controls.js"></script></body></html>';
const fixtureOwner = "11111111-1111-4111-8111-111111111111";

function fixture({
  visible = true,
  launched = true,
  state = "authenticated",
  eligible = true,
  role = null,
  roleFailure = false,
  ownerId = fixtureOwner,
  registrationDestination = null,
  source = template,
} = {}) {
  const calls = [];
  const identity = { displayName: "Example member" };
  const previewIdentity = { displayName: "Preview member" };
  const redirect = href => { throw Error(`redirect:${href}`); };
  const getMemberIdentity = async () => { throw Error("Identity must load through the existing membership context"); };
  const dependencies = {
    "node:crypto": require("node:crypto"),
    "node:path": require("node:path"),
    "node:fs/promises": {
      readFile: async (file, encoding) => {
        calls.push(["read", file, encoding]);
        assert.match(file, /\/src\/data\/foundations-deck\/index\.html$/);
        assert.equal(encoding, "utf8");
        return source;
      },
    },
    "next/navigation": { redirect },
    "@/lib/platform/visibility": { isMyRuinedVisible: () => { calls.push(["visible"]); return visible; } },
    "@/lib/foundations/availability": loadFoundationsAvailability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) }, {
      getOperatorRole: async id => {
        calls.push(["role", id]);
        if (roleFailure) throw Error("Role read failed");
        return role;
      },
    }),
    "@/lib/membership/access-policy": {
      deriveMemberAccessPolicy: data => { calls.push(["access", data]); return data; },
      memberCan: (access, capability) => {
        calls.push(["capability", capability]);
        assert.equal(access, identity);
        assert.equal(capability, "foundations.write");
        return eligible;
      },
    },
    "@/lib/membership/page-context": {
      getMembershipPageContext: async (preview, load, area) => {
        calls.push(["context", area]);
        assert.equal(preview, previewIdentity);
        assert.equal(load, getMemberIdentity);
        assert.equal(area, "Foundations");
        if (registrationDestination) redirect(registrationDestination);
        return {
          state,
          data: ["authenticated", "preview"].includes(state) ? identity : null,
          viewer: ownerId ? { authUserId: ownerId, email: "private@example.test", roles: ["ops_admin"] } : null,
        };
      },
    },
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: previewIdentity },
    "@/lib/membership/repository": { getMemberIdentity },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected deck dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return { ...loaded.exports, calls };
}

function assertNoDocumentRead(f) {
  assert.equal(f.calls.some(([kind]) => kind === "read"), false);
}

test("direct deck document retains the visibility, session and registration gates without a React layout", async () => {
  const hidden = fixture({ visible: false });
  const response = await hidden.GET();
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "");
  assert.deepEqual(hidden.calls, [["visible"]]);

  for (const state of ["signed_out", "denied", "unavailable"]) {
    const f = fixture({ state });
    await assert.rejects(f.GET(), { message: `redirect:${state === "signed_out" ? "/my/access" : "/my/foundations"}` });
    assertNoDocumentRead(f);
    assert.equal(f.calls.some(([kind]) => kind === "access" || kind === "role"), false);
  }
  for (const registrationDestination of ["/my/activate", "/my/registered"]) {
    const f = fixture({ registrationDestination });
    await assert.rejects(f.GET(), { message: `redirect:${registrationDestination}` });
    assertNoDocumentRead(f);
  }
  const missingOwner = fixture({ ownerId: null });
  await assert.rejects(missingOwner.GET(), { message: "redirect:/my/access" });
  assertNoDocumentRead(missingOwner);
});

test("the new deck retains launch and eligibility rules, including the current Administrator exception", async () => {
  for (const role of [null, "guide", "circle_leader"]) {
    const f = fixture({ launched: false, role });
    await assert.rejects(f.GET(), { message: "redirect:/my/foundations" });
    assert.deepEqual(f.calls.filter(([kind]) => kind === "role"), [["role", fixtureOwner]]);
    assertNoDocumentRead(f);
  }
  const administrator = fixture({ launched: false, role: "ops_admin" });
  assert.equal((await administrator.GET()).status, 200);
  for (const options of [{ launched: true }, { launched: false, role: "ops_admin" }]) {
    const f = fixture({ ...options, eligible: false });
    await assert.rejects(f.GET(), { message: "redirect:/my/foundations" });
    assertNoDocumentRead(f);
  }
  const failedRole = fixture({ launched: false, roleFailure: true });
  await assert.rejects(failedRole.GET(), { message: "redirect:/my/foundations" });
  assertNoDocumentRead(failedRole);
});

test("preview cannot impersonate an Administrator and still requires the launch flag", async () => {
  const closed = fixture({ state: "preview", launched: false, role: "ops_admin" });
  await assert.rejects(closed.GET(), { message: "redirect:/my/foundations" });
  assertNoDocumentRead(closed);
  assert.equal(closed.calls.some(([kind]) => kind === "role"), false);
  const open = fixture({ state: "preview", launched: true });
  assert.equal((await open.GET()).status, 200);
  const ineligible = fixture({ state: "preview", launched: true, eligible: false });
  await assert.rejects(ineligible.GET(), { message: "redirect:/my/foundations" });
  assertNoDocumentRead(ineligible);
});

test("the deck is a private full-page document with same-origin assets and no enrollment writes", async () => {
  const f = fixture();
  const response = await f.GET();
  const html = await response.text();
  assert.equal(f.runtime, "nodejs");
  assert.equal(f.dynamic, "force-dynamic");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.match(response.headers.get("Cache-Control"), /private.*no-store/);
  assert.equal(response.headers.get("Vary"), "Cookie");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.match(html, /<head><base href="\/membership\/foundations\/deck-v29\/">/);
  assert.match(html, /href="\/my\/foundations\/deck#stage"/);
  assert.match(html, /<script src="member\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="member\.css">/);
  assert.equal(f.calls.filter(([kind]) => kind === "read").length, 1);
  assert.doesNotMatch(html, /private@example\.test|\/api\/my\/foundations|iframe/i);
  assert.doesNotMatch(routeSource, /startMemberFoundations|recordMemberFoundationProgress|completeMemberFoundations|completeMemberFoundationRequirement/);
});

test("slide resume keys are opaque, stable per account, and isolated from other members and preview", async () => {
  const keyFor = async options => {
    const html = await (await fixture(options).GET()).text();
    const key = /data-member-resume-key="([^"]+)"/.exec(html)?.[1];
    assert.match(key, /^ruined-foundations01-v29-[a-f0-9]{24}$/);
    assert.doesNotMatch(html, new RegExp(fixtureOwner));
    return key;
  };
  const first = await keyFor({});
  assert.equal(await keyFor({}), first);
  assert.notEqual(await keyFor({ ownerId: "22222222-2222-4222-8222-222222222222" }), first);
  const preview = await keyFor({ state: "preview" });
  assert.notEqual(preview, first);
  assert.equal(await keyFor({ state: "preview", ownerId: null }), preview);
});

function readerFixture({ key = "account-a", href = "https://members.example.test/my/foundations/deck", storage = new Map(), storageFailure = false } = {}) {
  const callbacks = new Map();
  const reads = [];
  const writes = [];
  const replaced = [];
  const removed = [];
  const links = [];
  const slideLinks = [0, 22, 23].map(index => ({ dataset: { slideGo: String(index) }, href: `#slide-${index + 1}` }));
  const classes = [];
  const help = { textContent: "" };
  class Element {
    constructor(editable = false) { this.editable = editable; }
    closest() { return this.editable ? this : null; }
  }
  const context = {
    URL,
    Element,
    location: { href },
    history: { replaceState: (_state, _title, value) => { replaced.push(value); context.location.href = new URL(value, context.location.href).href; } },
    sessionStorage: {
      getItem: requestedKey => { reads.push(requestedKey); if (storageFailure) throw Error("Storage blocked"); return storage.get(requestedKey) ?? null; },
      setItem: (requestedKey, value) => { if (storageFailure) throw Error("Storage blocked"); writes.push([requestedKey, value]); storage.set(requestedKey, value); },
    },
    localStorage: { getItem() { throw Error("Reader must not read persistent cross-session member state"); }, setItem() { throw Error("Reader must not persist member state across sessions"); } },
    fetch() { throw Error("Reader must not submit member progress or answers"); },
    BroadcastChannel: class { constructor() { throw Error("Member reader must not open a shared presentation channel"); } },
    document: {
      readyState: "loading",
      body: { dataset: { memberResumeKey: key }, classList: { add: value => classes.push(value) } },
      addEventListener: (name, callback, options) => callbacks.set(name, { callback, options }),
      createElement: tag => { assert.equal(tag, "a"); return {}; },
      querySelectorAll: selector => { assert.equal(selector, "a[data-slide-go]"); return slideLinks; },
      querySelector: selector => {
        if (["#presenterOpen", "#presenterPanel"].includes(selector)) return { remove: () => removed.push(selector) };
        if (selector === ".masthead .issue") return { replaceWith: link => links.push(link) };
        if (selector === ".index-end p") return help;
        throw Error(`Unexpected reader selector: ${selector}`);
      },
    },
  };
  context.window = context;
  runInNewContext(readFileSync(new URL("../public/membership/foundations/deck-v29/member.js", import.meta.url), "utf8"), context);
  return { context, reads, writes, replaced, removed, links, slideLinks, classes, help, callbacks, emit: (name, event = {}) => callbacks.get(name)?.callback(event) };
}

test("reader resume is account-scoped, respects explicit slide links, and saves slide numbers only", () => {
  const storage = new Map([["account-a", "7"], ["account-b", "2"]]);
  const a = readerFixture({ storage });
  assert.equal(new URL(a.context.location.href).hash, "#slide-08");
  assert.deepEqual(a.reads, ["account-a"]);
  a.emit("foundations:slidechange", { detail: { index: 9, sourceIndex: 11, answer: "Private reflection" } });
  assert.deepEqual(a.writes, [["account-a", "9"]]);
  assert.equal(storage.get("account-b"), "2");
  const b = readerFixture({ key: "account-b", storage });
  assert.equal(new URL(b.context.location.href).hash, "#slide-03");
  const explicit = readerFixture({ storage, href: "https://members.example.test/my/foundations/deck#slide-05" });
  assert.equal(new URL(explicit.context.location.href).hash, "#slide-05");
  assert.deepEqual(explicit.reads, []);
  for (const index of [-1, 23, 1.5, "4", null, undefined, Infinity]) {
    a.emit("foundations:slidechange", { detail: { index } });
  }
  assert.equal(a.writes.length, 1);
});

test("reader remains usable with missing or blocked session storage and rejects invalid stored positions", () => {
  for (const stored of ["", " ", "-1", "23", "1.5", "NaN", "private reflection"]) {
    const f = readerFixture({ storage: new Map([["account-a", stored]]) });
    assert.equal(new URL(f.context.location.href).hash, "");
  }
  const absent = readerFixture();
  assert.equal(new URL(absent.context.location.href).hash, "");
  const blocked = readerFixture({ storageFailure: true });
  assert.doesNotThrow(() => blocked.emit("foundations:slidechange", { detail: { index: 3 } }));
  // Every real response supplies a key. A malformed empty-key document remains read-only.
  const emptyKey = readerFixture({ key: "" });
  emptyKey.emit("foundations:slidechange", { detail: { index: 3 } });
  assert.deepEqual(emptyKey.reads, []);
  assert.deepEqual(emptyKey.writes, []);
});

test("member reader removes presenter controls and cross-tab syncing while retaining return navigation", () => {
  const f = readerFixture({ href: "https://members.example.test/my/foundations/deck?presenter=1#slide-04" });
  assert.equal(new URL(f.context.location.href).searchParams.has("presenter"), false);
  assert.equal(new URL(f.context.location.href).hash, "#slide-04");
  assert.doesNotThrow(() => new f.context.BroadcastChannel("shared-deck").postMessage({ index: 4 }));
  f.emit("DOMContentLoaded");
  assert.deepEqual(f.removed, ["#presenterOpen", "#presenterPanel"]);
  assert.equal(f.links.length, 1);
  assert.equal(f.links[0].href, "/my/foundations");
  assert.equal(f.links[0].textContent, "← My Foundations");
  assert.deepEqual(f.slideLinks.map(link => link.href), ["/my/foundations/deck#slide-01", "/my/foundations/deck#slide-23", "#slide-24"]);
  assert.doesNotMatch(f.help.textContent, /Presenter/);
  assert.equal(f.callbacks.get("keydown").options, true);
  let blocked = 0;
  const event = { key: "p", target: new f.context.Element(), preventDefault: () => blocked++, stopImmediatePropagation: () => blocked++ };
  f.emit("keydown", event);
  assert.equal(blocked, 2);
  f.emit("keydown", { ...event, target: new f.context.Element(true) });
  f.emit("keydown", { ...event, ctrlKey: true });
  assert.equal(blocked, 2, "typing and browser shortcuts must remain available");
});
