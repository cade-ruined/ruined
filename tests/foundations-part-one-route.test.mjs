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
  const runtime = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected Timeline page dependency: ${name}`);
  }, runtime, runtime.exports, { error: (...args) => logs.push(args) });
  return runtime.exports;
}
const redirect = href => { throw Object.assign(Error("Redirect"), { href }); };
const Editor = () => null, Unavailable = () => null, AccessNotice = () => null;
class JournalError extends Error { constructor(status, message) { super(message); this.status = status; } }
const viewer = { authUserId: "11111111-1111-4111-8111-111111111111" };
const snapshot = { entries: [], writable: true, mediaReady: true, hasMore: false };
function fixture({ state = "authenticated", readable = true, failure = false, selected = null } = {}) {
  const reads = [], logs = [];
  const page = load("src/components/membership/GuidedTimelinePage.tsx", {
    "next/navigation": { redirect }, "./GuidedTimeline": Editor, "./MemberAccessNotice": AccessNotice,
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/auth/support-return": load("src/lib/auth/support-return.ts"),
    "@/lib/membership/access-policy": { deriveMemberAccessPolicy: () => ({}), memberCan: () => readable },
    "@/lib/membership/page-context": { getMembershipPageContext: async () => ({ state, data: ["authenticated", "preview"].includes(state) ? {} : null, viewer: state === "authenticated" ? viewer : null }) },
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: {} },
    "@/lib/membership/repository": { getMemberIdentity: () => null },
    "@/lib/membership/guided-timeline-preview": { GUIDED_TIMELINE_PREVIEW: snapshot },
    "@/lib/membership/journal-model": { JournalError },
    "@/lib/membership/journal-repository": {
      getJournal: async (...args) => { reads.push(["list", ...args]); if (failure) throw Error("PRIVATE ENTRY CONTENT"); return { ...snapshot, entries: [] }; },
      getJournalEntry: async (...args) => { reads.push(["entry", ...args]); if (!selected) throw new JournalError(404, "Not found"); return selected; },
    },
  }, logs).default;
  return { page, reads, logs };
}

test("Foundations links resolve to the same public Timeline editor and preserve the chosen moment", async () => {
  const page = load("app/my/foundations/timeline/part-1/page.tsx", { "next/navigation": { redirect } }).default;
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), { href: "/my/timeline" });
  await assert.rejects(page({ searchParams: Promise.resolve({ new: "1" }) }), { href: "/my/timeline/new" });
  await assert.rejects(page({ searchParams: Promise.resolve({ moment: "entry-id" }) }), { href: "/my/timeline?moment=entry-id" });
  const overview = load("app/my/foundations/timeline/page.tsx", { "next/navigation": { redirect } }).default;
  assert.throws(overview, { href: "/my/timeline" });
});

test("public Timeline authoring keeps sign-in destination and rejects unavailable identities before reads", async () => {
  const f = fixture({ state: "signed_out" });
  await assert.rejects(f.page({ startNew: true }), { href: "/access?returnTo=%2Fmy%2Ftimeline%2Fnew" });
  assert.deepEqual(f.reads, []);
  for (const state of ["denied", "unavailable"]) {
    const f = fixture({ state }); assert.equal((await f.page({})).type, Unavailable); assert.deepEqual(f.reads, []);
  }
  const denied = fixture({ readable: false });
  assert.equal((await denied.page({})).type, AccessNotice); assert.deepEqual(denied.reads, []);
});

test("Timeline authoring uses profile access and owner-scoped Journal persistence", async () => {
  const f = fixture(); const tree = await f.page({ startNew: true });
  assert.equal(tree.type, Editor); assert.equal(tree.props.ownerId, viewer.authUserId); assert.equal(tree.props.startNew, true);
  assert.deepEqual(f.reads, [["list", viewer.authUserId, null, false, { view: "timeline", order: "newest" }]]);
});

test("a selected moment beyond the first page is resolved for the owner without substituting a missing entry", async () => {
  const entry = { id: "selected", includeOnTimeline: true, visibility: "private" };
  const f = fixture({ selected: entry }); const tree = await f.page({ moment: entry.id });
  assert.deepEqual(tree.props.initialJournal.entries, [entry]); assert.equal(tree.props.initialEntryId, entry.id);
  assert.deepEqual(f.reads.at(-1), ["entry", viewer.authUserId, entry.id]);
  const missing = await fixture().page({ moment: "missing" });
  assert.deepEqual(missing.props.initialJournal.entries, []); assert.equal(missing.props.initialEntryId, "missing");
});

test("Timeline preview is isolated and failures never log private entry content", async () => {
  const preview = fixture({ state: "preview" }); const tree = await preview.page({});
  assert.equal(tree.props.preview, true); assert.deepEqual(preview.reads, []);
  const failed = fixture({ failure: true }); assert.equal((await failed.page({})).type, Unavailable);
  assert.doesNotMatch(JSON.stringify(failed.logs), /PRIVATE ENTRY CONTENT/);
});
