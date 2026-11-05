import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const flush = () => new Promise(resolve => setImmediate(resolve));
function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    if (name in dependencies) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const model = load("src/lib/membership/member-search-model.ts");
const preview = load("src/lib/membership/member-search-preview.ts", { "./member-search-model": model });
const tiers = load("src/lib/membership/member-number.ts");
const ProfileLink = load("src/components/membership/MemberProfileLink.tsx", { "next/link": { __esModule: true, default: "a" } }).default;
const expandProfileLinks = node => Array.isArray(node) ? node.map(expandProfileLinks) : !node || typeof node !== "object" ? node
  : node.type === ProfileLink ? expandProfileLinks(ProfileLink(node.props))
  : { ...node, props: { ...node.props, children: expandProfileLinks(node.props?.children) } };
const alex = { name: "Alex Rivera", memberTag: "alex_rivera", bio: "Making room for what matters.", memberNumber: 6, href: "/profile/alex_rivera", avatarUrl: "/api/profile/alex_rivera/portrait?v=1" };
const cherry = { name: "Cherry Hill", memberTag: "cherry_hill", bio: null, memberNumber: null, href: "/profile/cherry_hill", avatarUrl: null };
const libby = { name: "Libby Zaritsky", memberTag: "libby", bio: "A creative practice.", memberNumber: 52, href: "/profile/libby", avatarUrl: "/api/profile/libby/portrait?v=1" };
const riley = { name: "Riley Jordan", memberTag: null, bio: null, memberNumber: 201, href: "/profile/riley_jordan", avatarUrl: null };
const snapshot = (results = [alex, cherry], changes = {}) => ({ query: "", page: 1, results, hasMore: false, ...changes });

function fixture(t, { initialSearch = snapshot(), previewMode = false, href, routeHref } = {}) {
  const slots = [], effectSlots = new Set(), timers = new Map(), calls = [], history = [];
  let cursor = 0, dirty = false, tree, timerId = 0;
  let routeOverride = routeHref;
  const portraitSlots = new Map();
  let currentPortraitSlots = null, portraitCursor = 0;
  const initialUrl = new URL("https://members.example.test/my/members?source=menu#directory");
  if (initialSearch.query) initialUrl.searchParams.set("q", initialSearch.query);
  const browser = {
    location: { href: href ?? initialUrl.href },
    history: { replaceState(_state, _title, url) { history.push(url); browser.location.href = new URL(url, browser.location.href).href; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const hooks = { ...React,
    useState(initial) {
      const owner = currentPortraitSlots ?? slots;
      const i = currentPortraitSlots ? portraitCursor++ : cursor++;
      if (!(i in owner)) owner[i] = typeof initial === "function" ? initial() : initial;
      return [owner[i], value => {
        const next = typeof value === "function" ? value(owner[i]) : value;
        if (!Object.is(next, owner[i])) { owner[i] = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, dependencies) {
      const i = cursor++, previous = slots[i];
      effectSlots.add(i);
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
        slots[i] = { dependencies, callback, cleanup: previous?.cleanup, pending: true };
      }
    },
  };
  const fakeFetch = (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }));
  const reader = load("src/lib/membership/member-read-client.ts", {}, {
    fetch: fakeFetch, setTimeout: browser.setTimeout, clearTimeout: browser.clearTimeout,
  });
  const Component = load("src/components/membership/MemberDirectory.tsx", {
    react: hooks,
    "next/link": { __esModule: true, default: "a" },
    "next/image": { __esModule: true, default: "img" },
    "next/navigation": { useSearchParams: () => new URL(routeOverride ?? browser.location.href).searchParams,
      usePathname: () => new URL(routeOverride ?? browser.location.href).pathname },
    "./MemberIcon": { __esModule: true, default: "svg" },
    "./MemberProfileLink": { __esModule: true, default: ProfileLink },
    "@/lib/membership/member-number": tiers,
    "@/lib/membership/member-search-model": model,
    "@/lib/membership/member-search-preview": preview,
    "@/lib/membership/member-read-client": reader,
    "./MemberDirectory.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) },
  }, {
    window: browser,
    fetch: fakeFetch,
  }).default;
  const render = () => {
    let passes = 0;
    do {
      assert.ok(++passes < 10, "directory effects settle");
      dirty = false; cursor = 0;
      tree = expandProfileLinks(Component({ initialSearch, preview: previewMode }));
      for (const i of effectSlots) {
        const effect = slots[i];
        if (!effect.pending) continue;
        effect.pending = false;
        effect.cleanup?.();
        effect.cleanup = effect.callback();
      }
    } while (dirty);
    return tree;
  };
  const find = predicate => { const result = nodes(render()).find(predicate); assert.ok(result, "Expected directory element"); return result; };
  const button = label => nodes(render()).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node) === label));
  const cleanup = () => { for (const i of effectSlots) { slots[i].cleanup?.(); slots[i].cleanup = undefined; } };
  t.after(cleanup);
  render();
  return {
    calls, history, timers, render, find, button,
    location: () => new URL(browser.location.href),
    navigate(href) { browser.location.href = new URL(href, browser.location.href).href; },
    route(href, nextInitialSearch) {
      routeOverride = new URL(href, browser.location.href).href;
      if (nextInitialSearch) initialSearch = nextInitialSearch;
      render();
    },
    input: () => find(node => node.type === "input" && node.props.name === "q"),
    profiles: () => nodes(render()).filter(node => node.type === "a" && node.props.className === "member"),
    portrait(href) {
      const profile = find(node => node.type === "a" && node.props.className === "member" && node.props.href === href);
      const child = nodes(profile).find(node => typeof node.type === "function" && node.type.name === "DirectoryPortrait");
      assert.ok(child, "The profile card renders its portrait component");
      // Child hook state belongs to its profile and React key, not the directory.
      const key = `${href}:${child.key}`;
      if (!portraitSlots.has(key)) portraitSlots.set(key, []);
      currentPortraitSlots = portraitSlots.get(key); portraitCursor = 0;
      try { return child.type(child.props); }
      finally { currentPortraitSlots = null; }
    },
    results: () => find(node => node.props?.id === "member-directory-results"),
    change(value) { find(node => node.type === "input").props.onChange({ target: { value } }); render(); },
    click(label) { const target = button(label); assert.ok(target, label); assert.notEqual(target.props.disabled, true, "only enabled controls are clickable"); target.props.onClick(); render(); },
    startTimer() {
      const [id, timer] = timers.entries().next().value ?? [];
      assert.ok(timer, "Expected scheduled search"); timers.delete(id);
      const operation = timer.callback();
      return { delay: timer.delay, operation };
    },
    async reply(index, payload, status = 200) {
      assert.ok(calls[index], "Expected pending member request");
      calls[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => payload });
      await flush(); render();
    },
    async reject(index) { calls[index].reject(new TypeError("network disconnected")); await flush(); render(); },
    cleanup,
  };
}
const request = call => new URL(call.url, "https://members.example.test");

test("initial browse renders accessible public profile links without refetching the server snapshot", t => {
  const f = fixture(t);
  assert.deepEqual(f.calls, []); assert.equal(f.timers.size, 0);
  assert.match(text(f.render()), /Browse members/);
  assert.match(text(f.find(node => node.props?.role === "status")), /2 members · A–Z/);
  assert.equal(f.results().props["aria-busy"], false);
  const input = f.input(), label = f.find(node => node.type === "label");
  assert.equal(label.props.htmlFor, input.props.id);
  assert.equal(input.props["aria-controls"], f.results().props.id);
  assert.equal(input.props.type, "search"); assert.equal(input.props.maxLength, 80);
  assert.equal(input.props.autoComplete, "off"); assert.equal(input.props.autoCapitalize, "none");
  assert.equal(f.find(node => node.props?.role === "search").props["aria-label"], "Find members");
  assert.equal(f.find(node => node.props?.role === "status").props["aria-live"], "polite");
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href, cherry.href]);
  assert.ok(f.profiles().every(node => node.props.prefetch === false));
  assert.match(text(f.profiles()[0]), /Originals · No. 0006.*Alex Rivera.*@alex_rivera.*View profile for Alex Rivera/);
  assert.equal(f.button("Clear member search"), undefined);
});

test("profile portraits load lazily as decorative images and a failed photo falls back only for that member", t => {
  const f = fixture(t, { initialSearch: snapshot([alex, libby]) });
  const portrait = f.portrait(alex.href);
  assert.equal(portrait.props["aria-hidden"], "true");
  const image = nodes(portrait).find(node => node.type === "img");
  assert.equal(image.props.src, alex.avatarUrl);
  assert.equal(image.props.alt, "");
  assert.equal(image.props.loading, "lazy");
  assert.equal(image.props.decoding, "async");
  assert.equal(image.props.width, 88); assert.equal(image.props.height, 88);
  assert.equal(image.props.unoptimized, true, "the access-checked portrait URL is requested directly");
  image.props.onError();
  assert.equal(nodes(f.portrait(alex.href)).some(node => node.type === "img"), false);
  assert.equal(text(f.portrait(alex.href)), "AR");
  assert.equal(nodes(f.portrait(libby.href)).find(node => node.type === "img").props.src, libby.avatarUrl);
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href, libby.href]);
  assert.match(text(f.profiles()[0]), /Alex Rivera.*View profile for Alex Rivera/);
  assert.deepEqual(f.calls, []);
});

test("members without photos use initials without requesting an empty or invented image URL", t => {
  for (const [name, initials] of [["Cherry Marie Hill", "CH"], ["Björk", "B"], ["   ", "M"]]) {
    const f = fixture(t, { initialSearch: snapshot([{ ...cherry, name }]) });
    const portrait = f.portrait(cherry.href);
    assert.equal(portrait.props["aria-hidden"], "true");
    assert.equal(nodes(portrait).some(node => node.type === "img"), false);
    assert.equal(text(portrait), initials);
    assert.deepEqual(f.calls, []);
  }
});

test("an updated portrait URL recovers from an earlier image error for the same profile", async t => {
  const f = fixture(t, { initialSearch: snapshot([alex], { hasMore: true }) });
  nodes(f.portrait(alex.href)).find(node => node.type === "img").props.onError();
  assert.equal(text(f.portrait(alex.href)), "AR");
  f.click("Load more members"); f.startTimer();
  const updated = { ...alex, avatarUrl: "/api/profile/alex_rivera/portrait?v=2" };
  await f.reply(0, snapshot([updated], { page: 2 }));
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href]);
  assert.equal(nodes(f.portrait(alex.href)).find(node => node.type === "img").props.src, updated.avatarUrl);
});

test("name and @tag searches debounce, replace results, and preserve a shareable normalized query", async t => {
  const f = fixture(t);
  for (const [value, query] of [["  Libby   Zaritsky  ", "Libby Zaritsky"], ["@libby", "libby"]]) {
    f.change(value);
    assert.equal(f.profiles().length, 0, "old browse results are hidden while a different query loads");
    assert.equal(f.results().props["aria-busy"], true);
    assert.match(text(f.find(node => node.props?.role === "status")), /Loading members/);
    const index = f.calls.length;
    assert.equal(f.startTimer().delay, 250);
    assert.equal(request(f.calls[index]).pathname, "/api/my/members");
    assert.equal(request(f.calls[index]).searchParams.get("q"), query);
    assert.equal(request(f.calls[index]).searchParams.get("page"), "1");
    assert.equal(f.calls[index].options.cache, "no-store");
    await f.reply(index, snapshot([libby], { query }));
    assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
    assert.match(text(f.find(node => node.props?.role === "status")), /1 match/);
    assert.equal(f.results().props["aria-busy"], false);
    const url = new URL(f.history.at(-1), "https://members.example.test");
    assert.equal(url.searchParams.get("q"), query);
    assert.equal(url.searchParams.get("source"), "menu");
    assert.equal(url.searchParams.has("page"), false);
    assert.equal(url.hash, "#directory");
  }
});

test("a menu search uses the incoming route before the address bar catches up", t => {
  for (const previous of ["/my/members", "/my/members?q=alex", "/my/profile"]) {
    const f = fixture(t, {
      initialSearch: snapshot([libby], { query: "libby" }),
      href: `https://members.example.test${previous}`,
      routeHref: "https://members.example.test/my/members?q=%40libby",
    });
    assert.equal(f.input().props.value, "libby");
    assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
    assert.equal(f.results().props["aria-busy"], false);
    assert.equal(f.timers.size, 0, "the outgoing query must not replace the incoming results");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.history, []);
  }
});

test("a menu browse link clears the incoming filter even while the old query is in the address bar", t => {
  const f = fixture(t, {
    initialSearch: snapshot(),
    href: "https://members.example.test/my/members?q=libby",
    routeHref: "https://members.example.test/my/members",
  });
  assert.equal(f.input().props.value, "");
  assert.equal(f.results().props["aria-busy"], false);
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href, cherry.href]);
  assert.equal(f.timers.size, 0);
});

test("repeating a menu search after clearing it updates the reused directory", async t => {
  const f = fixture(t, { initialSearch: snapshot([libby], { query: "libby" }) });
  f.click("Clear member search"); f.startTimer();
  await f.reply(0, snapshot());
  assert.equal(f.input().props.value, "");
  assert.equal(f.location().searchParams.get("q"), null);
  f.route("/my/members?q=libby");
  assert.equal(f.input().props.value, "libby");
  assert.equal(f.results().props["aria-busy"], true);
  assert.equal(f.profiles().length, 0);
  f.startTimer();
  assert.equal(request(f.calls[1]).searchParams.get("q"), "libby");
  assert.equal(request(f.calls[1]).searchParams.get("page"), "1");
  await f.reply(1, snapshot([libby], { query: "libby" }));
  assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
});

test("menu navigation replaces an in-flight local query without a stale response rewriting it", async t => {
  const f = fixture(t);
  f.change("alex"); f.startTimer();
  f.route("/my/members?q=libby");
  assert.equal(f.input().props.value, "libby");
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.startTimer();
  await f.reply(1, snapshot([libby], { query: "libby" }));
  await f.reply(0, snapshot([alex], { query: "alex" }));
  assert.equal(f.input().props.value, "libby");
  assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
  assert.equal(f.location().searchParams.get("q"), "libby");
});

test("a delayed acknowledgement of our URL update cannot erase newer typing", async t => {
  const f = fixture(t, { routeHref: "https://members.example.test/my/members" });
  f.change("alex"); f.startTimer();
  await f.reply(0, snapshot([alex], { query: "alex" }));
  f.change("libby"); f.startTimer();
  f.route("/my/members?q=alex");
  assert.equal(f.input().props.value, "libby");
  assert.equal(f.calls[1].options.signal.aborted, false);
  await f.reply(1, snapshot([libby], { query: "libby" }));
  assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
});

test("sequential and coalesced acknowledgements preserve the latest typing and then allow external navigation", async t => {
  for (const acknowledged of [["alex", "cherry"], ["cherry"]]) {
    const f = fixture(t, { routeHref: "https://members.example.test/my/members" });
    f.change("alex"); f.startTimer();
    await f.reply(0, snapshot([alex], { query: "alex" }));
    f.change("cherry"); f.startTimer();
    await f.reply(1, snapshot([cherry], { query: "cherry" }));
    f.change("libby"); f.startTimer();
    for (const query of acknowledged) {
      f.route(`/my/members?q=${query}`);
      assert.equal(f.input().props.value, "libby");
      assert.equal(f.calls[2].options.signal.aborted, false);
    }
    f.route("/my/members?q=riley");
    assert.equal(f.input().props.value, "riley");
    assert.equal(f.calls[2].options.signal.aborted, true);
  }
});

test("returning to an acknowledged query while other local URL writes are pending preserves newer typing", async t => {
  const f = fixture(t, { initialSearch: snapshot([alex], { query: "alex" }), routeHref: "https://members.example.test/my/members?q=alex" });
  f.change("cherry"); f.startTimer();
  await f.reply(0, snapshot([cherry], { query: "cherry" }));
  f.change("alex"); f.startTimer();
  await f.reply(1, snapshot([alex], { query: "alex" }));
  f.change("libby"); f.startTimer();
  for (const query of ["cherry", "alex"]) {
    f.route(`/my/members?q=${query}`);
    assert.equal(f.input().props.value, "libby");
    assert.equal(f.calls[2].options.signal.aborted, false);
  }
});

test("a server menu navigation overrides leftover local writes coalesced back to the acknowledged route", async t => {
  const f = fixture(t, { initialSearch: snapshot([cherry], { query: "cherry" }), routeHref: "https://members.example.test/my/members?q=cherry" });
  f.change("alex"); f.startTimer();
  await f.reply(0, snapshot([alex], { query: "alex" }));
  f.route("/my/members?q=alex");
  f.change("cherry"); f.startTimer();
  await f.reply(1, snapshot([cherry], { query: "cherry" }));
  f.change("alex"); f.startTimer();
  await f.reply(2, snapshot([alex], { query: "alex" }));
  f.change("libby"); f.startTimer();
  f.route("/my/members?q=alex");
  assert.equal(f.input().props.value, "libby", "coalesced local history does not replace newer typing");
  assert.equal(f.calls[3].options.signal.aborted, false);
  f.route("/my/members?q=cherry", snapshot([cherry], { query: "cherry" }));
  assert.equal(f.input().props.value, "cherry", "the menu destination wins even though its server key is unchanged");
  assert.equal(f.calls[3].options.signal.aborted, true);
  f.startTimer();
  await f.reply(4, snapshot([cherry], { query: "cherry" }));
  await f.reply(3, snapshot([libby], { query: "libby" }));
  assert.equal(f.input().props.value, "cherry");
  assert.deepEqual(f.profiles().map(node => node.props.href), [cherry.href]);
});

test("Back restores the URL filter instead of a cached directory snapshot and refetches only the current query", async t => {
  for (const [initialSearch, href, query, results] of [
    [snapshot(), "https://members.example.test/my/members?q=%40libby", "libby", [libby]],
    [snapshot([libby], { query: "libby" }), "https://members.example.test/my/members", "", [alex, cherry]],
  ]) {
    const f = fixture(t, { initialSearch, href });
    assert.equal(f.input().props.value, query);
    assert.equal(f.results().props["aria-busy"], true);
    assert.equal(f.profiles().length, 0, "cached results for a different query stay hidden");
    assert.equal(f.timers.size, 1);
    f.startTimer();
    assert.equal(request(f.calls[0]).searchParams.get("q"), query);
    assert.equal(request(f.calls[0]).searchParams.get("page"), "1");
    await f.reply(0, snapshot(results, { query }));
    assert.deepEqual(f.profiles().map(node => node.props.href), results.map(member => member.href));
    assert.equal(f.location().pathname, "/my/members");
    assert.equal(f.location().searchParams.get("q"), query || null);
    assert.equal(f.results().props["aria-busy"], false);
  }
});

test("a directory response finishing after profile navigation cannot rewrite the profile URL", async t => {
  const f = fixture(t);
  f.change("Libby"); f.startTimer();
  f.navigate("/profile/libby#timeline");
  await f.reply(0, snapshot([libby], { query: "Libby" }));
  assert.equal(f.location().href, "https://members.example.test/profile/libby#timeline");
  assert.deepEqual(f.history, []);
});

test("an intercepted public profile preserves the filter, loaded pages and results when closed", async t => {
  const initial = snapshot([alex], { query: "Alex", hasMore: true });
  const f = fixture(t, { initialSearch: initial });
  f.click("Load more members"); f.startTimer();
  await f.reply(0, snapshot([cherry], { query: "Alex", page: 2, hasMore: true }));
  const before = f.profiles().map(node => node.props.href), count = f.calls.length;
  f.navigate("/profile/libby"); f.route("/profile/libby");
  assert.equal(f.input().props.value, "Alex");
  assert.deepEqual(f.profiles().map(node => node.props.href), before);
  assert.equal(f.timers.size, 0); assert.equal(f.calls.length, count);
  f.navigate("/my/members?q=Alex"); f.route("/my/members?q=Alex");
  assert.equal(f.input().props.value, "Alex");
  assert.deepEqual(f.profiles().map(node => node.props.href), before);
  assert.equal(f.results().props["aria-busy"], false);
  assert.equal(f.timers.size, 0); assert.equal(f.calls.length, count);
  f.click("Load more members"); f.startTimer();
  assert.equal(request(f.calls[count]).searchParams.get("page"), "3");
});

test("directory searches recover from one temporary service failure without showing an error", async t => {
  const f = fixture(t);
  f.change("Libby"); f.startTimer();
  await f.reply(0, {}, 503);
  assert.equal(f.results().props["aria-busy"], true);
  assert.equal(nodes(f.render()).some(node => node.props?.role === "alert"), false);
  assert.equal(f.startTimer().delay, 300); await flush();
  await f.reply(1, snapshot([libby], { query: "Libby" }));
  assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
  assert.equal(f.results().props["aria-busy"], false);
});

test("load more appends unique profiles and a failed page retries without losing prior results", async t => {
  const f = fixture(t, { initialSearch: snapshot([alex, cherry], { hasMore: true }) });
  f.click("Load more members");
  assert.equal(f.button("Loading…").props.disabled, true);
  assert.equal(f.startTimer().delay, 0);
  assert.equal(request(f.calls[0]).searchParams.get("page"), "2");
  await f.reply(0, snapshot([{ ...cherry, bio: "Updated public bio." }, libby], { page: 2, hasMore: true }));
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href, cherry.href, libby.href]);
  assert.match(text(f.profiles()[1]), /Updated public bio/);
  f.click("Load more members"); f.startTimer();
  assert.equal(request(f.calls[1]).searchParams.get("page"), "3");
  await f.reply(1, {}, 503);
  assert.equal(f.startTimer().delay, 300); await flush();
  await f.reply(2, {}, 503);
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href, cherry.href, libby.href]);
  assert.match(text(f.find(node => node.props?.role === "alert")), /Members couldn’t load/);
  assert.equal(f.button("Load more members"), undefined);
  f.click("Try again"); f.startTimer();
  assert.equal(request(f.calls[3]).searchParams.get("page"), "3");
  await f.reply(3, snapshot([riley], { page: 3 }));
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href, cherry.href, libby.href, riley.href]);
  assert.equal(nodes(f.render()).some(node => node.props?.role === "alert"), false);
  assert.equal(f.button("Load more members"), undefined);
});

test("clearing a search resets pagination and returns to browsing without retaining the query in the URL", async t => {
  const f = fixture(t, { initialSearch: snapshot([libby], { query: "libby", page: 3 }), href: "https://members.example.test/my/members?q=libby&page=3#directory" });
  f.click("Clear member search");
  assert.equal(f.input().props.value, "");
  assert.equal(f.button("Clear member search"), undefined);
  assert.equal(f.profiles().length, 0);
  f.startTimer();
  assert.equal(request(f.calls[0]).searchParams.get("q"), "");
  assert.equal(request(f.calls[0]).searchParams.get("page"), "1");
  await f.reply(0, snapshot());
  assert.match(text(f.render()), /Browse members/);
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href, cherry.href]);
  assert.equal(f.history.at(-1), "/my/members#directory");
});

test("empty search results offer browsing and an empty directory has a distinct empty state", async t => {
  const empty = fixture(t, { initialSearch: snapshot([]) });
  assert.match(text(empty.render()), /No profiles to browse yet/);
  assert.equal(empty.button("Browse all members"), undefined);
  const f = fixture(t, { initialSearch: snapshot([], { query: "unknown" }) });
  assert.match(text(f.render()), /No matching profiles/);
  assert.equal(nodes(f.render()).some(node => node.props?.role === "alert"), false);
  f.click("Browse all members"); f.startTimer();
  assert.equal(request(f.calls[0]).searchParams.get("q"), "");
  await f.reply(0, snapshot([alex]));
  assert.deepEqual(f.profiles().map(node => node.props.href), [alex.href]);
});

test("debounce cleanup and aborted late success or failure cannot overwrite a newer search", async t => {
  for (const staleStatus of [200, 401]) {
    const f = fixture(t);
    f.change("discarded"); f.change("Alex");
    assert.equal(f.timers.size, 1, "typing again cancels the previous debounce timer");
    f.startTimer(); assert.equal(f.calls.length, 1);
    assert.equal(request(f.calls[0]).searchParams.get("q"), "Alex");
    f.change("Libby");
    assert.equal(f.calls[0].options.signal.aborted, true);
    f.startTimer();
    await f.reply(1, snapshot([libby], { query: "Libby" }));
    const historyBefore = [...f.history];
    await f.reply(0, snapshot([alex], { query: "Alex" }), staleStatus);
    assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
    assert.deepEqual(f.history, historyBefore);
    assert.equal(nodes(f.render()).some(node => node.props?.role === "alert"), false);
    assert.equal(f.results().props["aria-busy"], false);
  }
});

test("lost or denied member access removes already visible profiles and provides the correct recovery link", async t => {
  for (const [status, recovery, message] of [[401, "/my/access", /Sign in again/], [403, "/my/account", /Member access is required/]]) {
    const f = fixture(t, { initialSearch: snapshot([alex], { hasMore: true }) });
    f.click("Load more members"); f.startTimer();
    await f.reply(0, {}, status);
    assert.equal(f.profiles().length, 0);
    const alert = f.find(node => node.props?.role === "alert");
    assert.match(text(alert), message);
    assert.equal(nodes(alert).find(node => node.type === "a").props.href, recovery);
    assert.equal(f.button("Try again"), undefined);
    assert.equal(f.results().props["aria-busy"], false);
  }
});

test("network failures and mismatched responses are retryable without displaying another query's profiles", async t => {
  const f = fixture(t);
  f.change("Libby"); f.startTimer();
  await f.reject(0);
  assert.equal(f.startTimer().delay, 300); await flush();
  await f.reject(1);
  assert.match(text(f.find(node => node.props?.role === "alert")), /Please try again/);
  assert.equal(f.profiles().length, 0);
  f.click("Try again"); f.startTimer();
  await f.reply(2, snapshot([alex], { query: "Alex" }));
  assert.equal(f.profiles().length, 0);
  assert.match(text(f.find(node => node.props?.role === "alert")), /Please try again/);
  const form = f.find(node => node.type === "form");
  let prevented = false;
  form.props.onSubmit({ preventDefault() { prevented = true; } }); f.render();
  assert.equal(prevented, true);
  f.startTimer();
  await f.reply(3, snapshot([libby], { query: "Libby" }));
  assert.deepEqual(f.profiles().map(node => node.props.href), [libby.href]);
});

test("local preview browsing and searching never request connected member data", async t => {
  const f = fixture(t, { previewMode: true, initialSearch: preview.getMemberSearchPreview() });
  assert.equal(f.profiles().length, 24);
  f.click("Load more members"); await f.startTimer().operation; f.render();
  assert.equal(f.profiles().length, 32);
  assert.equal(f.button("Load more members"), undefined);
  f.change("@alex_rivera"); await f.startTimer().operation; f.render();
  assert.deepEqual(f.profiles().map(node => node.props.href), ["/profile/alex_rivera"]);
  assert.deepEqual(f.calls, []);
});
