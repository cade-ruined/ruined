import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    const local = {
      "@/components/platform/OperatorPageFrame": "src/components/platform/OperatorPageFrame.tsx",
      "@/components/platform/StateLabel": "src/components/platform/StateLabel.tsx",
      "@/components/platform/operatorStyles": "src/components/platform/operatorStyles.ts",
    };
    assert.ok(local[name], `Unexpected overview dependency: ${name}`);
    return load(local[name]);
  }, mod, mod.exports, () => { throw Error("Rendering the dashboard must not make requests"); });
  return mod.exports;
}
const Overview = load("src/components/platform/OpsOverview.tsx").default;
const render = (data) => parseFragment(renderToStaticMarkup(React.createElement(Overview, { data })));
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const region = (tree, id) => elements(tree).find((node) => attr(node, "aria-labelledby") === id);
const link = (tree, href) => elements(tree).find((node) => node.tagName === "a" && attr(node, "href") === href);
const data = {
  attention: [], activity: [], canPlaceMembers: true, priorityWork: [], upcomingExperiences: [],
  counts: { activeMembers: 10, attentionRequired: 2, totalMembers: 12, eligibleWithoutCircle: 3, circles: { active: 4, forming: 1 }, foundations: { completed: 2, inProgress: 5, notStarted: 5 }, work: { artifacts: 1, failures: 2, tasks: 3 } },
};

test("dashboard counts are real, nonduplicated and connected to the matching workspaces", () => {
  const tree = render(data);
  assert.match(text(region(tree, "overview-people-heading")), /10active members \/ 12 total/);
  assert.match(text(link(tree, "/ops/members?filter=attention")), /2 to review/);
  assert.match(text(region(tree, "overview-circles-heading")), /4active1 forming/);
  assert.match(text(link(tree, "/ops/circles#assign-member")), /3/);
  assert.match(text(region(tree, "overview-foundations-heading")), /5in progress/);
  assert.match(text(link(tree, "/ops/work")), /6 open/);
  assert.doesNotMatch(text(tree), /No open work\./, "absence of priority rows must not contradict nonzero work counts");
  assert.match(text(region(tree, "priority-work-heading")), /Open the work queue/);
});

test("small Circle and Foundations cards stay paired while search and record lists span mobile width", () => {
  const tree = render(data);
  const dashboard = elements(tree).find((node) => attr(node, "aria-label") === "Operations dashboard");
  assert.match(attr(dashboard, "class"), /grid-cols-2/);
  assert.match(attr(region(tree, "overview-people-heading"), "class"), /col-span-2/);
  for (const id of ["overview-circles-heading", "overview-foundations-heading"]) {
    assert.doesNotMatch(attr(region(tree, id), "class"), /(?:^|\s)col-span-2(?:\s|$)/);
    assert.match(attr(region(tree, id), "class"), /lg:col-span-3/);
  }
  for (const id of ["upcoming-heading", "priority-work-heading", "recent-activity-heading"]) assert.match(attr(region(tree, id), "class"), /col-span-2/);
  const sections = elements(tree).filter((node) => node.tagName === "section").map((node) => attr(node, "aria-labelledby"));
  assert.ok(sections.indexOf("priority-work-heading") < sections.indexOf("recent-activity-heading"), "mobile decisions stay ahead of the long activity history");
  assert.equal(elements(tree).some((node) => node.tagName === "details"), false);
});

test("the scoped dashboard never invents administrator actions, placement counts or empty warning tiles", () => {
  const tree = render({ ...data, canPlaceMembers: false, attention: [{ count: 0, href: "/ops/system", label: "Empty warning", oldestAt: null }] });
  for (const href of ["/ops/members#allow-member-email", "/ops/operators?add=1", "/ops/circles#assign-member"]) assert.equal(link(tree, href), undefined);
  assert.match(text(tree), /Your Circles/);
  assert.doesNotMatch(text(tree), /Ready for a Circle|Empty warning/);
  assert.equal(attr(elements(tree).find((node) => attr(node, "id") === "overview-member-search"), "placeholder"), "Name");
});

test("Circle and Foundations use one native whole-card target and keep Circle placement above it", () => {
  for (const canPlaceMembers of [true, false]) {
    const tree = render({ ...data, canPlaceMembers });
    for (const [heading, href] of [["overview-circles-heading", "/ops/circles"], ["overview-foundations-heading", "/ops/foundations"]]) {
      const card = region(tree, heading);
      const target = link(card, href);
      assert.ok(target);
      assert.match(attr(card, "class"), /relative isolate/);
      assert.match(attr(target, "class"), /after:absolute after:inset-0/);
      assert.match(attr(target, "class"), /focus-visible:after:outline-2/);
      assert.equal(elements(card).filter((node) => node.tagName === "a" && attr(node, "href") === href).length, 1);
      assert.equal(elements(target).filter((node) => node.tagName === "a").length, 1, "native anchors are not nested");
      assert.equal(attr(target, "role"), undefined);
      assert.equal(attr(target, "tabindex"), undefined, "native links stay in the normal keyboard order");
    }
    const placement = link(region(tree, "overview-circles-heading"), "/ops/circles#assign-member");
    if (canPlaceMembers) {
      assert.match(attr(placement, "class"), /relative z-10/);
      assert.match(attr(placement, "class"), /min-h-11/);
      assert.equal(elements(link(tree, "/ops/circles")).includes(placement), false);
    } else assert.equal(placement, undefined);
  }
});

test("attention, every event, work kind and activity destination survive the compact presentation", () => {
  const fixture = { ...data,
    attention: [{ count: 2, href: "/ops/support", label: "Needs reply", oldestAt: "2026-09-14T15:00:00Z" }],
    upcomingExperiences: [{ experienceId: "event-one", title: "Circle room", startsAt: "2026-09-19T15:00:00Z" }, { experienceId: "event-two", title: "Gathering", startsAt: null }],
    activity: [{ activityId: "activity-one", subject: "Member One", summary: "Profile updated", occurredAt: "2026-09-14T15:00:00Z", href: "/ops/members/member-one", tone: "complete" }, { activityId: "activity-two", subject: "Recorded activity", summary: "No destination", occurredAt: "invalid", href: null, tone: "neutral" }],
    priorityWork: [{ kind: "workflow_failure", workId: "failure-one", label: "Review delivery", state: "failed" }, { kind: "artifact", workId: "artifact-one", label: "Prepare coin", state: "pending" }, { kind: "task", workId: "task-one", memberId: "member-one", label: "Help member", state: "open" }],
  };
  const before = JSON.stringify(fixture);
  const tree = render(fixture);
  for (const href of ["/ops/support", "/ops/experiences/event-one", "/ops/experiences/event-two", "/ops/members/member-one", "/ops/system", "/ops/artifacts?focus=artifact-one#artifact-artifact-one", "/ops/members/member-one#record"]) assert.ok(link(tree, href), href);
  assert.match(text(tree), /Schedule pending/);
  assert.match(text(tree), /Recorded activityNo destination/);
  assert.equal(JSON.stringify(fixture), before);
});

test("empty data is described honestly and every label target and search action remains accessible", () => {
  const tree = render({ ...data, counts: { ...data.counts, work: { artifacts: 0, failures: 0, tasks: 0 }, eligibleWithoutCircle: 0 } });
  assert.match(text(tree), /No activity recorded in the last 90 days/);
  assert.match(text(tree), /Nothing scheduled/);
  assert.match(text(tree), /No open work/);
  const all = elements(tree);
  const ids = all.map((node) => attr(node, "id")).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  for (const node of all.filter((node) => attr(node, "aria-labelledby"))) assert.ok(ids.includes(attr(node, "aria-labelledby")));
  const search = all.find((node) => attr(node, "role") === "search");
  assert.equal(attr(search, "action"), "/ops/members");
  assert.equal(attr(search, "method"), "get");
  assert.ok(all.some((node) => node.tagName === "label" && attr(node, "for") === "overview-member-search"));
});
