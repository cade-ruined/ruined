import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { Duplex } from "node:stream";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

function message(type, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header.write(type);
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function rowDescription() {
  const column = Buffer.alloc(18);
  column.writeInt32BE(23, 6); // PostgreSQL int4 OID.
  column.writeInt16BE(4, 10);
  column.writeInt32BE(-1, 12);
  return message("T", Buffer.concat([Buffer.from([0, 1]), Buffer.from("value\0"), column]));
}

// An in-memory PostgreSQL wire peer, not a mock of sql.begin. Every transaction
// command receives a successful server response; UNSAFE_TRANSACTION must come
// from the installed postgres.js driver's connection-reservation guard.
class TransactionWirePeer extends Duplex {
  constructor(commands, gate) {
    super();
    this.commands = commands;
    this.gate = gate;
    this.incoming = Buffer.alloc(0);
    this.started = false;
    this.statement = "";
    this.inTransaction = false;
  }

  get readyState() { return this.destroyed ? "closed" : "open"; }

  _read() {}

  _final(callback) {
    callback();
    this.destroy();
  }

  _write(chunk, _encoding, callback) {
    try {
      this.incoming = Buffer.concat([this.incoming, chunk]);
      const responses = [];
      while (this.incoming.length >= (this.started ? 5 : 4)) {
        const length = this.incoming.readInt32BE(this.started ? 1 : 0);
        const total = length + (this.started ? 1 : 0);
        if (this.incoming.length < total) break;
        const packet = this.incoming.subarray(0, total);
        this.incoming = this.incoming.subarray(total);
        if (!this.started) {
          assert.equal(packet.readInt32BE(4), 196608, "protocol version 3 startup");
          this.started = true;
          responses.push(message("R", Buffer.alloc(4)), this.ready());
          continue;
        }
        const type = packet.toString("utf8", 0, 1);
        const payload = packet.subarray(5);
        if (type === "Q") {
          responses.push(...this.execute(payload.toString("utf8", 0, payload.length - 1)), this.ready());
        } else if (type === "P") {
          this.statement = payload.toString("utf8").split("\0")[1];
          responses.push(message("1"));
        } else if (type === "D") {
          responses.push(message("t", Buffer.alloc(2)));
          responses.push(this.statement.toLowerCase().startsWith("select") ? rowDescription() : message("n"));
        } else if (type === "B") {
          responses.push(message("2"));
        } else if (type === "E") {
          responses.push(...this.execute(this.statement));
        } else if (type === "S") {
          responses.push(this.ready());
        } else {
          assert.ok(type === "H" || type === "X", `unexpected frontend message: ${type}`);
        }
      }
      // Real network replies cannot arrive reentrantly during socket.write.
      if (responses.length) this.gate.deliver(() => setImmediate(() => {
        if (!this.destroyed) this.push(Buffer.concat(responses));
      }));
      callback();
    } catch (error) {
      callback(error);
    }
  }

  ready() { return message("Z", Buffer.from(this.inTransaction ? "T" : "I")); }

  execute(statement) {
    const normalized = statement.trim().toLowerCase();
    this.commands.push(normalized);
    if (normalized === "begin") {
      this.inTransaction = true;
      return [message("C", Buffer.from("BEGIN\0"))];
    }
    if (normalized === "commit" || normalized === "rollback") {
      this.inTransaction = false;
      return [message("C", Buffer.from(`${normalized.toUpperCase()}\0`))];
    }
    assert.ok(normalized === "select 0 as value" || normalized === "select 1 as value");
    if (normalized === "select 1 as value") {
      assert.equal(this.inTransaction, true, "the callback query stays inside its transaction");
    }
    return [message("D", Buffer.from([0, 1, 0, 0, 0, 1, normalized.includes("1") ? 49 : 48])), message("C", Buffer.from("SELECT 1\0"))];
  }
}

function fixture(maxPipeline) {
  const commands = [];
  const pools = [];
  const pending = [];
  const waiters = [];
  const gate = {
    hold: false,
    deliver(response) {
      if (!this.hold) return response();
      pending.push(response);
      for (const waiter of waiters) if (pending.length >= waiter.count) waiter.resolve();
    },
    waitFor(count) {
      return pending.length >= count ? Promise.resolve() : new Promise((resolve) => waiters.push({ count, resolve }));
    },
    release() {
      this.hold = false;
      for (const response of pending.splice(0)) response();
    },
  };
  const source = readFileSync(new URL("../src/lib/database/server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", "globalThis", compiled)(
    (name) => {
      if (name === "server-only") return {};
      if (name === "node:async_hooks") return { AsyncLocalStorage };
      if (name === "postgres") return (url, options) => {
        // Preserve the real application's options. Only transport/type discovery
        // are replaced; the optional override reconstructs the broken setting.
        const sql = postgres(url, {
          ...options, socket: () => new TransactionWirePeer(commands, gate),
          ssl: false, fetch_types: false, max_lifetime: 0,
          ...(maxPipeline === undefined ? {} : { max_pipeline: maxPipeline }),
        });
        pools.push(sql);
        return sql;
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }, mod, mod.exports,
    { env: { DATABASE_URL: "postgres://fixture:fixture@127.0.0.1/driver_regression" } }, {},
  );
  return {
    ...mod.exports, commands, gate,
    cleanup: () => Promise.all(pools.map((sql) => sql.end({ timeout: 0 }))),
  };
}

test("real postgres.js rejects begin with max_pipeline zero before running the transaction callback", { timeout: 5_000 }, async (t) => {
  const f = fixture(0);
  t.after(f.cleanup);
  let callbackRan = false;
  await assert.rejects(
    f.withFreshApplicationDatabaseRead("member-badge-collection", () =>
      f.getApplicationDatabase().begin(async () => { callbackRan = true; })),
    { code: "UNSAFE_TRANSACTION" },
  );
  assert.equal(callbackRan, false);
  assert.deepEqual(f.commands, ["begin"]);
});

test("current scoped member-read configuration lets real postgres.js reserve and commit a transaction", { timeout: 5_000 }, async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const result = await f.withFreshApplicationDatabaseRead("member-badge-collection", () =>
    f.getApplicationDatabase().begin(async (transaction) => {
      const rows = await transaction`select 1 as value`;
      return rows[0].value;
    }));
  assert.equal(result, 1);
  assert.deepEqual(f.commands, ["begin", "select 1 as value", "commit"]);
});

async function saturatedTransaction(f) {
  return f.withFreshApplicationDatabaseRead("member-badge-collection", async () => {
    const sql = f.getApplicationDatabase();
    // Establish all four connections, then leave one read active on each.
    await Promise.all(Array.from({ length: 4 }, () => sql`select 0 as value`));
    f.gate.hold = true;
    const reads = Array.from({ length: 4 }, () => sql`select 0 as value`.execute());
    await f.gate.waitFor(4);
    const outcome = sql.begin(async (transaction) => {
      const rows = await transaction`select 1 as value`;
      return rows[0].value;
    }).then((value) => ({ value }), (error) => ({ error }));
    await f.gate.waitFor(5);
    f.gate.release();
    await Promise.all(reads);
    return outcome;
  });
}

test("max_pipeline one loses transaction reservation when all four connections already have active reads", { timeout: 5_000 }, async (t) => {
  const f = fixture(1);
  t.after(f.cleanup);
  const outcome = await saturatedTransaction(f);
  assert.equal(outcome.error?.code, "UNSAFE_TRANSACTION");
  assert.equal(f.commands.at(-1), "begin");
});

test("current scoped member-read configuration commits a transaction while all four connections have active reads", { timeout: 5_000 }, async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const outcome = await saturatedTransaction(f);
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.value, 1);
  assert.deepEqual(f.commands.slice(-3), ["begin", "select 1 as value", "commit"]);
});
