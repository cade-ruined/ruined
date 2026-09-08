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
function load(path, overrides = {}, browserWindow) {
  const compiled = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "window", compiled)((name) => {
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
      "@/components/platform/StateLabel": "src/components/platform/StateLabel.tsx",
      "@/components/platform/operatorStyles": "src/components/platform/operatorStyles.ts",
    };
    const dependency = localPaths[name];
    if (dependency) {
      if (!modules.has(dependency)) modules.set(dependency, load(dependency));
      return modules.get(dependency);
    }
    throw new Error(`Unexpected navigation dependency: ${name}`);
  }, cjsModule, cjsModule.exports, () => { throw new Error("Navigation must not make external requests"); }, browserWindow);
  return cjsModule.exports;
}
const navigation = load("src/lib/platform/operations-navigation.ts");
const { getOperationsNavigation, getOperationsLocation, isOperationsPathCurrent } = navigation;
const { OperationsNavigation, default: PlatformShell } = load("src/components/platform/PlatformShell.tsx");
const OpsOverview = load("src/components/platform/OpsOverview.tsx").default;
const Frame = load("src/components/platform/OperatorPageFrame.tsx").default;
const EmptyState = load("src/components/platform/OperatorEmptyState.tsx").default;
const connected = { mode: "connected", database: "connected", supabase: "connected", stripe: "connected" };
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
function elements(node) { return [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName); }
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const nodes = (root, tag) => elements(root).filter((node) => node.tagName === tag);
const render = (element) => parseFragment(renderToStaticMarkup(element));
const renderNavigation = (path, role = "ops_admin") => render(React.createElement(OperationsNavigation, {
  configuration: connected, operatorRole: role, pathname: path, viewerLabel: "operator@example.test",
}));
const sharedRoutes = ["/ops", "/ops/members", "/ops/circles", "/ops/foundations", "/ops/experiences", "/ops/work"];
const adminRoutes = ["/ops/blocks", "/ops/operators", "/ops/academy", "/ops/artifacts", "/ops/support", "/ops/announcements", "/ops/notifications", "/ops/system"];

test("only header destinations disable Next focus scrolling and explicitly reveal the selection rails", () => {
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
    assert.equal(headerLinks.length, 1 + 5 + (route === "/ops" ? 0 : getOperationsLocation(route, getOperationsNavigation("ops_admin")).group.items.length));
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

test("horizontal navigation preserves exactly the existing shared and Administrator-only destinations", () => {
  const admin = getOperationsNavigation("ops_admin");
  assert.deepEqual(admin.map((group) => group.label), ["Overview", "People", "Learning & events", "Messages", "Tasks & tools"]);
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
  assert.equal(getOperationsLocation("/ops/experiences/event-id/attendance", groups).group.label, "Learning & events");
  assert.equal(getOperationsLocation("/ops/operators?memberId=example#record", groups).item.label, "Operators");
  assert.equal(isOperationsPathCurrent("/ops/memberships", "/ops/members"), false);
  assert.equal(isOperationsPathCurrent("/ops/work", "/ops"), false);
  assert.equal(getOperationsLocation("/ops/operators", getOperationsNavigation("guide")), null);
});

test("every page renders selected section/page in horizontal rails without a sidebar or navigation drawer", () => {
  for (const route of [...sharedRoutes, ...adminRoutes]) {
    const tree = renderNavigation(route);
    const sections = nodes(tree, "nav").find((node) => attr(node, "aria-label") === "Operations sections");
    assert.ok(sections);
    assert.equal(nodes(sections, "a").length, 5);
    assert.match(attr(sections, "class"), /flex-wrap/);
    assert.doesNotMatch(attr(sections, "class"), /overflow-x/);
    const current = elements(tree).filter((node) => attr(node, "aria-current") === "page");
    assert.equal(current.length, 1, route);
    assert.equal(attr(current[0], "href"), route);
    assert.equal(elements(tree).filter((node) => attr(node, "aria-current") === "location").length, route === "/ops" ? 0 : 1);
    assert.equal(nodes(tree, "nav").length, route === "/ops" ? 1 : 2);
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

test("mobile rails keep the selected page readable and do not expose Administrator controls to Shapers or Guides", () => {
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

test("Overview maps concrete jobs to the same destinations and takes Circle placement directly to its form", () => {
  const tree = render(React.createElement(OpsOverview, { data }));
  const tasks = nodes(tree, "nav").find((node) => attr(node, "aria-label") === "Operator tasks");
  assert.ok(tasks);
  assert.deepEqual(nodes(tasks, "a").map((node) => attr(node, "href")).sort(), [...sharedRoutes.filter((path) => path !== "/ops"), ...adminRoutes, "/ops/members#allow-member-email", "/ops/circles#create-circle"].sort());
  assert.match(text(tasks), /Find a member/);
  assert.match(text(tasks), /Open a Circle roster/);
  assert.match(text(tasks), /Plan events and take attendance/);
  assert.match(text(tasks), /Add or manage operators/);
  for (const heading of nodes(tasks, "h2")) {
    assert.match(attr(nodes(heading, "span")[0], "class"), /\[font-family:var\(--font-cadehandy2\)\]/);
  }
  assert.equal(attr(nodes(tasks, "a").find((node) => text(node).startsWith("Allow member email")), "href"), "/ops/members#allow-member-email");
  assert.equal(attr(nodes(tasks, "a").find((node) => text(node).startsWith("Create a Circle")), "href"), "/ops/circles#create-circle");
  assert.match(source("app/ops/members/page.tsx"), /id="allow-member-email"/);
  assert.match(source("src/components/platform/OperatorCirclesManager.tsx"), /id="create-circle"/);
  const placement = nodes(tree, "a").find((node) => text(node).startsWith("Place 2 eligible members"));
  assert.equal(attr(placement, "href"), "/ops/circles#assign-member");
});

test("Overview shares the existing server Administrator boundary for privileged job shortcuts", () => {
  const tree = render(React.createElement(OpsOverview, { data: { ...data, canPlaceMembers: false } }));
  const tasks = nodes(tree, "nav").find((node) => attr(node, "aria-label") === "Operator tasks");
  assert.deepEqual(nodes(tasks, "a").map((node) => attr(node, "href")).sort(), sharedRoutes.filter((path) => path !== "/ops").toSorted());
  for (const forbidden of adminRoutes) assert.equal(nodes(tree, "a").some((node) => attr(node, "href") === forbidden), false);
  assert.doesNotMatch(text(tree), /Place 2 eligible members/);
  assert.doesNotMatch(text(tasks), /Allow member email|Create a Circle/);
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
