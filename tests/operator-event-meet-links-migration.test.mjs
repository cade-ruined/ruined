import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only operator-supplied Experience Meet links can share an external identity", async () => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  try {
    const foundation = await source("db/migrations/20260819_platform_foundation.sql");
    const table = foundation.match(/create table if not exists integration_entity_links \([\s\S]*?\n\);/)?.[0];
    const localIndex = foundation.match(/create unique index if not exists integration_entity_links_local_mode_idx[\s\S]*?;/)?.[0];
    const externalIndex = foundation.match(/create unique index if not exists integration_entity_links_external_mode_idx[\s\S]*?;/)?.[0];
    assert.ok(table && localIndex && externalIndex);
    await db.exec(`${table}\n${localIndex}\n${externalIndex}`);
    const insert = ({ local = "first", external = "abc-defg-hij", provider = "google", localType = "experience", externalType = "meet_space", mode = false, source: linkSource = "operator_event" } = {}) => db.query(
      "insert into integration_entity_links(provider,local_entity_type,local_entity_id,external_entity_type,external_entity_id,livemode,metadata) values ($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [provider, localType, local, externalType, external, mode, JSON.stringify(linkSource ? { source: linkSource } : {})],
    );
    await insert();
    await assert.rejects(() => insert({ local: "second" }), (error) => error.code === "23505");
    const migration = await source("db/migrations/20261008180000_operator_event_meet_links.sql");
    await db.exec(migration);
    await insert({ local: "second" });
    await insert({ local: "third" });
    await assert.rejects(() => insert({ external: "xyz-abcd-efg" }), (error) => error.code === "23505", "one local event still gets only one link per mode");
    await insert({ mode: true, external: "xyz-abcd-efg" });
    for (const [label, overrides] of [
      ["generated", { source: "google_calendar" }],
      ["legacy", { source: "operator" }],
      ["missing-source", { source: null }],
      ["other-local-type", { localType: "circle" }],
      ["other-external-type", { externalType: "chat_space" }],
      ["other-provider", { provider: "shopify" }],
    ]) {
      await insert({ ...overrides, local: `${label}-first`, external: label });
      await assert.rejects(() => insert({ ...overrides, local: `${label}-second`, external: label }), (error) => error.code === "23505", label);
    }
    // Existing links survive, and replaying the migration remains safe even
    // after operators deliberately reused their supplied link.
    const before = (await db.query("select * from integration_entity_links order by id")).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query("select * from integration_entity_links order by id")).rows, before);
    assert.match(await source("scripts/migrate-platform.mjs"), /20261008180000_operator_event_meet_links\.sql/);
  } finally {
    await db.close();
  }
});
