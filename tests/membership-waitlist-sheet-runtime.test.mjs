import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    if (name === "node:buffer") return { Buffer };
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("waitlist delivery persists leases and retries in PostgreSQL while fixed Sheet writes remain idempotent", async (t) => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  let transactionDepth = 0;
  let providerHook = null;
  let failFinalize = false;
  const configuration = { ready: true, enabled: true, missing: [], spreadsheetId: "waitlist-sheet" };
  const remote = new Map();
  const writes = [];
  const id = crypto.randomUUID();
  function bridge(engine) {
    const sql = (strings, ...values) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      if (failFinalize && query.includes("set status = 'succeeded'")) {
        failFinalize = false;
        return Promise.reject(new Error("Database acknowledgement unavailable"));
      }
      return engine.query(query, values).then(({ rows }) => rows);
    };
    sql.begin = (fn) => engine.transaction(async (tx) => {
      transactionDepth += 1;
      try { return await fn(bridge(tx)); }
      finally { transactionDepth -= 1; }
    });
    return sql;
  }
  const model = await load("src/lib/membership/waitlist-sheet-model.ts");
  const worker = await load("src/lib/membership/waitlist-sheet-sync.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => bridge(db) },
    "@/lib/membership/waitlist-sheet-model": model,
    "@/lib/google/sheets": {
      getGoogleMembershipWaitlistSheetConfigurationStatus: () => configuration,
      getGoogleSheetValues: async (spreadsheetId, range) => {
        assert.equal(transactionDepth, 0);
        assert.equal(spreadsheetId, "waitlist-sheet");
        const row = Number(range.match(/!A(\d+):F\1$/)?.[1]);
        assert.ok(row >= 2);
        return remote.has(row) ? [remote.get(row).slice(0, 6)] : [];
      },
      updateGoogleSheetValues: async (spreadsheetId, range, rows) => {
        assert.equal(transactionDepth, 0, "provider writes must happen outside database transactions");
        assert.equal(spreadsheetId, "waitlist-sheet");
        const row = Number(range.match(/!A(\d+):F\1$/)?.[1]);
        assert.ok(row >= 1);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].length, 6);
        writes.push({ range, row: [...rows[0]] });
        remote.set(row, [...rows[0], ...(remote.get(row)?.slice(6) ?? [])]);
        if (providerHook) {
          const hook = providerHook;
          providerHook = null;
          await hook(row);
        }
      },
    },
  });
  const run = (limit = 1) => worker.processMembershipWaitlistSheetOutboxBatch(limit);
  const queued = async () => (await db.query("select * from integration_outbox order by id limit 1")).rows[0];
  async function reset() {
    await db.exec("truncate membership_waitlist, integration_outbox restart identity");
    configuration.ready = true;
    configuration.missing = [];
    providerHook = null;
    failFinalize = false;
    writes.length = 0;
    remote.clear();
    await db.query("insert into membership_waitlist (id,name,email_normalized,phone) values ($1,'=1+1','person@example.test','+1 303 555 0100')", [id]);
    await db.query(`insert into integration_outbox (destination,event_type,aggregate_type,aggregate_id,dedupe_key)
      values ('google','membership_waitlist.sheet_sync_requested','membership_waitlist',$1,$1)`, [id]);
  }
  try {
    await db.exec("create role anon; create role authenticated;");
    const foundation = await source("db/migrations/20260819_platform_foundation.sql");
    const outboxSql = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)?.[0];
    assert.ok(outboxSql);
    await db.exec(outboxSql);
    await db.exec(await source("db/migrations/20260914225359_membership_waitlist.sql"));

    await t.test("canonical row reaches fixed A2:F2 once and leaves notes untouched", async () => {
      await reset();
      remote.set(2, ["", "", "", "", "", "", "Call next week"]);
      const result = await run();
      assert.equal(result.processed, 1);
      assert.equal((await queued()).status, "succeeded");
      assert.deepEqual(remote.get(2).slice(1), ["=1+1", "person@example.test", "+1 303 555 0100", "waiting", id, "Call next week"]);
      assert.ok(!Number.isNaN(Date.parse(remote.get(2)[0])));
      assert.equal((await run()).claimed, 0);
      assert.equal(writes.filter((call) => call.range === "Waitlist!A2:F2").length, 1);
    });

    await t.test("missing configuration and inaccessible headers consume no attempts", async () => {
      await reset();
      configuration.ready = false;
      configuration.missing = ["GOOGLE_MEMBERSHIP_WAITLIST_SPREADSHEET_ID"];
      assert.equal((await run()).ready, false);
      assert.equal((await queued()).attempts, 0);
      assert.equal(writes.length, 0);
      configuration.ready = true;
      providerHook = () => { throw new Error("Sheet inaccessible"); };
      await assert.rejects(run, /Sheet inaccessible/);
      assert.equal((await queued()).attempts, 0);
    });

    await t.test("an accepted write with a lost response retries the same row without duplicating it", async () => {
      await reset();
      // Header succeeds; throw only after Google has accepted the entry itself.
      providerHook = () => {
        providerHook = () => { throw new Error("Sensitive provider body person@example.test"); };
      };
      assert.equal((await run()).failed, 1);
      assert.equal((await queued()).status, "failed");
      assert.equal((await queued()).last_error, "Membership waitlist sheet sync failed.");
      assert.equal(remote.get(2)[5], id);
      assert.equal((await run()).claimed, 0, "backoff delays retry");
      await db.exec("update integration_outbox set available_at=now()");
      assert.equal((await run()).processed, 1);
      assert.equal(remote.size, 2, "only header and one signup row exist");
    });

    await t.test("database finalization failure retries the already accepted row", async () => {
      await reset();
      failFinalize = true;
      assert.equal((await run()).failed, 1);
      await db.exec("update integration_outbox set available_at=now()");
      assert.equal((await run()).processed, 1);
      assert.equal(remote.size, 2);
    });

    await t.test("moved or manually populated sheet rows fail safely without overwrite", async () => {
      for (const previous of [
        ["date", "Different person", "other@example.test", "", "waiting", crypto.randomUUID()],
        ["date", "No ID", "other@example.test"],
      ]) {
        await reset();
        remote.set(2, previous);
        assert.equal((await run()).failed, 1);
        assert.deepEqual(remote.get(2), previous);
        assert.equal(writes.length, 1, "only the header may be updated");
      }
    });

    await t.test("active leases block competing claims, expired leases recover, retry limit dead-letters", async () => {
      await reset();
      await db.exec("update integration_outbox set status='processing',attempts=1,locked_at=now(),locked_by='other'");
      assert.equal((await run()).claimed, 0);
      await db.exec("update integration_outbox set locked_at=now()-interval '11 minutes'");
      assert.equal((await run()).processed, 1);
      assert.equal((await queued()).attempts, 2);
      await reset();
      await db.exec("update integration_outbox set status='processing',attempts=5,locked_at=now()-interval '11 minutes',locked_by='other'");
      assert.equal((await run()).claimed, 0);
      assert.equal((await queued()).status, "dead_letter");
      assert.equal((await queued()).locked_by, null);
    });

    await t.test("last retry failure dead-letters and a worker cannot finish another worker's lease", async () => {
      await reset();
      await db.exec("update integration_outbox set attempts=4");
      remote.set(2, ["manually moved"]);
      assert.equal((await run()).failed, 1);
      assert.equal((await queued()).status, "dead_letter");
      await reset();
      providerHook = () => {
        providerHook = () => db.exec("update integration_outbox set locked_by='new-owner'");
      };
      const result = await run();
      assert.equal(result.processed, 0);
      assert.equal(result.skipped, 1);
      assert.equal((await queued()).status, "processing");
      assert.equal((await queued()).locked_by, "new-owner");
    });

    await t.test("exhausted waitlist deliveries stay visible without retrying or counting unrelated dead letters", async () => {
      await reset();
      await db.exec("update integration_outbox set attempts=4");
      remote.set(2, ["manually moved"]);
      const exhausted = await run();
      assert.equal(exhausted.failed, 1);
      assert.equal(exhausted.deadLetter, 1);
      await db.exec(`insert into integration_outbox
        (destination,event_type,aggregate_type,aggregate_id,dedupe_key,status,attempts)
        values
          ('stripe','membership_waitlist.sheet_sync_requested','membership_waitlist','other','wrong-destination','dead_letter',5),
          ('google','different.sheet_sync_requested','membership_waitlist','other','wrong-event','dead_letter',5),
          ('google','membership_waitlist.sheet_sync_requested','different','other','wrong-aggregate','dead_letter',5)`);
      const later = await run();
      assert.equal(later.claimed, 0);
      assert.equal(later.failed, 0);
      assert.equal(later.deadLetter, 1);
      assert.equal((await queued()).attempts, 5, "dead letters are not automatically retried");
      await db.query("update integration_outbox set status='succeeded' where dedupe_key=$1", [id]);
      assert.equal((await run()).deadLetter, 0);
    });

    await t.test("unrelated outbox events are never claimed and missing canonical entries skip", async () => {
      await reset();
      await db.exec("update integration_outbox set event_type='community_event_registration.sheet_sync_requested'");
      assert.equal((await run()).claimed, 0);
      assert.equal((await queued()).attempts, 0);
      await reset();
      await db.query("update integration_outbox set aggregate_id=$1", [crypto.randomUUID()]);
      assert.equal((await run()).skipped, 1);
      assert.equal((await queued()).status, "succeeded");
    });
  } finally {
    await db.close();
  }
});

test("waitlist configuration is independent and keyless Google auth resolves the current request lazily", async () => {
  const keys = ["GOOGLE_REGISTRATION_SHEET_ENABLED", "GOOGLE_REGISTRATION_SPREADSHEET_ID",
    "GOOGLE_MEMBERSHIP_WAITLIST_SHEET_ENABLED", "GOOGLE_MEMBERSHIP_WAITLIST_SPREADSHEET_ID",
    "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64", "GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER",
    "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  const cachedAuth = globalThis.ruinedGoogleSheetsAuth;
  const requests = [];
  let identityOptions;
  let tokenCalls = 0;
  const api = await load("src/lib/google/sheets.ts", {
    "@vercel/oidc": { getVercelOidcToken: async () => { tokenCalls += 1; return "test-token"; } },
    "google-auth-library": {
      IdentityPoolClient: class { constructor(options) { identityOptions = options; } },
      GoogleAuth: class { async request(request) { requests.push(request); return { data: {} }; } },
    },
  });
  try {
    keys.forEach((key) => delete process.env[key]);
    delete globalThis.ruinedGoogleSheetsAuth;
    process.env.GOOGLE_MEMBERSHIP_WAITLIST_SHEET_ENABLED = "true";
    process.env.GOOGLE_MEMBERSHIP_WAITLIST_SPREADSHEET_ID = "waitlist-sheet";
    process.env.GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER = "projects/123/locations/global/workloadIdentityPools/vercel/providers/ruined";
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL = "sheets@ruined-test.iam.gserviceaccount.com";
    assert.equal(api.getGoogleMembershipWaitlistSheetConfigurationStatus().ready, true);
    assert.equal(api.getGoogleRegistrationSheetConfigurationStatus().ready, false);
    await api.updateGoogleSheetValues("waitlist-sheet", "Waitlist!A2:F2", [["=1+1"]]);
    assert.equal(tokenCalls, 0);
    assert.equal(await identityOptions.subject_token_supplier.getSubjectToken(), "test-token");
    assert.equal(tokenCalls, 1);
    assert.deepEqual(identityOptions.scopes, ["https://www.googleapis.com/auth/spreadsheets"]);
    assert.equal(requests[0].method, "PUT");
    assert.equal(requests[0].params.valueInputOption, "RAW");
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
    assert.ok(api.getGoogleMembershipWaitlistSheetConfigurationStatus().missing.includes("GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL"));
    delete process.env.GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER;
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64 = "invalid";
    assert.ok(api.getGoogleMembershipWaitlistSheetConfigurationStatus().missing.includes("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64 (invalid)"));
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.ruinedGoogleSheetsAuth = cachedAuth;
  }
});

test("the cron endpoint rejects untrusted requests and reports configuration or delivery failures", async () => {
  const previousSecret = process.env.CRON_SECRET;
  let calls = 0;
  const result = { claimed: 0, deadLetter: 0, failed: 0, ready: true, missing: [], processed: 0, skipped: 0 };
  const route = await load("app/api/internal/integrations/membership-waitlist/process/route.ts", {
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/lib/membership/waitlist-sheet-sync": {
      processMembershipWaitlistSheetOutboxBatch: async () => { calls += 1; return result; },
    },
  });
  try {
    process.env.CRON_SECRET = "test-secret";
    const request = (token) => new Request("https://example.test/api/internal/integrations/membership-waitlist/process", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    assert.equal((await route.GET(request())).status, 401);
    assert.equal((await route.POST(request("wrong-secret"))).status, 401);
    assert.equal(calls, 0);
    const ok = await route.GET(request("test-secret"));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    result.ready = false;
    assert.equal((await route.POST(request("test-secret"))).status, 503);
    result.ready = true;
    result.failed = 1;
    assert.equal((await route.POST(request("test-secret"))).status, 503);
    result.failed = 0;
    result.deadLetter = 2;
    const unresolved = await route.GET(request("test-secret"));
    assert.equal(unresolved.status, 503);
    assert.equal((await unresolved.json()).deadLetter, 2);
    result.deadLetter = 0;
    assert.equal((await route.GET(request("test-secret"))).status, 200);
    delete process.env.CRON_SECRET;
    assert.equal((await route.GET(request("test-secret"))).status, 401);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});
