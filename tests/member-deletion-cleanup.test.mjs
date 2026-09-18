import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = id(1), auth = id(2), cleanup = id(3), lease = id(4);
const now = Date.UTC(2026, 8, 18, 12);
const portrait = `${member}/${id(10)}.webp`;
const job = () => ({ member_id: member, auth_user_ids: [auth], storage_objects: [{ bucket: "member-portraits", path: portrait }] });

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => {
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

function provider(initial = {}) {
  const files = new Map(Object.entries(initial).map(([prefix, names]) => [prefix, names.map(name => ({ name, id: `object:${name}` }))]));
  const calls = []; const state = { list: null, remove: null, auth: null };
  const client = {
    storage: { from: bucket => ({
      list: async (prefix, options) => { calls.push({ type: "list", bucket, prefix, options });
        if (state.list) return state.list(bucket, prefix, options);
        return { data: (files.get(`${bucket}/${prefix}`) ?? []).slice(options.offset, options.offset + options.limit), error: null };
      },
      remove: async paths => { calls.push({ type: "remove", bucket, paths });
        if (state.remove) return state.remove(bucket, paths);
        for (const path of paths) { const slash = path.lastIndexOf("/"); const key = `${bucket}/${path.slice(0, slash)}`;
          files.set(key, (files.get(key) ?? []).filter(file => file.name !== path.slice(slash + 1)));
        }
        return { error: null };
      },
    }) },
    auth: { admin: { deleteUser: async (value, softDelete) => { calls.push({ type: "auth", value, softDelete }); return state.auth ? state.auth(value) : { error: null }; } } },
  };
  return { client, calls, state, files };
}

async function fixture(options = {}) {
  const p = options.provider ?? provider(); const calls = []; const pending = [...(options.jobs ?? [])];
  const env = options.env ?? { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-secret" };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const sql = async (strings, ...values) => {
    const query = strings.join("?"); calls.push({ type: "sql", query, values });
    if (query.includes("with candidate as")) return pending.length ? [pending.shift()] : [];
    if (query.includes("as safe")) return [{ safe: options.safe ?? true }];
    const result = []; result.count = query.includes("last_error = null") ? (options.updateCount ?? 1) : 1; return result;
  };
  const core = await load("src/lib/platform/member-deletion-cleanup.ts", {
    "server-only": {}, "node:crypto": { randomUUID: () => lease },
    "@supabase/supabase-js": { createClient: (...args) => { calls.push({ type: "client", args }); return p.client; } },
    "@/lib/database/server": { getApplicationDatabase: () => sql },
  }, { Date: Clock, process: { env } });
  return { ...p, core, workerCalls: calls };
}

test("cleanup validates the entire ownership job before any provider access", async () => {
  const f = await fixture();
  for (const invalid of [null, {}, { ...job(), member_id: "invalid" }, { ...job(), member_id: [member] },
    { ...job(), auth_user_ids: ["not-an-auth-id"] }, { ...job(), auth_user_ids: [[auth]] },
    { ...job(), storage_objects: [job().storage_objects[0], { bucket: "member-portraits", path: `${id(99)}/${id(10)}.webp` }] },
    ...[
      { bucket: "other-bucket", path: portrait }, { bucket: "member-portraits", path: `${member}/../${id(99)}.webp` },
      { bucket: "member-portraits", path: `${member}/${id(10)}.jpg` }, { bucket: "member-journal", path: `${member}/pending/${id(10)}.webp` },
      { bucket: "member-journal", path: `${member}/verified/unknown.webp` }, { bucket: "member-journal", path: `${member}/verified/${id(10)}/extra.webp` },
    ].map(object => ({ ...job(), storage_objects: [object] }))]) {
    await assert.rejects(f.core.cleanupMemberProviderData(f.client, invalid));
    assert.equal(f.calls.length, 0, "invalid ownership must fail before listing, deleting files or deleting Auth");
  }
});

test("cleanup sweeps exact owner directories in deletion batches without pagination skips, then removes Auth", async () => {
  const portraits = Array.from({ length: 205 }, (_, n) => `${id(n + 100)}.webp`);
  const p = provider({ [`member-portraits/${member}`]: portraits,
    [`member-journal/${member}/pending`]: [id(501)], [`member-journal/${member}/verified`]: [`${id(502)}.webp`, `${id(503)}.mp4`, `${id(504)}.webm`],
    [`member-portraits/${id(999)}`]: [`${id(999)}.webp`],
  });
  const f = await fixture({ provider: p });
  await f.core.cleanupMemberProviderData(f.client, { ...job(), storage_objects: [...job().storage_objects,
    { bucket: "member-journal", path: `${member}/pending/${id(501)}` }, { bucket: "member-journal", path: `${member}/verified/${id(503)}.mp4` }] });
  const lists = f.calls.filter(call => call.type === "list"), removes = f.calls.filter(call => call.type === "remove");
  assert.ok(lists.every(call => call.options.offset === 0 && call.options.limit === 100));
  assert.deepEqual(removes.filter(call => call.bucket === "member-portraits").map(call => call.paths.length), [100, 100, 5]);
  assert.equal(removes.flatMap(call => call.paths).length, 209);
  assert.ok(lists.every(call => [member, `${member}/pending`, `${member}/verified`].includes(call.prefix)));
  assert.ok(removes.every(call => call.paths.every(path => path.startsWith(`${member}/`))));
  assert.deepEqual(f.calls.at(-1), { type: "auth", value: auth, softDelete: false });
  assert.equal(f.files.get(`member-portraits/${id(999)}`).length, 1);
});

test("unexpected files, folders, absent listing and removal failures preserve sign-in until retry", async () => {
  for (const response of [{ data: null, error: null }, { data: [{ name: "nested", id: null }], error: null },
    { data: [{ name: "../other.webp", id: "object" }], error: null }, { data: [], error: { code: "ServiceUnavailable" } }]) {
    const f = await fixture(); f.state.list = () => response;
    await assert.rejects(f.core.cleanupMemberProviderData(f.client, job()));
    assert.equal(f.calls.filter(call => call.type === "auth" || call.type === "remove").length, 0);
  }
  const f = await fixture({ provider: provider({ [`member-portraits/${member}`]: [`${id(10)}.webp`] }) });
  f.state.remove = () => ({ error: { code: "StorageError" } });
  await assert.rejects(f.core.cleanupMemberProviderData(f.client, job()), /cleanup failed/);
  assert.equal(f.calls.filter(call => call.type === "auth").length, 0);
  f.state.remove = null;
  await f.core.cleanupMemberProviderData(f.client, job());
  assert.equal(f.calls.filter(call => call.type === "auth").length, 1);
});

test("missing buckets are tolerated only without stored paths and Auth missing is idempotent", async () => {
  const f = await fixture(); f.state.list = () => ({ data: null, error: { code: "NoSuchBucket" } });
  await assert.rejects(f.core.cleanupMemberProviderData(f.client, job()));
  assert.equal(f.calls.filter(call => call.type === "auth").length, 0);
  for (const error of [{ code: "user_not_found" }, { status: 404 }]) {
    f.state.auth = () => ({ error });
    await f.core.cleanupMemberProviderData(f.client, { ...job(), storage_objects: [] });
  }
  f.state.auth = () => ({ error: { status: 500 } });
  await assert.rejects(f.core.cleanupMemberProviderData(f.client, { ...job(), storage_objects: [] }), /sign-in cleanup failed/);
});

test("elapsed cleanup budget stops provider operations", async () => {
  const f = await fixture();
  await assert.rejects(f.core.cleanupMemberProviderData(f.client, job(), now), /time budget/);
  assert.equal(f.calls.length, 0);
});

const queuedJob = (ageMinutes, index = 0) => ({ ...job(), id: index ? id(50 + index) : cleanup, lease_token: lease, created_at: new Date(now - ageMinutes * 60_000) });

test("worker keeps an immediate successful sweep pending until the signed-upload grace period ends", async () => {
  const f = await fixture({ jobs: [queuedJob(0)] });
  assert.deepEqual(await f.core.processMemberDeletionCleanupBatch(1, cleanup), { claimed: 1, completed: 0, deferred: 1, failed: 0 });
  const claim = f.workerCalls.find(call => call.query?.includes("with candidate as"));
  const safety = f.workerCalls.find(call => call.query?.includes("as safe"));
  assert.match(safety.query, /member.deleted_at is not null/);
  assert.match(safety.query, /member_deletion_records/);
  assert.match(safety.query, /person.status = 'erased'/);
  assert.match(claim.query, /for update skip locked/); assert.match(claim.query, /lease_expires_at/);
  assert.deepEqual(claim.values, [cleanup, cleanup, lease]);
  const update = f.workerCalls.find(call => call.query?.includes("last_error = null"));
  assert.equal(update.values[0], "pending"); assert.equal(update.values[1], null);
  assert.equal(update.values[2].getTime(), now + 125 * 60_000);
  assert.deepEqual(update.values.slice(3), [cleanup, lease]);
  assert.match(update.query, /lease_token = .*status = 'processing'/s);
});

test("worker performs the final sweep, bounds batch size, and refuses changed identities", async () => {
  const f = await fixture({ jobs: [1,2,3,4].map(n => queuedJob(126, n)) });
  assert.deepEqual(await f.core.processMemberDeletionCleanupBatch(99), { claimed: 3, completed: 3, deferred: 0, failed: 0 });
  assert.equal(f.calls.filter(call => call.type === "auth").length, 3);
  assert.ok(f.workerCalls.filter(call => call.query?.includes("last_error = null")).every(call => call.values[0] === "completed"));
  const unsafe = await fixture({ jobs: [queuedJob(126)], safe: false });
  assert.deepEqual(await unsafe.core.processMemberDeletionCleanupBatch(1), { claimed: 1, completed: 0, deferred: 0, failed: 1 });
  assert.equal(unsafe.calls.length, 0);
  assert.match(unsafe.workerCalls.find(call => call.query?.includes("as safe")).query, /identity\.status <> 'disabled'/);
});

test("provider errors and a lost lease leave retryable jobs without claiming completion", async () => {
  const f = await fixture({ jobs: [queuedJob(126)] }); f.state.list = () => ({ data: null, error: { status: 500 } });
  assert.deepEqual(await f.core.processMemberDeletionCleanupBatch(1), { claimed: 1, completed: 0, deferred: 0, failed: 1 });
  assert.equal(f.calls.filter(call => call.type === "auth").length, 0);
  const retry = f.workerCalls.find(call => call.query?.includes("Provider cleanup needs retry."));
  assert.match(retry.query, /interval '5 minutes'/); assert.match(retry.query, /lease_token = .*status = 'processing'/s);
  assert.deepEqual(retry.values, [cleanup, lease]);
  const stale = await fixture({ jobs: [queuedJob(126)], updateCount: 0 });
  assert.deepEqual(await stale.core.processMemberDeletionCleanupBatch(1), { claimed: 1, completed: 0, deferred: 0, failed: 1 });
});

test("missing cleanup configuration and invalid selected job ids never reach providers or SQL", async () => {
  const missing = await fixture({ env: {} });
  assert.equal(missing.core.memberDeletionCleanupConfigured(), false);
  assert.deepEqual(await missing.core.processMemberDeletionCleanupBatch(), { claimed: 0, completed: 0, deferred: 0, failed: 0 });
  assert.equal(missing.workerCalls.length, 0);
  const configured = await fixture();
  await assert.rejects(configured.core.processMemberDeletionCleanupBatch(1, "not-a-job"), /Invalid/);
  assert.equal(configured.workerCalls.length, 0);
});
