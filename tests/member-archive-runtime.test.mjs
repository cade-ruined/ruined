import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadPGliteForSchemaChecks } from '../scripts/check-support-schema.mjs';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const runner = await source('scripts/migrate-platform.mjs');
const migrations = await Promise.all([...runner.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => source(match[1])));
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const admin=id(1), member=id(2), auth=id(3), guide=id(4);

test('member directory archives enforce authority, preserve records, block outstanding membership, and restore with version checks', async t => {
  const PGlite=await loadPGliteForSchemaChecks(), db=new PGlite();
  t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const migration of migrations) await db.exec(migration);
  await db.query("insert into platform_users(auth_user_id,email_normalized,user_type,status) values($1,'admin@example.test','staff','active'),($2,'guide@example.test','staff','active')",[admin,guide]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin'),($2,'guide')",[admin,guide]);
  await db.query("insert into ruined_members(id,email,email_normalized) values($1,'member@example.test','member@example.test')",[member]);
  const person=(await db.query('select person_id from ruined_members where id=$1',[member])).rows[0].person_id;
  await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')",[member]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,'member@example.test','active')",[auth,member,person]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[auth]);
  await db.query("update person_profiles set display_name='Archive Example',bio='Keep my biography' where person_id=$1",[person]);
  await db.query("insert into member_journal_entries(id,member_id,kind,event_year,title,include_on_timeline) values($1,$2,'text',2020,'Keep my journal',false)",[id(10),member]);
  const state=(actor=admin)=>db.query('select private.ruined_member_archive_state($1,$2) result',[actor,member]).then(r=>r.rows[0].result);
  const change=(action,version,actor=admin,reason='Inactive registration')=>db.query('select private.ruined_set_member_archive($1,$2,$3,$4,$5) result',[actor,member,action,version,reason]).then(r=>r.rows[0].result);
  const snapshot=async()=>{
    const tables=['ruined_members','member_lifecycle','platform_users','platform_role_grants','person_profiles','member_journal_entries','member_consents','stripe_subscriptions','stripe_invoices','member_registration_access','circle_member_assignments'];
    return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`select to_jsonb(r) as row from ${table} r order by to_jsonb(r)::text`)).rows])));
  };
  const original=await snapshot();
  assert.equal((await state()).allowed,true,'unfunded active identity can be filed without pretending to close it');
  for(const actor of [auth,guide,id(999)]) {
    await assert.rejects(state(actor),e=>e.code==='PT403');
    await assert.rejects(change('archive',0,actor),e=>e.code==='PT403');
  }
  for(const role of ['anon','authenticated']) {
    assert.equal((await db.query("select has_function_privilege($1,'private.ruined_set_member_archive(uuid,uuid,text,integer,text)','execute') allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege($1,'public.member_directory_archives','select,insert,update,delete') allowed",[role])).rows[0].allowed,false);
  }
  await assert.rejects(change('archive',99),e=>e.code==='PT409');
  await assert.rejects(change('archive',0,admin,'x'),e=>e.code==='PT400');
  const archived=await change('archive',0);
  assert.ok(archived.archivedAt); assert.equal(archived.version,1); assert.equal(archived.allowed,false); assert.equal(archived.restoreAllowed,true);
  assert.deepEqual(await snapshot(),original,'archive must not change content, access, consent, circles or billing');
  assert.equal((await db.query('select count(*)::int n from ruined_members m left join member_directory_archives a on a.member_id=m.id where m.deleted_at is null and a.archived_at is null')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from ruined_members m join member_directory_archives a on a.member_id=m.id where m.deleted_at is null and a.archived_at is not null')).rows[0].n,1);
  await assert.rejects(change('restore',0),e=>e.code==='PT409');
  await assert.rejects(change('archive',1),e=>e.code==='PT409');
  const restored=await change('restore',1,admin,'Return to directory');
  assert.equal(restored.archivedAt,null); assert.equal(restored.version,2); assert.equal(restored.restoreAllowed,false);
  assert.deepEqual(await snapshot(),original,'restore must not grant access, charge or recreate a membership');
  assert.deepEqual((await db.query("select action,metadata from operator_audit_events where member_id=$1 order by id",[member])).rows,[
    {action:'member.directory_archived',metadata:{scope:'directory_only'}},{action:'member.directory_restored',metadata:{scope:'directory_only'}}]);
  await assert.rejects(change('archive',0),e=>e.code==='PT409','stale original page cannot overwrite a restored record');

  // Observe each live blocker independently without mutating any provider.
  for(const billing of ['active','attention_required']) {
    await db.query('update member_lifecycle set billing_state=$1 where member_id=$2',[billing,member]);
    assert.equal((await state()).allowed,false);
    await assert.rejects(change('archive',2),e=>e.code==='PT409');
  }
  await db.query("update member_lifecycle set billing_state='pending' where member_id=$1",[member]);
  for(const stripeStatus of ['active','trialing','past_due','unpaid','incomplete','paused']) {
    await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,last_event_created) values('sub_archive_test',$1,'cus_archive_test',$2,0) on conflict(id) do update set stripe_status=excluded.stripe_status",[member,stripeStatus]);
    assert.equal((await state()).allowed,false,stripeStatus);
  }
  await db.query("update stripe_subscriptions set stripe_status='canceled' where id='sub_archive_test'");
  assert.equal((await state()).allowed,true);
  await db.query("insert into stripe_checkout_sessions(id,member_id,session_status,livemode,last_event_created) values('cs_archive_test',$1,'open',false,0)",[member]);
  assert.equal((await state()).allowed,false);
  await db.query("update stripe_checkout_sessions set session_status='expired' where id='cs_archive_test'");
  assert.equal((await state()).allowed,true);
  await db.query("insert into stripe_invoices(id,member_id,purpose,stripe_status,currency,last_event_created) values('in_archive_test',$1,'membership','open','usd',0)",[member]);
  assert.equal((await state()).allowed,false);
  await db.query("update stripe_invoices set stripe_status='paid' where id='in_archive_test'");
  assert.equal((await state()).allowed,true);
  // Directory filing must not obstruct the separately authorized erasure path.
  const eraseMember=id(100),eraseAuth=id(101);
  await db.query("insert into ruined_members(id,email,email_normalized) values($1,'erase@example.test','erase@example.test')",[eraseMember]);
  const erasePerson=(await db.query('select person_id from ruined_members where id=$1',[eraseMember])).rows[0].person_id;
  await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')",[eraseMember]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,'erase@example.test','active')",[eraseAuth,eraseMember,erasePerson]);
  await db.query("insert into member_journal_entries(id,member_id,kind,event_year,title,include_on_timeline) values($1,$2,'text',2020,'Erase this journal',false)",[id(102),eraseMember]);
  await db.query("select private.ruined_set_member_archive($1,$2,'archive',0,'Unused registration')",[admin,eraseMember]);
  const archiveBeforeDelete=(await db.query('select to_jsonb(a) row from member_directory_archives a where member_id=$1',[eraseMember])).rows[0].row;
  const deletion=(await db.query('select private.ruined_member_deletion_eligibility($1,$2) result',[admin,eraseMember])).rows[0].result;
  assert.equal(deletion.allowed,true,'archive FK and audit history do not prevent account erasure');
  assert.equal((await db.query("select private.ruined_delete_member($1,$2,$3,'erase@example.test','member_request') result",[admin,eraseMember,deletion.lifecycleVersion])).rows[0].result.deleted,true);
  assert.equal((await db.query('select count(*)::int n from member_journal_entries where member_id=$1',[eraseMember])).rows[0].n,0);
  assert.ok((await db.query('select deleted_at from ruined_members where id=$1',[eraseMember])).rows[0].deleted_at);
  assert.deepEqual((await db.query('select to_jsonb(a) row from member_directory_archives a where member_id=$1',[eraseMember])).rows[0].row,archiveBeforeDelete,'filing history is retained alongside the tombstone');
  assert.equal((await db.query("select count(*)::int n from operator_audit_events where member_id=$1 and action='member.directory_archived'",[eraseMember])).rows[0].n,1);
  assert.equal((await db.query('select private.ruined_member_archive_state($1,$2) result',[admin,eraseMember])).rows[0].result.restoreAllowed,false);
  await assert.rejects(db.query("select private.ruined_set_member_archive($1,$2,'restore',1,'Try restoring erased member')",[admin,eraseMember]),e=>e.code==='PT409');
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[auth]);
  assert.equal((await state()).allowed,false,'operator identities never disappear into archive');
  const own=await state(auth);
  assert.equal(own.allowed,false); assert.ok(own.blockers.some(text=>text.includes('own member')));
  await db.query("update platform_role_grants set revoked_at=now(),revoke_reason='Test removed' where auth_user_id=$1 and role_slug='ops_admin'",[auth]);
  await db.query("update platform_role_grants set revoked_at=now(),revoke_reason='Test revoked' where auth_user_id=$1 and role_slug='ops_admin'",[admin]);
  await assert.rejects(change('archive',2),e=>e.code==='PT403');
  assert.equal((await db.query('select version from member_directory_archives where member_id=$1',[member])).rows[0].version,2);
});

// A small dependency fixture exercises financial eligibility combinations that
// production funding writers normally create only after provider verification.
// No provider evidence is manufactured in the real database.
test('archive eligibility covers complimentary, shared and prepaid memberships while restoration never changes their funding',async t=>{
  const PGlite=await loadPGliteForSchemaChecks(),db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create schema private; create role anon; create role authenticated; create role service_role;
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,user_type text,status text);
    create table platform_role_grants(id uuid default gen_random_uuid(),auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table ruined_members(id uuid primary key,person_id uuid,deleted_at timestamptz,membership_state text);
    create table member_lifecycle(member_id uuid,account_state text,billing_state text,standing_state text);
    create table person_profiles(person_id uuid,display_name text,preferred_name text);
    create table stripe_subscriptions(id text,member_id uuid,stripe_status text);
    create table stripe_checkout_sessions(id text,member_id uuid,session_status text);
    create table stripe_checkout_attempts(id uuid,member_id uuid,status text);
    create table stripe_invoices(id text,member_id uuid,stripe_status text);
    create table operator_membership_saved_payments(member_id uuid,status text);
    create table member_complimentary_grants(member_id uuid,revoked_at timestamptz,ends_at timestamptz);
    create table membership_commercial_reservations(id uuid,payer_member_id uuid,status text,expires_at timestamptz,stripe_subscription_id text);
    create table membership_commercial_participants(reservation_id uuid,member_id uuid);
    create table stripe_membership_prepaid_proofs(reservation_id uuid,refund_state text,activated_at timestamptz,prepaid_through timestamptz,provider_canceled_at timestamptz);
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,member_id uuid,reason text,before_snapshot jsonb,after_snapshot jsonb,metadata jsonb,dedupe_key text);
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql as $$select false$$;`);
  await db.exec(await source('db/migrations/20261104210000_member_directory_archives.sql'));
  await db.query("insert into platform_users values($1,null,null,'staff','active')",[admin]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[admin]);
  await db.query("insert into ruined_members values($1,$2,null,'pending');",[member,id(5)]);
  await db.query("insert into member_lifecycle values($1,'active','pending','pre_active')",[member]);
  const state=()=>db.query('select private.ruined_member_archive_state($1,$2) result',[admin,member]).then(r=>r.rows[0].result);
  assert.equal((await state()).allowed,true);
  await db.query('insert into member_complimentary_grants values($1,null,null)',[member]);
  assert.equal((await state()).allowed,false,'indefinite complimentary membership');
  await db.query("update member_complimentary_grants set ends_at=now()-interval '1 day'");
  assert.equal((await state()).allowed,true,'expired funding');
  await db.query("update member_complimentary_grants set ends_at=now()+interval '1 day'");
  assert.equal((await state()).allowed,false,'funding with upcoming end');
  await db.query('update member_complimentary_grants set revoked_at=now()');
  assert.equal((await state()).allowed,true,'revoked funding');
  await db.query("insert into operator_membership_saved_payments values($1,'review')",[member]);
  assert.equal((await state()).allowed,false,'saved payment review');
  await db.query("update operator_membership_saved_payments set status='failed'");
  const reservation=id(6),payer=id(7);
  await db.query("insert into membership_commercial_reservations values($1,$2,'reserved',now()+interval '1 day',null)",[reservation,payer]);
  await db.query('insert into membership_commercial_participants values($1,$2)',[reservation,member]);
  assert.equal((await state()).allowed,false,'shared pending reservation');
  await db.query("update membership_commercial_reservations set expires_at=now()-interval '1 day'");
  assert.equal((await state()).allowed,true,'abandoned expired reservation');
  await db.query("insert into stripe_membership_prepaid_proofs values($1,'none',null,now()+interval '30 days',null)",[reservation]);
  assert.equal((await state()).allowed,false,'paid waiting for activation');
  await db.query("update stripe_membership_prepaid_proofs set activated_at=now()");
  assert.equal((await state()).allowed,false,'already activated with prepaid coverage');
  await db.query("update stripe_membership_prepaid_proofs set refund_state='review_required',activated_at=null,provider_canceled_at=now()");
  assert.equal((await state()).allowed,false,'canceled provider with unresolved prepaid money');
  await db.query("update stripe_membership_prepaid_proofs set refund_state='refunded'");
  assert.equal((await state()).allowed,true,'fully refunded ended membership');
  await db.query("select private.ruined_set_member_archive($1,$2,'archive',0,'Unused registration')",[admin,member]);
  await db.query("update member_lifecycle set billing_state='active',standing_state='active'");
  assert.equal((await state()).restoreAllowed,true,'later successful payment must not prevent restoring visibility');
  await db.query("select private.ruined_set_member_archive($1,$2,'restore',1,'Return to directory')",[admin,member]);
  assert.deepEqual((await db.query('select billing_state,standing_state from member_lifecycle')).rows,[{billing_state:'active',standing_state:'active'}]);
  await db.query('update ruined_members set deleted_at=now()');
  const deleted=await state(); assert.equal(deleted.allowed,false); assert.equal(deleted.restoreAllowed,false);
});
