import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { loader, read } from "./helpers/member-sms-fixture.mjs";

const schedules=loader()("src/lib/membership/foundations-schedule.ts");
async function fixture(t) {
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
    create table platform_users(auth_user_id uuid primary key,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_registration_access(member_id uuid primary key,registered_at timestamptz,completion_basis text,ready boolean default true,complimentary boolean default true);
    create table experiences(id uuid primary key,status text,cancelled_at timestamptz,visibility text,registration_mode text,starts_at timestamptz);
    create table experience_registrations(member_id uuid,experience_id uuid,status text,source text);
    create table private.member_email_cadence_event_bindings(experience_id uuid,kind text,track text,cohort_month text);
    create function private.ruined_member_registration_ready(uuid) returns boolean language sql as 'select ready from public.member_registration_access where member_id=$1';
    create function private.ruined_member_has_complimentary_funding(uuid) returns boolean language sql as 'select complimentary from public.member_registration_access where member_id=$1';
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql as 'select false';`);
  await db.exec(read("db/migrations/20261012200000_foundations_schedule_v3.sql"));
  await db.exec(read("db/migrations/20261104190000_complimentary_foundations_cohorts.sql"));
  await db.exec(read("db/migrations/20261105235000_active_complimentary_foundations_exception.sql"));
  const resolve=async memberId=>(await db.query("select private.ruined_assign_complimentary_foundations($1) as schedule",[memberId])).rows[0].schedule;
  async function member(at,basis="complimentary",ready=true,complimentary=true) {
    const id=randomUUID();await db.query("insert into member_registration_access values($1,$2,$3,$4,$5)",[id,at,basis,ready,complimentary]);return id;
  }
  return {db,resolve,member};
}

test("complimentary monthly cutoffs match paid scheduling for every month through 2030, including DST and first-day calls",async t=>{
  const {db}=await fixture(t);
  for(let year=2026;year<=2030;year++) for(let month=1;month<=12;month++) {
    const key=`${year}-${String(month).padStart(2,"0")}`;if(key<"2026-11")continue;
    const scheduled=schedules.foundationsBillingScheduleForMonth(key,"monthly");
    for(const delta of [-1,0,1,86_400_000,26*86_400_000]) {
      const at=new Date(Date.parse(scheduled.cutoffAt)+delta);
      const actual=(await db.query("select private.ruined_complimentary_foundations_schedule($1,null) as schedule",[at.toISOString()])).rows[0].schedule;
      assert.deepEqual(actual,schedules.createFoundationsBillingSchedule(at,"monthly"),`${key} offset ${delta}`);
    }
  }
  assert.equal((await db.query("select private.ruined_complimentary_foundations_schedule('2027-03-31T21:00:00Z',null)->>'cohortMonth' as month")).rows[0].month,"2027-05");
});

test("only completed and genuinely complimentary registrations receive a stable group",async t=>{
  const {db,resolve,member}=await fixture(t);
  const before=await member("2026-11-04T21:59:59.999Z"),boundary=await member("2026-11-04T22:00:00Z");
  assert.equal((await resolve(before)).cohortMonth,"2026-11");assert.equal((await resolve(boundary)).cohortMonth,"2026-12");
  assert.deepEqual(await resolve(before),await resolve(before));
  assert.equal((await db.query("select count(*)::int as n from private.member_complimentary_foundations_cohorts")).rows[0].n,2);
  for(const id of [await member(null),await member("2026-11-01Z","paid_membership"),await member("2026-11-01Z","complimentary",false),await member("2026-11-01Z","complimentary",true,false)]) {
    assert.equal(await resolve(id),null);
  }
  await assert.rejects(db.query("update private.member_complimentary_foundations_cohorts set schedule=private.ruined_complimentary_foundations_schedule('2026-11-06Z',null) where member_id=$1",[before]),/immutable/);
  await assert.rejects(db.query("delete from private.member_complimentary_foundations_cohorts where member_id=$1",[before]),/immutable/);
  await db.query("update member_registration_access set complimentary=false where member_id=$1",[before]);assert.equal(await resolve(before),null);
});

test("legacy explicit member invitations are preserved; founder practice calls do not determine a group",async t=>{
  const {db,resolve,member}=await fixture(t);
  const existing=await member(null),practice=await member(null),ambiguous=await member(null);
  async function invite(memberId,month,track="members") {
    const event=randomUUID();await db.query("insert into experiences(id,status,cancelled_at,visibility,registration_mode) values($1,'published',null,'invite_only','internal')",[event]);
    await db.query("insert into experience_registrations values($1,$2,'registered','ops')",[memberId,event]);
    await db.query("insert into private.member_email_cadence_event_bindings values($1,'foundations_01',$2,$3)",[event,track,month]);
  }
  await invite(existing,"2026-11");await invite(practice,"2026-11","founder_test");
  await invite(ambiguous,"2026-11");await invite(ambiguous,"2026-12");
  await db.exec("update member_registration_access set registered_at='2026-11-04T22:00:00Z'");
  assert.equal((await resolve(existing)).cohortMonth,"2026-11");
  assert.equal((await resolve(practice)).cohortMonth,"2026-12");
  assert.equal(await resolve(ambiguous),null);
  assert.equal((await db.query("select source from private.member_complimentary_foundations_cohorts where member_id=$1",[existing])).rows[0].source,"existing_roster");
});

test("administrator group exceptions are explicit, append-only and preserve original cutoff evidence",async t=>{
  const {db,resolve,member}=await fixture(t);
  const person=await member("2026-11-04T22:00:00Z");const actor=randomUUID();
  await db.query("insert into platform_users values($1,'active')",[actor]);
  await assert.rejects(db.query("select private.ruined_override_complimentary_foundations($1,'2099-11',$2,'Approved late entry')",[person,actor]),/administrator/);
  await db.query("insert into platform_role_grants values($1,'ops_admin',null)",[actor]);
  await assert.rejects(db.query("select private.ruined_override_complimentary_foundations($1,'2099-11',$2,'short')",[person,actor]),/check constraint/);
  await db.query("select private.ruined_override_complimentary_foundations($1,'2099-11',$2,'Approved by the member and team')",[person,actor]);
  assert.equal((await resolve(person)).cohortMonth,"2099-11");
  assert.equal((await db.query("select schedule->>'cohortMonth' as month from private.member_complimentary_foundations_cohorts where member_id=$1",[person])).rows[0].month,"2026-12");
  await db.query("select private.ruined_override_complimentary_foundations($1,'2099-11',$2,'Approved by the member and team')",[person,actor]);
  assert.equal((await db.query("select count(*)::int n from private.member_complimentary_foundations_overrides")).rows[0].n,1);
  await assert.rejects(db.exec("delete from private.member_complimentary_foundations_overrides"),/append-only/);
});

test("started group exceptions require a real remaining published call and close at the last call",async t=>{
  const {db}=await fixture(t);
  const schedule=schedules.foundationsBillingScheduleForMonth("2099-11","monthly");
  const open=async at=>(await db.query("select private.ruined_complimentary_foundations_group_open($1::jsonb,$2::timestamptz) as open",[JSON.stringify(schedule),at])).rows[0].open;
  assert.equal(await open(new Date(Date.parse(schedule.callStartsAt[0])-1).toISOString()),true,"upcoming groups retain the existing exception path");
  assert.equal(await open(schedule.callStartsAt[0]),false,"a started group without remaining published calls is closed");
  const event=randomUUID();
  await db.query("insert into experiences values($1,'published',null,'invite_only','internal',$2)",[event,schedule.callStartsAt[1]]);
  await db.query("insert into private.member_email_cadence_event_bindings values($1,'foundations_02','members','2099-11')",[event]);
  assert.equal(await open(schedule.callStartsAt[0]),true);
  assert.equal(await open(schedule.callStartsAt[1]),false,"a call that has started is not a remaining opportunity");
  for(const mutation of [
    "update experiences set cancelled_at=now()",
    "update experiences set status='draft'",
    "update experiences set visibility='public'",
    "update experiences set registration_mode='external'",
    "update experiences set starts_at=starts_at+interval '1 day'",
    "update private.member_email_cadence_event_bindings set track='founder_test'",
    "update private.member_email_cadence_event_bindings set cohort_month='2099-12'",
  ]) {
    await db.exec("begin");await db.exec(mutation);
    assert.equal(await open(schedule.callStartsAt[0]),false,mutation);
    await db.exec("rollback");
  }
  await db.query("update experiences set starts_at=$1",[schedule.callStartsAt[3]]);
  await db.exec("update private.member_email_cadence_event_bindings set kind='foundations_04'");
  assert.equal(await open(new Date(Date.parse(schedule.callStartsAt[3])-1).toISOString()),true);
  assert.equal(await open(schedule.callStartsAt[3]),false,"completed groups cannot accept a late placement");
});
