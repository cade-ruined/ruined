import { readFile } from "node:fs/promises";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const migrations = [
  "../db/migrations/20260819_stripe_billing.sql",
  "../db/migrations/20260819_platform_foundation.sql",
  "../db/migrations/20260819_communications.sql",
  "../db/migrations/20260821_byob_registration.sql",
  "../db/migrations/20260821_byob_registration_v2.sql",
  "../db/migrations/20260821_byob_registration_v3.sql",
];

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
    for (const relativePath of migrations) {
      const migration = await readFile(new URL(relativePath, import.meta.url), "utf8");
      await sql.unsafe(migration);
    }
    console.log("Ruined platform migrations applied.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
