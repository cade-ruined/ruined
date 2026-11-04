import assert from "node:assert/strict";
import test from "node:test";
import { loader, id, sid, installMemberSmsTemplateFixture } from "./helpers/member-sms-fixture.mjs";
import { oneOffFixture } from "./helpers/member-sms-one-off-fixture.mjs";

const MODEL="src/lib/communications/member-sms-template-model.ts", SERVICE="src/lib/communications/member-sms-template-service.ts";
const model=loader()(MODEL), origin="https://members.theruinedproject.com";
const fields=template=>({id:template.id,body:template.body,enabled:template.enabled,noticeMinutes:template.noticeMinutes,revision:template.revision});
async function fixture(t){
  const f=await oneOffFixture();t.after(()=>f.db.close());
  if(!(await f.db.query("select to_regclass('private.member_sms_templates') as relation")).rows[0].relation)await installMemberSmsTemplateFixture(f.db);
  await f.db.exec("alter table operator_audit_events add column before_snapshot jsonb; alter table operator_audit_events add column after_snapshot jsonb; alter table operator_audit_events add column dedupe_key text unique");
  const service=f.load(SERVICE), transport=f.load("src/lib/communications/member-sms-service.ts");
  const get=async templateId=>(await service.getMemberSmsTemplates(f.admin)).templates.find(template=>template.id===templateId);
  const save=async changes=>{const current=await get(changes.id),edit={...fields(current),...changes};const preview=await service.previewMemberSmsTemplate(f.admin,edit);return service.saveMemberSmsTemplate(f.admin,{...edit,reviewDigest:preview.reviewDigest});};
  return {...f,service,transport,get,save};
}
const fails=(promise,status)=>assert.rejects(promise,error=>error.status===status);

test("default saved template renderings preserve current exact bodies, required disclosures and stage selection",()=>{
  const legacy=loader()("src/lib/communications/member-sms-model.ts"),templates=model.defaultMemberSmsTemplates();
  for(const template of templates){
    const input={memberId:id(1),kind:"opt_in_confirmation",expectedConsentId:"1",reminderKey:"consent:1"};
    if(template.id!=="opt_in_confirmation")Object.assign(input,{kind:"call_reminder",reminderKey:"preview:call",callDetails:{eventId:id(2),title:"Membership call",startsAt:"2030-01-15T19:00:00.000Z",timeZone:"America/Denver",foundations01:template.id==="foundations_01",meetingUrl:"https://meet.google.com/abc-defg-hij",...(template.id==="day_before"?{reminderStage:"day_before"}:{})}});
    const rendered=model.renderMemberSmsTemplate(template,input,origin);
    if(template.id!=="day_before")assert.equal(rendered,legacy.memberSmsReminderBody(input,origin));
    assert.equal(model.memberSmsTemplateId(input),template.id);assert.match(rendered,/Reply STOP to unsubscribe/);assert.match(rendered,/HELP/);
    assert.equal(template.revision,0);assert.equal(template.effectiveAt,"1970-01-01T00:00:00.000Z");
  }
  const confirmation=model.memberSmsTemplatePreview(templates[0]);
  for(const text of ["Message frequency varies", "Message and data rates may apply", "connect@theruinedproject.com"])assert.ok(confirmation.includes(text));
  assert.equal(templates.find(t=>t.id==="day_before").enabled,false);
});

test("template edits validate exact shape, brand, plaintext, known placeholders, joining links and fixed timing",()=>{
  const defaults=model.defaultMemberSmsTemplates(),standard=fields(defaults[1]),confirmation=fields(defaults[0]);
  for(const edit of [{...standard,body:"No brand {{call_link}}"},{...standard,body:"Ruined: <b>Call</b> {{call_link}}"},
    {...standard,body:"Ruined: {{secret}} {{call_link}}"},{...standard,body:"Ruined: {{call_link}"},{...standard,body:"Ruined: no link"},
    {...standard,body:"Ruined: \u0000 {{call_link}}"},{...standard,body:"Ruined: "+"a".repeat(901)+" {{call_link}}"},
    {...standard,body:"Ruined: "+"{{call_title}} ".repeat(5)+" {{call_link}}"},{...standard,noticeMinutes:14},{...standard,noticeMinutes:721},
    {...standard,noticeMinutes:30.5},{...standard,noticeMinutes:null},{...standard,revision:-1},{...standard,extra:true},
    {...confirmation,enabled:false},{...confirmation,noticeMinutes:5},{...confirmation,body:"Ruined: {{call_title}}"},
    {...fields(defaults[3]),noticeMinutes:60},{...fields(defaults[2]),body:"RU/NED starts soon."}])assert.throws(()=>model.validateMemberSmsTemplateEdit(edit));
  assert.equal(model.validateMemberSmsTemplateEdit({...standard,body:"  Ruined: {{call_title}} at {{call_time}}. {{call_link}}\r\n "}).body,"Ruined: {{call_title}} at {{call_time}}. {{call_link}}");
});

test("private template storage defaults are exact and browser roles cannot read or alter them",async t=>{
  const f=await fixture(t),saved=(await f.service.getMemberSmsTemplates(f.admin)).templates;
  assert.deepEqual(saved.map(fields),model.defaultMemberSmsTemplates().map(fields));
  assert.equal((await f.db.query("select relrowsecurity from pg_class where oid='private.member_sms_templates'::regclass")).rows[0].relrowsecurity,true);
  for(const role of ["anon","authenticated"]){
    await f.db.exec(`set role ${role}`);await assert.rejects(()=>f.db.query("select * from private.member_sms_templates"),/permission denied/);await f.db.exec("reset role");
  }
  await assert.rejects(()=>f.db.query("update private.member_sms_templates set enabled=false where id='opt_in_confirmation'"),/check constraint/);
  await assert.rejects(()=>f.db.query("update private.member_sms_templates set notice_minutes=null where id='call_reminder'"),/check constraint/);
  await assert.rejects(()=>f.db.query("update private.member_sms_templates set notice_minutes=60 where id='day_before'"),/check constraint/);
});

test("only active admins preview/save; reviewed revision persists with audit and no messages",async t=>{
  const f=await fixture(t),current=await f.get("call_reminder"),edit={...fields(current),body:"Ruined: {{call_title}} at {{call_time}}. Join: {{call_link}}.",noticeMinutes:45};
  await fails(f.service.getMemberSmsTemplates(f.ordinary),403);await fails(f.service.previewMemberSmsTemplate(f.ordinary,edit),403);
  f.queries.length=0;const preview=await f.service.previewMemberSmsTemplate(f.admin,edit);
  assert.doesNotMatch(f.queries.join("\n"),/\b(insert|update|delete)\b|for\s+(share|update)/i);
  assert.equal((await f.get("call_reminder")).revision,0);assert.match(preview.preview,/Membership call at 12:00 PM MT/);
  await fails(f.service.saveMemberSmsTemplate(f.ordinary,{...edit,reviewDigest:preview.reviewDigest}),403);
  await fails(f.service.saveMemberSmsTemplate(f.admin,{...edit,body:edit.body+" Changed.",reviewDigest:preview.reviewDigest}),409);
  const saved=await f.service.saveMemberSmsTemplate(f.admin,{...edit,reviewDigest:preview.reviewDigest});
  assert.equal(saved.template.revision,1);assert.equal(saved.template.updatedBy,f.admin);assert.equal(saved.template.noticeMinutes,45);
  assert.equal(saved.preview,preview.preview);assert.ok(Date.now()-Date.parse(saved.template.effectiveAt)<10000);
  await fails(f.service.saveMemberSmsTemplate(f.admin,{...edit,reviewDigest:preview.reviewDigest}),409);
  const audit=(await f.db.query("select * from operator_audit_events")).rows;assert.equal(audit.length,1);assert.equal(audit[0].action,"member_sms.template_saved");
  assert.equal(audit[0].before_snapshot.revision,0);assert.equal(audit[0].after_snapshot.revision,1);assert.equal(audit[0].actor_auth_user_id,f.admin);
  const noChange=fields(saved.template),review=await f.service.previewMemberSmsTemplate(f.admin,noChange);
  assert.equal((await f.service.saveMemberSmsTemplate(f.admin,{...noChange,reviewDigest:review.reviewDigest})).template.revision,1);
  assert.equal((await f.db.query("select count(*)::int as n from operator_audit_events")).rows[0].n,1);
  assert.equal(f.calls.length,0);assert.equal((await f.db.query("select count(*)::int as n from private.member_sms_delivery_attempts")).rows[0].n,0);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[f.admin]);await fails(f.service.previewMemberSmsTemplate(f.admin,noChange),403);
});

test("edited confirmation reaches transport once with locked disclosure and exact body history snapshot",async t=>{
  const f=await fixture(t),m=await f.member(),consentId=await f.consent(m);
  const saved=await f.save({id:"opt_in_confirmation",body:"RU/NED: You’re signed up for membership texts."});
  const input={memberId:m.memberId,kind:"opt_in_confirmation",expectedConsentId:consentId,reminderKey:`consent:${consentId}`};
  const sent=await f.transport.sendMemberSmsReminder(input);assert.equal(sent.status,"accepted");assert.equal(f.calls.length,1);assert.equal(f.calls[0].body,saved.preview);
  const original=(await f.db.query("select body_text,body_sha256 from private.member_sms_delivery_attempts where id=$1",[sent.attemptId])).rows[0];assert.equal(original.body_text,saved.preview);
  await f.save({id:"opt_in_confirmation",body:"Ruined: Your membership text permission is saved."});
  const history=(await f.view()).history.items.find(item=>item.id===sent.attemptId);assert.equal(history.body,original.body_text);assert.equal(history.bodySource,"snapshot");
  assert.equal((await f.transport.sendMemberSmsReminder(input)).status,"duplicate");assert.equal(f.calls.length,1);
});

for(const change of ["template_edit","template_disable","stop"]){
  test(`dispatch rechecks ${change} after reservation and never sends stale or suppressed copy`,async t=>{
    const f=await fixture(t),m=await f.member(),consentId=await f.consent(m),event=await f.event();
    const input={memberId:m.memberId,kind:"call_reminder",expectedConsentId:consentId,reminderKey:`template-race:${change}`,
      callDetails:{eventId:event.eventId,title:event.title,startsAt:event.startsAt,timeZone:event.timeZone}};
    f.hooks.afterTransaction=async()=>{
      if(!(await f.db.query("select count(*)::int as n from private.member_sms_delivery_attempts")).rows[0].n)return;
      f.hooks.afterTransaction=null;
      if(change==="stop")await f.db.query("insert into private.member_sms_phone_suppressions(phone_e164,latest_message_sid) values($1,$2)",[m.phone,sid(200)]);
      else await f.db.query("update private.member_sms_templates set revision=revision+1,updated_by=$1,enabled=$2 where id='call_reminder'",[f.admin,change!=="template_disable"]);
    };
    const result=await f.transport.sendMemberSmsReminder(input);assert.equal(result.status,"blocked");assert.equal(f.calls.length,0);
    assert.equal(result.reason,change==="stop"?"phone_suppressed":"source_ineligible");
    assert.equal((await f.transport.sendMemberSmsReminder(input)).status,change==="template_disable"?"blocked":change==="stop"?"blocked":"duplicate");assert.equal(f.calls.length,0);
  });
}

test("missing saved template configuration fails visibly and cannot fall back to sending defaults",async t=>{
  const f=await fixture(t),m=await f.member(),consentId=await f.consent(m);
  await f.db.query("delete from private.member_sms_templates where id='day_before'");
  await fails(f.service.getMemberSmsTemplates(f.admin),503);
  await fails(f.transport.sendMemberSmsReminder({memberId:m.memberId,kind:"opt_in_confirmation",expectedConsentId:consentId,reminderKey:`consent:${consentId}`}),503);
  assert.equal(f.calls.length,0);
});
