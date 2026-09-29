import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import ts from "typescript";
import { timelineFixture, timelineIds } from "./canonical-journal-fixture.mjs";

export { timelineIds };
export const source = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
export async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
export async function publicJournalFixture(t, { applyPrivacy = true } = {}) {
  const base = await timelineFixture(t, { visibilityMigration: false }), db = base.db;
  await db.exec(`
    alter table ruined_members add column membership_activated_at timestamptz default '2020-01-01';
    create table person_profiles(person_id uuid primary key, display_name text, preferred_name text, member_tag text,
      avatar_storage_path text, location_label text, bio text, building_now text);
    create table member_milestones(id uuid primary key, member_id uuid, person_id uuid, title text, visibility text,
      occurred_at timestamptz, source_entity_type text, source_entity_id text);
    create table artifact_awards(id uuid primary key, member_id uuid, person_id uuid, status text, revoked_at timestamptz, awarded_at timestamptz);
  `);
  await db.exec(await source("db/migrations/20260917200000_public_member_cards.sql"));
  await db.exec(await source("db/migrations/20260919210000_member_profile_card_sync.sql"));
  const privacyMigration = await source("db/migrations/20260928010000_member_journal_visibility.sql");
  if (applyPrivacy) await db.exec(privacyMigration);
  const token = "a".repeat(43), otherToken = "b".repeat(43);
  for (const [member, person, shareToken] of [[timelineIds.member, timelineIds.person, token], [timelineIds.otherMember, timelineIds.otherMember, otherToken]]) {
    await db.query("insert into person_profiles(person_id,display_name,member_tag,bio,location_label,building_now,website_url) values($1,'Shared name','shared-tag','PRIVATE BIO','PRIVATE LOCATION','PRIVATE BUILDING','https://private.example.test')", [person]);
    await db.query("insert into member_public_cards(member_id,public_token,wear_seed) values($1,$2,$3)", [member,shareToken,"c".repeat(24)]);
  }
  let afterQuery = null;
  function wrap(sql) {
    const wrapped = async (strings,...args) => {
      if (!strings.raw) return sql(strings,...args);
      const result = await sql(strings,...args);
      if (afterQuery) await afterQuery(strings.join("?"));
      return result;
    };
    // postgres list binding is synchronous.
    const binding = (strings,...args) => strings.raw ? wrapped(strings,...args) : sql(strings,...args);
    binding.json = sql.json;
    binding.begin = callback => sql.begin(tx => callback(wrap(tx)));
    return binding;
  }
  const sql = wrap(base.sql);
  const model = await load("src/lib/membership/journal-model.ts");
  const cardModel = await load("src/lib/membership/public-card-model.ts");
  const access = await load("src/lib/membership/access-policy.ts");
  const cardRepository = await load("src/lib/membership/public-card-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@supabase/supabase-js": {},
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/membership/repository": base.repository, "@/lib/membership/access-policy": access,
    "@/lib/membership/photo-policy": await load("src/lib/membership/photo-policy.ts"), "./public-card-model": cardModel,
  });
  const blobs = new Map(), downloads = [];
  let storageHook = null;
  const storage = {
    journalStorageConfigured: () => true,
    journalStore: () => ({ download: async path => {
      downloads.push(path);
      if (storageHook) await storageHook();
      return { data: blobs.get(path) ?? null, error: blobs.has(path) ? null : new Error("Missing test blob") };
    } }),
  };
  const shared = { "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "./journal-model": model, "./journal-storage": storage, "./public-card-repository": cardRepository };
  const journal = await load("src/lib/membership/journal-repository.ts", { ...shared, "node:crypto": crypto,
    "@/lib/membership/repository": base.repository, "@/lib/membership/access-policy": access });
  const visitor = await load("src/lib/membership/public-journal-repository.ts", { ...shared, "./public-card-model": cardModel });
  const enable = (enabled = true, member = timelineIds.member) => db.query("update member_public_cards set public_enabled=$1,version=version+1 where member_id=$2", [enabled,member]);
  return { ...base, model, cardModel, cardRepository, journal, visitor, token, otherToken, blobs, downloads, enable,
    migratePrivacy: () => db.exec(privacyMigration), setStorageHook: hook => { storageHook = hook; }, setAfterQuery: hook => { afterQuery = hook; } };
}
