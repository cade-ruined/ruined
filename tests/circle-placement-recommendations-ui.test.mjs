import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compiled = new Map();
const blank = () => null;
function load(path, dependencies = {}, request = () => { throw new Error("Unexpected network request"); }) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText);
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled.get(path))(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "./operatorStyles") return load("src/components/platform/operatorStyles.ts");
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "@/components/platform/OperatorPageFrame" || name === "@/components/platform/OperatorMemberWorkspace") return { __esModule: true, default: ({ children }) => React.createElement("div", null, children) };
    if (name === "@/components/platform/OperatorMemberActions") return { OperatorNoteAction: blank, OperatorTaskCreateAction: blank, OperatorOverrideAction: blank };
    if (name.startsWith("@/components/platform/")) return { __esModule: true, default: blank };
    if (name.startsWith("@/lib/platform/")) return load(`${name.replace("@/", "src/")}.ts`);
    throw new Error(`Unexpected dependency ${name}`);
  }, mod, mod.exports, request);
  return mod.exports;
}
const candidate = (overrides = {}) => ({ circleId: "circle-one", name: "North Circle", activeMembers: 8, score: 55, reasons: ["Below the target of 10 people"], exceptionRequired: false, inviterPresent: false, preferredConnectionPresent: false, ...overrides });
const snapshot = (memberId = "member-one", overrides = {}) => ({ recommendations: [candidate()], context: { memberId, inviter: null, preferredConnection: null, requiredPartnerCircle: null }, ...overrides });
const connection = (overrides = {}) => ({ memberId: "inviter-one", name: "Taylor Inviter", status: "available", circleId: "circle-one", circleName: "North Circle", circles: [{ circleId: "circle-one", name: "North Circle", relationship: "member" }], boundAt: "2026-10-01T00:00:00Z", joinedAt: "2026-10-02T00:00:00Z", ...overrides });
const response = data => ({ ok: true, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

function fixture({ props: initial = {}, respond = () => response(snapshot()) } = {}) {
  const slots = [], effects = [], calls = [];
  let props = { memberId: "member-one", ...initial }, cursor = 0, effectCursor = 0, dirty = false;
  const hooks = { ...React,
    useState(initialValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }];
    },
    useEffect(callback, dependencies) {
      const index = effectCursor++, previous = effects[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) effects[index] = { callback, dependencies, pending: true, cleanup: previous?.cleanup };
    },
  };
  const Component = load("src/components/platform/CirclePlacementRecommendations.tsx", { react: hooks }, async (url, options) => {
    calls.push({ url, options });
    return respond(url, options, calls.length);
  }).default;
  return {
    calls,
    draw(nextProps = {}, commit = true) {
      props = { ...props, ...nextProps };
      let tree, passes = 0;
      do {
        assert.ok(++passes < 10, "effects settle without a render loop");
        dirty = false; cursor = 0; effectCursor = 0; tree = Component(props);
        if (commit) for (const effect of effects.filter(item => item.pending)) { effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.callback(); }
      } while (commit && dirty);
      return tree;
    },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
  };
}

test("inline recommendations stay collapsed and lazy; opening only reads and closing cancels", async () => {
  const pending = deferred();
  const f = fixture({ respond: () => pending.promise });
  let tree = f.draw();
  assert.equal(tree.type, "details");
  assert.equal(f.calls.length, 0);
  assert.doesNotMatch(renderToStaticMarkup(tree), /Loading/);
  tree.props.onToggle({ currentTarget: { open: true } });
  tree = f.draw();
  assert.match(renderToStaticMarkup(tree), /Loading placement suggestions/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.method, undefined);
  assert.equal(f.calls[0].options.cache, "no-store");
  tree.props.onToggle({ currentTarget: { open: false } });
  f.draw();
  assert.equal(f.calls[0].options.signal.aborted, true);
  pending.resolve(response(snapshot())); await settle();
  assert.doesNotMatch(renderToStaticMarkup(f.draw()), /North Circle/);
});

test("member panel loads visibly, names inviter and preferred connection, and retains connected Circles beyond the first five", async () => {
  const data = snapshot("member & one", {
    recommendations: [...Array.from({ length: 5 }, (_, i) => candidate({ circleId: `rank-${i}`, name: `Other Circle ${i}` })), candidate({ circleId: "circle & one", inviterPresent: true, preferredConnectionPresent: true, exceptionRequired: true, activeMembers: 12 })],
    context: { memberId: "member & one", inviter: connection(), preferredConnection: connection({ name: "Casey Preferred", memberId: "preferred-one" }), requiredPartnerCircle: null },
  });
  const f = fixture({ props: { memberId: "member & one", display: "member" }, respond: () => response(data) });
  assert.equal(f.draw().type, "section");
  assert.equal(f.calls[0].url, "/api/ops/circle-recommendations?memberId=member%20%26%20one");
  await settle();
  const tree = f.draw(), markup = renderToStaticMarkup(tree);
  for (const label of ["Invited by", "Taylor Inviter", "Member · North Circle", "Preferred connection", "Casey Preferred", "Inviter’s Circle", "Capacity exception required", "Administrator review before placement"]) assert.ok(markup.includes(label), label);
  assert.doesNotMatch(markup, /<details|<summary|Place member|Assign member/);
  const reviewLinks = nodes(tree).filter(node => node.props?.href);
  assert.equal(reviewLinks.length, 6);
  assert.ok(reviewLinks.some(node => node.props.href === "/ops/circles?circleId=circle%20%26%20one&memberId=member%20%26%20one"));
  assert.equal(f.calls.length, 1);
});

test("partner requirements remain explicit and inviter context cannot introduce a non-candidate placement link", async () => {
  const data = snapshot("member-one", {
    recommendations: [candidate({ circleId: "partner-circle", name: "Partner Circle" })],
    context: { memberId: "member-one", inviter: connection(), preferredConnection: null, requiredPartnerCircle: { circleId: "partner-circle", name: "Partner Circle" } },
  });
  const f = fixture({ props: { display: "member" }, respond: () => response(data) });
  f.draw(); await settle();
  const tree = f.draw(), markup = renderToStaticMarkup(tree);
  assert.match(markup, /Required partner Circle/);
  assert.match(markup, /must join their partner’s Circle/);
  assert.match(markup, /Taylor Inviter/);
  assert.deepEqual(nodes(tree).filter(node => node.props?.href).map(node => node.props.href), ["/ops/circles?circleId=partner-circle&memberId=member-one"]);
});

test("changing members clears old names before effects and aborts or ignores stale requests", async () => {
  const oldRequest = deferred(), newRequest = deferred();
  const f = fixture({ props: { display: "member" }, respond: (_url, _options, count) => count === 1 ? oldRequest.promise : newRequest.promise });
  f.draw();
  oldRequest.resolve(response(snapshot("member-one", { context: { memberId: "member-one", inviter: connection(), preferredConnection: null, requiredPartnerCircle: null } })));
  await settle(); assert.match(renderToStaticMarkup(f.draw()), /Taylor Inviter/);
  const immediate = renderToStaticMarkup(f.draw({ memberId: "member-two" }, false));
  assert.doesNotMatch(immediate, /Taylor Inviter|North Circle/);
  assert.match(immediate, /Loading placement suggestions/);
  f.draw();
  assert.equal(f.calls[0].options.signal.aborted, true);
  newRequest.resolve(response(snapshot("member-two", { recommendations: [candidate({ name: "South Circle" })] })));
  await settle(); assert.match(renderToStaticMarkup(f.draw()), /South Circle/);
  f.unmount(); assert.equal(f.calls[1].options.signal.aborted, true);

  const late = deferred(), newest = deferred();
  const raced = fixture({ props: { display: "member" }, respond: (_url, _options, count) => count === 1 ? late.promise : newest.promise });
  raced.draw(); raced.draw({ memberId: "member-two" });
  newest.resolve(response(snapshot("member-two", { recommendations: [candidate({ name: "Newest Circle" })] })));
  await settle();
  late.resolve(response(snapshot("member-one", { recommendations: [candidate({ name: "Stale Circle" })] })));
  await settle();
  const result = renderToStaticMarkup(raced.draw());
  assert.match(result, /Newest Circle/); assert.doesNotMatch(result, /Stale Circle/);
});

test("failed requests offer retry and empty results explain that no placement is available", async () => {
  const f = fixture({ props: { display: "member" }, respond: (_url, _options, count) => count === 1 ? { ok: false, json: async () => ({ error: "Please retry this lookup." }) } : response(snapshot("member-one", { recommendations: [] })) });
  f.draw(); await settle();
  let tree = f.draw();
  assert.match(renderToStaticMarkup(tree), /role="alert"[^>]*>Please retry this lookup/);
  nodes(tree).find(node => node.type === "button").props.onClick();
  f.draw(); await settle(); tree = f.draw();
  assert.equal(f.calls.length, 2);
  assert.match(renderToStaticMarkup(tree), /No eligible Circles are available/);
  assert.equal(nodes(tree).filter(node => node.props?.href).length, 0);
});

test("a mismatched member response fails closed instead of showing another member's connections", async () => {
  const f = fixture({ props: { display: "member" }, respond: () => response(snapshot("wrong-member", { context: { memberId: "wrong-member", inviter: connection({ name: "Wrong Inviter" }) } })) });
  f.draw(); await settle();
  const markup = renderToStaticMarkup(f.draw());
  assert.match(markup, /could not be loaded/); assert.doesNotMatch(markup, /Wrong Inviter|North Circle/);
});

test("connection states distinguish inactive, unavailable, absent and multiple current Circles", async () => {
  for (const [status, message] of [["inactive", "not currently active"], ["circle_unavailable", "not available for placement"], ["no_circle", "No current Circle"], ["multiple_circles", "More than one current Circle"]]) {
    const inviter = connection({ name: "Inviter <script>alert(1)</script>", status, circles: status === "multiple_circles" ? [{ circleId: "north", name: "North Circle", relationship: "supporter" }, { circleId: "south", name: "South Circle", relationship: "member" }] : [] });
    const f = fixture({ props: { display: "member" }, respond: () => response(snapshot("member-one", { recommendations: [], context: { memberId: "member-one", inviter, preferredConnection: null, requiredPartnerCircle: null } })) });
    f.draw(); await settle();
    const markup = renderToStaticMarkup(f.draw());
    assert.ok(markup.includes(message)); assert.doesNotMatch(markup, /<script/);
    if (status === "multiple_circles") { assert.match(markup, /Circle Supporter · North Circle/); assert.match(markup, /Member · South Circle/); }
  }
});

test("preview only uses passed active/forming Circles and never invents invitation evidence or sends requests", () => {
  const circles = [{ id: "actual-preview-one", name: "Actual preview Circle", activeMembers: 12, status: "active" }, { id: "forming", name: "Forming Circle", activeMembers: 4, status: "forming" }, { id: "retired", name: "Retired Circle", activeMembers: 1, status: "retired" }];
  const f = fixture({ props: { display: "member", preview: true, previewCircles: circles } });
  let tree = f.draw(), markup = renderToStaticMarkup(tree);
  assert.match(markup, /capacity examples from these preview Circles/);
  assert.match(markup, /Actual preview Circle/); assert.match(markup, /Forming Circle/);
  assert.match(markup, /Capacity exception required/);
  assert.doesNotMatch(markup, /Retired Circle|Invited by|Inviter’s Circle|A known connection/);
  assert.equal(f.calls.length, 0);
  assert.ok(nodes(tree).some(node => node.props?.href === "/ops/circles?circleId=actual-preview-one&memberId=member-one"));
  tree = f.draw({ previewCircles: [] }); markup = renderToStaticMarkup(tree);
  assert.match(markup, /No eligible Circles/); assert.doesNotMatch(markup, /Actual preview Circle/);
});

test("the member Overview exposes placement only to administrators and preserves preview Circle identities", () => {
  const Placement = () => null;
  const Record = load("src/components/platform/OperatorMemberRecord.tsx", { "@/lib/membership/operator-registration-progress": load("src/lib/membership/operator-registration-progress.ts"), "@/components/platform/CirclePlacementRecommendations": { __esModule: true, default: Placement } }).default;
  const preview = load("src/lib/platform/ops-preview.ts");
  const record = preview.getPreviewOpsMemberRecord("preview-03");
  const tree = Record({ record, preview: true, previewCircles: preview.PREVIEW_OPS_CIRCLES });
  const overview = nodes(tree).find(node => node.props?.id === "overview");
  const panel = nodes(overview).find(node => node.type === Placement);
  assert.ok(panel);
  assert.equal(panel.props.display, "member");
  assert.equal(panel.props.memberId, record.header.memberId);
  assert.equal(panel.props.previewCircles, preview.PREVIEW_OPS_CIRCLES);
  for (const role of ["guide", "circle_leader"]) assert.equal(nodes(Record({ record: { ...record, access: { ...record.access, roles: [role] } } })).some(node => node.type === Placement), false);
});
