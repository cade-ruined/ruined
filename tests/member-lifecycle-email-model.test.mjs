import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
function load(file) {
  const source=readFileSync(new URL(`../src/lib/communications/${file}.ts`,import.meta.url),"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function("require","module","exports",output)(()=>{throw new Error("Unexpected runtime dependency");},loaded,loaded.exports);
  return loaded.exports;
}
const model=load("member-lifecycle-email-model"),copy=load("member-lifecycle-email-copy");
const dates={registeredAt:"2026-02-10T19:00:00Z",firstMembershipCallAt:"2026-03-12T21:00:00Z",birthDate:"1992-02-29"};
const occurrence=(key,year=2026,override={})=>model.lifecycleOccurrences(key,{...dates,...override},year)[0];
test("check-ins anchor to the attended call rather than registration and preserve Denver wall time",()=>{
  assert.equal(occurrence("checkin_30").dueAt,"2026-04-11T21:00:00.000Z");
  assert.equal(occurrence("checkin_90").dueAt,"2026-06-10T21:00:00.000Z");
  assert.equal(occurrence("checkin_6_month").dueAt,"2026-09-12T21:00:00.000Z");
  assert.equal(occurrence("checkin_30",2026,{firstMembershipCallAt:null}),undefined);
  assert.equal(occurrence("checkin_30",2026,{registeredAt:"2020-01-01T00:00:00Z"}).dueAt,occurrence("checkin_30").dueAt);
  assert.equal(model.localEmailTime("2026-03-07"),"2026-03-07T22:00:00.000Z");
  assert.equal(model.localEmailTime("2026-03-08"),"2026-03-08T21:00:00.000Z");
});
test("year one is a single registration anniversary; unfinished year-two copy never repeats",()=>{
  assert.equal(occurrence("anniversary",2027).occurrenceKey,"2027-02-10");
  assert.equal(occurrence("anniversary",2026),undefined);
  assert.equal(occurrence("anniversary",2028),undefined);
  assert.equal(occurrence("anniversary",2025,{registeredAt:"2024-02-29T22:00:00Z"}).occurrenceKey,"2025-02-28");
});
test("six-month calculations clamp month ends and birthday dates do not shift across UTC",()=>{
  assert.equal(occurrence("checkin_6_month",2026,{firstMembershipCallAt:"2026-08-31T21:00:00Z"}),undefined);
  assert.equal(occurrence("checkin_6_month",2027,{firstMembershipCallAt:"2026-08-31T21:00:00Z"}).occurrenceKey,"2027-02-28");
  assert.equal(occurrence("birthday").dueAt,"2026-02-28T17:00:00.000Z");
  assert.equal(occurrence("birthday",2028).occurrenceKey,"2028-02-29");
});
test("yearly holidays compute weekdays and keep Christmas and New Year closures separate",()=>{
  const closures=model.holidayClosures(2026);
  assert.deepEqual(closures.map(item=>[item.start,item.end]),[
    ["2026-05-25","2026-05-25"],["2026-07-04","2026-07-04"],["2026-09-07","2026-09-07"],
    ["2026-11-26","2026-11-27"],["2026-12-23","2026-12-27"],["2026-12-31","2027-01-01"],
  ]);
  assert.equal(occurrence("thanksgiving").occurrenceKey,"2026-11-19");
  assert.equal(occurrence("thanksgiving",2027).occurrenceKey,"2027-11-18");
  assert.equal(occurrence("christmas").occurrenceKey,"2026-12-17");
  assert.equal(occurrence("ruined_birthday").occurrenceKey,"2026-07-30");
  assert.equal(occurrence("new_year",2027).occurrenceKey,"2027-01-01");
});
test("activation, enrollment and expiry prevent replaying a missed milestone",()=>{
  const item=occurrence("checkin_30"),due=Date.parse(item.dueAt);
  const valid={now:new Date(due).toISOString(),activatedAt:new Date(due-1000).toISOString(),enrolledAt:new Date(due-2000).toISOString()};
  assert.equal(model.lifecycleOccurrenceIsDue(item,valid),true);
  for(const override of [{now:new Date(due-1).toISOString()},{now:item.expiresAt},{activatedAt:new Date(due+1).toISOString()},
    {enrolledAt:new Date(due+1).toISOString()},{enrolledAt:"invalid"}]) assert.equal(model.lifecycleOccurrenceIsDue(item,{...valid,...override}),false);
});
test("green copy does not bypass unavailable benefits, badge evidence or a new year's holiday approval",()=>{
  assert.ok(model.lifecycleMissing("birthday",{},2026).length);
  assert.ok(model.lifecycleMissing("checkin_30",{reviewUrl:"https://example.com/review"},2026).length);
  assert.ok(model.lifecycleMissing("checkin_90",{surveyUrl:"javascript:alert(1)"},2026).length);
  assert.deepEqual(model.lifecycleMissing("checkin_90",{surveyUrl:"https://example.com/form"},2026),[]);
  const settings={calendarYear:"2026",closureDetails:"December 23–27 and December 31–January 1",returnDate:"January 2",scheduleChanges:"None"};
  assert.deepEqual(model.lifecycleMissing("christmas",settings,2026),[]);
  assert.ok(model.lifecycleMissing("christmas",settings,2027).length);
  assert.ok(model.lifecycleMissing("checkin_6_month",{foundationsWorkLabel:"wrote your letter",foundationsWorkPath:"//attacker.example",fulfillmentMode:"none"},2026).length);
});
test("authored copy renders real member fields and separate closure periods without placeholders",()=>{
  const settings={calendarYear:"2026",closureDetails:"closed December 23–27 and December 31–January 1",returnDate:"January 2",scheduleChanges:"None"};
  const result=copy.lifecycleEmailCopy("christmas","Alex Example",settings,"https://members.theruinedproject.com");
  assert.match(result.body,/Alex, one quick housekeeping note/);
  assert.match(result.body,/closed December 23–27 and December 31–January 1/);
  assert.doesNotMatch(result.body,/\[|AI NOTE|\(NAME\)/);
  assert.equal(copy.lifecycleEmailCopy("anniversary","Alex Example",{},"https://members.theruinedproject.com").subject,"A year ago today.");
  assert.throws(()=>copy.lifecycleEmailCopy("birthday","Alex",{},"https://members.theruinedproject.com"),/remaining fields/);
});

test("baked lifecycle copy is editable with bounded named tokens and a mandatory preference link",()=>{
  const template=copy.getLifecycleEditableTemplate("anniversary");
  assert.ok(template.tokens.includes("{{member_name}}"));
  const edited={subject:"One year, {{member_name}}.",body:"{{member_name}}, thank you for being here."};
  const result=copy.lifecycleEmailCopy("anniversary","Alex Member",{},"https://members.theruinedproject.com",edited);
  assert.equal(result.subject,"One year, Alex.");assert.match(result.body,/Alex, thank you/);assert.match(result.body,/Manage your membership emails/);
  for(const invalid of [{...edited,subject:"Header\nInjected"},{...edited,body:"{{unknown}}"},{...edited,body:"<script>"},{...edited,body:"[INSERT LINK]"}])assert.throws(()=>copy.validateLifecycleCopy("anniversary",invalid));
  assert.ok(model.lifecycleMissing("birthday",{},2026).length,"copy editing cannot unlock an unavailable birthday benefit");
});
