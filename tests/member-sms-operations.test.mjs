import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import ts from "typescript";
import { id, sid, read } from "./helpers/member-sms-fixture.mjs";
import { operationsFixture } from "./helpers/member-sms-operations-fixture.mjs";

const hash = body => createHash("sha256").update(body).digest("hex");
const ORIGIN = "https://members.theruinedproject.com";
async function attempt(f, m, consentId, options = {}) {
  const kind = options.kind ?? "opt_in_confirmation", key = options.key ?? `consent:${consentId}`;
  const body = options.body ?? f.load("src/lib/communications/member-sms-model.ts").memberSmsReminderBody({ memberId: m.memberId, kind, reminderKey: kind === "opt_in_confirmation" ? `consent:${consentId}` : key, expectedConsentId: consentId }, ORIGIN);
  const result = await f.db.query(`insert into private.member_sms_delivery_attempts(member_id,reminder_key,reminder_kind,destination_e164,consent_id,body_sha256,body_text,status,twilio_message_sid,delivery_status)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [m.memberId, key, kind, m.phone, consentId,
    options.hash ?? hash(body), options.snapshot ? body : null, options.status ?? "accepted", options.status && options.status !== "accepted" ? null : sid(Math.floor(Math.random() * 1e10)), options.deliveryStatus ?? null]);
  return result.rows[0].id;
}
async function fixture(t) { const f = await operationsFixture(); t.after(() => f.db.close()); return f; }

test("SMS operations enforces current administrator access and makes only read-only queries", async t => {
  const f = await fixture(t), m = await f.member(); await f.consent(m); await f.event();
  await assert.rejects(f.service.getMemberSmsOperationsOverview(f.ordinary), error => error.status === 403);
  const before = (await f.db.query("select (select count(*) from member_consents) as consents,(select count(*) from private.member_sms_delivery_attempts) as attempts,(select count(*) from private.member_sms_automation_jobs) as jobs")).rows;
  const result = await f.view();
  assert.equal(result.upcoming.items.length, 1);
  assert.equal(result.upcoming.items[0].confirmation, "required");
  assert.equal(result.upcoming.items[0].recipient.name, "Test Member");
  assert.match(result.upcoming.items[0].recipient.maskedPhone, /••• \d{4}/);
  assert.ok(!JSON.stringify(result).includes(m.phone));
  assert.ok(!JSON.stringify(result).includes(f.env.TWILIO_AUTH_TOKEN));
  assert.equal(result.automation.state, "enabled");
  assert.equal(result.templates.length, 3);
  assert.deepEqual((await f.db.query("select (select count(*) from member_consents) as consents,(select count(*) from private.member_sms_delivery_attempts) as attempts,(select count(*) from private.member_sms_automation_jobs) as jobs")).rows, before);
  assert.ok(f.queries.every(query => !/for\s+(share|update)|ruined_lock_|\b(insert|update|delete)\b/i.test(query)));
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.admin]);
  await assert.rejects(f.view(), error => error.status === 403);
});

test("forecasts follow latest consent, phone, suppression, hold, registration and current event eligibility", async t => {
  const f = await fixture(t), m = await f.member(); await f.consent(m); const e = await f.event();
  assert.equal((await f.view()).upcoming.items.length, 1);
  const other = await f.member(); await f.db.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [m.phone, other.personId]);
  assert.equal((await f.view()).upcoming.items[0].recipient.sharedPhone, true, "shared number is flagged, matching worker behavior");
  await f.db.query("update person_private_profiles set mobile_e164='+12025559999' where person_id=$1", [m.personId]);
  assert.equal((await f.view()).upcoming.items.length, 0);
  await f.db.query("update person_private_profiles set mobile_e164=$1 where person_id=$2", [m.phone, m.personId]);
  await f.consent(m, { decision: "withdrawn" }); assert.equal((await f.view()).upcoming.items.length, 0);
  await f.consent(m); await f.db.query("insert into private.member_sms_phone_suppressions(phone_e164,latest_message_sid) values($1,$2)", [m.phone, sid(400)]);
  assert.equal((await f.view()).upcoming.items.length, 0);
  await f.db.exec("delete from private.member_sms_phone_suppressions");
  await f.db.query("insert into member_registration_access(member_id) values($1)", [m.memberId]);
  assert.equal((await f.view()).upcoming.items.length, 0);
  await f.db.query("update member_registration_access set profile_activated_at=now() where member_id=$1", [m.memberId]);
  await f.db.query("update experiences set visibility='public' where id=$1", [e.eventId]);
  assert.equal((await f.view()).upcoming.items.length, 0);
  await f.db.query("insert into experience_registrations(experience_id,person_id,member_id,status) values($1,$2,$3,'registered')", [e.eventId,m.personId,m.memberId]);
  assert.equal((await f.view()).upcoming.items.length, 1);
  await f.db.exec("update experience_registrations set status='cancelled'"); assert.equal((await f.view()).upcoming.items.length, 0);
  await f.db.exec("update experience_registrations set status='registered'; update experiences set cancelled_at=now()"); assert.equal((await f.view()).upcoming.items.length, 0);
  await f.db.exec("update experiences set cancelled_at=null; delete from integration_entity_links"); assert.equal((await f.view()).upcoming.items.length, 0);
});

test("Foundations timing comes from binding; future activation and stale durable jobs cannot promise a new send", async t => {
  const f = await fixture(t), m = await f.member(); const c = await f.consent(m); const e = await f.event({ title: "Foundations 01", startsAt: f.ago(-148) });
  assert.equal((await f.view()).upcoming.items[0].dueAt, new Date(Date.parse(e.startsAt)-60*60000).toISOString(), "title alone uses standard notice");
  await f.db.query("insert into private.member_email_cadence_event_bindings values($1,'foundations_01')", [e.eventId]);
  assert.equal((await f.view()).upcoming.items.length, 0, "invalid Foundations binding is not a standard call");
  await f.db.exec("update experiences set visibility='invite_only',registration_mode='internal'");
  await f.db.query("insert into experience_registrations(experience_id,person_id,member_id,status,source) values($1,$2,$3,'registered','ops')", [e.eventId,m.personId,m.memberId]);
  let result = await f.view(); assert.equal(result.upcoming.items[0].dueAt, new Date(Date.parse(e.startsAt)-150*60000).toISOString());
  assert.match(result.upcoming.items[0].body, /RU\/NED Foundations starts today/);
  f.env.MEMBER_SMS_AUTOMATION_ACTIVATED_AT=f.ago(-10);
  assert.equal((await f.view()).upcoming.items.length, 0, "window earlier than future activation excluded");
  f.env.MEMBER_SMS_AUTOMATION_ACTIVATED_AT=f.ago(60);
  await f.db.exec("delete from private.member_email_cadence_event_bindings; update experiences set visibility='all_members',registration_mode='none'");
  const startsAt=f.ago(-58); await f.db.query("update experiences set starts_at=$1 where id=$2",[startsAt,e.eventId]);
  const key=`call:${e.eventId}:${Date.parse(startsAt)}:60m`;
  await f.db.query(`insert into private.member_sms_automation_jobs(member_id,reminder_kind,reminder_key,expected_consent_id,experience_id,starts_at,due_at,expires_at)
    values($1,'call_reminder',$2,$3,$4,$5,$6,$7)`,[m.memberId,key,c,e.eventId,startsAt,f.ago(92),f.ago(82)]);
  result=await f.view(); assert.equal(result.upcoming.items.length,0); assert.equal(result.jobs.items[0].status,'queued');
  await f.db.exec("update private.member_sms_automation_jobs set status='processing'");
  result=await f.view(); assert.equal(result.jobs.items[0].status,'processing'); assert.equal(result.upcoming.items.length,0);
});

test("confirmation dependencies use exact kind and consent; any occurrence attempt prevents forecast retry", async t => {
  const f = await fixture(t), m = await f.member(); const c=await f.consent(m); const e=await f.event();
  await attempt(f,m,c,{kind:'call_reminder',key:`consent:${c}`,body:'unrelated body'});
  assert.equal((await f.view()).upcoming.items[0].confirmation,'required');
  const another=await f.consent(m); await attempt(f,m,c,{key:`consent:${another}`});
  assert.equal((await f.view()).upcoming.items[0].confirmation,'unavailable');
  await f.db.query("update private.member_sms_delivery_attempts set consent_id=$1 where reminder_kind='opt_in_confirmation'",[another]);
  assert.equal((await f.view()).upcoming.items[0].confirmation,'accepted');
  await f.db.exec("update private.member_sms_delivery_attempts set delivery_status='failed' where reminder_kind='opt_in_confirmation'");
  assert.equal((await f.view()).upcoming.items[0].confirmation,'unavailable');
  await attempt(f,m,another,{kind:'call_reminder',key:`call:${e.eventId}:${Date.parse(e.startsAt)}:60m`,body:'fixture call',status:'unknown'});
  const result=await f.view(); assert.equal(result.upcoming.items.length,0); assert.equal(result.history.items.find(row=>row.status==='unknown').body,null);
});

test("history uses exact stored text or matching legacy hash and pages tied microsecond dates without omissions", async t => {
  const f=await fixture(t),m=await f.member(); const c=await f.consent(m);
  const snapshot=await attempt(f,m,c,{key:'saved-body',snapshot:true,body:'Ruined: exact saved message. Reply STOP to unsubscribe.'});
  const legacy=await attempt(f,m,c,{kind:'membership_reminder',key:'legacy-body'});
  const unavailable=await attempt(f,m,c,{key:'legacy-unknown',hash:'0'.repeat(64)});
  await attempt(f,m,c,{kind:'call_reminder',key:'call:------------------------------------:1700000000000:60m',body:'malformed old key'});
  let result=await f.view();
  assert.equal(result.history.items.find(row=>row.id===snapshot).bodySource,'snapshot');
  assert.equal(result.history.items.find(row=>row.id===legacy).bodySource,'verified_reconstruction');
  assert.equal(result.history.items.find(row=>row.id===unavailable).bodySource,'unavailable');
  await f.db.exec("delete from private.member_sms_delivery_attempts");
  await f.db.query(`insert into private.member_sms_delivery_attempts(member_id,reminder_key,reminder_kind,destination_e164,consent_id,body_sha256,created_at)
    select $1,'page:'||n,'membership_reminder',$2,$3,$4,'2026-11-01T10:00:00.123456Z' from generate_series(1,55) n`,[m.memberId,m.phone,c,'0'.repeat(64)]);
  const first=await f.view(),second=await f.view({cursor:first.history.nextCursor});
  assert.equal(first.history.items.length,50);assert.equal(second.history.items.length,5);
  assert.equal(new Set([...first.history.items,...second.history.items].map(row=>row.id)).size,55);
  assert.equal(second.history.nextCursor,null);
  for(const cursor of ['', 'bad', Buffer.from(JSON.stringify({id:id(1),createdAt:'2026-02-30T00:00:00.000Z'})).toString('base64url')]) {
    await assert.rejects(f.view({cursor}),error=>error.status===400);
  }
});

test("fresh confirmation remains readable without Google setup, and read route reports auth/errors without false empty results",async t=>{
  const f=await fixture(t),m=await f.member();await f.consent(m,{acceptedAt:f.ago(1)});
  delete f.env.GOOGLE_COMMUNICATIONS_LIVEMODE;
  const result=await f.view();assert.equal(result.automation.ready,true);assert.equal(result.automation.callReady,false);
  assert.equal(result.upcoming.items[0].kind,'opt_in_confirmation');assert.equal(result.automation.warnings.length,1);
  let viewer=null;const logs=[];const routeModule={exports:{}};
  const code=ts.transpileModule(read('app/api/ops/messages/texts/route.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports','console',code)(name=>{
    if(name==='@/lib/auth/session')return{getCurrentPlatformViewer:async()=>viewer};
    if(name==='@/lib/communications/member-sms-operations')return f.service;
    if(name==='@/lib/platform/ops-api')return{opsJson:(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})};
    throw Error(name);
  },routeModule,routeModule.exports,{error:(...args)=>logs.push(args)});
  const route=routeModule.exports;const request=()=>new Request('https://members.theruinedproject.com/api/ops/messages/texts');
  assert.equal((await route.GET(request())).status,401);
  viewer={authUserId:f.ordinary};assert.equal((await route.GET(request())).status,403);
  viewer={authUserId:f.admin};let response=await route.GET(request());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal((await route.GET(new Request(request().url+'?cursor=bad'))).status,400);
  assert.equal((await route.GET(new Request(request().url+'?send=true'))).status,400);
  assert.equal(route.POST,undefined);assert.equal(route.PATCH,undefined);
  await f.db.exec('alter table private.member_sms_delivery_attempts drop column body_text');
  response=await route.GET(request());assert.equal(response.status,503);assert.ok((await response.json()).error);assert.equal(logs.length,1);
});
