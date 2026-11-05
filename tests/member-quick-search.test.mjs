import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const flush = () => new Promise(resolve => setImmediate(resolve));
const cade = { name: "Cade Mangelson", memberTag: "cade", bio: "A public bio.", memberNumber: 1, href: "/profile/cade", avatarUrl: "/api/profile/cade/portrait" };
const libby = { name: "Libby Zaritsky", memberTag: "libby", bio: null, memberNumber: 52, href: "/profile/libby", avatarUrl: null };
const snapshot = (query, results = [cade], extra = {}) => ({ query, page: 1, results, hasMore: false, ...extra });

function fixture(t, initial = {}) {
  const calls = [], timers = new Map(), instances = new Map(), modules = new Map();
  let now = 0, timerId = 0, owner, tree, dirty = false, mounted = true, navigations = 0, updatesAfterUnmount = 0;
  let props = { query: "", open: true, preview: false, id: "quick-members", onNavigate: () => { navigations++; }, ...initial };
  const browser = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const hooks = { ...React,
    useState(initialValue) {
      const component = owner, index = component.cursor++;
      if (!(index in component.slots)) component.slots[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [component.slots[index], value => {
        if (!component.active) updatesAfterUnmount++;
        const next = typeof value === "function" ? value(component.slots[index]) : value;
        if (!Object.is(next, component.slots[index])) { component.slots[index] = next; dirty = true; }
      }];
    },
    useRef(initialValue) { return owner.slots[owner.cursor++] ??= { current: initialValue }; },
    useEffect(callback, dependencies) {
      const index = owner.cursor++, previous = owner.slots[index];
      owner.effects.add(index);
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))) {
        owner.slots[index] = { callback, dependencies, cleanup: previous?.cleanup, pending: true };
      }
    },
    useMemo: callback => callback(),
    useCallback: callback => callback,
    useId: () => "quick-search-id",
  };
  function load(path) {
    const absolute = resolve(root, path);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const mod = { exports: {} }; modules.set(absolute, mod);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", "window", "fetch", code)(name => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "next/link") return { __esModule: true, default: "a" };
      if (name === "next/image") return { __esModule: true, default: "img" };
      if (name.endsWith("MemberIcon")) return { __esModule: true, default: "svg" };
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(absolute), name);
        const file = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(candidate));
        assert.ok(file, `Local dependency exists: ${name}`); return load(file);
      }
      throw Error(`Unexpected quick-search dependency ${name}`);
    }, mod, mod.exports, browser, (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })));
    return mod.exports;
  }
  const Component = load("src/components/platform/MemberQuickSearch.tsx").default;
  function expand(node, path, seen) {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${child?.key ?? index}`, seen));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const key = `${path}/${node.type.name}:${node.key ?? ""}`;
      let instance = instances.get(key);
      if (!instance) { instance = { slots: [], effects: new Set(), active: true }; instances.set(key, instance); }
      seen.add(key); instance.cursor = 0; instance.active = true;
      const previous = owner; owner = instance;
      let output;
      try { output = node.type(node.props); } finally { owner = previous; }
      return expand(output, key, seen);
    }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/${String(node.type)}`, seen) } };
  }
  function cleanupInstance(instance) {
    for (const index of instance.effects) { instance.slots[index].cleanup?.(); instance.slots[index].cleanup = undefined; }
    instance.active = false;
  }
  function render() {
    if (!mounted) return tree;
    let passes = 0;
    do {
      assert.ok(++passes < 15, "quick-search effects settle"); dirty = false;
      const seen = new Set();
      tree = expand(React.createElement(Component, props), "root", seen);
      for (const [key, instance] of instances) if (!seen.has(key)) { cleanupInstance(instance); instances.delete(key); }
      for (const instance of instances.values()) for (const index of instance.effects) {
        const effect = instance.slots[index];
        if (effect.pending) { effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.callback(); }
      }
    } while (dirty);
    return tree;
  }
  const cleanup = () => { if (!mounted) return; for (const instance of instances.values()) cleanupInstance(instance); mounted = false; };
  t.after(cleanup); render();
  return {
    calls, timers, render, cleanup,
    update(next) { props = { ...props, ...next }; render(); },
    profiles: () => nodes(render()).filter(node => node.type === "a" && node.props.href?.startsWith("/profile/")),
    find(predicate) { const result = nodes(render()).find(predicate); assert.ok(result, "Expected quick-search element"); return result; },
    button(label) { return nodes(render()).find(node => node.type === "button" && text(node) === label); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback(); await flush(); render();
      }
      now = end; await flush(); render();
    },
    async reply(index, data, status = 200) {
      assert.ok(calls[index], "Expected a pending member request");
      calls[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
      await flush(); render();
    },
    async reject(index) { calls[index].reject(new Error("network unavailable")); await flush(); render(); },
    navigations: () => navigations,
    updatesAfterUnmount: () => updatesAfterUnmount,
  };
}

const request = call => new URL(call.url, "https://members.example.test");

test("quick search makes no request for a closed dialog or an empty normalized query", async t => {
  const f = fixture(t, { open: false, query: "cade" });
  await f.advance(20_000); assert.equal(f.calls.length, 0); assert.equal(f.profiles().length, 0);
  for (const query of ["", "   ", " @ @ ", "\u0000\n"]) {
    f.update({ open: true, query }); await f.advance(20_000);
    assert.equal(f.calls.length, 0, JSON.stringify(query)); assert.equal(f.profiles().length, 0);
  }
});

test("name and @tag queries debounce and encode punctuation without creating a different URL", async t => {
  const f = fixture(t);
  for (const [input, query] of [["  Cade   Mangelson  ", "Cade Mangelson"], [" @ @ cade ", "cade"], ["@cade&alex/?#%_\\\u0000 end", "cade&alex/?#%_\\ end"]]) {
    f.update({ query: input });
    const count = f.calls.length;
    await f.advance(249); assert.equal(f.calls.length, count);
    await f.advance(1); assert.equal(f.calls.length, count + 1);
    const url = request(f.calls[count]);
    assert.equal(url.origin, "https://members.example.test"); assert.equal(url.pathname, "/api/my/members");
    assert.equal(url.searchParams.get("q"), query); assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.size, 2); assert.equal(url.hash, "");
    assert.equal(f.calls[count].options.cache, "no-store");
    await f.reply(count, snapshot(query)); assert.equal(f.profiles()[0].props.href, cade.href);
  }
});

test("successful quick search shows five direct member links with accessible portraits and initials", async t => {
  const f = fixture(t, { query: "cade" });
  assert.match(text(f.render()), /Searching members/);
  await f.advance(250);
  const results = [cade, libby, ...Array.from({ length: 5 }, (_, i) => ({ ...libby, name: `Member ${i}`, href: `/profile/member_${i}`, memberTag: `member_${i}` }))];
  await f.reply(0, snapshot("cade", results, { hasMore: true }));
  const section = f.find(node => node.props?.["aria-label"] === "Matching members");
  assert.equal(section.props.id, "quick-members"); assert.equal(section.props["aria-busy"], false);
  const status = f.find(node => node.props?.role === "status");
  assert.equal(status.props["aria-live"], "polite"); assert.match(text(status), /5\+ matches/);
  assert.deepEqual(f.profiles().map(node => node.props.href), results.slice(0, 5).map(row => row.href));
  assert.ok(f.profiles().every(node => node.props.prefetch === false));
  assert.match(text(f.profiles()[0]), /Cade Mangelson.*@cade/);
  assert.match(text(f.profiles()[1]), /LZ.*Libby Zaritsky.*@libby/);
  const portrait = nodes(f.profiles()[0]).find(node => node.type === "img");
  assert.equal(portrait.props.src, cade.avatarUrl); assert.equal(portrait.props.alt, "");
  assert.equal(portrait.props.loading, "lazy"); assert.equal(portrait.props.decoding, "async"); assert.equal(portrait.props.unoptimized, true);
  portrait.props.onError(); f.render();
  assert.equal(nodes(f.profiles()[0]).some(node => node.type === "img"), false);
  assert.match(text(f.profiles()[0]), /CM/);
  f.profiles()[0].props.onClick(); assert.equal(f.navigations(), 1);
});

test("typing a new name immediately hides old profiles and cancels the previous debounce", async t => {
  const f = fixture(t, { query: "cade" });
  await f.advance(250); await f.reply(0, snapshot("cade"));
  f.update({ query: "discarded" }); f.update({ query: "libby" });
  assert.equal(f.profiles().length, 0); assert.match(text(f.render()), /Searching members/);
  await f.advance(250); assert.equal(f.calls.length, 2); assert.equal(request(f.calls[1]).searchParams.get("q"), "libby");
  await f.reply(1, snapshot("libby", [libby])); assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
});

test("out-of-order success, access denial and network errors never replace newer member results", async t => {
  for (const outcome of [200, 401, 403, 500, "network"]) {
    const f = fixture(t, { query: "cade" }); await f.advance(250);
    f.update({ query: "libby" }); assert.equal(f.calls[0].options.signal.aborted, true); await f.advance(250);
    await f.reply(1, snapshot("libby", [libby]));
    if (outcome === "network") await f.reject(0); else await f.reply(0, snapshot("cade"), outcome);
    assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href], String(outcome));
    assert.equal(nodes(f.render()).some(node => node.props?.role === "alert"), false);
  }
});

test("empty member results are announced independently of page search", async t => {
  const f = fixture(t, { query: "nobody" }); await f.advance(250); await f.reply(0, snapshot("nobody", []));
  assert.equal(f.profiles().length, 0); assert.match(text(f.render()), /No matching members.*Try another name or @tag/);
  assert.equal(nodes(f.render()).some(node => node.props?.role === "alert"), false);
});

test("401 and 403 remove profiles and offer the correct recovery action without a retry loop", async t => {
  for (const [status, href, label] of [[401, "/my/access", "Sign in"], [403, "/my/account", "View account"]]) {
    const f = fixture(t, { query: "cade" }); await f.advance(250); await f.reply(0, snapshot("cade"));
    f.update({ query: "libby" }); await f.advance(250); await f.reply(1, {}, status);
    assert.equal(f.profiles().length, 0);
    const link = f.find(node => node.type === "a" && node.props.href === href);
    assert.match(text(link), new RegExp(label)); assert.equal(f.button("Try again"), undefined);
    link.props.onClick(); assert.equal(f.navigations(), 1);
  }
});

test("server and network failures show a retry that requests the current query", async t => {
  for (const failure of [500, "network"]) {
    const f = fixture(t, { query: "cade" }); await f.advance(250);
    if (failure === "network") await f.reject(0); else await f.reply(0, { error: "PRIVATE database failure" }, failure);
    assert.equal(f.profiles().length, 0); assert.doesNotMatch(text(f.render()), /PRIVATE/);
    assert.ok(f.button("Try again")); f.button("Try again").props.onClick(); f.render(); await f.advance(250);
    assert.equal(request(f.calls[1]).searchParams.get("q"), "cade");
    await f.reply(1, snapshot("cade")); assert.deepEqual(f.profiles().map(node => node.props.href), [cade.href]);
  }
});

test("malformed or cross-query responses never display profile links and remain retryable", async t => {
  const invalid = [null, {}, snapshot("other"), snapshot("cade", [cade], { page: 2 }), snapshot("cade", [cade], { hasMore: "yes" }),
    snapshot("cade", [null]), snapshot("cade", [{ ...cade, name: null }]), snapshot("cade", [{ ...cade, memberTag: 42 }]),
    snapshot("cade", [{ ...cade, href: "https://untrusted.example/profile/cade" }]), snapshot("cade", [{ ...cade, href: "//untrusted.example/profile/cade" }]),
    snapshot("cade", [{ ...cade, avatarUrl: 42 }])];
  for (const payload of invalid) {
    const f = fixture(t, { query: "cade" }); await f.advance(250); await f.reply(0, payload);
    assert.equal(f.profiles().length, 0, JSON.stringify(payload)); assert.ok(f.button("Try again"), "invalid response is recoverable");
  }
});

test("a timed-out search aborts, offers retry and ignores its later successful response", async t => {
  const f = fixture(t, { query: "cade" }); await f.advance(250);
  await f.advance(9999); assert.equal(f.calls[0].options.signal.aborted, false);
  await f.advance(1); assert.equal(f.calls[0].options.signal.aborted, true); assert.ok(f.button("Try again"));
  assert.equal(f.profiles().length, 0); assert.doesNotMatch(text(f.render()), /Searching members/);
  f.button("Try again").props.onClick(); f.render(); await f.advance(250);
  await f.reply(1, snapshot("cade", [{ ...cade, name: "Current result" }]));
  await f.reply(0, snapshot("cade", [{ ...cade, name: "Stale result" }]));
  assert.match(text(f.render()), /Current result/); assert.doesNotMatch(text(f.render()), /Stale result/);
});

test("closing and unmounting cancel pending work and prevent late updates", async t => {
  const f = fixture(t, { query: "cade" }); await f.advance(250);
  f.update({ open: false }); assert.equal(f.calls[0].options.signal.aborted, true); assert.equal(f.timers.size, 0);
  await f.reply(0, snapshot("cade")); assert.equal(f.profiles().length, 0);
  f.update({ open: true, query: "libby" }); await f.advance(250);
  assert.equal(request(f.calls[1]).searchParams.get("q"), "libby");
  f.cleanup(); assert.equal(f.calls[1].options.signal.aborted, true); assert.equal(f.timers.size, 0);
  await f.reply(1, snapshot("libby", [libby])); assert.equal(f.updatesAfterUnmount(), 0);
  const early = fixture(t, { query: "cade" }); early.cleanup(); await early.advance(20_000); assert.equal(early.calls.length, 0);
});

test("preview search uses fictional local profiles without fetching connected members", async t => {
  const f = fixture(t, { query: " @alex_rivera ", preview: true }); await f.advance(250);
  assert.deepEqual(f.profiles().map(node => node.props.href), ["/profile/alex_rivera"]);
  assert.equal(f.calls.length, 0);
  f.update({ query: "not-a-preview-member" }); await f.advance(250);
  assert.match(text(f.render()), /No matching members/); assert.equal(f.calls.length, 0);
});
