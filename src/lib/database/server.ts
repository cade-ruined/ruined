import "server-only";

import postgres from "postgres";

declare global {
  var ruinedApplicationDatabase: ReturnType<typeof postgres> | undefined;
}

export function getApplicationDatabase(): ReturnType<typeof postgres> {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!globalThis.ruinedApplicationDatabase) {
    globalThis.ruinedApplicationDatabase = postgres(databaseUrl, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 4,
      prepare: false,
    });
  }

  return globalThis.ruinedApplicationDatabase;
}
