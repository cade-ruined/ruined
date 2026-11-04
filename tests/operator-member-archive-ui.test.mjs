import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "a" };
    throw new Error(`Unexpected archive UI dependency: ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const flush = () => new Promise(resolve => setImmediate(resolve));
const eligible = (patch = {}) => ({ archivedAt: null, version: 0, memberName: "Example Member", allowed: true, restoreAllowed: false, blockers: [], reason: null, ...patch });
const archived = () => eligible({ archivedAt: "2026-11-04T20:00:00Z", version: 1, allowed: false, restoreAllowed: true, reason: "No longer participating" });

function fixture(props = {}) {
  const slots = [], effects = [], requests = [];
  let cursor = 0, pending = [], refreshes = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) {
      const i = cursor++, previous = effects[i];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) pending.push(() => {
        previous?.cleanup?.(); effects[i] = { deps, cleanup: effect() };
      });
    },
  };
  const View = load("src/components/platform/OperatorMemberArchiveAction.tsx", {
    react: hooks,
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "@/components/platform/operatorStyles": {},
  }).default;
  const draw = () => {
    cursor = 0; pending = [];
    const result = View({ memberId: "member-one", ...props });
    pending.forEach(effect => effect());
    return result;
  };
  const button = label => nodes(draw()).find(node => node.type === "button" && text(node) === label);
  return { draw, button, requests, get refreshes() { return refreshes; },
    reason(value) { nodes(draw()).find(node => node.type === "textarea").props.onChange({ target: { value } }); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}
function requestsFor(t, handler = () => Response.json({ archive: eligible() })) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const request = { url, ...options }; calls.push(request); return handler(request);
  });
  return calls;
}
async function open(f, label = "Archive member") { f.draw(); await flush(); f.button(label).props.onClick(); }

test("archive reads status without mutating; preview never reads or writes member data", async t => {
  const calls = requestsFor(t);
  const f = fixture();
  assert.equal(f.button("Archive member").props.disabled, true);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/ops/members/member-one/archive");
  assert.equal(calls[0].cache, "no-store");
  assert.equal(calls[0].method, undefined);
  f.button("Archive member").props.onClick();
  assert.match(text(f.draw()), /Billing, account access, communications, and saved work stay unchanged/);
  assert.equal(calls.length, 1);
  const preview = fixture({ preview: true });
  await open(preview);
  preview.reason("Just a preview");
  assert.equal(preview.button("Confirm archive").props.disabled, true);
  await preview.button("Confirm archive").props.onClick();
  assert.match(text(preview.draw()), /Preview only/);
  assert.equal(calls.length, 1);
});

test("blocked archive and restore states never expose an enabled confirmation, including absent blockers", async t => {
  let current = eligible({ allowed: false, blockers: ["Resolve current billing before archiving."] });
  const calls = requestsFor(t, () => Response.json({ archive: current }));
  for (const state of [current, eligible({ allowed: true, blockers: current.blockers }), eligible({ allowed: false }), { ...archived(), restoreAllowed: false, blockers: [] }]) {
    current = state;
    const f = fixture();
    await open(f, current.archivedAt ? "Restore to members" : "Archive member");
    const action = f.button(current.archivedAt ? "Confirm restore" : "Confirm archive");
    assert.ok(!action || action.props.disabled, "ineligible states must not enable confirmation");
    if (state.blockers.length) assert.match(text(f.draw()), /Resolve current billing/);
  }
  assert.equal(calls.some(call => call.method === "POST"), false);
});

test("archiving requires a reason and explicit confirmation; one pending click sends only one write", async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const calls = requestsFor(t, request => request.method === "POST" ? pending : Response.json({ archive: eligible() }));
  const f = fixture();
  await open(f);
  assert.equal(f.button("Confirm archive").props.disabled, true);
  await f.button("Confirm archive").props.onClick();
  f.reason("   "); await f.button("Confirm archive").props.onClick();
  assert.equal(calls.length, 1);
  f.reason("x"); await f.button("Confirm archive").props.onClick();
  assert.equal(calls.length, 1);
  f.reason("  No longer participating  ");
  assert.equal(f.button("Confirm archive").props.disabled, false);
  const action = f.button("Confirm archive").props.onClick;
  const first = action(); await action();
  assert.equal(calls.length, 2);
  assert.equal(f.refreshes, 0);
  assert.deepEqual(JSON.parse(calls[1].body), { action: "archive", reason: "No longer participating", expectedVersion: 0 });
  assert.equal(calls[1].headers["Content-Type"], "application/json");
  assert.equal(f.button("Saving…").props.disabled, true);
  assert.equal(nodes(f.draw()).find(node => node.type === "textarea").props.disabled, true);
  resolve(Response.json({ archive: archived() })); await first;
  assert.equal(f.refreshes, 1);
  assert.match(text(f.draw()), /Moved to Archived/);
  assert.equal(nodes(f.draw()).find(node => node.type === "a").props.href, "/ops/members?archive=archived");
  assert.ok(f.button("Restore to members"));
});

test("restoring uses the existing archive version and only succeeds after confirmation", async t => {
  const calls = requestsFor(t, request => Response.json({ archive: request.method === "POST" ? eligible({ version: 2 }) : archived() }));
  const f = fixture();
  await open(f, "Restore to members");
  assert.match(text(f.draw()), /Reason: No longer participating/);
  assert.match(text(f.draw()), /Return this record to the current member list/);
  assert.equal(calls.length, 1);
  assert.equal(nodes(f.draw()).some(node => node.type === "textarea"), false);
  await f.button("Confirm restore").props.onClick();
  assert.deepEqual(JSON.parse(calls[1].body), { action: "restore", reason: "Restored to the current member list.", expectedVersion: 1 });
  assert.match(text(f.draw()), /Restored to the member list/);
  assert.ok(f.button("Archive member"));
  assert.equal(f.refreshes, 1);
});

test("failed status reads and failed saves show errors without claiming completion", async t => {
  let mode = "read";
  const calls = requestsFor(t, request => mode === "read" || request.method === "POST"
    ? Response.json({ error: "The member changed. Refresh the record." }, { status: 409 })
    : Response.json({ archive: eligible() }));
  const denied = fixture(); denied.draw(); await flush();
  assert.match(text(denied.draw()), /member changed/);
  assert.equal(denied.button("Archive member").props.disabled, true);
  mode = "save";
  const f = fixture(); await open(f); f.reason("No longer participating");
  await f.button("Confirm archive").props.onClick();
  assert.match(text(f.draw()), /member changed/);
  assert.doesNotMatch(text(f.draw()), /Moved to Archived|Restored to the member list/);
  assert.equal(f.refreshes, 0);
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
});

test("malformed archive responses fail closed", async t => {
  let response = { archive: {} };
  const calls = requestsFor(t, request => request.method === "POST" ? Response.json({ archive: {} }) : Response.json(response));
  const invalid = fixture(); invalid.draw(); await flush();
  assert.equal(invalid.button("Archive member").props.disabled, true);
  assert.equal(invalid.refreshes, 0);
  response = { archive: eligible() };
  const f = fixture(); await open(f); f.reason("No longer participating");
  await f.button("Confirm archive").props.onClick();
  assert.equal(f.refreshes, 0);
  assert.doesNotMatch(text(f.draw()), /Moved to Archived|Restored to the member list/);
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
});

test("unmount aborts the pending archive read", async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const calls = requestsFor(t, () => pending);
  const f = fixture(); f.draw(); f.unmount();
  assert.equal(calls[0].signal.aborted, true);
  resolve(Response.json({ archive: archived() })); await flush();
  assert.equal(f.button("Restore to members"), undefined);
});

test("member records show archive controls only to administrators, preserving preview mode", () => {
  const blank = { __esModule: true, default: () => null };
  const Archive = () => null;
  const dependencies = {
    "@/lib/membership/operator-registration-progress": load("src/lib/membership/operator-registration-progress.ts"),
    "@/lib/platform/operator-return-location": load("src/lib/platform/operator-return-location.ts"),
    "@/lib/platform/operator-member-guidance": load("src/lib/platform/operator-member-guidance.ts"),
    "@/components/platform/OperatorMemberActions": { OperatorNoteAction: () => null, OperatorTaskCreateAction: () => null, OperatorOverrideAction: () => null },
    "@/components/platform/OperatorMemberArchiveAction": { __esModule: true, default: Archive },
  };
  for (const name of ["OperatorMemberDeleteAction", "OperatorSavedMemberPayment", "OperatorMemberCheckout", "OperatorMemberPaymentMethod", "OperatorMemberCheckpoints", "CirclePlacementRecommendations", "OperatorPageFrame", "OperatorMemberSetup", "OperatorProfileSupport", "OperatorProgress", "OperatorMemberAvatar", "OperatorMemberReferrals", "OperatorMemberWorkspace", "StateLabel"]) dependencies[`@/components/platform/${name}`] = blank;
  const Record = load("src/components/platform/OperatorMemberRecord.tsx", dependencies).default;
  const record = load("src/lib/platform/ops-preview.ts").getPreviewOpsMemberRecord("preview-01");
  for (const role of ["ops_admin", "guide", "circle_leader"]) {
    const tree = Record({ record: { ...record, access: { ...record.access, roles: [role] } }, preview: true });
    const panels = nodes(tree).filter(node => node.type === Archive);
    assert.equal(panels.length, role === "ops_admin" ? 1 : 0);
    if (panels[0]) assert.deepEqual(panels[0].props, { memberId: record.header.memberId, preview: true });
  }
});
