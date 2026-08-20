import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run the Stripe billing migration.");
  process.exitCode = 1;
} else {
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
  });

  try {
    const migration = await readFile(
      new URL("../db/migrations/20260819_stripe_billing.sql", import.meta.url),
      "utf8",
    );
    await sql.unsafe(migration);
    console.log("Stripe billing migration applied.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
