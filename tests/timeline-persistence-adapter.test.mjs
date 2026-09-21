import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/components/membership/timeline-persistence.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(responses = []) {
  const calls = [];
  const cjs = { exports: {} };
  const fetch = async (...args) => { calls.push(args); return responses.shift(); };
  new Function("module", "exports", "fetch", output)(cjs, cjs.exports, fetch);
  return { ...cjs.exports, calls };
}
const current = { access: {}, completedAt: null, entries: [], revision: "12" };
const entry = { id: null, title: "A beginning", details: null, year: 2020 };

test("Timeline adapter sends the revision it read; conflicts require an explicit reload, never a retry", async () => {
  const latest = { ...current, revision: "14", entries: [{ ...entry, id: "saved", position: 1 }] };
  const f = fixture([Response.json({ error: "Changed in another tab" }, { status: 409 }), Response.json({ timeline: latest })]);
  const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: true });
  await assert.rejects(() => adapter.save([entry], current), f.TimelineConflictError);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { action: "upsert", entry, expectedRevision: "12" });
  assert.deepEqual(current.entries, []);
  assert.deepEqual(await adapter.load(current), latest);
  assert.deepEqual(f.calls[1], ["/api/my/timeline", { cache: "no-store" }]);
});

test("read-only adapter can reload but cannot save or mark complete", async () => {
  const f = fixture([Response.json({ timeline: current })]);
  const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: false });
  assert.deepEqual(await adapter.load(current), current);
  await assert.rejects(() => adapter.save([entry], current), /read-only/);
  await assert.rejects(() => adapter.complete(current), /read-only/);
  assert.equal(f.calls.length, 1);
});

test("preview edits and completion stay in memory and never call the member API", async () => {
  const f = fixture();
  const adapter = f.createTimelinePersistenceAdapter({ preview: true, writable: false });
  const saved = await adapter.save([entry], current);
  assert.equal(saved.revision, "13");
  assert.equal(saved.entries[0].title, entry.title);
  assert.match(saved.entries[0].id, /^preview-/);
  assert.ok((await adapter.complete(saved)).completedAt);
  assert.equal(f.calls.length, 0);
});

test("a failed Timeline request never resolves as a successful save", async () => {
  const f = fixture([Response.json({ error: "Unavailable" }, { status: 503 })]);
  const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: true });
  await assert.rejects(() => adapter.save([entry], current), f.TimelineSaveUncertainError);
  assert.equal(f.calls.length, 1);
});

test("preview month edits and explicit year-only changes survive saved snapshots", async () => {
  const f = fixture();
  const adapter = f.createTimelinePersistenceAdapter({ preview: true, writable: false });
  const saved = await adapter.save([{ ...entry, month: 9 }], current);
  assert.equal(saved.entries[0].month, 9);
  const cleared = await adapter.save([{ ...saved.entries[0], month: null }], saved);
  assert.equal(cleared.entries[0].month, null);
  assert.equal(f.calls.length, 0);
});

test("lost and unreadable successful responses require reconciliation instead of a blind retry", async () => {
  for (const response of [undefined, new Response("truncated", { status: 200 })]) {
    const f = fixture([response]);
    const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: true });
    await assert.rejects(() => adapter.save([entry], current), f.TimelineSaveUncertainError);
    assert.equal(f.calls.length, 1);
  }
});

test("a large Timeline sends only the one changed moment, without client positions or unrelated private details", async () => {
  const entries = Array.from({ length: 150 }, (_, index) => ({ ...entry, id: `saved-${index}`, position: index + 1, details: `${index}:` + "Private".repeat(560), month: index % 12 + 1 }));
  const snapshot = { ...current, entries };
  const f = fixture([Response.json({ timeline: snapshot })]);
  const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: true });
  const changed = entries.map((e, index) => index === 70 ? { ...e, title: "One changed title" } : { ...e, position: 999 - index });
  await adapter.save(changed, snapshot);
  const body = JSON.parse(f.calls[0][1].body);
  assert.equal(body.action, "upsert");
  assert.equal(body.entry.id, "saved-70");
  assert.equal(body.entry.title, "One changed title");
  assert.equal(body.entry.month, entries[70].month);
  assert.equal(body.entry.position, undefined);
  assert.equal(body.entries, undefined);
  assert.ok(f.calls[0][1].body.length < 5_000);
  assert.doesNotMatch(f.calls[0][1].body, /saved-69|saved-71/);
});

test("single deletion is explicit, reorder-only saves are no-ops, and multiple mutations are never sent", async () => {
  const entries = [{ ...entry, id: "a", position: 1, month: 9 }, { ...entry, id: "b", position: 2, month: null }];
  const snapshot = { ...current, entries };
  const f = fixture([Response.json({ timeline: { ...snapshot, entries: [entries[1]] } })]);
  const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: true });
  const oldClient = entries.map(entry => { const old = { ...entry, position: 99 }; delete old.month; return old; });
  assert.equal(await adapter.save(oldClient.reverse(), snapshot), snapshot);
  assert.equal(f.calls.length, 0);
  await adapter.save([entries[1]], snapshot);
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { action: "delete", id: "a", expectedRevision: "12" });
  await assert.rejects(adapter.save([], snapshot), /one moment at a time/);
  await assert.rejects(adapter.save(entries.map(e => ({ ...e, title: "Changed" })), snapshot), /one moment at a time/);
  await assert.rejects(adapter.save([entries[0], entries[0]], snapshot), f.TimelineConflictError);
  assert.equal(f.calls.length, 1);
});

test("single field changes preserve an omitted month and permit explicit null clearing", async () => {
  const existing = { ...entry, id: "saved", position: 12, month: 9 };
  const snapshot = { ...current, entries: [existing] };
  const f = fixture([Response.json({ timeline: snapshot }), Response.json({ timeline: snapshot })]);
  const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: true });
  const { month, ...legacy } = existing;
  assert.equal(month, 9);
  await adapter.save([{ ...legacy, title: "A revised beginning" }], snapshot);
  assert.equal(Object.hasOwn(JSON.parse(f.calls[0][1].body).entry, "month"), false);
  await adapter.save([{ ...existing, month: null }], snapshot);
  assert.equal(JSON.parse(f.calls[1][1].body).entry.month, null);
});

test("preview edits keep durable positions, insert after prior positions and return chronological snapshots", async () => {
  const f = fixture();
  const adapter = f.createTimelinePersistenceAdapter({ preview: true, writable: false });
  const late = await adapter.save([{ ...entry, month: 12 }], current);
  const early = await adapter.save([...late.entries, { ...entry, month: 1 }], late);
  assert.deepEqual(early.entries.map(e => [e.month, e.position]), [[1, 2], [12, 1]]);
  const moved = await adapter.save(early.entries.map(e => e.month === 12 ? { ...e, month: 1 } : e), early);
  assert.deepEqual(moved.entries.map(e => e.position), [1, 2]);
  const removed = await adapter.save([moved.entries[0]], moved);
  const added = await adapter.save([...removed.entries, { ...entry, month: 1 }], removed);
  assert.deepEqual(added.entries.map(e => e.position), [1, 3]);
  assert.equal(f.calls.length, 0);
});
