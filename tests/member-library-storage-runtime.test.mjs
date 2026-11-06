import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const ids = { member: "11111111-1111-4111-8111-111111111111", other: "22222222-2222-4222-8222-222222222222",
  resource: "33333333-3333-4333-8333-333333333333", version: "44444444-4444-4444-8444-444444444444",
  circle: "55555555-5555-4555-8555-555555555555" };
function definition(text, name) {
  const start = text.indexOf(`create or replace function private.${name}(`);
  const end = text.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, name);
  return text.slice(start, end + 3);
}

test("private Library storage allows only entitled current published recordings, including Foundations members", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema private; create schema storage;
    grant usage on schema private,storage to authenticated;
    grant usage on schema storage to anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id bigint generated always as identity,bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    grant usage on all sequences in schema storage to anon,authenticated;
    -- A permissive policy from another feature must not expose Library files.
    create policy unrelated_permissive_policy on storage.objects for all to anon,authenticated using(true) with check(true);
    create table platform_users(auth_user_id uuid,person_id uuid,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table ruined_members(id uuid,person_id uuid);
    create table member_lifecycle(member_id uuid,account_state text,billing_state text,administrative_onboarding_state text,
      standing_state text,cancellation_effective_at timestamptz,program_state text,current_progression_level_slug text,funding text,profile_released boolean);
    create table learning_collections(id uuid,status text);
    create table learning_resources(id uuid,status text,current_version_id uuid,collection_id uuid);
    create table learning_resource_versions(id uuid,learning_resource_id uuid,published_at timestamptz,storage_bucket text,storage_path text);
    create table learning_resource_targets(learning_resource_id uuid,audience_type text,circle_id uuid,block_id uuid,progression_level_slug text);
    create table circle_member_assignments(circle_id uuid,member_id uuid,ended_at timestamptz);
    create table block_circle_assignments(circle_id uuid,block_id uuid,ended_at timestamptz);
    create table circle_resources(circle_id uuid,learning_resource_id uuid,ended_at timestamptz);
    create function private.ruined_current_auth_user_id() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function private.ruined_member_has_complimentary_funding(member uuid) returns boolean language sql as $$
      select funding in ('complimentary','operator') from public.member_lifecycle where member_id=member $$;
    create function private.ruined_current_circle_is_revealed() returns boolean language sql as $$select true$$;
    create function private.ruined_member_profile_released(member uuid) returns boolean language sql as $$
      select profile_released from public.member_lifecycle where member_id=member $$;
    create function private.ruined_current_membership_id() returns uuid language sql as $$select null::uuid$$;
    create function private.ruined_current_member_id() returns uuid language sql as $$select null::uuid$$;
    create function private.ruined_current_updates_member_id() returns uuid language sql as $$select null::uuid$$;
    create function private.ruined_member_can_share_invitation(member uuid) returns boolean language sql as $$select true$$;
  `);
  // The shipped access selector has no program_state exclusion: funded members
  // doing Foundations qualify without completing Foundations or entering a Circle.
  await db.exec(definition(await source("db/migrations/20260925000000_complimentary_member_invitations.sql"), "ruined_current_active_access_member_id"));
  const registration = await source("db/migrations/20260930140000_member_registration_access.sql");
  await db.exec(registration.slice(registration.indexOf("-- Keep existing funding/standing rules"), registration.indexOf("-- Profile tables also")));
  await db.exec(definition(await source("db/migrations/20260930102000_circle_reveal.sql"), "ruined_can_access_learning_resource"));
  await db.exec(await source("db/migrations/20261106200000_private_member_library.sql"));
  const bucket = (await db.query("select * from storage.buckets where id='member-library'")).rows[0];
  assert.equal(bucket.public, false); assert.equal(Number(bucket.file_size_limit), 1073741824);
  assert.deepEqual(bucket.allowed_mime_types, ["video/mp4"]);
  for (const id of [ids.member, ids.other]) {
    await db.query("insert into ruined_members values($1,$1);", [id]);
    await db.query("insert into platform_users values($1,$1,'active')", [id]);
    await db.query("insert into platform_role_grants values($1,'member',null)", [id]);
    await db.query("insert into member_lifecycle values($1,'active','active','completed','active',null,'onboarding','one','self',true)", [id]);
  }
  await db.query("insert into learning_resources values($1,'published',$2,null)", [ids.resource, ids.version]);
  await db.query("insert into learning_resource_versions values($1,$2,now(),'member-library','live.mp4')", [ids.version, ids.resource]);
  await db.query("insert into learning_resource_versions values(gen_random_uuid(),$1,null,'member-library','draft.mp4'),(gen_random_uuid(),$1,now(),'member-library','old.mp4')", [ids.resource]);
  await db.query("insert into learning_resource_targets values($1,'circle',$2,null,null)", [ids.resource, ids.circle]);
  await db.query("insert into circle_member_assignments values($1,$2,null)", [ids.circle, ids.member]);
  await db.exec("insert into storage.objects(bucket_id,name) values('member-library','live.mp4'),('member-library','draft.mp4'),('member-library','old.mp4'),('member-library','unlisted.mp4'),('other-bucket','other.mp4')");
  async function asMember(id) {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  }
  const visible = async () => (await db.query("select name from storage.objects order by name")).rows.map(row => row.name);
  await asMember(ids.member);
  assert.deepEqual(await visible(), ["live.mp4", "other.mp4"]);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('member-library','injected.mp4')"), /row-level security/);
  await db.exec("update storage.objects set name='changed.mp4' where bucket_id='member-library'; delete from storage.objects where bucket_id='member-library'");
  assert.deepEqual(await visible(), ["live.mp4", "other.mp4"], "client cannot replace or delete the recording");
  await asMember(ids.other);
  assert.deepEqual(await visible(), ["other.mp4"], "another Circle cannot read the signed source");
  await db.exec("reset role; set role anon");
  assert.deepEqual(await visible(), ["other.mp4"], "anonymous access stays denied despite unrelated permissive policies");
  await db.exec("reset role; update learning_resource_targets set audience_type='all_members',circle_id=null");
  await asMember(ids.other);
  assert.deepEqual(await visible(), ["live.mp4", "other.mp4"], "all-members recording reaches a funded Foundations member without Circle assignment");
  await db.exec("reset role");
  await db.query("insert into learning_collections values($1,'published');", [ids.resource]);
  await db.query("update learning_resources set collection_id=$1", [ids.resource]);
  await asMember(ids.other);
  assert.deepEqual(await visible(), ["live.mp4", "other.mp4"]);
  await db.exec("reset role; update learning_collections set status='unpublished'");
  await asMember(ids.other);
  assert.deepEqual(await visible(), ["other.mp4"], "an unpublished collection blocks its recording too");
  await db.exec("reset role; update learning_collections set status='published'");
  await db.exec("reset role");
  await db.query("update member_lifecycle set profile_released=false where member_id=$1", [ids.other]);
  await asMember(ids.other);
  assert.deepEqual(await visible(), ["other.mp4"], "paid but unreleased profiles cannot access Library files");
  await db.exec("reset role");
  await db.query("update member_lifecycle set profile_released=true where member_id=$1", [ids.other]);
  for (const funding of ["complimentary", "operator"]) {
    await db.exec("reset role");
    await db.query("update member_lifecycle set billing_state='pending',funding=$1 where member_id=$2", [funding, ids.other]);
    await asMember(ids.other);
    assert.deepEqual(await visible(), ["live.mp4", "other.mp4"]);
  }
  await db.exec("reset role");
  await db.query("update member_lifecycle set funding='self',billing_state='pending' where member_id=$1", [ids.other]);
  await asMember(ids.other);
  assert.deepEqual(await visible(), ["other.mp4"], "unpaid membership cannot sign the recording");
  await db.exec("reset role; update learning_resources set status='unpublished'");
  await asMember(ids.member);
  assert.deepEqual(await visible(), ["other.mp4"]);
});
