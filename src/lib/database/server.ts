import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

type ApplicationDatabase = ReturnType<typeof postgres>;
type MemberReadStage = "member-home" | "member-timeline";
const readDatabase = new AsyncLocalStorage<ApplicationDatabase>();
const READ_TIMEOUT_MS = 8_000;
const CLEANUP_TIMEOUT_MS = 1_000;

declare global {
  var ruinedApplicationDatabase: ApplicationDatabase | undefined;
}

function createApplicationDatabase(): ApplicationDatabase {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 4,
    prepare: false,
  });
}

export function getApplicationDatabase(): ApplicationDatabase {
  const scoped = readDatabase.getStore();
  if (scoped) return scoped;
  if (!globalThis.ruinedApplicationDatabase) {
    globalThis.ruinedApplicationDatabase = createApplicationDatabase();
  }
  return globalThis.ruinedApplicationDatabase;
}

export class ApplicationDatabaseReadTimeoutError extends Error {
  readonly code = "DATABASE_READ_TIMEOUT";

  constructor() {
    super("The member record could not finish loading.");
    this.name = "ApplicationDatabaseReadTimeoutError";
  }
}

async function closeReadDatabase(database: ApplicationDatabase, stage: MemberReadStage) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // postgres.js end({ timeout: 0 }) terminates pending queries rather than
    // waiting for the very query that exhausted the read deadline.
    await Promise.race([
      Promise.resolve().then(() => database.end({ timeout: 0 })),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.error("Member database read cleanup timed out", { stage, kind: "cleanup_timeout" });
          resolve();
        }, CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    console.error("Member database read cleanup failed", { stage, kind: "cleanup_error" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Only for the member-home and timeline loaders: callbacks must contain reads
 * and no external side effects. A deadline may replay the callback once.
 * Each attempt owns a fresh pool reserved for reads; closing it never interrupts the
 * shared application pool used by account changes, sign-in, or other requests.
 */
export async function withFreshApplicationDatabaseRead<T>(
  stage: MemberReadStage,
  read: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const database = createApplicationDatabase();
    const timeoutError = new ApplicationDatabaseReadTimeoutError();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await readDatabase.run(database, () => Promise.race([
        Promise.resolve().then(read),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeoutError), READ_TIMEOUT_MS);
        }),
      ]));
    } catch (error) {
      // A SQL/access error is meaningful and must not be replayed. Only our
      // elapsed read deadline permits another attempt with a fresh connection.
      if (error !== timeoutError) throw error;
      console.error("Member database read timed out", { stage, kind: "read_timeout" });
      if (attempt === 1) throw error;
    } finally {
      clearTimeout(timer);
      await closeReadDatabase(database, stage);
    }
  }
  throw new ApplicationDatabaseReadTimeoutError();
}
