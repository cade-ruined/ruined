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
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { action: "save", entries: [entry], expectedRevision: "12" });
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

test("lost and unreadable successful responses require reconciliation instead of a blind retry", async () => {
  for (const response of [undefined, new Response("truncated", { status: 200 })]) {
    const f = fixture([response]);
    const adapter = f.createTimelinePersistenceAdapter({ preview: false, writable: true });
    await assert.rejects(() => adapter.save([entry], current), f.TimelineSaveUncertainError);
    assert.equal(f.calls.length, 1);
  }
});
