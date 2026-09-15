import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let pathname = "/ops";
const modules = new Map();
function load(path, overrides = {}, browserWindow, runtime = {}) {
  const compiled = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "window", "FormData", compiled)((name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "next/navigation") return { usePathname: () => pathname };
    if (name === "next/link") return { __esModule: true, default: ({ children, scroll, onNavigate, ...props }) => { void scroll; void onNavigate; return React.createElement("a", props, children); } };
    if (name === "next/image") return { __esModule: true, default: ({ priority, ...props }) => { void priority; return React.createElement("img", props); } };
    if (name === "@/lib/site") return { publicWebsiteHref: (path) => `https://theruinedproject.com${path}` };
    if (name === "@/components/platform/MemberNavigationFab") return { __esModule: true, default: () => React.createElement("button", { "data-member-fab": true }, "Member navigation") };
    const localPaths = {
      "@/lib/platform/operations-navigation": "src/lib/platform/operations-navigation.ts",
      "@/components/platform/OperatorPageFrame": "src/components/platform/OperatorPageFrame.tsx",
      "@/components/platform/OperatorDialog": "src/components/platform/OperatorDialog.tsx",
      "@/components/platform/StateLabel": "src/components/platform/StateLabel.tsx",
      "@/components/platform/operatorStyles": "src/components/platform/operatorStyles.ts",
    };
    const dependency = localPaths[name];
    if (dependency) {
      if (!modules.has(dependency)) modules.set(dependency, load(dependency));
      return modules.get(dependency);
    }
    throw new Error(`Unexpected navigation dependency: ${name}`);
  }, cjsModule, cjsModule.exports, runtime.fetch ?? (() => { throw new Error("Navigation must not make external requests"); }), browserWindow, runtime.FormData ?? FormData);
  return cjsModule.exports;
}
const navigation = load("src/lib/platform/operations-navigation.ts");
const { getOperationsNavigation, getOperationsLocation, isOperationsPathCurrent } = navigation;
const { OperationsNavigation, default: PlatformShell } = load("src/components/platform/PlatformShell.tsx");
const OpenOperationsNavigation = load("src/components/platform/PlatformShell.tsx", {
  react: { ...React, useEffect: () => {}, useRef: () => ({ current: null }), useState: () => [true, () => {}] },
}).OperationsNavigation;
const OpsOverview = load("src/components/platform/OpsOverview.tsx").default;
const Frame = load("src/components/platform/OperatorPageFrame.tsx").default;
const EmptyState = load("src/components/platform/OperatorEmptyState.tsx").default;
const connected = { mode: "connected", database: "connected", supabase: "connected", stripe: "connected" };
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
function elements(node) { return [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName); }
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const nodes = (root, tag) => elements(root).filter((node) => node.tagName === tag);
const render = (element) => parseFragment(renderToStaticMarkup(element));
const renderNavigation = (path, role = "ops_admin", open = true) => render(React.createElement(open ? OpenOperationsNavigation : OperationsNavigation, {
  configuration: connected, operatorRole: role, pathname: path, viewerLabel: "operator@example.test",
}));
const sharedRoutes = ["/ops", "/ops/members", "/ops/circles", "/ops/foundations", "/ops/experiences", "/ops/work"];
const adminRoutes = ["/ops/blocks", "/ops/operators", "/ops/academy", "/ops/artifacts", "/ops/support", "/ops/messages", "/ops/system"];

test("workspace links preserve native link behavior and start the selected page below the fixed header", () => {
  const calls = [];
  const Navigation = load("src/components/platform/PlatformShell.tsx", {
    react: { ...React, useEffect: () => {}, useRef: () => ({ current: null }), useState: () => [true, () => {}] },
  }, { scrollTo: (options) => calls.push(options) }).OperationsNavigation;
  function descendants(node) {
    if (Array.isArray(node)) return node.flatMap(descendants);
    if (!node || typeof node !== "object") return [];
    return [node, ...descendants(node.props?.children)];
  }
  for (const route of [...sharedRoutes, ...adminRoutes]) {
    const tree = Navigation({ configuration: connected, operatorRole: "ops_admin", pathname: route });
    const links = descendants(tree).filter((node) => node.props?.href);
    const headerLinks = links.filter((node) => node.props.href === "/ops" || node.props["aria-current"] !== undefined || typeof node.props.onNavigate === "function");
    assert.equal(headerLinks.length, 1 + sharedRoutes.length + adminRoutes.length);
    const triggers = descendants(tree).filter((node) => node.type === "button" && node.props["aria-controls"] === "ops-workspaces");
    assert.equal(triggers.length, 1, "one selector replaces both navigation rails");
    for (const link of headerLinks) {
      assert.equal(link.props.scroll, false);
      assert.equal(link.props.onClick, undefined, "onNavigate leaves modifier/new-tab clicks to Next");
      link.props.onNavigate();
      assert.deepEqual(calls.at(-1), { top: 0, left: 0, behavior: "instant" });
    }
    for (const href of ["#operator-content", "/my", "https://theruinedproject.com/"]) {
      const link = links.find((node) => node.props.href === href);
      assert.ok(link, href);
      assert.equal(link.props.scroll, undefined);
      assert.equal(link.props.onNavigate, undefined);
    }
  }
});

test("workspace navigation preserves exactly the existing shared and Administrator-only destinations", () => {
  const admin = getOperationsNavigation("ops_admin");
  assert.deepEqual(admin.map((group) => group.label), ["Overview", "People", "Circles", "Events", "Learning", "Artifacts", "Messages", "Settings"]);
  assert.deepEqual(admin.flatMap((group) => group.items.map((item) => item.href)).sort(), [...sharedRoutes, ...adminRoutes].sort());
  for (const role of ["circle_leader", "guide"]) {
    assert.deepEqual(getOperationsNavigation(role).flatMap((group) => group.items.map((item) => item.href)).sort(), sharedRoutes.toSorted());
  }
  for (const role of [null, undefined, "member", "unknown"]) assert.deepEqual(getOperationsNavigation(role), []);
});

test("each destination exists locally and every task has a concrete action label", () => {
  for (const item of getOperationsNavigation("ops_admin").flatMap((group) => group.items)) {
    assert.ok(source(`app${item.href}/page.tsx`).length > 0, item.href);
    assert.ok(item.task.split(" ").length >= 3, item.task);
    assert.doesNotMatch(item.label, /^Manage$|^Admin$/);
  }
});

test("exact and nested locations select one section/page without prefix collisions or unauthorized fallbacks", () => {
  const groups = getOperationsNavigation("ops_admin");
  assert.equal(getOperationsLocation("/ops/members/member-id", groups).item.label, "Members");
  assert.equal(getOperationsLocation("/ops/experiences/event-id/attendance", groups).group.label, "Events");
  assert.equal(getOperationsLocation("/ops/operators?memberId=example#record", groups).item.label, "Operators");
  assert.equal(isOperationsPathCurrent("/ops/memberships", "/ops/members"), false);
  assert.equal(isOperationsPathCurrent("/ops/work", "/ops"), false);
  assert.equal(getOperationsLocation("/ops/operators", getOperationsNavigation("guide")), null);
  for (const path of ["/ops/announcements", "/ops/notifications"]) assert.equal(getOperationsLocation(path, groups).item.href, "/ops/messages");
  assert.equal(getOperationsLocation("/ops/community/byob-02", groups).item.href, "/ops/experiences");
});

test("workspace selector closes after navigation and is mutually exclusive with the account menu", () => {
  const slots = [];
  let cursor = 0;
  const scrolls = [];
  const Navigation = load("src/components/platform/PlatformShell.tsx", {
    react: { ...React, useEffect() {}, useRef: () => ({ current: null }), useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    } },
  }, { scrollTo: (options) => scrolls.push(options) }).OperationsNavigation;
  const descendants = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
  const draw = (path) => { cursor = 0; return Navigation({ configuration: connected, operatorRole: "ops_admin", pathname: path }); };
  let tree = descendants(draw("/ops/members"));
  const trigger = () => tree.find((node) => node.type === "button" && node.props["aria-controls"] === "ops-workspaces");
  const account = () => tree.find((node) => node.type === "button" && node.props["aria-controls"] === "ops-account");
  assert.equal(trigger().props["aria-label"], "Workspace: Members");
  assert.equal(trigger().props["aria-expanded"], false);
  assert.equal(tree.some((node) => node.type === "nav"), false);
  trigger().props.onClick();
  tree = descendants(draw("/ops/members"));
  assert.equal(trigger().props["aria-expanded"], true);
  assert.equal(tree.filter((node) => node.type === "nav").length, 1);
  assert.equal(tree.find((node) => node.props?.href === "/ops/academy").props.children[0], "Academy");
  account().props.onClick();
  tree = descendants(draw("/ops/members"));
  assert.equal(trigger().props["aria-expanded"], false);
  assert.equal(account().props["aria-expanded"], true);
  trigger().props.onClick();
  tree = descendants(draw("/ops/academy/example"));
  assert.equal(account().props["aria-expanded"], false);
  assert.equal(trigger().props["aria-label"], "Workspace: Academy");
  assert.equal(tree.find((node) => node.props?.href === "/ops/academy").props["aria-current"], "page");
  assert.deepEqual(scrolls, [], "opening the selector and highlighting never scrolls");
  tree.find((node) => node.props?.href === "/ops/messages").props.onNavigate();
  tree = descendants(draw("/ops/notifications"));
  assert.equal(trigger().props["aria-expanded"], false);
  assert.equal(trigger().props["aria-label"], "Workspace: Messages");
  assert.deepEqual(scrolls, [{ top: 0, left: 0, behavior: "instant" }]);
  for (const invalid of ["/ops/announcementstuff", "/ops/notifications-other"]) assert.equal(getOperationsLocation(invalid, getOperationsNavigation("ops_admin")), null);
});

test("each page has one compact current-workspace selector and every destination is one click away when open", () => {
  for (const route of [...sharedRoutes, ...adminRoutes]) {
    const closed = renderNavigation(route, "ops_admin", false);
    assert.equal(nodes(closed, "nav").length, 0);
    const trigger = nodes(closed, "button").find((node) => attr(node, "aria-controls") === "ops-workspaces");
    assert.equal(attr(trigger, "aria-expanded"), "false");
    assert.equal(text(trigger), getOperationsLocation(route, getOperationsNavigation("ops_admin")).item.label);
    const tree = renderNavigation(route);
    const sections = nodes(tree, "nav").find((node) => attr(node, "aria-label") === "Operator workspaces");
    assert.ok(sections);
    assert.deepEqual(nodes(sections, "a").map((node) => attr(node, "href")).sort(), [...sharedRoutes, ...adminRoutes].sort());
    assert.equal(nodes(sections, "button").length, 0);
    assert.match(attr(sections, "class"), /overflow-y-auto/);
    const current = elements(tree).filter((node) => attr(node, "aria-current") === "page");
    assert.equal(current.length, 1, route);
    assert.equal(attr(current[0], "href"), route);
    assert.equal(elements(tree).filter((node) => attr(node, "aria-current") === "location").length, 0);
    assert.equal(nodes(tree, "nav").length, 1);
    for (let parent = current[0]; parent; parent = parent.parentNode) {
      assert.notEqual(parent.tagName, "details");
      assert.notEqual(attr(parent, "role"), "dialog");
      assert.doesNotMatch(attr(parent, "class") ?? "", /(?:^|\s)(?:hidden|xl:hidden)(?:\s|$)/);
    }
    assert.equal(nodes(tree, "aside").length, 0);
    assert.equal(elements(tree).filter((node) => attr(node, "role") === "menu").length, 0);
    assert.doesNotMatch(text(tree), /Open operations menu|Close operations menu/);
  }
});

test("workspace options do not expose Administrator controls to Shapers or Guides", () => {
  for (const role of ["circle_leader", "guide"]) {
    for (const path of sharedRoutes) {
      const tree = renderNavigation(path, role);
      const links = nodes(tree, "a").map((node) => attr(node, "href"));
      for (const forbidden of adminRoutes) assert.equal(links.includes(forbidden), false);
      assert.equal(elements(tree).filter((node) => attr(node, "aria-current") === "page").length, 1);
    }
  }
  assert.equal(nodes(renderNavigation("/ops/access", null), "nav").length, 0);
});

test("operator skip link has a focusable page destination without another visible page-title block", () => {
  const tree = render(React.createElement(React.Fragment, null,
    React.createElement(OperationsNavigation, { configuration: connected, operatorRole: "ops_admin", pathname: "/ops/circles" }),
    React.createElement(Frame, { title: "Circles" }, React.createElement("p", null, "Circle roster")),
  ));
  assert.ok(nodes(tree, "a").some((node) => attr(node, "href") === "#operator-content"));
  const main = nodes(tree, "main")[0];
  assert.equal(attr(main, "id"), "operator-content");
  assert.equal(attr(main, "tabindex"), "-1");
  assert.equal(attr(nodes(main, "h1")[0], "class"), "sr-only");
});

const data = {
  attention: [], activity: [], canPlaceMembers: true, priorityWork: [], upcomingExperiences: [],
  counts: {
    activeMembers: 10, attentionRequired: 1, totalMembers: 12, eligibleWithoutCircle: 2,
    circles: { active: 1, forming: 1 }, foundations: { completed: 2, inProgress: 5, notStarted: 5 },
    work: { artifacts: 1, failures: 1, tasks: 2 },
  },
};

test("Overview keeps member actions and search together without a duplicate navigation or counter strip", () => {
  const tree = render(React.createElement(OpsOverview, { data }));
  const people = nodes(tree, "section").find((node) => attr(node, "aria-labelledby") === "overview-people-heading");
  assert.ok(people);
  for (const href of ["/ops/members#allow-member-email", "/ops/members", "/ops/operators?add=1"]) assert.ok(nodes(people, "a").some((node) => attr(node, "href") === href));
  assert.equal(nodes(tree, "nav").some((node) => ["Operator tasks", "Current membership snapshot"].includes(attr(node, "aria-label"))), false);
  const search = nodes(tree, "form").find((node) => attr(node, "role") === "search");
  assert.equal(attr(search, "action"), "/ops/members");
  assert.equal(attr(search, "method"), "get");
  assert.equal(attr(nodes(search, "input")[0], "name"), "q");
  assert.equal(attr(nodes(search, "input")[0], "type"), "search");
  assert.match(source("src/components/platform/OperatorPeopleWorkspace.tsx"), /id="allow-member-email"/);
  assert.match(source("src/components/platform/OperatorCirclesManager.tsx"), /id="create-circle"/);
  const placement = nodes(tree, "a").find((node) => text(node).startsWith("Ready for a Circle"));
  assert.equal(attr(placement, "href"), "/ops/circles#assign-member");
  assert.match(text(placement), /2/);
});

test("Overview shares the existing server Administrator boundary for privileged job shortcuts", () => {
  const tree = render(React.createElement(OpsOverview, { data: { ...data, canPlaceMembers: false } }));
  for (const href of ["/ops/circles", "/ops/foundations", "/ops/experiences"]) assert.ok(nodes(tree, "a").some((node) => attr(node, "href") === href));
  for (const forbidden of adminRoutes) assert.equal(nodes(tree, "a").some((node) => attr(node, "href") === forbidden), false);
  assert.doesNotMatch(text(tree), /Place 2 eligible members/);
  assert.doesNotMatch(text(tree), /Ready for a Circle/);
  assert.equal(nodes(tree, "a").some((node) => attr(node, "href") === "/ops/circles#assign-member"), false);
  assert.equal(attr(nodes(tree, "input").find((node) => attr(node, "name") === "q"), "placeholder"), "Name");
  assert.doesNotMatch(text(tree), /Add a member|Add an operator|Create a Circle/);
});

test("Overview does not show empty attention calls or ask operators to place zero members", () => {
  const tree = render(React.createElement(OpsOverview, { data: {
    ...data,
    counts: { ...data.counts, eligibleWithoutCircle: 0 },
    attention: [{ count: 0, href: "/ops/system#delivery", label: "Empty delivery queue", oldestAt: null }],
  } }));
  assert.doesNotMatch(text(tree), /Place 0|Empty delivery queue/);
  assert.doesNotMatch(text(tree), /Ready for a Circle|Without a Circle/);
  assert.equal(nodes(tree, "a").some((node) => attr(node, "href") === "/ops/circles#assign-member"), false);
});

test("operator account profile link avoids the unified sign-in invitation-claiming redirect", () => {
  const openAccount = load("src/components/platform/PlatformShell.tsx", {
    react: { ...React, useEffect: () => {}, useRef: () => ({ current: null }), useState: () => [true, () => {}] },
  }).OperationsNavigation;
  const tree = render(React.createElement(openAccount, { configuration: connected, pathname: "/ops/circles", operatorRole: "ops_admin", viewerLabel: "operator@example.test" }));
  const account = elements(tree).find((node) => attr(node, "aria-label") === "Operator account");
  assert.ok(account);
  assert.equal(attr(nodes(account, "a").find((node) => text(node) === "My profile"), "href"), "/my");
  assert.equal(attr(nodes(account, "a").find((node) => text(node).startsWith("Return to website")), "href"), "https://theruinedproject.com/");
  assert.equal(attr(nodes(account, "form")[0], "method"), "post");
  assert.equal(attr(nodes(account, "form")[0], "action"), "/api/auth/sign-out?next=/access");
  assert.doesNotMatch(text(account), /Stripe on|Database on|Services verified/);
  assert.equal(attr(nodes(tree, "button")[0], "aria-expanded"), "true");
});

test("Overview retains server-supplied attention, activity and event destinations", () => {
  const tree = render(React.createElement(OpsOverview, { data: {
    ...data,
    attention: [{ count: 2, href: "/ops/system#delivery", label: "Delivery needs attention", oldestAt: null }],
    activity: [{ activityId: "fixture", href: "/ops/members/example", kind: "member", memberId: "example", occurredAt: "2026-09-08T12:00:00Z", subject: "Example", summary: "Profile saved", tone: "complete" }],
    upcomingExperiences: [{ experienceId: "fixture-event", title: "Circle meeting", startsAt: "2026-09-09T12:00:00Z" }],
  } }));
  for (const href of ["/ops/system#delivery", "/ops/members/example", "/ops/experiences/fixture-event"]) {
    assert.ok(nodes(tree, "a").some((node) => attr(node, "href") === href));
  }
});

test("shared empty states remove generic filler and keep explicit actions readable", () => {
  const tree = render(React.createElement(EmptyState, { title: "No Circles yet.", detail: "Create the first Circle to start a roster.", actionHref: "/ops/circles#create-circle", actionLabel: "Create a Circle" }));
  assert.doesNotMatch(text(tree), /Ready when you are/);
  const action = nodes(tree, "a")[0];
  assert.match(attr(action, "class"), /text-sm/);
  assert.match(attr(action, "class"), /normal-case tracking-normal/);
  assert.doesNotMatch(attr(action, "class"), /uppercase|tracking-\[/);
  assert.equal(attr(action, "href"), "/ops/circles#create-circle");
});

test("member shell retains its utility rail, member FAB and thresholds without operations navigation", () => {
  pathname = "/my";
  const tree = render(React.createElement(PlatformShell, { configuration: connected, operatorRole: "ops_admin", surface: "member", viewerLabel: "member@example.test" }, React.createElement("p", null, "Member profile")));
  assert.match(text(tree), /Member access/);
  assert.ok(nodes(tree, "a").some((node) => attr(node, "href") === "/ops"));
  assert.ok(nodes(tree, "button").some((node) => attr(node, "data-member-fab") === "true"));
  assert.equal(nodes(tree, "nav").some((node) => attr(node, "aria-label") === "Operations sections"), false);
  pathname = "/my/join";
  const threshold = render(React.createElement(PlatformShell, { configuration: connected, surface: "member" }, React.createElement("p", null, "Membership entry")));
  assert.equal(nodes(threshold, "button").some((node) => attr(node, "data-member-fab") === "true"), false);
});

const audienceTabs = load("src/components/platform/OperatorEventAudienceTabs.tsx");
const eventClientDependencies = {
  "next/navigation": { useRouter: () => ({ push() { throw new Error("Rendering must not navigate"); }, refresh() { throw new Error("Rendering must not refresh"); } }) },
  "@/lib/datetime/zoned-date-time": load("src/lib/datetime/zoned-date-time.ts"),
  "@/lib/events/byob-registration-model": load("src/lib/events/byob-registration-model.ts"),
};
const communityComponents = load("src/components/platform/OperatorCommunityEvents.tsx", eventClientDependencies);
const memberEventComponents = load("src/components/platform/OperatorExperienceDirectory.tsx", eventClientDependencies);
const eventDirectory = { canCreate: false, canManageGlobal: true, experiences: [], circles: [], blocks: [] };
const publicEvent = {
  eventKey: "byob-02", title: "BYOB 02", location: "Alpine, Utah", timezone: "America/Denver",
  startsAt: "2026-09-19T15:00:00Z", publicationState: "published", eventState: "Upcoming",
  registrationMode: "byob", registeredCount: 0, attendanceCount: 0, version: 1,
};
function eventPageDependencies(state) {
  return {
    "@/components/platform/OperatorEventAudienceTabs": audienceTabs,
    "@/components/platform/OperatorCommunityEvents": communityComponents,
    "@/components/platform/OperatorExperienceDirectory": memberEventComponents,
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: () => React.createElement("p", null, "Unavailable") },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({ state, role: "ops_admin", dashboard: {}, viewer: { authUserId: "local-fixture" } }) },
    "@/lib/platform/ops-experience-preview": { PREVIEW_OPS_EXPERIENCE_DIRECTORY: eventDirectory },
    "@/lib/platform/ops-experience-repository": { getOpsExperienceManagementDirectory: async () => eventDirectory },
    "@/lib/events/community-event-model": { legacyCommunityEventRecords: () => [publicEvent] },
    "@/lib/events/community-event-repository": {
      getOpsCommunityEvents: async () => [publicEvent],
      getCommunityRoster: async () => ({ count: 0, page: 1, pageCount: 1, registrations: [] }),
    },
  };
}
function assertAudienceInsideFrame(tree, selected) {
  const frames = nodes(tree, "main");
  assert.equal(frames.length, 1);
  assert.equal(attr(frames[0], "id"), "operator-content");
  const audiences = nodes(tree, "nav").filter((node) => attr(node, "aria-label") === "Event audiences");
  assert.equal(audiences.length, 1);
  const [audience] = audiences;
  assert.ok(elements(frames[0]).includes(audience), "audience tabs must not be a sibling above the negative-margin page frame");
  assert.equal(audience.parentNode.parentNode, frames[0]);
  const bodyChildren = audience.parentNode.childNodes.filter((node) => node.tagName);
  assert.equal(bodyChildren[0], audience, "audience navigation is the first content inside the page frame");
  assert.ok(bodyChildren.length > 1, "the page body follows the audience tabs");
  const selectedLinks = nodes(audience, "a").filter((node) => attr(node, "aria-current") === "page");
  assert.equal(selectedLinks.length, 1);
  assert.equal(attr(selectedLinks[0], "href"), selected === "community" ? "/ops/experiences?view=community" : "/ops/experiences");
  return audience;
}

test("both event audiences remain inside their listing frame before the body in preview and connected routes", async () => {
  for (const state of ["preview", "connected"]) {
    for (const view of ["members", "community"]) {
      const Page = load("app/ops/experiences/page.tsx", eventPageDependencies(state)).default;
      const page = await Page({ searchParams: Promise.resolve({ view }) });
      assert.equal(page.type, view === "community" ? communityComponents.default : memberEventComponents.default);
      assert.equal(page.props.navigation.type, audienceTabs.default, "the route passes tabs into the listing instead of rendering them outside its frame");
      const tree = render(page);
      const audience = assertAudienceInsideFrame(tree, view);
      const body = audience.parentNode;
      if (view === "community") {
        assert.ok(nodes(body, "input").some((node) => attr(node, "type") === "search"));
        assert.ok(nodes(body, "a").some((node) => attr(node, "href") === "/ops/community/byob-02"));
      } else {
        assert.ok(nodes(body, "section").some((node) => attr(node, "aria-label") === "Experience directory"));
        assert.ok(nodes(body, "input").some((node) => attr(node, "type") === "search"));
      }
    }
  }
});

test("public event detail keeps audience tabs inside its frame and website links leave the member host", async () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  const site = load("src/lib/site.ts");
  const paths = [];
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://members.theruinedproject.com";
    for (const state of ["preview", "connected"]) {
      const Page = load("app/ops/community/[eventKey]/page.tsx", {
        ...eventPageDependencies(state),
        "@/lib/site": { ...site, publicWebsiteHref: (path) => { paths.push(path); return site.publicWebsiteHref(path); } },
      }).default;
      const tree = render(await Page({ params: Promise.resolve({ eventKey: publicEvent.eventKey }), searchParams: Promise.resolve({}) }));
      assertAudienceInsideFrame(tree, "community");
      assert.equal(paths.at(-1), "/community#byob-02", "the public destination must use the shared website host helper");
      const websiteLink = nodes(tree, "a").find((node) => text(node).startsWith("View on website"));
      assert.ok(websiteLink);
      assert.equal(attr(websiteLink, "href"), "https://theruinedproject.com/community#byob-02");
      assert.equal(attr(websiteLink, "target"), "_blank");
      assert.match(attr(websiteLink, "rel"), /noopener/);
      assert.ok(nodes(tree, "a").some((node) => attr(node, "href") === "/ops/experiences?view=community"), "operator back link stays local");
      assert.ok(nodes(tree, "section").some((node) => attr(node, "id") === "registrations"));
      const eventDetails = nodes(tree, "section").find((node) => attr(node, "aria-label") === "Event details");
      assert.ok(eventDetails, "saved event details remain visible beside registration management");
      assert.ok(nodes(eventDetails, "button").some((node) => text(node) === "Edit event"));
      assert.equal(nodes(eventDetails, "form").length, 0, "editing is an explicit action, not a duplicate of the saved details");
      assert.equal(nodes(tree, "button").some((node) => text(node) === "Save event"), false);
    }
    assert.equal(paths.length, 2);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

const opsPreview = load("src/lib/platform/ops-preview.ts");
const experiencePreview = load("src/lib/platform/ops-experience-preview.ts", { "@/lib/platform/ops-preview": opsPreview });
const meetingCircleId = opsPreview.PREVIEW_OPS_CIRCLES[0].id;
const otherMeetingCircleId = opsPreview.PREVIEW_OPS_CIRCLES[1].id;
const meetingDirectory = {
  ...experiencePreview.PREVIEW_OPS_EXPERIENCE_DIRECTORY,
  circles: [{ id: meetingCircleId, name: "Same display name" }, { id: otherMeetingCircleId, name: "Same display name" }],
  experiences: [
    { ...experiencePreview.PREVIEW_OPS_EXPERIENCE_DIRECTORY.experiences[0], circleId: meetingCircleId, title: "Selected meeting" },
    { ...experiencePreview.PREVIEW_OPS_EXPERIENCE_DIRECTORY.experiences[0], circleId: otherMeetingCircleId, experienceId: "other-meeting", title: "Other Circle meeting" },
    { ...experiencePreview.PREVIEW_OPS_EXPERIENCE_DIRECTORY.experiences[1], circleId: null, title: "All-member gathering" },
  ],
};
function meetingPage(state) {
  return load("app/ops/experiences/page.tsx", {
    ...eventPageDependencies(state),
    "@/lib/platform/ops-experience-preview": { PREVIEW_OPS_EXPERIENCE_DIRECTORY: meetingDirectory },
    "@/lib/platform/ops-experience-repository": { getOpsExperienceManagementDirectory: async () => meetingDirectory },
  }).default;
}

test("Circle scheduling uses canonical preview IDs shared with Circle management", () => {
  assert.deepEqual(experiencePreview.PREVIEW_OPS_EXPERIENCE_DIRECTORY.circles, opsPreview.PREVIEW_OPS_CIRCLES
    .filter((circle) => ["active", "forming"].includes(circle.status)).map(({ id, name }) => ({ id, name })));
  assert.equal(experiencePreview.PREVIEW_OPS_EXPERIENCE_DIRECTORY.experiences[0].circleId, meetingCircleId);
  assert.equal(experiencePreview.PREVIEW_OPS_EXPERIENCE_RECORDS["preview-experience-circle-01"].circleId, meetingCircleId);
});

test("event listings use one clear event destination instead of duplicated meeting-link tasks", () => {
  const tree = render(React.createElement(memberEventComponents.default, { directory: meetingDirectory }));
  for (const article of nodes(tree, "article")) {
    assert.equal(nodes(article, "form").length, 0, "the listing must not contain an inline Google mutation form");
    const [link] = nodes(article, "a");
    assert.equal(nodes(article, "a").length, 1);
    assert.ok(link);
    const event = meetingDirectory.experiences.find((entry) => attr(link, "href") === `/ops/experiences/${entry.experienceId}`);
    assert.ok(event);
    assert.ok(text(link).includes(event.title));
    assert.doesNotMatch(text(article), /Set meeting link|Manage meeting link/);
  }
});

test("Circle shortcut filters by exact ID and prefills a no-reservation meeting for the selected Circle", async () => {
  for (const state of ["preview", "connected"]) {
    const page = await meetingPage(state)({ searchParams: Promise.resolve({ circleId: meetingCircleId, view: "community" }) });
    assert.equal(page.key, meetingCircleId, "changing Circle resets the new-draft form");
    const tree = render(page);
    assertAudienceInsideFrame(tree, "members");
    assert.match(text(tree), /Selected meeting/);
    assert.doesNotMatch(text(tree), /Other Circle meeting|All-member gathering/);
    assert.ok(nodes(tree, "a").some((node) => attr(node, "href") === `/ops/circles?circleId=${meetingCircleId}#circle-communications`));
    const dialog = nodes(tree, "dialog")[0];
    assert.equal(attr(dialog, "open"), undefined, "creation stays closed until requested");
    const form = nodes(dialog, "form")[0];
    assert.ok(form);
    const input = (name) => nodes(form, "input").find((node) => attr(node, "name") === name);
    assert.equal(attr(input("title"), "value"), "Same display name meeting");
    for (const [name, value] of [["kind", "circle_meeting"], ["visibility", "circle"], ["circleId", meetingCircleId], ["registrationMode", "none"]]) {
      assert.equal(attr(input(name), "type"), "hidden");
      assert.equal(attr(input(name), "value"), value);
      assert.equal(nodes(form, "select").some((node) => attr(node, "name") === name), false);
    }
    assert.equal(input("capacity"), undefined);
    assert.equal(nodes(form, "input").some((node) => attr(node, "name") === "waitlistEnabled"), false);
    assert.match(text(form), /No reservation needed/);
    assert.match(text(form), /Nothing is published or sent yet/);
    assert.equal(nodes(form, "ol").length, 0, "the draft form does not repeat the entire publishing process");
  }
});

test("invalid, unauthorized, ambiguous and empty Circle shortcuts never fall back to another audience", async () => {
  for (const state of ["preview", "connected"]) {
    for (const circleId of ["", "not-a-circle", "Same display name", "11111111-1111-4111-8111-111111111199", [meetingCircleId, otherMeetingCircleId]]) {
      const tree = render(await meetingPage(state)({ searchParams: Promise.resolve({ circleId }) }));
      assertAudienceInsideFrame(tree, "members");
      assert.match(text(tree), /No other audience has been selected/);
      assert.equal(nodes(tree, "form").length, 0);
      assert.equal(nodes(tree, "article").length, 0);
      assert.equal(nodes(tree, "input").length, 0);
      assert.ok(nodes(tree, "a").some((node) => attr(node, "href") === "/ops/circles"));
    }
  }
});

test("saving a scoped meeting pins the request audience and opens meeting setup without sending invitations", async () => {
  const calls = [];
  const navigations = [];
  let resets = 0;
  const descendants = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
  const Form = load("src/components/platform/OperatorExperienceDirectory.tsx", {
    ...eventClientDependencies,
    react: { ...React, useState: (initial) => [initial, () => {}], useEffect() {} },
    "next/navigation": { useRouter: () => ({ push: (path) => navigations.push(path), refresh() {} }) },
  }, undefined, {
    FormData: class { constructor(form) { this.values = form.values; } get(name) { return this.values[name] ?? null; } },
    fetch: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ experience: { experienceId: "new-meeting" } }) }; },
  }).default;
  const event = {
    preventDefault() {},
    currentTarget: { reset() { resets += 1; }, values: {
      title: "Our next meeting", startsAt: "2026-10-01T18:00", endsAt: "2026-10-01T19:00", timezone: "America/Denver",
      visibility: "all_members", kind: "public_event", circleId: otherMeetingCircleId, blockId: "other-block",
      registrationMode: "internal", capacity: "100", waitlistEnabled: "on",
    } },
  };
  const form = descendants(Form({ directory: meetingDirectory, requestedCircleId: meetingCircleId })).find((node) => node.type === "form");
  await form.props.onSubmit(event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/ops/experiences");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.circleId, meetingCircleId);
  assert.equal(calls[0].body.visibility, "circle");
  assert.equal(calls[0].body.kind, "circle_meeting");
  assert.equal(calls[0].body.registrationMode, "none");
  assert.equal(calls[0].body.blockId, null);
  assert.equal(calls[0].body.capacity, null);
  assert.equal(calls[0].body.waitlistEnabled, false);
  assert.equal(calls[0].body.startsAt, "2026-10-02T00:00:00.000Z");
  assert.deepEqual(navigations, ["/ops/experiences/new-meeting#meeting-setup"]);
  assert.equal(resets, 1);
  const preview = descendants(Form({ directory: meetingDirectory, requestedCircleId: meetingCircleId, preview: true })).find((node) => node.type === "form");
  await preview.props.onSubmit(event);
  assert.equal(calls.length, 1, "preview cannot create or publish an event");
});
