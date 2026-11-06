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
function fixture({ state = "authenticated", readable = true, failure = false, selected = null, resume = null } = {}) {
  const reads = [], logs = [];
  const page = load("src/components/membership/GuidedTimelinePage.tsx", {
    "next/navigation": { redirect }, "./GuidedTimeline": Editor, "./MemberAccessNotice": AccessNotice,
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/auth/support-return": load("src/lib/auth/support-return.ts"),
    "@/lib/membership/access-policy": { deriveMemberAccessPolicy: () => ({}), memberCan: () => readable },
    "@/lib/membership/page-context": { getMembershipPageContext: async () => ({ state, data: ["authenticated", "preview"].includes(state) ? {} : null, viewer: state === "authenticated" ? viewer : null }) },
    "@/lib/membership/preview": { PREVIEW_MEMBER_IDENTITY: {} },
    "@/lib/membership/repository": { getMemberIdentity: () => null },
    "@/lib/practice/timeline-draft-handoff": { getPracticeTimelineResume: async (...args) => { reads.push(["resume", ...args]); return resume; } },
    "@/lib/membership/guided-timeline-preview": { GUIDED_TIMELINE_PREVIEW: snapshot },
    "@/lib/membership/journal-model": { JournalError },
    "@/lib/membership/journal-repository": {
      getJournal: async (...args) => { reads.push(["list", ...args]); if (failure) throw Error("PRIVATE ENTRY CONTENT"); return { ...snapshot, entries: [] }; },
      getJournalEntry: async (...args) => { reads.push(["entry", ...args]); if (!selected) throw new JournalError(404, "Not found"); return selected; },
    },
  }, logs).default;
  return { page, reads, logs };
}

test("Foundations work links open the assignment while preserving explicit historical moments", async () => {
  const page = load("app/my/foundations/timeline/part-1/page.tsx", { "next/navigation": { redirect } }).default;
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), { href: "/my/practice?course=f1" });
  await assert.rejects(page({ searchParams: Promise.resolve({ new: "1" }) }), { href: "/my/practice?course=f1" });
  await assert.rejects(page({ searchParams: Promise.resolve({ moment: "entry-id" }) }), { href: "/my/timeline?moment=entry-id" });
  const overview = load("app/my/foundations/timeline/page.tsx", { "next/navigation": { redirect } }).default;
  await assert.rejects(overview({}), { href: "/my/practice?course=f1" });
  await assert.rejects(overview({ searchParams: Promise.resolve({ moment: "entry-id" }) }), { href: "/my/timeline?moment=entry-id" });
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


test("Timeline route enables the Foundations context only for an exact F1 query", async () => {
  const newPage = load("app/my/timeline/new/page.tsx", { "@/components/membership/GuidedTimelinePage": Editor }).default;
  const existingPage = load("app/my/timeline/page.tsx", { "@/components/membership/GuidedTimelinePage": Editor }).default;
  const fresh = await newPage({ searchParams: Promise.resolve({ practice: "f1", resume: "1" }) });
  assert.equal(fresh.props.startNew, true);
  assert.equal(fresh.props.practice, true);
  assert.equal(fresh.props.resumePracticeDraft, true);
  const existing = await existingPage({ searchParams: Promise.resolve({ moment: "my-entry", practice: "f1" }) });
  assert.equal(existing.props.moment, "my-entry");
  assert.equal(existing.props.practice, true);
  assert.equal(existing.props.resumePracticeDraft, false);
  const invalid = await newPage({ searchParams: Promise.resolve({ practice: "someone-else", resume: "1" }) });
  assert.equal(invalid.props.practice, false);
  assert.equal(invalid.props.resumePracticeDraft, false);
});

test("resuming Work preserves sign-in destination and never reads owner writing before access", async () => {
  const signedOut = fixture({ state: "signed_out" });
  await assert.rejects(signedOut.page({ startNew: true, practice: true, resumePracticeDraft: true }), { href: "/access?returnTo=%2Fmy%2Ftimeline%2Fnew%3Fpractice%3Df1%26resume%3D1" });
  assert.deepEqual(signedOut.reads, []);
  const denied = fixture({ readable: false });
  assert.equal((await denied.page({ practice: true, resumePracticeDraft: true })).type, AccessNotice);
  assert.deepEqual(denied.reads, []);
  const preview = fixture({ state: "preview" });
  const tree = await preview.page({ startNew: true, practice: true, resumePracticeDraft: true });
  assert.equal(tree.props.practice, true);
  assert.equal(tree.props.initialWorkDraft, undefined);
  assert.deepEqual(preview.reads, []);
});

test("a Work resume loads only the signed-in member's private draft and preserves its stable ID", async () => {
  const draft = { id: null, year: null, title: "Unfinished", details: "Still private", meaning: "", presentImpact: "" };
  const resume = { draft, revision: "7", entryId: "stable-draft-id", sourceEntry: null, savedEntry: null };
  const f = fixture({ resume });
  const tree = await f.page({ practice: true, resumePracticeDraft: true, startNew: true });
  assert.equal(tree.props.startNew, true);
  assert.equal(tree.props.initialEntryId, undefined);
  assert.deepEqual(tree.props.initialWorkDraft, { draft, revision: "7", entryId: "stable-draft-id", newerSavedVersion: false });
  assert.deepEqual(f.reads.at(-1), ["resume", viewer.authUserId]);
  const ordinary = fixture({ resume });
  const ordinaryTree = await ordinary.page({ practice: true, startNew: true });
  assert.equal(ordinaryTree.props.initialWorkDraft, undefined);
  assert.equal(ordinary.reads.some(read => read[0] === "resume"), false, "starting a separate post cannot silently import prior work");
});

test("a saved version from earlier recovery takes precedence while preserving the older Work draft for explicit review", async () => {
  const draft = { id: "original-entry", year: 2008, title: "Older draft", details: "Older words", meaning: "", presentImpact: "" };
  const sourceEntry = { id: "original-entry", visibility: "private", includeOnTimeline: true, body: "Original words" };
  const savedEntry = { ...sourceEntry, body: "A newer published version", visibility: "public" };
  const f = fixture({ resume: { draft, revision: "8", entryId: sourceEntry.id, sourceEntry, savedEntry } });
  const tree = await f.page({ practice: true, resumePracticeDraft: true, startNew: true });
  assert.equal(tree.props.startNew, false);
  assert.equal(tree.props.initialEntryId, savedEntry.id);
  assert.deepEqual(tree.props.initialJournal.entries, [savedEntry]);
  assert.equal(tree.props.initialWorkDraft.newerSavedVersion, true);
  assert.equal(tree.props.initialWorkDraft.draft.details, "Older words");
});

test("Timeline sign-in return accepts only bounded local authoring context", () => {
  const { getAccessReturnTo } = load("src/lib/auth/support-return.ts");
  const moment = "11111111-1111-4111-8111-111111111111";
  for (const path of [`/my/timeline?moment=${moment}&practice=f1`, "/my/timeline/new?practice=f1&resume=1", "/my/timeline/new?practice=f1"]) assert.equal(getAccessReturnTo(path), path);
  for (const path of ["https://evil.example/my/timeline?practice=f1", "//evil.example/my/timeline?practice=f1", "/my/timeline?returnTo=https://evil.example", "/my/timeline?practice=f1&practice=f1", "/my/timeline?resume=1", "/my/timeline?practice=f4", "/my/timeline?moment=private-text", "/my/timeline?practice=f1#outside", "/my/timeline?practice=%0af1", "/my/timeline?", "/my/timeline?" + "a".repeat(250)]) assert.equal(getAccessReturnTo(path), null, path);
});
