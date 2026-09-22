import assert from "node:assert/strict";
import test from "node:test";
import { createUnifiedJournalDatabase } from "./helpers/unified-journal-fixture.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = id(1), auth = id(2), admin = id(3), entry = id(10), deleted = id(11), imageEntry = id(12), videoEntry = id(13), photo = id(20), video = id(21);
async function owner(db) {
  await db.query("insert into ruined_members(id,email,email_normalized) values($1,'member@example.test','member@example.test')", [member]);
  const person = (await db.query("select person_id from ruined_members where id=$1", [member])).rows[0].person_id;
  await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')", [member]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,user_type,status) values($1,$2,$3,'member@example.test','member','active')", [auth,member,person]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [auth]);
  return person;
}
async function seed(db) {
  await owner(db);
  await db.query("insert into member_timeline_entries(id,member_id,entry_year,title,details,position,updated_by_auth_user_id,created_at,updated_at) values($1,$2,2000,$3,null,7,$4,'2020-01-02Z','2020-01-02Z')", [entry,member,"T".repeat(200),auth]);
  await db.query("update member_timeline_entries set entry_month=9,details='Original private details' where id=$1", [entry]);
  await db.query("insert into member_timeline_entries(id,member_id,entry_year,title,details,position) values($1,$2,1999,'Removed memory','',2)", [deleted,member]);
  await db.query("update member_timeline_entries set status='deleted',deleted_at=now() where id=$1", [deleted]);
  await db.query("insert into member_journal_entries(id,member_id,kind,title,body,saved,created_at) values($1,$2,'images','Existing photo',null,true,'2018-03-04Z'),($3,$2,'video',null,'A private film',false,'2019-04-05Z')", [imageEntry,member,videoEntry]);
  await db.query("insert into member_journal_media(id,member_id,entry_id,storage_path,mime_type,byte_size,verified_at,state,position) values($1,$2,$3,$4,'image/webp',120,now(),'ready',0),($5,$2,$6,$7,'video/mp4',200,now(),'ready',0)", [photo,member,imageEntry,`${member}/verified/${photo}.webp`,video,videoEntry,`${member}/verified/${video}.mp4`]);
  return {
    timeline: (await db.query("select to_jsonb(e) as row from member_timeline_entries e order by id")).rows,
    history: (await db.query("select to_jsonb(v) as row from member_timeline_entry_versions v order by id")).rows,
    journal: (await db.query("select to_jsonb(e) as row from member_journal_entries e order by id")).rows,
    media: (await db.query("select to_jsonb(m) as row from member_journal_media m order by id")).rows,
    revision: (await db.query("select max(id)::text as revision from member_timeline_entry_versions")).rows[0].revision,
  };
}

test("migration preserves original entries/history/IDs/media/saved state and imports precise dates without inventing journal dates", async t => {
  const { db, before } = await createUnifiedJournalDatabase(t, { beforeMigration: seed });
  assert.deepEqual((await db.query("select to_jsonb(e) as row from member_timeline_entries e order by id")).rows, before.timeline);
  assert.deepEqual((await db.query("select to_jsonb(v) as row from member_timeline_entry_versions v order by id")).rows, before.history);
  assert.deepEqual((await db.query("select to_jsonb(e)-array['event_year','event_month','event_day','include_on_timeline','timeline_position','current_version','updated_by_auth_user_id'] as row from member_journal_entries e where id in ($1,$2) order by id", [imageEntry,videoEntry])).rows, before.journal);
  assert.deepEqual((await db.query("select to_jsonb(m)-'removed_at' as row from member_journal_media m order by id")).rows, before.media);
  assert.equal((await db.query("select count(*)::int n from member_journal_entries where id in ($1,$2) and event_year is null and event_month is null and event_day is null and not include_on_timeline", [imageEntry,videoEntry])).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int n from member_journal_entries j join member_timeline_entries old on old.id=j.id where row(j.member_id,j.title,j.body,j.created_at,j.updated_at,j.deleted_at,j.event_year,j.event_month,j.timeline_position,j.current_version) is distinct from row(old.member_id,old.title,old.details,old.created_at,old.updated_at,old.deleted_at,old.entry_year,old.entry_month,old.position,old.current_version)")).rows[0].n, 0);
  assert.ok((await db.query("select min(id)::text id from member_journal_entry_versions")).rows[0].id > BigInt(before.revision));
  assert.deepEqual((await db.query("select media_ids from member_journal_entry_versions where journal_entry_id=$1", [imageEntry])).rows[0].media_ids, [photo]);
  assert.equal((await db.query("select count(*)::int n from member_journal_entries where deleted_at is null and include_on_timeline")).rows[0].n, 1);
});

test("date precision and canonical limits preserve title-only entries and reject impossible dates", async t => {
  const { db } = await createUnifiedJournalDatabase(t, { beforeMigration: owner });
  await db.query("insert into member_journal_entries(id,member_id,kind,title,event_year,include_on_timeline) values($1,$2,'text',$3,2024,true)", [entry,member,"T".repeat(200)]);
  await db.query("update member_journal_entries set event_month=2,event_day=29,body=$1 where id=$2", ["B".repeat(20000),entry]);
  for (const query of [
    "update member_journal_entries set event_year=2023 where id=$1",
    "update member_journal_entries set event_month=null where id=$1",
    "update member_journal_entries set event_year=null where id=$1",
    "update member_journal_entries set event_month=13 where id=$1",
    "update member_journal_entries set event_day=0 where id=$1",
    "update member_journal_entries set title=null where id=$1",
    "update member_journal_entries set title='   ' where id=$1",
    "update member_journal_entries set title=repeat('x',201) where id=$1",
    "update member_journal_entries set body=repeat('x',20001) where id=$1",
  ]) await assert.rejects(db.query(query, [entry]), { code: "23514" });
  await db.query("update member_journal_entries set event_day=null,event_month=null where id=$1", [entry]);
  await db.query("update member_journal_entries set include_on_timeline=false,event_year=null,title=null where id=$1", [entry]);
  const latest = (await db.query("select * from member_journal_entry_versions where journal_entry_id=$1 order by id desc limit 1", [entry])).rows[0];
  assert.equal(latest.event_year, null); assert.equal(latest.include_on_timeline, false); assert.equal(latest.body.length, 20000);
  await assert.rejects(db.query("insert into member_journal_entry_versions(journal_entry_id,member_id,version,action,kind,title,saved,include_on_timeline,event_year,event_month,event_day,occurred_at) values($1,$2,999,'created','text','Invalid date',false,false,2023,2,29,now())", [entry,member]), { code: "23514" });
  await db.query("insert into ruined_members(id,email,email_normalized) values($1,'other@example.test','other@example.test')", [id(99)]);
  await assert.rejects(db.query("insert into member_journal_entry_versions(journal_entry_id,member_id,version,action,kind,title,saved,include_on_timeline,occurred_at) values($1,$2,999,'created','text','Wrong owner',false,false,now())", [entry,id(99)]), { code: "23503" });
});

test("new journal and attachment mutations record immutable full snapshots while old timeline writes are fenced", async t => {
  const { db, before } = await createUnifiedJournalDatabase(t, { beforeMigration: seed });
  await db.query("update member_journal_entries set body='A revised memory',saved=true,event_day=20 where id=$1", [entry]);
  const changed = (await db.query("select * from member_journal_entry_versions where journal_entry_id=$1 order by id desc limit 1", [entry])).rows[0];
  assert.equal(changed.body,"A revised memory"); assert.equal(changed.saved,true); assert.equal(changed.event_day,20); assert.equal(changed.version,3);
  const count = (await db.query("select count(*)::int n from member_journal_entry_versions")).rows[0].n;
  await db.query("update member_journal_entries set body=body,updated_at=now() where id=$1", [entry]);
  assert.equal((await db.query("select count(*)::int n from member_journal_entry_versions")).rows[0].n,count);
  await db.transaction(async tx => {
    await tx.query("select set_config('app.journal_actor_auth_user_id',$1,true)", [auth]);
    await tx.query("update member_journal_media set removed_at=now() where id=$1", [photo]);
  });
  const removed = (await db.query("select media_ids,actor_auth_user_id from member_journal_entry_versions where journal_entry_id=$1 order by id desc limit 1", [imageEntry])).rows[0];
  assert.deepEqual(removed.media_ids,[]); assert.equal(removed.actor_auth_user_id,auth);
  await db.query("update member_journal_media set removed_at=null where id=$1", [photo]);
  assert.deepEqual((await db.query("select media_ids from member_journal_entry_versions where journal_entry_id=$1 order by id desc limit 1", [imageEntry])).rows[0].media_ids,[photo]);
  for (const sql of [
    "update member_timeline_entries set title='Lost old edit'",
    "delete from member_timeline_entries",
    "update member_timeline_entry_versions set title='Changed history'",
    "delete from member_timeline_entry_versions",
  ]) await assert.rejects(db.exec(sql), { code: "PT409" });
  await assert.rejects(db.query("insert into member_timeline_entries(member_id,entry_year,title) values($1,2026,'Old writer')", [member]), { code: "PT409" });
  await assert.rejects(db.exec("update member_journal_entry_versions set body='Changed history'"), /append-only/);
  await assert.rejects(db.exec("delete from member_journal_entry_versions"), /append-only/);
  await db.query("select set_config('ruined.member_deletion_token',$1,false)", [id(999)]);
  await assert.rejects(db.exec("delete from member_journal_entry_versions"), /append-only/);
  await assert.rejects(db.query("update member_journal_entries set title='Revived' where id=$1", [deleted]), /deleted journal entry is immutable/);
  assert.deepEqual((await db.query("select to_jsonb(e) as row from member_timeline_entries e order by id")).rows,before.timeline);
  assert.deepEqual((await db.query("select to_jsonb(v) as row from member_timeline_entry_versions v order by id")).rows,before.history);
});

test("Foundation completion receipts stay unchanged and new eligibility uses only live canonical timeline selections", async t => {
  const enrollment = id(63);
  const { db, before } = await createUnifiedJournalDatabase(t, { beforeMigration: async db => {
    await seed(db);
    await db.query("insert into foundation_programs(id,slug,name) values($1,'test','Test')",[id(60)]);
    await db.query("insert into foundation_versions(id,foundation_program_id,version,title) values($1,$2,1,'Test')",[id(61),id(60)]);
    await db.query("insert into foundation_units(id,foundation_version_id,unit_slug,position,title) values($1,$2,'test',1,'Test')",[id(62),id(61)]);
    await db.query("update foundation_versions set status='published',published_at=now() where id=$1",[id(61)]);
    await db.query("insert into foundation_enrollments(id,member_id,foundation_version_id,status) values($1,$2,$3,'in_progress')",[enrollment,member,id(61)]);
    await db.query("insert into member_foundation_requirement_completions(member_id,foundation_enrollment_id,requirement_slug,source,dedupe_key,completed_by_auth_user_id) values($1,$2,'timeline','member','original-completion',$3)",[member,enrollment,auth]);
    return (await db.query("select to_jsonb(c) value from member_foundation_requirement_completions c")).rows;
  } });
  assert.deepEqual((await db.query("select to_jsonb(c) value from member_foundation_requirement_completions c")).rows,before);
  await db.query("update member_journal_entries set include_on_timeline=false where member_id=$1 and deleted_at is null",[member]);
  const complete = () => db.query("insert into member_foundation_requirement_completions(member_id,foundation_enrollment_id,requirement_slug,completion_version,source,dedupe_key,completed_by_auth_user_id) values($1,$2,'timeline',2,'member','later-completion',$3)",[member,enrollment,auth]);
  await assert.rejects(complete(), /At least one active Timeline entry/);
  await db.query("insert into member_journal_entries(id,member_id,kind,title,event_year,include_on_timeline) values($1,$2,'text','New canonical event',2026,true)",[id(64),member]);
  await complete();
  assert.deepEqual((await db.query("select to_jsonb(c) value from member_foundation_requirement_completions c where completion_version=1")).rows,before);
  assert.equal((await db.query("select count(*)::int n from member_foundation_requirement_completions")).rows[0].n,2);
});

test("journal history remains server-only and member deletion erases both systems without erasing historical membership", async t => {
  const { db } = await createUnifiedJournalDatabase(t, { beforeMigration: seed });
  for (const role of ["anon","authenticated"]) {
    for (const table of ["member_journal_entries","member_journal_media","member_journal_entry_versions"]) {
      const row = (await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed,(select relrowsecurity from pg_class where oid=$2::regclass) rls", [role,table])).rows[0];
      assert.equal(row.allowed,false); assert.equal(row.rls,true);
    }
    for (const fn of ["private.ruined_version_journal_entry()","private.ruined_record_journal_entry_version()","private.ruined_record_journal_media_change()","private.ruined_fence_legacy_timeline_write()","private.ruined_delete_member(uuid,uuid,bigint,text,text)"]) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed,false);
    }
  }
  await db.query("insert into platform_users(auth_user_id,email_normalized,user_type,status) values($1,'admin@example.test','staff','active')", [admin]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [admin]);
  const decision = (await db.query("select private.ruined_member_deletion_eligibility($1,$2) decision", [admin,member])).rows[0].decision;
  assert.deepEqual(decision.blockers,[]);
  const result = (await db.query("select private.ruined_delete_member($1,$2,$3,'member@example.test','member_request') result", [admin,member,decision.lifecycleVersion])).rows[0].result;
  assert.equal(result.deleted,true);
  for (const table of ["member_journal_entries","member_journal_media","member_journal_entry_versions","member_timeline_entries","member_timeline_entry_versions"]) {
    assert.equal((await db.query(`select count(*)::int n from ${table} where member_id=$1`, [member])).rows[0].n,0,table);
  }
  assert.equal((await db.query("select count(*)::int n from private.member_deletion_records where member_id=$1", [member])).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from ruined_members where id=$1 and deleted_at is not null", [member])).rows[0].n,1);
  assert.equal((await db.query("select jsonb_array_length(storage_objects) n from private.member_deletion_jobs where member_id=$1", [member])).rows[0].n,2);
  await assert.rejects(db.query("insert into member_journal_entries(member_id,kind,body) values($1,'text','Late old request')", [member]), /deleted account cannot receive/);
});

test("overlapping source UUIDs abort the complete migration instead of skipping or overwriting content", async t => {
  const { db, applyMigration } = await createUnifiedJournalDatabase(t, { applyMigration:false, beforeMigration:async db => {
    await owner(db);
    await db.query("insert into member_timeline_entries(id,member_id,entry_year,title) values($1,$2,2020,'Timeline original')", [entry,member]);
    await db.query("insert into member_journal_entries(id,member_id,kind,body) values($1,$2,'text','Journal original')", [entry,member]);
  } });
  await assert.rejects(applyMigration(), /entry IDs overlap/);
  await db.exec("rollback");
  assert.equal((await db.query("select body from member_journal_entries where id=$1", [entry])).rows[0].body,"Journal original");
  assert.equal((await db.query("select title from member_timeline_entries where id=$1", [entry])).rows[0].title,"Timeline original");
  assert.equal((await db.query("select to_regclass('public.member_journal_entry_versions') relation")).rows[0].relation,null);
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='member_journal_entries' and column_name='event_year'")).rows[0].n,0);
});
