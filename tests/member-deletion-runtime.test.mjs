import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const runner = await source("scripts/migrate-platform.mjs");
const migrations = await Promise.all([...runner.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => source(match[1])));
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const admin = id(1), member = id(2), auth = id(3), portrait = id(4), other = id(5);

async function fixture(t, accountState = "closed") {
  // The complete shipped schema runs only in memory, never on DATABASE_URL.
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const migration of migrations) await db.exec(migration);
  await db.query("insert into platform_users(auth_user_id,email_normalized,user_type,status) values($1,'admin@example.test','staff','active')", [admin]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [admin]);
  await db.query("insert into ruined_members(id,email,email_normalized) values($1,'member@example.test','member@example.test')", [member]);
  const person = (await db.query("select person_id from ruined_members where id=$1", [member])).rows[0].person_id;
  await db.query("insert into member_lifecycle(member_id,account_state) values($1,$2)", [member,accountState]);
  const identityStatus = accountState === "active" ? "active" : accountState === "suspended" ? "suspended" : accountState === "closed" ? "disabled" : "invited";
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,'member@example.test',$4)", [auth,member,person,identityStatus]);
  await db.query("insert into person_profiles(person_id,display_name,member_tag,bio,avatar_storage_path) values($1,'Former Member','former_member','Private biography',$2) on conflict(person_id) do update set display_name=excluded.display_name,member_tag=excluded.member_tag,bio=excluded.bio,avatar_storage_path=excluded.avatar_storage_path", [person,`/api/member-photos/${member}/${portrait}.webp`]);
  await db.query("insert into person_private_profiles(person_id,legal_name,birth_date) values($1,'Private Legal Name','1990-01-01')", [person]);
  const eligibility = async (actor = admin) => (await db.query("select private.ruined_member_deletion_eligibility($1,$2) as result", [actor,member])).rows[0].result;
  const remove = async (overrides = {}, connection = db) => (await connection.query("select private.ruined_delete_member($1,$2,$3,$4,$5) as result", [overrides.actor ?? admin,member,overrides.version ?? 1,overrides.email ?? "member@example.test",overrides.reason ?? "account_removal"])).rows[0].result;
  return { db,person,eligibility,remove };
}

test("administrator authorization, confirmation, version and reason remain mandatory and failure does not close an active account", async t => {
  const { db,eligibility,remove } = await fixture(t,"active");
  const before = (await db.query("select to_jsonb(m) as row from ruined_members m where id=$1", [member])).rows;
  assert.equal((await eligibility()).allowed,true);
  await assert.rejects(eligibility(auth), error => error.code === "PT403");
  await assert.rejects(remove({ actor: auth }), error => error.code === "PT403");
  for (const overrides of [{ version: 99 },{ email:"wrong@example.test" },{ reason:"anything" }]) {
    await assert.rejects(remove(overrides), error => ["PT400","PT409"].includes(error.code));
  }
  assert.deepEqual((await db.query("select to_jsonb(m) as row from ruined_members m where id=$1", [member])).rows,before);
  assert.equal((await db.query("select count(*)::int n from private.member_deletion_jobs")).rows[0].n,0);
  assert.equal((await db.query("select account_state from member_lifecycle where member_id=$1",[member])).rows[0].account_state,"active");
  assert.equal((await db.query("select count(*)::int n from member_state_history")).rows[0].n,0);
  await db.query("update platform_role_grants set revoked_at=statement_timestamp(),revoke_reason='Revoked during review' where auth_user_id=$1 and role_slug='ops_admin'",[admin]);
  await assert.rejects(remove(),error=>error.code==="PT403");
  assert.equal((await db.query("select account_state from member_lifecycle where member_id=$1",[member])).rows[0].account_state,"active");
});

test("Delete closes every account state atomically, records a real transition once and excludes the historical member from current counts",async t=>{
  for(const state of ["active","provisional","suspended","invited","closed"]){
    await t.test(state,async context=>{
      const {db,person,eligibility,remove}=await fixture(context,state);
      await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[auth]);
      assert.equal((await eligibility()).allowed,true);
      const result=await remove();
      assert.equal(result.deleted,true);
      const lifecycle=(await db.query("select account_state,standing_state,program_state,version from member_lifecycle where member_id=$1",[member])).rows[0];
      assert.deepEqual(lifecycle,{account_state:"closed",standing_state:"inactive",program_state:"withdrawn",version:2});
      const history=(await db.query("select previous_state,next_state,source,actor_auth_user_id,reason_code,metadata from member_state_history where member_id=$1 and dimension='account'",[member])).rows;
      assert.deepEqual(history,state === "closed" ? [] : [{previous_state:state,next_state:"closed",source:"ops",actor_auth_user_id:admin,reason_code:"member_account_deleted",metadata:{cleanupId:result.cleanupId,reason:"account_removal"}}]);
      assert.equal((await db.query("select count(*)::int n from ruined_members where deleted_at is null")).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from private.member_deletion_records where member_id=$1",[member])).rows[0].n,1);
      assert.equal((await db.query("select count(*)::int n from person_profiles where person_id=$1",[person])).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from platform_role_grants where auth_user_id=$1 and revoked_at is null",[auth])).rows[0].n,0);
      assert.deepEqual(await remove(),result);
      assert.equal((await db.query("select count(*)::int n from member_state_history where member_id=$1 and dimension='account'",[member])).rows[0].n,state === "closed" ? 0 : 1);
    });
  }
});

test("removal erases live profiles and authored content, preserves original history and creates one historical record and cleanup job", async t => {
  const { db,person,eligibility,remove } = await fixture(t);
  await db.query("insert into member_timeline_entries(member_id,entry_year,title,details) values($1,2020,'Personal event','Sensitive details')",[member]);
  await db.query("insert into member_journal_entries(id,member_id,kind,body) values($1,$2,'text','Private journal')",[id(11),member]);
  await db.query("insert into member_journal_media(id,member_id,storage_path,mime_type,byte_size) values($1,$2,$3,'image/webp',12)",[id(12),member,`${member}/pending/${id(12)}`]);
  await db.query("insert into member_public_cards(member_id,public_token,wear_seed,public_enabled) values($1,$2,$3,true)",[member,"a".repeat(43),"b".repeat(24)]);
  await db.query("insert into member_invitations(member_id,public_token,enabled) values($1,$2,true)",[member,"c".repeat(43)]);
  await db.query("insert into member_personal_invitations(id,member_id,request_id,public_token,recipient_name,recipient_email_normalized,inviter_name,email_requested,delivery_payload) values($1,$2,$3,$4,'Private Recipient','recipient@example.test','Former Member',true,$5::jsonb)", [id(13),member,id(14),"p".repeat(43),JSON.stringify({to:"recipient@example.test",html:"Private invitation"})]);
  await db.query("insert into membership_waitlist(id,name,email_normalized) values($1,'Recipient','recipient@example.test')", [id(15)]);
  await db.query("insert into member_referrals(waitlist_id,inviter_member_id,personal_invitation_id) values($1,$2,$3)", [id(15),member,id(13)]);
  await db.query("insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,reason,before_snapshot,metadata) values($1,'member.state_override_applied','member',$2,$3,'Original reason','{\"evidence\":true}','{\"kept\":true}')",[admin,member,member]);
  const audit = (await db.query("select to_jsonb(a) as value from operator_audit_events a order by id")).rows;
  const history = (await db.query("select to_jsonb(h) as value from member_state_history h order by id")).rows;
  const result = await remove({email:"  MEMBER@example.test  "});
  assert.equal(result.deleted,true);
  for (const table of ["person_profiles","person_private_profiles","person_email_addresses","member_journal_entries","member_journal_media","member_timeline_entries","member_timeline_entry_versions","member_public_cards","member_invitations","member_personal_invitations"]) {
    const column = table.startsWith("person_") ? "person_id" : "member_id";
    assert.equal((await db.query(`select count(*)::int n from ${table} where ${column}=$1`,[column === "person_id" ? person : member])).rows[0].n,0,table);
  }
  assert.deepEqual((await db.query("select inviter_member_id,personal_invitation_id from member_referrals where waitlist_id=$1",[id(15)])).rows[0],{inviter_member_id:member,personal_invitation_id:null});
  assert.deepEqual((await db.query("select to_jsonb(a) as value from operator_audit_events a where action <> 'member.account_deleted' order by id")).rows,audit);
  assert.deepEqual((await db.query("select to_jsonb(h) as value from member_state_history h order by id")).rows,history);
  const saved = (await db.query("select * from private.member_deletion_records where member_id=$1",[member])).rows[0];
  assert.equal(saved.display_name,"Former Member");assert.equal(saved.member_tag,"former_member");assert.equal(saved.actor_auth_user_id,admin);
  assert.equal(Object.keys(saved).some(key=>/email|legal|phone|birth/.test(key)),false);
  const target = (await db.query("select * from ruined_members where id=$1",[member])).rows[0];
  assert.ok(target.deleted_at);assert.equal(target.person_id,person);assert.equal(target.email,`deleted+${member}@members.invalid`);
  const identity=(await db.query("select * from platform_users where auth_user_id=$1",[auth])).rows[0];
  assert.equal(identity.status,"disabled");assert.equal(identity.member_id,null);assert.equal(identity.email_normalized,`deleted+${auth}@members.invalid`);
  assert.equal((await db.query("select status from people where id=$1",[person])).rows[0].status,"erased");
  const job=(await db.query("select * from private.member_deletion_jobs where id=$1",[result.cleanupId])).rows[0];
  assert.deepEqual(job.auth_user_ids,[auth]);assert.deepEqual(job.storage_objects.sort((a,b)=>a.bucket.localeCompare(b.bucket)),[
    {bucket:"member-journal",path:`${member}/pending/${id(12)}`},{bucket:"member-portraits",path:`${member}/${portrait}.webp`},
  ]);
  assert.deepEqual(await remove(),result,"Authorized retry returns the same cleanup job.");
  assert.ok((await eligibility()).blockers.includes("already_deleted"));
  assert.equal((await db.query("select version from member_lifecycle where member_id=$1",[member])).rows[0].version,2);
});

test("numbered former members and terminal live financial history are retained rather than rejected or renumbered", async t => {
  const {db,eligibility,remove}=await fixture(t);
  await db.query("insert into private.member_number_assignments(member_number,member_id,activated_at) values(1,$1,now())",[member]);
  await db.query("update ruined_members set member_number=1 where id=$1",[member]);
  await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,last_event_created) values('sub_live',$1,'cus_live','canceled',1)",[member]);
  await db.query("insert into stripe_invoices(id,member_id,stripe_customer_id,stripe_subscription_id,purpose,stripe_status,currency,last_event_created) values('in_live',$1,'cus_live','sub_live','membership','paid','usd',1)",[member]);
  await db.exec("insert into stripe_webhook_events(event_id,event_type,object_id,livemode,stripe_created,status) values('evt_live','invoice.paid','in_live',true,1,'processed')");
  assert.equal((await eligibility()).allowed,true);
  const invoice=(await db.query("select to_jsonb(i) as value from stripe_invoices i")).rows;
  await remove();
  assert.deepEqual((await db.query("select to_jsonb(i) as value from stripe_invoices i")).rows,invoice);
  assert.equal((await db.query("select member_number from ruined_members where id=$1",[member])).rows[0].member_number,1);
  assert.equal((await db.query("select member_number from private.member_deletion_records where member_id=$1",[member])).rows[0].member_number,1);
  assert.equal((await db.query("select count(*)::int n from private.member_number_assignments")).rows[0].n,1);
  await assert.rejects(db.query("update ruined_members set member_number=null where id=$1",[member]),/permanent|immutable/);
});

test("open billing, staff history, self deletion, shared identity and pending workflows block account removal", async t => {
  const {db,person,eligibility,remove}=await fixture(t,"active");
  await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,last_event_created) values('sub_test',$1,'cus_test','active',1)",[member]);
  assert.ok((await eligibility()).blockers.includes("stripe_not_terminal"));
  await assert.rejects(remove(), error=>error.code==="PT409");
  assert.equal((await db.query("select account_state from member_lifecycle where member_id=$1",[member])).rows[0].account_state,"active");
  assert.equal((await db.query("select count(*)::int n from member_state_history")).rows[0].n,0);
  await db.exec("update stripe_subscriptions set stripe_status='canceled'");
  await db.query("insert into platform_role_grants(auth_user_id,role_slug,revoked_at) values($1,'guide',statement_timestamp())",[auth]);
  assert.ok((await eligibility()).blockers.includes("operator_identity"));
  await db.transaction(async tx=>{
    await tx.query("update platform_users set status='active' where auth_user_id=$1",[auth]);
    await tx.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[auth]);
    const self=(await tx.query("select private.ruined_member_deletion_eligibility($1,$2) as result",[auth,member])).rows[0].result;
    assert.ok(self.blockers.includes("self_deletion"));
  });
  await db.query("insert into person_merge_events(source_person_id,target_person_id,actor_auth_user_id,reason,dedupe_key) values($1,(select person_id from platform_users where auth_user_id=$2),$2,'Recorded duplicate','merge-test')",[person,admin]);
  assert.ok((await eligibility()).blockers.includes("shared_identity"));
  await db.query("insert into domain_events(id,aggregate_type,aggregate_id,event_type,member_id,person_id,dedupe_key) values($1,'member',$2,'test.pending',$3,$4,'pending-test')",[id(30),member,member,person]);
  await db.query("insert into workflow_actions(domain_event_id,action_type,idempotency_key) values($1,'send_notification','pending-test')",[id(30)]);
  assert.ok((await eligibility()).blockers.includes("pending_workflows"));
});

test("rollback leaves account, history and provider queue unchanged and scoped erasure never permits unrelated audit mutation", async t=>{
  const {db,person,remove}=await fixture(t,"active");
  await db.query("insert into member_timeline_entries(member_id,entry_year,title) values($1,2020,'Personal event')",[member]);
  await assert.rejects(db.exec("delete from member_timeline_entry_versions"),/append-only/);
  await db.exec("select set_config('ruined.member_deletion_token','00000000-0000-4000-8000-000000000999',false)");
  await assert.rejects(db.exec("delete from member_timeline_entry_versions"),/append-only/);
  await assert.rejects(db.transaction(async tx=>{await remove({},tx);throw Error("ROLLBACK_PROOF");}),/ROLLBACK_PROOF/);
  assert.equal((await db.query("select deleted_at from ruined_members where id=$1",[member])).rows[0].deleted_at,null);
  assert.equal((await db.query("select display_name from person_profiles where person_id=$1",[person])).rows[0].display_name,"Former Member");
  assert.equal((await db.query("select count(*)::int n from private.member_deletion_jobs")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from member_timeline_entry_versions")).rows[0].n,1);
  assert.equal((await db.query("select account_state from member_lifecycle where member_id=$1",[member])).rows[0].account_state,"active");
  assert.equal((await db.query("select count(*)::int n from member_state_history")).rows[0].n,0);
  await remove();
  await assert.rejects(db.exec("delete from operator_audit_events"),/append-only/);
  await assert.rejects(db.exec("update operator_audit_events set reason='rewrite'"),/append-only/);
});

test("Foundation response erasure retains submission identity, progress and reviews and does not widen the append-only guard",async t=>{
  const {db,remove}=await fixture(t);
  await db.query("insert into foundation_programs(id,slug,name) values($1,'test','Test')",[id(60)]);
  await db.query("insert into foundation_versions(id,foundation_program_id,version,title) values($1,$2,1,'Test')",[id(61),id(60)]);
  await db.query("insert into foundation_units(id,foundation_version_id,unit_slug,position,title) values($1,$2,'test',1,'Test')",[id(62),id(61)]);
  await db.query("update foundation_versions set status='published',published_at=now() where id=$1",[id(61)]);
  await db.query("insert into foundation_enrollments(id,member_id,foundation_version_id,status,progress_percent) values($1,$2,$3,'withdrawn',73)",[id(63),member,id(61)]);
  const submission=(await db.query("insert into foundation_submissions(enrollment_id,unit_id,foundation_version_id,submission_version,payload,submitted_by_auth_user_id) values($1,$2,$3,1,'{\"response\":\"Private life story\"}',$4) returning *",[id(63),id(62),id(61),auth])).rows[0];
  await db.query("insert into foundation_submission_reviews(foundation_submission_id,review_state,feedback,reviewed_by_auth_user_id) values($1,'accepted','Completed', $2)",[submission.id,admin]);
  const enrollment=(await db.query("select to_jsonb(e) as value from foundation_enrollments e")).rows;
  const reviews=(await db.query("select to_jsonb(r) as value from foundation_submission_reviews r")).rows;
  await assert.rejects(db.exec("update foundation_submissions set payload='{}'"),/append-only/);
  await remove();
  const redacted=(await db.query("select * from foundation_submissions where id=$1",[submission.id])).rows[0];
  assert.deepEqual(redacted,{...submission,payload:{}});
  assert.deepEqual((await db.query("select to_jsonb(e) as value from foundation_enrollments e")).rows,enrollment);
  assert.deepEqual((await db.query("select to_jsonb(r) as value from foundation_submission_reviews r")).rows,reviews);
  await assert.rejects(db.exec("update foundation_submissions set payload='{\"restored\":true}'"),/append-only/);
  await assert.rejects(db.exec("delete from foundation_submissions"),/append-only/);
});

test("unknown restrictive content linkage fails closed and rolls back closure, history, receipt, markers and profile erasure",async t=>{
  const {db,person,remove}=await fixture(t,"suspended");
  await db.exec("create table future_profile_dependency(person_id uuid primary key references person_profiles(person_id) on delete restrict)");
  await db.query("insert into future_profile_dependency values($1)",[person]);
  await assert.rejects(remove(),error=>error.code==="PT409");
  assert.equal((await db.query("select deleted_at from ruined_members where id=$1",[member])).rows[0].deleted_at,null);
  assert.equal((await db.query("select count(*)::int n from private.member_deletion_records")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from private.member_deletion_jobs")).rows[0].n,0);
  assert.equal((await db.query("select display_name from person_profiles where person_id=$1",[person])).rows[0].display_name,"Former Member");
  assert.deepEqual((await db.query("select account_state,version from member_lifecycle where member_id=$1",[member])).rows[0],{account_state:"suspended",version:1});
  assert.equal((await db.query("select count(*)::int n from member_state_history")).rows[0].n,0);
});

test("deleted accounts cannot reopen, regain role grants or receive late profile and content writes; billing history can still update",async t=>{
  const {db,person,remove}=await fixture(t);await remove();
  for(const query of [
    ["update ruined_members set deleted_at=null where id=$1",[member]],
    ["update ruined_members set email='restored@example.test' where id=$1",[member]],
    ["update member_lifecycle set account_state='active' where member_id=$1",[member]],
    ["update people set status='active' where id=$1",[person]],
    ["update platform_users set status='active' where auth_user_id=$1",[auth]],
    ["insert into platform_users(auth_user_id,person_id,email_normalized,status) values($1,$2,'new@example.test','active')",[other,person]],
    ["delete from platform_users where auth_user_id=$1",[auth]],
    ["insert into ruined_members(id,person_id,email,email_normalized) values($1,$2,'newmember@example.test','newmember@example.test')",[other,person]],
    ["insert into person_profiles(person_id,display_name) values($1,'Restored')",[person]],
    ["insert into person_email_addresses(person_id,email,email_normalized,source) values($1,'restored@example.test','restored@example.test','platform_auth')",[person]],
    ["insert into person_private_profiles(person_id,legal_name) values($1,'Restored')",[person]],
    ["insert into member_journal_entries(id,member_id,kind,body) values($1,$2,'text','Late upload')",[id(42),member]],
    ["insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[auth]],
  ]) await assert.rejects(db.query(...query),/deleted|Historical/);
  await db.query("update ruined_members set membership_state='ended',billing_last_event_created=200 where id=$1",[member]);
  await db.query("update member_lifecycle set billing_state='ended' where member_id=$1",[member]);
  assert.equal((await db.query("select account_state from member_lifecycle where member_id=$1",[member])).rows[0].account_state,"closed");
});

test("historical snapshot and cleanup identity are immutable, worker status remains writable, browser roles have no access",async t=>{
  const {db,remove}=await fixture(t);const result=await remove();
  await assert.rejects(db.exec("delete from private.member_deletion_records"),/permanent/);
  await assert.rejects(db.exec("update private.member_deletion_records set display_name='Changed'"),/permanent/);
  await assert.rejects(db.exec("update private.member_deletion_jobs set auth_user_ids='{}'"),/immutable/);
  await assert.rejects(db.exec("delete from private.member_deletion_jobs"),/permanent/);
  await db.query("update private.member_deletion_jobs set status='processing',attempt_count=1,lease_token=$1,lease_expires_at=now()+interval '5 minutes' where id=$2",[id(99),result.cleanupId]);
  for(const role of ["anon","authenticated"]){
    for(const table of ["member_deletion_records","member_deletion_jobs"]){
      const check=(await db.query("select has_table_privilege($1,$2,'select,insert,update,delete') as allowed",[role,`private.${table}`])).rows[0];assert.equal(check.allowed,false);
    }
    for(const signature of ["private.ruined_delete_member(uuid,uuid,bigint,text,text)","private.ruined_member_deletion_eligibility(uuid,uuid)","private.ruined_member_deletion_authorized(uuid)"]){
      assert.equal((await db.query("select has_function_privilege($1,$2,'execute') as allowed",[role,signature])).rows[0].allowed,false);
    }
  }
});
