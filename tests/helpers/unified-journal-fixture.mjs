import { readFile } from "node:fs/promises";
import { loadPGliteForSchemaChecks } from "../../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const registry = await source("scripts/migrate-platform.mjs");
const paths = [...registry.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => match[1]);
const mergePath = "db/migrations/20260928000000_unified_member_journal.sql";
const basePaths = paths.slice(0, paths.indexOf(mergePath));
if (paths.indexOf(mergePath) !== 49) throw Error("Unified journal migration must follow the 49 shipped migrations.");
const baseMigrations = await Promise.all(basePaths.map(source));
export const unifiedJournalMigration = await source(mergePath);

/** No URL or filesystem database: all schemas and synthetic records live in memory. */
export async function createUnifiedJournalDatabase(t, { beforeMigration, applyMigration = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const migration of baseMigrations) await db.exec(migration);
  const before = await beforeMigration?.(db);
  if (applyMigration) await db.exec(unifiedJournalMigration);
  return { db, before, applyMigration: () => db.exec(unifiedJournalMigration) };
}
