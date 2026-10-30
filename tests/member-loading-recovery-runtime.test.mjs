import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";
import { resolveMemberHomeArtifactProducts } from "../src/lib/membership/artifact-products.ts";

const require = createRequire(import.meta.url);

function loadModule(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected ${path} dependency: ${name}`);
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}

const component = (name) => ({ __esModule: true, default: name });
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const attr = (node, name) => node?.attrs?.find((item) => item.name === name)?.value;
const content = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(content).join("");

const linkedArtifact = () => ({
  awardId: "award-1",
  imageUrl: null,
  product: {
    productGid: "gid://shopify/Product/123",
    productHandle: "old-handle",
    provider: "shopify",
    href: null,
  },
});

function homeFixture(overrides = {}) {
  return {
    access: { mode: "limited", reason: "payment_required", capabilities: ["home.read"] },
    artifact: null,
    artifacts: [],
    displayName: "Member",
    nextAction: { href: "/my/account", title: "Review membership" },
    ...overrides,
  };
}

function pageFixture(data, { state = "authenticated", products = [], viewer = state === "authenticated" ? { authUserId: "member-auth-id" } : null } = {}) {
  const calls = { products: 0, resolutions: [], timelines: 0, reads: [], welcome: [] };
  const { default: Page } = loadModule("app/my/page.tsx", {
    "next/navigation": { redirect: (href) => { throw new Error(`redirect:${href}`); } },
    "@/components/platform/MemberHome": component("member-home"),
    "@/components/platform/PlatformUnavailable": component("platform-unavailable"),
    "@/lib/database/server": {
      withFreshApplicationDatabaseRead: async (stage, read) => { calls.reads.push(stage); return read(); },
    },
    "@/lib/membership/welcome-repository": { getMemberWelcome: async ownerId => {
      calls.welcome.push(ownerId);
      return { ownerId, dismissedAt: null, calendarViewedAt: null, hasJournalEntry: false };
    } },
    "@/lib/membership/artifact-products": {
      resolveMemberHomeArtifactProducts: (snapshot, catalog) => {
        calls.resolutions.push(catalog);
        return resolveMemberHomeArtifactProducts(snapshot, catalog);
      },
    },
    "@/lib/membership/page-context": { getMembershipPageContext: async (_, load) => ({
      data: state === "authenticated" ? await load(viewer.authUserId) : data, state, viewer,
    }) },
    "@/lib/membership/preview": { PREVIEW_MEMBER_HOME: {} },
    "@/lib/membership/repository": {
      getMemberHome: async () => data,
      getMemberTimeline: async () => { calls.timelines += 1; throw new Error("Profile must not prefetch Timeline"); },
    },
    "@/lib/shopify": { getProducts: async () => { calls.products += 1; return products; } },
  });
  return { calls, Page };
}

test("loading recovery is a native same-page link in server HTML without client JavaScript", () => {
  const { default: Loading } = loadModule("app/loading.tsx");
  const tree = parseFragment(renderToStaticMarkup(Loading()));
  const nodes = elements(tree);
  assert.ok(nodes.some((node) => attr(node, "role") === "status" && content(node).includes("Entering Ruined")));
  const retry = nodes.find((node) => node.tagName === "a" && content(node).trim() === "Reload page");
  assert.ok(retry, "recovery must render before hydration");
  assert.equal(attr(retry, "href"), "");
  assert.equal(new URL(attr(retry, "href"), "https://members.theruinedproject.com/my?returnTo=profile").href,
    "https://members.theruinedproject.com/my?returnTo=profile");
});

test("profile loads its own snapshot without eagerly fetching a separate Timeline", async () => {
  const member = homeFixture({ access: { capabilities: ["home.read", "foundations.write"] } });
  const f = pageFixture(member);
  const result = await f.Page();
  assert.equal(result.type, "member-home");
  assert.equal(result.props.timeline, undefined);
  assert.deepEqual(f.calls.reads, ["member-home", "member-welcome"]);
  assert.deepEqual(f.calls.welcome, ["member-auth-id"]);
  assert.deepEqual(result.props.welcome, {
    ownerId: "member-auth-id", dismissedAt: null, calendarViewedAt: null, hasJournalEntry: false,
  });
  assert.equal(f.calls.timelines, 0);
});

test("authenticated profile failures render native reload without asking the member to sign in again", async () => {
  const f = pageFixture(null, { state: "unavailable", viewer: { authUserId: "private-member-id" } });
  const markup = renderToStaticMarkup(await f.Page());
  const nodes = elements(parseFragment(markup));
  const retry = nodes.find((node) => node.tagName === "a" && content(node) === "Reload profile");
  assert.equal(new URL(attr(retry, "href"), "https://members.theruinedproject.com/my").pathname, "/my");
  assert.match(markup, /Your profile couldn’t load/);
  assert.doesNotMatch(markup, /passwordless|sign.in|private-member-id/);
  assert.equal(f.calls.products, 0);
  assert.equal(f.calls.timelines, 0);
  assert.deepEqual(f.calls.welcome, []);
});

test("members without Shopify-linked artifacts render without requesting the storefront", async () => {
  for (const artifacts of [[], [{ awardId: "unlinked-award", product: null }]]) {
    const member = homeFixture({ artifacts, artifact: artifacts[0] ?? null });
    const f = pageFixture(member);
    const result = await f.Page();
    assert.equal(result.type, "member-home");
    assert.equal(f.calls.products, 0);
    assert.deepEqual(f.calls.resolutions, [[]], "artifact resolution still runs with an empty catalogue");
    assert.deepEqual(result.props.member, member);
    assert.equal(result.props.member.access, member.access);
    assert.equal(f.calls.timelines, 0, "limited access must not load a private timeline");
  }
});

test("either a featured or archived Shopify binding requests the catalogue and preserves member access", async () => {
  const product = {
    shopifyProductGid: "gid://shopify/Product/123",
    id: "the-first-coin",
    name: "The First Coin",
    image: { url: "https://cdn.shopify.com/coin.jpg", alt: "First Coin" },
  };
  for (const featured of [true, false]) {
    const artifact = linkedArtifact();
    const member = homeFixture({ artifact: featured ? artifact : null, artifacts: featured ? [] : [artifact] });
    const before = JSON.stringify(member);
    const f = pageFixture(member, { products: [product] });
    const result = await f.Page();
    assert.equal(f.calls.products, 1);
    const resolved = featured ? result.props.member.artifact : result.props.member.artifacts[0];
    assert.equal(resolved.product.href, "/store/the-first-coin");
    assert.equal(result.props.member.access, member.access);
    assert.equal(result.props.member.nextAction, member.nextAction);
    assert.equal(JSON.stringify(member), before, "catalogue enrichment must not mutate the member snapshot");
  }
});

test("an unavailable catalogue preserves linked artifacts and the accessible member profile", async () => {
  const artifact = linkedArtifact();
  const member = homeFixture({ artifact, artifacts: [artifact] });
  const f = pageFixture(member);
  const result = await f.Page();
  assert.equal(f.calls.products, 1);
  assert.equal(result.type, "member-home");
  assert.deepEqual(result.props.member, member);
});

test("signed-out, denied, and unavailable member states never request Shopify", async () => {
  const signedOut = pageFixture(null, { state: "signed_out" });
  await assert.rejects(signedOut.Page(), /redirect:\/my\/access/);
  assert.equal(signedOut.calls.products, 0);
  assert.deepEqual(signedOut.calls.welcome, []);
  for (const state of ["denied", "unavailable"]) {
    const f = pageFixture(null, { state });
    const result = await f.Page();
    assert.equal(result.type, "platform-unavailable");
    assert.equal(f.calls.products, 0);
    assert.equal(f.calls.resolutions.length, 0);
    assert.deepEqual(f.calls.welcome, []);
  }
});

test("getProducts passes an eight-second abort signal and falls back to an empty catalogue when aborted", async () => {
  const controller = new AbortController();
  let timeout;
  let request;
  const { getProducts } = loadModule("src/lib/shopify.ts", {
    "server-only": {},
    "@shopify/storefront-api-client": {
      createStorefrontApiClient: () => ({
        request: (query, options) => {
          request = { query, options };
          return new Promise((resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
          });
        },
      }),
    },
    "@/data/products": { TONE_BY_HANDLE: {}, TONE_CYCLE: ["shadow"] },
    "@/lib/store/product-copy.js": { normalizeExpectedShipDateLanguage: (value) => value },
  }, {
    process: { env: { SHOPIFY_STORE_DOMAIN: "fixture.myshopify.com", SHOPIFY_STOREFRONT_ACCESS_TOKEN: "fixture-token" } },
    AbortSignal: { timeout: (milliseconds) => { timeout = milliseconds; return controller.signal; } },
  });
  const pending = getProducts();
  assert.equal(timeout, 8000);
  assert.equal(request.options.signal, controller.signal);
  assert.deepEqual(request.options.variables, { first: 50 });
  assert.match(request.query, /query Products/);
  controller.abort(new DOMException("Catalogue deadline reached", "TimeoutError"));
  assert.deepEqual(await pending, []);
});


function guidedTimelineFixture({ state = "authenticated", capabilities = ["profile.read"], journal = { entries: [], writable: true, mediaReady: true, hasMore: false }, failRead = false, viewer = state === "authenticated" ? { authUserId: "member-auth-id" } : null } = {}) {
  const calls = [];
  const identity = { memberId: "member-id" };
  const access = { capabilities };
  const { default: Page } = loadModule("src/components/membership/GuidedTimelinePage.tsx", {
    "next/navigation": { redirect: href => { throw Error(`redirect:${href}`); } },
    "./MemberAccessNotice": component("member-access-notice"),
    "./GuidedTimeline": component("guided-timeline"),
    "@/components/platform/PlatformUnavailable": component("platform-unavailable"),
    "@/lib/auth/support-return": loadModule("src/lib/auth/support-return.ts"),
    "@/lib/membership/access-policy": {
      deriveMemberAccessPolicy: value => { assert.equal(value, identity); return access; },
      memberCan: (policy, capability) => policy.capabilities.includes(capability),
    },
    "@/lib/membership/page-context": { getMembershipPageContext: async () => ({
      state, data: ["signed_out", "denied", "unavailable"].includes(state) ? null : identity,
      viewer,
    }) },
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: identity },
    "@/lib/membership/repository": { getMemberIdentity: async () => identity },
    "@/lib/membership/guided-timeline-preview": { GUIDED_TIMELINE_PREVIEW: { entries: [], writable: false, mediaReady: true, hasMore: false } },
    "@/lib/membership/journal-model": { JournalError: class extends Error {} },
    "@/lib/membership/journal-repository": {
      getJournal: async (...args) => {
        calls.push(args);
        if (failRead) throw new Error("Owner Timeline read unavailable");
        return journal;
      },
    },
  }, { console: { error: () => {} } });
  return { calls, Page };
}

test("guided Timeline reads only the authorized member's entries using profile access and preserves write policy", async () => {
  for (const writable of [true, false]) {
    const journal = { entries: [{ title: "An unpublished moment", visibility: "private" }], writable, mediaReady: true, hasMore: false };
    const f = guidedTimelineFixture({ journal });
    const page = await f.Page({});
    assert.equal(page.type, "guided-timeline");
    assert.equal(page.props.initialJournal, journal);
    assert.equal(page.props.ownerId, "member-auth-id");
    assert.equal(page.props.initialJournal.writable, writable);
    assert.deepEqual(f.calls, [["member-auth-id", null, false, { view: "timeline", order: "newest" }]]);
  }
});

test("guided Timeline authentication and profile-access failures never load member entries", async () => {
  const signedOut = guidedTimelineFixture({ state: "signed_out" });
  await assert.rejects(signedOut.Page({}), /^Error: redirect:\/access\?returnTo=%2Fmy%2Ftimeline$/);
  assert.deepEqual(signedOut.calls, []);
  for (const state of ["denied", "unavailable"]) {
    const f = guidedTimelineFixture({ state });
    const page = await f.Page({});
    assert.equal(page.type, "platform-unavailable");
    if (state === "denied") assert.equal(page.props.reason, "member_access");
    assert.deepEqual(f.calls, []);
  }
  const ineligible = guidedTimelineFixture({ capabilities: ["foundations.write"] });
  assert.equal((await ineligible.Page({})).type, "member-access-notice");
  assert.deepEqual(ineligible.calls, []);
  const missingViewer = guidedTimelineFixture({ viewer: null });
  assert.equal((await missingViewer.Page({})).type, "platform-unavailable");
  assert.deepEqual(missingViewer.calls, []);
});

test("an unavailable guided Timeline renders a recoverable connection fallback without exposing entries", async () => {
  const f = guidedTimelineFixture({ failRead: true });
  const page = await f.Page({});
  assert.equal(page.type, "platform-unavailable");
  assert.equal(page.props.initialJournal, undefined);
  assert.equal(page.props.accessHref, "/access?returnTo=%2Fmy%2Ftimeline");
  assert.deepEqual(f.calls, [["member-auth-id", null, false, { view: "timeline", order: "newest" }]]);
});

test("guided Timeline preview has no member identity or persistence reads", async () => {
  const f = guidedTimelineFixture({ state: "preview" });
  const page = await f.Page({ startNew: true });
  assert.equal(page.type, "guided-timeline"); assert.equal(page.props.preview, true);
  assert.equal(page.props.ownerId, undefined); assert.equal(page.props.initialJournal.writable, false);
  assert.deepEqual(f.calls, []);
});
