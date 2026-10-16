import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {loadPGliteForSchemaChecks} from '../../scripts/check-support-schema.mjs';
export const readBadgeSource = path => readFile(new URL(`../../${path}`,import.meta.url),'utf8');
export const badgeId = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function badgeSql(engine) {
  const sql = async (strings,...values) => (await engine.query(strings.reduce((q,p,i)=>q+(i?`$${i}`:'')+p,''),values)).rows;
  sql.begin = callback => engine.transaction(tx=>callback(badgeSql(tx)));
  return sql;
}
export async function loadBadgeModule(path, dependencies={}) {
  const loaded={exports:{}};
  const output=ts.transpileModule(await readBadgeSource(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',output)(name=>{
    assert.ok(Object.hasOwn(dependencies,name),`Unexpected dependency ${name}`);return dependencies[name];
  },loaded,loaded.exports);
  return loaded.exports;
}
export async function installBadgeEvidenceSchema(db) {
  await db.exec(`
    create table if not exists person_profiles(person_id uuid primary key,avatar_storage_path text,bio text,member_tag text,updated_at timestamptz default now());
    create table if not exists member_journal_entries(id uuid primary key default gen_random_uuid(),member_id uuid,visibility text,include_on_timeline boolean default false,deleted_at timestamptz,created_at timestamptz default now());
    create table if not exists foundation_programs(id uuid primary key,slug text);
    create table if not exists foundation_versions(id uuid primary key,foundation_program_id uuid,configuration jsonb default '{}');
    insert into foundation_programs values('00000000-0000-4000-8000-000000000800','ruined-foundations') on conflict do nothing;
    insert into foundation_versions(id,foundation_program_id,configuration) values('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000800','{"required_member_requirements":["timeline","future_letter"]}') on conflict do nothing;
    create table if not exists foundation_enrollments(id uuid primary key default gen_random_uuid(),member_id uuid,foundation_version_id uuid default '00000000-0000-4000-8000-000000000801',status text default 'in_progress',progress_percent numeric default 0,enrolled_at timestamptz default now(),completed_at timestamptz);
    create table if not exists member_foundation_requirement_completions(id uuid primary key default gen_random_uuid(),member_id uuid,foundation_enrollment_id uuid,requirement_slug text,completion_version integer default 1,state text default 'completed',completed_at timestamptz default now(),supersedes_completion_id uuid);
    create table if not exists experiences(id uuid primary key default gen_random_uuid(),kind text,starts_at timestamptz,ends_at timestamptz,status text default 'published',cancelled_at timestamptz,circle_id uuid,location_label text);
    create table if not exists experience_attendance_events(id bigint generated always as identity primary key,experience_id uuid,person_id uuid,member_id uuid,event_type text,source text default 'ops',occurred_at timestamptz default now());
    create table if not exists circle_member_assignments(circle_id uuid,member_id uuid,assigned_at timestamptz,ended_at timestamptz);
    create table if not exists member_referrals(waitlist_id uuid primary key default gen_random_uuid(),inviter_member_id uuid,joined_at timestamptz);
    create table if not exists integration_entity_links(provider text,local_entity_type text,local_entity_id text,external_entity_type text,metadata jsonb default '{}');
  `);
  await db.exec(await readBadgeSource('db/migrations/20261015230000_member_badge_collection.sql'));
}
export async function badgeCollectionFixture(t) {
  const PGlite=await loadPGliteForSchemaChecks(),db=new PGlite();t.after(()=>db.close());
  const original=await readBadgeSource('db/migrations/20260929000000_member_badges.sql');
  await db.exec(`
    create role anon;create role authenticated;create schema private;
    create table people(id uuid primary key,status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,member_number integer,email_normalized text,deleted_at timestamptz,released boolean default true);
    create function private.ruined_member_profile_released(uuid) returns boolean language sql stable as 'select released from ruined_members where id=$1';
    create function private.ruined_member_can_share_invitation(uuid) returns boolean language sql stable as 'select false';
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text default 'active');
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active');
    create table private.member_number_assignments(member_id uuid primary key,member_number integer,activated_at timestamptz);
    create table person_email_addresses(person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);
    create table membership_waitlist(email_normalized text,joined_waitlist_at timestamptz);
    ${original.match(/create table if not exists public\.member_badge_awards \([\s\S]*?\n\);/)[0]}
    alter table member_badge_awards enable row level security;
    revoke all on member_badge_awards from public,anon,authenticated;
  `);
  await db.exec(await readBadgeSource('db/migrations/20260930112000_member_badge_acknowledgements.sql'));
  await installBadgeEvidenceSchema(db);
  const sql=badgeSql(db);
  const model=await loadBadgeModule('src/lib/membership/badge-model.ts',{'./member-number':await loadBadgeModule('src/lib/membership/member-number.ts')});
  const baseDeps={'server-only':{},'@/lib/database/server':{getApplicationDatabase:()=>sql},'./badge-model':model};
  const repository=await loadBadgeModule('src/lib/membership/badge-repository.ts',baseDeps);
  const collectionModel=await loadBadgeModule('src/lib/membership/badge-collection-model.ts',{'./badge-model':model});
  const deps={...baseDeps,'./badge-repository':repository,'./badge-collection-model':collectionModel};
  const collection=await loadBadgeModule('src/lib/membership/badge-collection-repository.ts',deps);
  const notifications=await loadBadgeModule('src/lib/membership/badge-notification-repository.ts',deps);
  async function member(n) {
    await db.query('insert into people(id) values($1)',[badgeId(n+200)]);
    await db.query('insert into ruined_members(id,person_id,member_number) values($1,$2,$3)',[badgeId(n+100),badgeId(n+200),n]);
    await db.query('insert into platform_users(auth_user_id,member_id,person_id) values($1,$2,$3)',[badgeId(n),badgeId(n+100),badgeId(n+200)]);
    await db.query("insert into platform_role_grants values($1,'member',null)",[badgeId(n)]);
    await db.query('insert into member_lifecycle(member_id) values($1)',[badgeId(n+100)]);
  }
  await member(1);await member(2);
  async function event(n,credit,{kind='weekly_call',circle=null,status='published',date='2026-01-01T12:00:00Z',location=null,attended=true,person=1,source='ops'}={}) {
    await db.query('insert into experiences(id,kind,starts_at,ends_at,status,circle_id,location_label,metadata) values($1,$2,$3,$3::timestamptz+interval \'1 hour\',$4,$5,$6,$7)',[badgeId(n+1000),kind,date,status,circle,location,{badge_credit:credit}]);
    if(attended) await db.query("insert into experience_attendance_events(experience_id,person_id,member_id,event_type,source,occurred_at) values($1,$2,$3,'attended',$4,$5::timestamptz+interval '2 hour')",[badgeId(n+1000),badgeId(person+200),badgeId(person+100),source,date]);
  }
  return {db,sql,model,repository,...collection,...notifications,member,event};
}
