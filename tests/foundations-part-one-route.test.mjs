import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, logs = []) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected Part I page dependency: ${name}`);
  }, cjsModule, cjsModule.exports, { error: (...args) => logs.push(args) });
  return cjsModule.exports;
}

const Worksheet = () => null;
const Unavailable = () => null;
const AccessNotice = () => null;
const viewer = { authUserId: "11111111-1111-4111-8111-111111111111" };
const timeline = { entries: [], revision: "timeline-r1" };
const previewTimeline = { entries: [], revision: "preview" };
const accessUrl = "/access?returnTo=%2Fmy%2Ffoundations%2Ftimeline%2Fpart-1";

function fixture({ state = "authenticated", launched = true, writable = true, revisit = true, failure = false } = {}) {
  const reads = [], logs = [];
  const page = load("app/my/foundations/timeline/part-1/page.tsx", {
    "next/navigation": { redirect: (href) => { throw Object.assign(Error("Redirect"), { href }); } },
    "@/components/membership/FoundationsTimelineWorksheet": Worksheet,
    "@/components/membership/MemberAccessNotice": AccessNotice,
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/auth/support-return": load("src/lib/auth/support-return.ts"),
    "@/lib/foundations/availability": { isFoundationsAvailableToMember: async (id) => { reads.push(["availability", id]); return launched; } },
    "@/lib/membership/access-policy": {
      deriveMemberAccessPolicy: () => ({ active: writable }),
      memberCan: (_access, action) => action === "foundations.write" ? writable : revisit,
    },
    "@/lib/membership/page-context": { getMembershipPageContext: async () => ({ state, data: ["authenticated", "preview"].includes(state) ? { member: true } : null, viewer: state === "authenticated" ? viewer : null }) },
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: {}, PREVIEW_MEMBER_TIMELINE: previewTimeline },
    "@/lib/membership/repository": {
      getMemberIdentity: () => null,
      getMemberTimeline: async (id) => { reads.push(["timeline", id]); if (failure) throw Error("PRIVATE content"); return timeline; },
    },
  }, logs);
  return { page: page.default, reads, logs };
}

test("Part I keeps its destination through sign-in and never loads private moments for an absent identity", async () => {
  const signedOut = fixture({ state: "signed_out" });
  await assert.rejects(signedOut.page(), { href: accessUrl });
  assert.deepEqual(signedOut.reads, []);
  for (const state of ["denied", "unavailable"]) {
    const f = fixture({ state });
    const tree = await f.page();
    assert.equal(tree.type, Unavailable);
    assert.deepEqual(f.reads, []);
  }
});

test("Part I preserves launch and read/write membership gates before reading the Timeline", async () => {
  const closed = fixture({ launched: false });
  await assert.rejects(closed.page(), { href: "/my/foundations" });
  assert.deepEqual(closed.reads, [["availability", viewer.authUserId]]);
  const denied = fixture({ writable: false, revisit: false });
  assert.equal((await denied.page()).type, AccessNotice);
  assert.deepEqual(denied.reads, [["availability", viewer.authUserId]]);
  for (const writable of [false, true]) {
    const f = fixture({ writable });
    const tree = await f.page();
    assert.equal(tree.type, Worksheet);
    assert.deepEqual(tree.props, { initialTimeline: timeline, writable, ownerId: viewer.authUserId });
    assert.deepEqual(f.reads, [["availability", viewer.authUserId], ["timeline", viewer.authUserId]]);
  }
});

test("Part I preview stays read-only and a data failure reveals no journal content", async () => {
  const preview = fixture({ state: "preview" });
  assert.deepEqual((await preview.page()).props, { initialTimeline: previewTimeline, preview: true, writable: false });
  assert.deepEqual(preview.reads, [["availability", null]]);
  const failed = fixture({ failure: true });
  assert.equal((await failed.page()).type, Unavailable);
  assert.doesNotMatch(JSON.stringify(failed.logs), /PRIVATE/);
});
