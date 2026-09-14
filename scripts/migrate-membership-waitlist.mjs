import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

// This release has one additive migration. Keep it separate from the legacy
// public-site runner, which replays its earlier migration files on every run.
const migrationName = "20260914225359_membership_waitlist.sql";
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is required to migrate the membership waitlist.");
  process.exitCode = 1;
} else {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const migration = await readFile(new URL(`../db/migrations/${migrationName}`, import.meta.url), "utf8");
    const body = /^\s*begin\s*;\s*([\s\S]*?)\s*commit\s*;\s*$/i.exec(migration)?.[1];
    if (!body) throw new Error("Invalid migration envelope.");
    const checksum = createHash("sha256").update(migration).digest("hex");
    const applied = await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '10s'`;
      await tx`select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'))`;
      await tx.unsafe(`
        create schema if not exists private;
        create table if not exists private.ruined_platform_migrations (
          migration_name text primary key,
          sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz not null default statement_timestamp(),
          execution_ms bigint not null check (execution_ms >= 0)
        );
        revoke all on private.ruined_platform_migrations from public, anon, authenticated;
      `);
      const [existing] = await tx`
        select sha256 from private.ruined_platform_migrations
        where migration_name = ${migrationName} for update
      `;
      if (existing) {
        if (existing.sha256 !== checksum) throw new Error("Applied migration checksum differs.");
        return false;
      }
      const start = performance.now();
      await tx.unsafe(body);
      await tx`
        insert into private.ruined_platform_migrations (migration_name, sha256, execution_ms)
        values (${migrationName}, ${checksum}, ${Math.round(performance.now() - start)})
      `;
      return true;
    });
    console.log(`${applied ? "Applied" : "Already applied"} ${migrationName}.`);
  } catch (error) {
    console.error("Membership waitlist migration failed.", {
      name: error instanceof Error ? error.name : "Error",
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
    });
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
