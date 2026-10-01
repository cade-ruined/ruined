import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { coupleCircleFixture } from "./helpers/couple-circle-fixture.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function sqlFor(engine) {
  const sql = async (parts,...values) => (await engine.query(parts.reduce((text,part,index) => text+(index ? `$${index}` : "")+part,""),values)).rows;
  sql.begin = fn => engine.transaction(tx => fn(sqlFor(tx)));
  return sql;
}
async function load(path,overrides) {
  const result = {exports:{}};
  const code = ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("require","module","exports",code)(name => {
    if(name==="server-only") return {};
    if(Object.hasOwn(overrides,name)) return overrides[name];
    throw new Error(`Unexpected dependency: ${name}`);
  },result,result.exports);
  return result.exports;
}
async function fixture(t) {
  const f = await coupleCircleFixture(t), {db} = f;
  await db.exec(`
    alter table ruined_members add column email_normalized text unique;
    alter table platform_users add column email_normalized text,add column member_id uuid;
    create table people(id uuid primary key,status text default 'active');
    create table person_email_addresses(id uuid primary key default gen_random_uuid(),person_id uuid,email_normalized text unique,verification_state text default 'verified',retired_at timestamptz);
    create table member_registration_access(member_id uuid primary key,registered_at timestamptz,profile_activated_at timestamptz);
    create table member_onboardings(member_id uuid primary key,profile_completed_at timestamptz);
    create table person_private_profiles(person_id uuid primary key,birth_date date,default_fulfillment_address jsonb);
  `);
  const eligibility = await source("db/migrations/20260930200000_registration_eligibility.sql");
  const start = eligibility.indexOf("create function private.ruined_registration_intake_eligibility_error(");
  await db.exec(eligibility.slice(start,eligibility.indexOf("$$;",start)+3));
  await db.exec(await source("db/migrations/20260930210000_registration_couples.sql"));
  const repository = await load("src/lib/membership/registration-couple.ts",{"@/lib/database/server":{getApplicationDatabase:()=>sqlFor(db)}});
  async function member(email,{profile=true,age=30,country="US",verified=true}={}) {
    const id=await f.member(),auth=randomUUID();
    await db.query("update ruined_members set email_normalized=$2 where id=$1",[id,email]);
    await db.query("insert into people(id) values($1)",[id]);
    await db.query("insert into platform_users(auth_user_id,person_id,member_id,email_normalized) values($1,$2,$2,$3)",[auth,id,email]);
    await db.query("insert into platform_role_grants values($1,'member',null)",[auth]);
    await db.query("insert into person_email_addresses(person_id,email_normalized,verification_state) values($1,$2,$3)",[id,email,verified ? "verified" : "unverified"]);
    await db.query("insert into member_registration_access(member_id) values($1)",[id]);
    await db.query("insert into member_onboardings values($1,case when $2 then now() end)",[id,profile]);
    await db.query("insert into person_private_profiles values($1,(current_date-($2 * interval '1 year'))::date,jsonb_build_object('countryCode',$3::text))",[id,age,country]);
    return {id,auth,email};
  }
  const save=(member,email)=>repository.saveRegistrationCouple(member.auth,email);
  const read=member=>repository.getRegistrationCouple(member.auth);
  return {...f,repository,member,save,read};
}

test("registration pairing requires mutual verified adult consent and preserves independent card/registration state",async t=>{
  const f=await fixture(t),a=await f.member("a@example.test"),b=await f.member("b@example.test");
  assert.deepEqual(await f.read(a),{status:"none",partnerEmail:null});
  assert.deepEqual(await f.save(a," B@EXAMPLE.TEST "),{status:"pending",partnerEmail:"b@example.test"});
  assert.equal(await f.partnerOf(a.id),null);
  assert.deepEqual(await f.read(b),{status:"none",partnerEmail:null},"an incoming request never appears as accepted consent");
  assert.deepEqual(await f.save(b,a.email),{status:"paired",partnerEmail:a.email});
  assert.deepEqual(await f.read(a),{status:"paired",partnerEmail:b.email});
  assert.equal(await f.partnerOf(a.id),b.id);
  assert.equal(await f.partnerOf(b.id),a.id);
  assert.deepEqual(Object.keys(await f.read(a)).sort(),["partnerEmail","status"],"no discovered identity is returned");
  assert.equal((await f.db.query("select count(*)::int n from stripe_subscriptions")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from membership_couple_authorizations")).rows[0].n,0);
  assert.equal((await f.db.query("select count(*)::int n from member_registration_access where registered_at is not null")).rows[0].n,0);
  assert.deepEqual(await f.save(a,b.email),{status:"paired",partnerEmail:b.email},"repeated save is idempotent");
  await assert.rejects(()=>f.save(a,"someone-else@example.test"),{code:"P4210"});
  await assert.rejects(()=>f.repository.clearRegistrationCouple(a.auth),{code:"P4210"});
});

test("pending request can be corrected or cleared without exposing whether a recipient exists",async t=>{
  const f=await fixture(t),a=await f.member("a@example.test"),b=await f.member("b@example.test");
  assert.deepEqual(await f.save(a,"not-registered@example.test"),{status:"pending",partnerEmail:"not-registered@example.test"});
  assert.deepEqual(await f.save(a,b.email),{status:"pending",partnerEmail:b.email});
  assert.deepEqual(await f.repository.clearRegistrationCouple(a.auth),{status:"none",partnerEmail:null});
  assert.deepEqual(await f.read(a),{status:"none",partnerEmail:null});
  await assert.rejects(()=>f.save(a,a.email),{status:400});
  await assert.rejects(()=>f.save(a,"bad"),{status:400});
});

test("unfinished, underage, non-US and unverified accounts cannot consent; forged actor is rejected in SQL",async t=>{
  const f=await fixture(t),adult=await f.member("adult@example.test");
  for(const [key,options,status] of [["unfinished",{profile:false},409],["minor",{age:17},400],["foreign",{country:"CA"},400],["unverified",{verified:false},403]]) {
    const member=await f.member(`${key}@example.test`,options);
    if(key==="unfinished") assert.deepEqual(await f.read(member),{status:"none",partnerEmail:null},"can read intent before intake");
    await assert.rejects(()=>f.save(member,adult.email),{status});
    await assert.rejects(()=>f.db.query("insert into member_registration_couple_intents(member_id,partner_email_normalized,consented_by_auth_user_id) values($1,$2,$3)",[member.id,adult.email,member.auth]),{code:"P4212"});
  }
  const b=await f.member("b@example.test");
  await assert.rejects(()=>f.db.query("insert into member_registration_couple_intents(member_id,partner_email_normalized,consented_by_auth_user_id) values($1,$2,$3)",[adult.id,b.email,b.auth]),{code:"P4212"});
});

test("confirmed registration couples cannot be split across Circles before paying and can move atomically",async t=>{
  const f=await fixture(t),a=await f.member("a@example.test"),b=await f.member("b@example.test");
  await f.save(a,b.email);await f.save(b,a.email);
  await f.place(a.id,f.circleA);
  await assert.rejects(()=>f.place(b.id,f.circleB),/same Circle/);
  await f.place(b.id,f.circleA);
  await f.db.transaction(async tx=>{
    await tx.query("update circle_member_assignments set ended_at=now() where member_id in ($1,$2)",[a.id,b.id]);
    await f.place(a.id,f.circleB,tx);await f.place(b.id,f.circleB,tx);
  });
  assert.ok((await f.placements()).every(row=>row.circle_id===f.circleB));
});

test("confirmation rolls back when existing Circle placements conflict or a different paid pair exists",async t=>{
  const f=await fixture(t),a=await f.member("a@example.test"),b=await f.member("b@example.test"),c=await f.member("c@example.test");
  await f.place(a.id,f.circleA);await f.place(b.id,f.circleB);
  await f.save(a,b.email);
  await assert.rejects(()=>f.save(b,a.email),/same Circle/);
  assert.deepEqual(await f.read(b),{status:"none",partnerEmail:null});
  await f.db.query("update circle_member_assignments set ended_at=now() where member_id=$1",[b.id]);
  await f.pair({payer:a.id,partner:c.id});
  await assert.rejects(()=>f.save(b,a.email),{code:"21000"});
  assert.equal(await f.partnerOf(a.id),c.id);
});

test("direct anonymous and authenticated access to registration pair data is denied",async t=>{
  const f=await fixture(t);
  const row=(await f.db.query(`select has_table_privilege('authenticated','member_registration_couple_intents','select') as read,
    has_table_privilege('anon','member_registration_couple_intents','insert') as write,
    has_function_privilege('authenticated','private.ruined_registration_circle_couple_partner(uuid)','execute') as resolve`)).rows[0];
  assert.deepEqual(row,{read:false,write:false,resolve:false});
});

test("pair API accepts only owner intent with explicit consent and same-origin mutations",async()=>{
  let current={authUserId:randomUUID()},called=[];
  class RegistrationCoupleError extends Error {}
  const route=await load("app/api/my/registration/couple/route.ts",{
    "next/server":{NextResponse:{json:Response.json}},
    "@/lib/auth/request":{isTrustedPlatformOrigin:request=>request.headers.get("origin")==="https://members.example.test"},
    "@/lib/auth/session":{getCurrentPlatformViewer:async()=>current},
    "@/lib/platform/config":{getPlatformConfiguration:()=>({mode:"connected"})},
    "@/lib/membership/registration-couple":{
      RegistrationCoupleError,
      getRegistrationCouple:async actor=>{called.push(["get",actor]);return{status:"none",partnerEmail:null};},
      saveRegistrationCouple:async(...args)=>{called.push(["save",...args]);return{status:"pending",partnerEmail:args[1]};},
      clearRegistrationCouple:async actor=>{called.push(["clear",actor]);return{status:"none",partnerEmail:null};},
    },
  });
  const request=(body,origin="https://members.example.test")=>new Request("https://members.example.test/api/my/registration/couple",{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(body)});
  for(const body of [{partnerEmail:"p@example.test"},{partnerEmail:"p@example.test",consent:false},{partnerEmail:"p@example.test",consent:true,memberId:randomUUID()}]) assert.equal((await route.POST(request(body))).status,400);
  assert.equal((await route.POST(request({partnerEmail:"p@example.test",consent:true},"https://evil.example"))).status,403);
  assert.equal(called.length,0);
  assert.equal((await route.POST(request({partnerEmail:"p@example.test",consent:true}))).status,200);
  assert.deepEqual(called[0],["save",current.authUserId,"p@example.test"]);
  assert.equal((await route.DELETE(request({}))).status,200);
  current=null;assert.equal((await route.GET()).status,401);
});
