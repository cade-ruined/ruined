import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected registration worker dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("shared BYOB registration sheet delivery preserves event identity and durable retries", async (t) => {
  const db = new PGlite();
  const id02 = crypto.randomUUID();
  const id03 = crypto.randomUUID();
  const sharedEmail = "casey@example.test";
  const outboxType = "community_event_registration.sheet_sync_requested";
  const configuration = { ready: true, enabled: true, missing: [] };
  const remote = new Map();
  const calls = [];
  let transactionDepth = 0;
  let appendHook = null;
  let updateHook = null;
  let failFinalize = false;

  function bridge(engine) {
    const sql = (strings, ...values) => {
      const query = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
      if (failFinalize && /status = 'succeeded'/.test(query)) {
        failFinalize = false;
        return Promise.reject(new Error("Database acknowledgement unavailable"));
      }
      return engine.query(query, values).then(({ rows }) => rows);
    };
    sql.begin = (fn) => engine.transaction(async (tx) => {
      transactionDepth++;
      try { return await fn(bridge(tx)); }
      finally { transactionDepth--; }
    });
    return sql;
  }

  function providerCall(kind, spreadsheetId, detail = {}) {
    assert.equal(transactionDepth, 0, "Google transport must never run inside a queue-claim transaction");
    assert.equal(spreadsheetId, "shared-registration-sheet");
    calls.push({ kind, ...detail });
  }
  function rowRange(range) {
    const match = /^Registrants!A(\d+):J(\d+)$/.exec(range);
    assert.ok(match, `A:J is the complete ten-column projection: ${range}`);
    return [Number(match[1]), Number(match[2])];
  }
  function writeRows(first, rows) {
    rows.forEach((row, index) => {
      assert.equal(row.length, 10);
      const rowNumber = first + index;
      remote.set(rowNumber, [...row, ...(remote.get(rowNumber)?.slice(10) ?? [])]);
    });
  }
  const model = await load("src/lib/events/registration-sheet-model.ts");
  const byobModel = await load("src/lib/events/byob-registration-model.ts");
  const worker = await load("src/lib/events/registration-sheet-sync.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => bridge(db) },
    "@/lib/events/byob-registration-model": byobModel,
    "@/lib/events/registration-sheet-model": model,
    "@/lib/google/sheets": {
      getGoogleRegistrationSheetConfigurationStatus: () => configuration,
      getGoogleRegistrationSpreadsheetId: () => "shared-registration-sheet",
      configureGoogleRegistrationSheet: async (spreadsheetId, tab) => {
        providerCall("configure", spreadsheetId, { tab });
        assert.equal(tab, "Registrants");
      },
      hideGoogleSheetColumn: async (spreadsheetId, tab, column) => {
        providerCall("hide", spreadsheetId, { tab, column });
        assert.equal(column, 8, "UUID identity stays in hidden column I");
      },
      extendGoogleSheetTableToRow: async (spreadsheetId, tab, row, columns) => {
        providerCall("extend", spreadsheetId, { tab, row, columns });
        assert.equal(columns, 10, "The table must include the Event column");
      },
      getGoogleSheetValues: async (spreadsheetId, range) => {
        providerCall("get", spreadsheetId, { range });
        assert.ok(["Registrants!I2:I", "Registrants!A2:J"].includes(range));
        const last = Math.max(1, ...remote.keys());
        return Array.from({ length: last - 1 }, (_, index) => {
          const row = remote.get(index + 2) ?? [];
          return range === "Registrants!I2:I" ? (row[8] ? [row[8]] : []) : row.slice(0, 10);
        });
      },
      updateGoogleSheetValues: async (spreadsheetId, range, rows) => {
        providerCall("update", spreadsheetId, { range, rows: rows.map((row) => [...row]) });
        const [first, last] = rowRange(range);
        assert.equal(rows.length, last - first + 1);
        writeRows(first, rows);
        if (updateHook) {
          const hook = updateHook;
          updateHook = null;
          await hook(first);
        }
      },
      appendGoogleSheetValues: async (spreadsheetId, range, rows) => {
        providerCall("append", spreadsheetId, { range, rows: rows.map((row) => [...row]) });
        assert.equal(range, "Registrants!A:J");
        assert.equal(rows.length, 1, "Normal delivery must only write its requested registration");
        const first = Math.max(1, ...remote.keys()) + 1;
        writeRows(first, rows);
        if (appendHook) {
          const hook = appendHook;
          appendHook = null;
          await hook(first);
        }
        return `Registrants!A${first}:J${first}`;
      },
      clearGoogleSheetValues: async (spreadsheetId, range) => {
        providerCall("clear", spreadsheetId, { range });
        const [first, last] = rowRange(range);
        for (let row = first; row <= last; row++) {
          const notes = remote.get(row)?.slice(10) ?? [];
          if (notes.length) remote.set(row, [...Array(10).fill(""), ...notes]);
          else remote.delete(row);
        }
      },
    },
  });

  const run = (limit = 10) => worker.processRegistrationSheetOutboxBatch(limit);
  const queued = async (id) => (await db.query("select * from integration_outbox where aggregate_id=$1 order by id limit 1", [id])).rows[0];
  const dataWrites = () => calls.filter((call) => call.kind === "append" || (call.kind === "update" && call.range !== "Registrants!A1:J1"));
  async function enqueue(id, changes = {}) {
    await db.query(`insert into integration_outbox (destination,event_type,aggregate_type,aggregate_id,dedupe_key,payload)
      values ($1,$2,'community_event_registration',$3,$4,$5)`, [
      changes.destination ?? "google", changes.eventType ?? outboxType, id, crypto.randomUUID(),
      JSON.stringify({ eventKey: "byob-02", email: "stale@example.test", ...changes.payload }),
    ]);
  }
  async function seed(id, eventKey, options = {}) {
    await db.query(`insert into community_event_registrations
      (id,event_key,registrant_name,registrant_first_name,registrant_last_name,email_normalized,instagram_handle,status,waiver_version,waiver_accepted_at,created_at)
      values ($1,$2,'Casey Example','Casey','Example',$3,'casey',$4,$5,$6,$6)`, [
      id, eventKey, options.email ?? sharedEmail, options.status ?? "registered",
      `${eventKey}-risk-acknowledgment-${eventKey === "byob-02" ? "v3" : "v1"}`,
      eventKey === "byob-02" ? "2026-08-21T18:15:00.000Z" : "2026-09-15T16:00:00.000Z",
    ]);
    if (options.enqueue !== false) await enqueue(id);
  }
  async function reset() {
    await db.exec("truncate community_event_registrations, integration_outbox restart identity");
    configuration.ready = true;
    configuration.missing = [];
    remote.clear();
    calls.length = 0;
    appendHook = null;
    updateHook = null;
    failFinalize = false;
  }

  try {
    const foundation = await source("db/migrations/20260819_platform_foundation.sql");
    const outboxSql = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)?.[0];
    assert.ok(outboxSql, "Use the real queue schema so lease/status constraints remain exercised");
    await db.exec(outboxSql);
    // Only the canonical columns read by this worker are needed. Event/email
    // uniqueness matches production while intentionally allowing another event
    // to prove that the worker cannot mirror registrations outside BYOB 02/03.
    await db.exec(`create table community_event_registrations (
      id uuid primary key,
      event_key text not null,
      registrant_name text not null,
      registrant_first_name text,
      registrant_last_name text,
      email_normalized text not null,
      instagram_handle text,
      status text not null check (status in ('registered','cancelled')),
      waiver_version text not null,
      waiver_accepted_at timestamptz not null,
      created_at timestamptz not null,
      unique (event_key,email_normalized)
    );`);

    await t.test("one person attending both events keeps separate UUID, waiver, and Event values", async () => {
      await reset();
      await seed(id02, "byob-02");
      await seed(id03, "byob-03");
      const result = await run();
      assert.equal(result.claimed, 2);
      assert.equal(result.processed, 2);
      assert.equal(result.failed, 0);
      assert.deepEqual(remote.get(1), ["Registered at", "First name", "Last name", "Email", "Instagram", "Status", "Waiver accepted", "Waiver version", "Registration ID", "Event"]);
      assert.equal(remote.get(2)[3], sharedEmail);
      assert.equal(remote.get(3)[3], sharedEmail);
      assert.deepEqual(remote.get(2).slice(7), ["byob-02-risk-acknowledgment-v3", id02, "byob-02"]);
      assert.deepEqual(remote.get(3).slice(7), ["byob-03-risk-acknowledgment-v1", id03, "byob-03"]);
      assert.equal(typeof remote.get(2)[0], "number");
      assert.equal(typeof remote.get(3)[6], "number");
      assert.equal((await queued(id02)).status, "succeeded");
      assert.equal((await queued(id03)).status, "succeeded");
      assert.ok(calls.filter((call) => call.kind === "get").every((call) => call.range === "Registrants!I2:I"));
      assert.equal((await run()).claimed, 0);
      assert.equal(dataWrites().length, 2);
    });

    await t.test("delivering BYOB 03 leaves the existing BYOB 02 row and notes byte-for-byte unchanged", async () => {
      await reset();
      await seed(id02, "byob-02", { enqueue: false });
      await seed(id03, "byob-03");
      const original = [45000, "Original", "Two", sharedEmail, "original", "registered", 45000, "original-waiver", id02, "", "Operator note"];
      remote.set(2, [...original]);
      assert.equal((await run()).processed, 1);
      assert.deepEqual(remote.get(2), original);
      assert.equal(remote.get(3)[8], id03);
      assert.equal(remote.get(3)[9], "byob-03");
      assert.equal(dataWrites().length, 1);
      assert.equal(dataWrites()[0].kind, "append");
      assert.equal(calls.some((call) => call.kind === "clear"), false);
    });

    await t.test("a lost append response backs off and retries by UUID instead of appending a duplicate", async () => {
      await reset();
      await seed(id03, "byob-03");
      appendHook = () => { throw new Error(`Sensitive provider response for ${sharedEmail}`); };
      assert.equal((await run()).failed, 1);
      const failed = await queued(id03);
      assert.equal(failed.status, "failed");
      assert.equal(failed.attempts, 1);
      assert.equal(failed.locked_by, null);
      assert.equal(failed.last_error, "Registration sheet sync failed (Error)");
      assert.equal(new Date(failed.available_at) - new Date(failed.updated_at), 30_000);
      assert.equal(remote.get(2)[8], id03);
      assert.equal((await run()).claimed, 0, "The retry cannot bypass available_at");
      await db.exec("update integration_outbox set available_at=now()");
      assert.equal((await run()).processed, 1);
      assert.equal((await queued(id03)).attempts, 2);
      assert.equal(remote.size, 2, "Only a header and one registration remain");
      assert.deepEqual(dataWrites().map((call) => [call.kind, call.range]), [["append", "Registrants!A:J"], ["update", "Registrants!A2:J2"]]);
    });

    await t.test("database acknowledgement failure also retries the accepted registration by UUID", async () => {
      await reset();
      await seed(id03, "byob-03");
      failFinalize = true;
      assert.equal((await run()).failed, 1);
      assert.equal((await queued(id03)).status, "failed");
      assert.equal(remote.get(2)[8], id03);
      await db.exec("update integration_outbox set available_at=now()");
      assert.equal((await run()).processed, 1);
      assert.equal(remote.size, 2);
      assert.deepEqual(dataWrites().map((call) => call.kind), ["append", "update"]);
    });

    await t.test("duplicate UUID rows fail safely without appending or changing either registration", async () => {
      await reset();
      await seed(id03, "byob-03");
      const one = [1, "Existing", "One", sharedEmail, "", "registered", 1, "waiver-one", id03, "byob-03"];
      const two = [2, "Existing", "Two", "different@example.test", "", "registered", 2, "waiver-two", ` ${id03.toUpperCase()} `, "byob-02"];
      remote.set(2, one);
      remote.set(5, two);
      assert.equal((await run()).failed, 1);
      assert.equal((await queued(id03)).status, "failed");
      assert.deepEqual(remote.get(2), one);
      assert.deepEqual(remote.get(5), two);
      assert.equal(dataWrites().length, 0);
    });

    await t.test("active leases prevent a competing claim and stale leases recover with another attempt", async () => {
      await reset();
      await seed(id03, "byob-03");
      await db.exec("update integration_outbox set status='processing',attempts=1,locked_at=now(),locked_by='other-worker'");
      assert.equal((await run()).claimed, 0);
      assert.equal(dataWrites().length, 0);
      assert.equal((await queued(id03)).locked_by, "other-worker");
      await db.exec("update integration_outbox set locked_at=now()-interval '11 minutes'");
      assert.equal((await run()).processed, 1);
      assert.equal((await queued(id03)).attempts, 2);
      assert.equal((await queued(id03)).locked_by, null);
      assert.equal((await queued(id03)).status, "succeeded");
    });

    await t.test("final retry failures and exhausted stale leases become terminal dead letters", async () => {
      await reset();
      await seed(id03, "byob-03");
      await db.exec("update integration_outbox set attempts=4");
      appendHook = () => { throw new Error("Provider unavailable"); };
      assert.equal((await run()).failed, 1);
      assert.equal((await queued(id03)).status, "dead_letter");
      assert.equal((await queued(id03)).attempts, 5);
      assert.equal((await run()).claimed, 0);
      await reset();
      await seed(id03, "byob-03");
      await db.exec("update integration_outbox set status='processing',attempts=5,locked_at=now()-interval '11 minutes',locked_by='expired-worker'");
      assert.equal((await run()).claimed, 0);
      const terminal = await queued(id03);
      assert.equal(terminal.status, "dead_letter");
      assert.equal(terminal.locked_by, null);
      assert.equal(terminal.last_error, "Worker lease expired at the retry limit.");
      assert.equal(dataWrites().length, 0);
    });

    await t.test("lease ownership is required when a worker finalizes an accepted write", async () => {
      await reset();
      await seed(id03, "byob-03");
      appendHook = () => db.exec("update integration_outbox set locked_by='replacement-worker'");
      await run(1);
      const pending = await queued(id03);
      assert.equal(pending.status, "processing");
      assert.equal(pending.locked_by, "replacement-worker");
      assert.equal(pending.processed_at, null);
      assert.equal((await run()).claimed, 0);
    });

    await t.test("unrelated canonical events are skipped even when the payload falsely claims BYOB 02", async () => {
      await reset();
      const unrelatedId = crypto.randomUUID();
      await seed(unrelatedId, "studio-night");
      const result = await run();
      assert.equal(result.claimed, 1);
      assert.equal(result.skipped, 1);
      assert.equal(result.processed, 0);
      assert.equal((await queued(unrelatedId)).status, "succeeded");
      assert.equal(dataWrites().length, 0);
    });

    await t.test("wrong outbox destination or event type remains untouched and missing canonical IDs skip", async () => {
      await reset();
      await seed(id03, "byob-03", { enqueue: false });
      await enqueue(id03, { destination: "stripe" });
      await enqueue(id03, { eventType: "membership_waitlist.sheet_sync_requested" });
      assert.equal((await run()).claimed, 0);
      const unrelated = (await db.query("select status,attempts from integration_outbox order by id")).rows;
      assert.deepEqual(unrelated, [{ status: "pending", attempts: 0 }, { status: "pending", attempts: 0 }]);
      await reset();
      for (const id of [crypto.randomUUID(), "invalid-uuid"]) await enqueue(id);
      assert.equal((await run()).skipped, 2);
      assert.equal(dataWrites().length, 0);
    });

    await t.test("configuration and header failures happen before attempts are consumed", async () => {
      await reset();
      await seed(id03, "byob-03");
      configuration.ready = false;
      configuration.missing = ["GOOGLE_REGISTRATION_SPREADSHEET_ID"];
      assert.equal((await run()).ready, false);
      assert.equal((await queued(id03)).attempts, 0);
      assert.equal(calls.length, 0);
      configuration.ready = true;
      updateHook = () => { throw new Error("Sheet unavailable"); };
      await assert.rejects(run, /Sheet unavailable/);
      assert.equal((await queued(id03)).attempts, 0);
    });

    await t.test("explicit reconciliation replaces the full mirror with both events and removes stale trailing rows", async () => {
      await reset();
      await seed(id03, "byob-03", { enqueue: false, status: "cancelled" });
      await seed(id02, "byob-02", { enqueue: false });
      await seed(crypto.randomUUID(), "studio-night", { enqueue: false });
      remote.set(2, ["stale", "Wrong", "Two", "old@example.test", "", "registered", "", "old", id03, "wrong-event"]);
      remote.set(3, ["stale", "Wrong", "Three", "old@example.test", "", "registered", "", "old", id02, "wrong-event"]);
      remote.set(4, ["stale", "Extra", "Four", "extra@example.test", "", "registered", "", "old", crypto.randomUUID(), "unknown"]);
      assert.deepEqual(await worker.reconcileRegistrationSheet(), { clearedRows: 1, rows: 2 });
      assert.deepEqual(remote.get(2).slice(7), ["byob-02-risk-acknowledgment-v3", id02, "byob-02"]);
      assert.deepEqual(remote.get(3).slice(7), ["byob-03-risk-acknowledgment-v1", id03, "byob-03"]);
      assert.equal(remote.get(3)[5], "cancelled");
      assert.equal(remote.has(4), false);
      assert.deepEqual(calls.filter((call) => call.kind === "clear").map((call) => call.range), ["Registrants!A4:J4"]);
      assert.deepEqual(dataWrites().map((call) => call.range), ["Registrants!A2:J3"]);
      assert.equal(calls.find((call) => call.kind === "get").range, "Registrants!A2:J");
    });
  } finally {
    await db.close();
  }
});
