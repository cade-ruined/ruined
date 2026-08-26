import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const migrations = [
  "../db/migrations/20260819_stripe_billing.sql",
  "../db/migrations/20260819_platform_foundation.sql",
  "../db/migrations/20260825_membership_foundations_circle_gate.sql",
  "../db/migrations/20260819_communications.sql",
  "../db/migrations/20260821_byob_registration.sql",
  "../db/migrations/20260821_byob_registration_v2.sql",
  "../db/migrations/20260821_byob_registration_v3.sql",
];

function migrationBody(migration, migrationName) {
  const transactionEnvelope = /^\s*begin\s*;\s*([\s\S]*?)\s*commit\s*;\s*$/i.exec(
    migration,
  );

  if (!transactionEnvelope) {
    throw new Error(
      `${migrationName} must contain exactly one top-level BEGIN/COMMIT envelope.`,
    );
  }

  return transactionEnvelope[1];
}

function migrationChecksum(migration) {
  return createHash("sha256").update(migration, "utf8").digest("hex");
}

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run the platform migrations.");
  process.exitCode = 1;
} else {
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 5,
    max: 1,
    prepare: false,
  });

  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe("set local lock_timeout = '10s'");
      await transaction`
        select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'))
      `;
      await transaction.unsafe(`
        create schema if not exists private;
        revoke all on schema private from public, anon, authenticated;

        create table if not exists private.ruined_platform_migrations (
          migration_name text primary key,
          sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz not null default statement_timestamp(),
          execution_ms bigint not null check (execution_ms >= 0)
        );

        revoke all on private.ruined_platform_migrations
          from public, anon, authenticated;
      `);
    });

    for (const relativePath of migrations) {
      const migration = await readFile(new URL(relativePath, import.meta.url), "utf8");
      const migrationName = relativePath.split("/").at(-1);
      if (!migrationName) throw new Error(`Invalid migration path: ${relativePath}`);

      const checksum = migrationChecksum(migration);
      const body = migrationBody(migration, migrationName);
      const applied = await sql.begin(async (transaction) => {
        await transaction.unsafe("set local lock_timeout = '10s'");
        await transaction`
          select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'))
        `;

        const existingRows = await transaction`
          select sha256
          from private.ruined_platform_migrations
          where migration_name = ${migrationName}
          for update
        `;
        const existing = existingRows[0];

        if (existing) {
          if (existing.sha256 !== checksum) {
            throw new Error(
              `${migrationName} was already applied with a different checksum. ` +
                "Create a new migration instead of editing applied history.",
            );
          }

          return false;
        }

        const startedAt = performance.now();
        await transaction.unsafe(body);
        const executionMs = Math.max(0, Math.round(performance.now() - startedAt));

        await transaction`
          insert into private.ruined_platform_migrations (
            migration_name,
            sha256,
            execution_ms
          ) values (
            ${migrationName},
            ${checksum},
            ${executionMs}
          )
        `;

        return true;
      });

      console.log(`${applied ? "Applied" : "Skipped"} ${migrationName}.`);
    }
    console.log("Ruined platform migrations applied.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
