import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { publicJournalFixture, timelineIds, load } from "./helpers/public-journal-fixture.mjs";

const draft = changes => ({ id: randomUUID(), kind: "text", title: "A shared thought", body: "Chosen words", mediaIds: [], ...changes });
const edit = (entry, changes) => ({ expectedVersion: entry.version, kind: entry.kind, title: entry.title ?? "", body: entry.body ?? "",
  mediaIds: entry.media.map(item => item.id), eventYear: entry.eventYear, eventMonth: entry.eventMonth, eventDay: entry.eventDay,
  includeOnTimeline: entry.includeOnTimeline, ...changes });

test("visibility migration leaves legacy content, revisions and history untouched and defaults every row private", async t => {
  const f = await publicJournalFixture(t, { applyPrivacy: false, meaningMigration: false });
  const id = randomUUID();
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,body,event_year,include_on_timeline,saved) values($1,$2,'text','Private title','PRIVATE BODY',2010,true,true)", [id,timelineIds.member]);
  await f.db.query("update member_journal_entries set body='PRIVATE REVISION' where id=$1",[id]);
  const before = (await f.db.query("select to_jsonb(e) entry from member_journal_entries e order by id")).rows;
  const history = (await f.db.query("select to_jsonb(v) entry from member_journal_entry_versions v order by id")).rows;
  await f.migratePrivacy();
  assert.deepEqual((await f.db.query("select to_jsonb(e)-'visibility' entry from member_journal_entries e order by id")).rows,before);
  assert.deepEqual((await f.db.query("select to_jsonb(v)-'visibility' entry from member_journal_entry_versions v order by id")).rows,history);
  assert.equal((await f.db.query("select count(*)::int n from member_journal_entries where visibility<>'private'")).rows[0].n,0);
  const entry = await f.journal.createJournalEntry(timelineIds.auth,draft());
  assert.equal(entry.visibility,"private");
  await f.enable();
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries,[]);
  await assert.rejects(f.db.query("update member_journal_entries set visibility='everyone' where id=$1",[id]),{code:"23514"});
  for (const role of ["anon","authenticated"]) {
    assert.equal((await f.db.query("select has_table_privilege($1,'member_journal_entries','SELECT,UPDATE') allowed",[role])).rows[0].allowed,false);
  }
});

test("public post migration preserves every stored entry/history and relaxes dates only for explicitly public posts", async t => {
  const f = await publicJournalFixture(t,{applyTimelinePosts:false});
  const legacy = await f.journal.createJournalEntry(timelineIds.auth,draft({eventYear:1998,includeOnTimeline:true}));
  await f.journal.editJournalEntry(timelineIds.auth,legacy.id,edit(legacy,{body:"Private milestone revision"}));
  await f.repository.completeMemberFoundationRequirement(timelineIds.auth,"timeline");
  const before = (await f.db.query("select to_jsonb(e) entry from member_journal_entries e order by id")).rows;
  const history = (await f.db.query("select to_jsonb(v) entry from member_journal_entry_versions v order by id")).rows;
  const completions = (await f.db.query("select to_jsonb(c) completion from member_foundation_requirement_completions c order by id")).rows;
  await f.migrateTimelinePosts();
  assert.deepEqual((await f.db.query("select to_jsonb(e) entry from member_journal_entries e order by id")).rows,before);
  assert.deepEqual((await f.db.query("select to_jsonb(v) entry from member_journal_entry_versions v order by id")).rows,history);
  assert.deepEqual((await f.db.query("select to_jsonb(c) completion from member_foundation_requirement_completions c order by id")).rows,completions);
  await f.enable();
  const post = await f.journal.createJournalEntry(timelineIds.auth,draft({title:"",visibility:"public",includeOnTimeline:true}));
  assert.equal(post.title,null); assert.equal(post.eventYear,null);
  assert.equal((await f.visitor.getPublicJournal(f.token)).entries[0].id,post.id);
  const version = (await f.db.query("select visibility,include_on_timeline,event_year,title from member_journal_entry_versions where journal_entry_id=$1",[post.id])).rows[0];
  assert.deepEqual(version,{visibility:"public",include_on_timeline:true,event_year:null,title:null});
  await assert.rejects(f.db.query("update member_journal_entries set visibility='private' where id=$1",[post.id]),{code:"23514"});
  await assert.rejects(f.db.query("insert into member_journal_entry_versions(journal_entry_id,member_id,version,action,kind,body,saved,include_on_timeline,visibility,occurred_at) values($1,$2,999,'updated','text','Invalid private milestone',false,true,'private',now())",[post.id,timelineIds.member]),{code:"23514"});
  for (const assignment of ["title=null,body=null","event_month=2","event_year=2023,event_month=2,event_day=29"]) {
    await assert.rejects(f.db.query(`update member_journal_entries set ${assignment} where id=$1`,[post.id]),{code:"23514"});
  }
});

test("public posts never count toward private Foundations and existing completion receipts stay unchanged", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  await f.journal.createJournalEntry(timelineIds.auth,draft({title:"",visibility:"public",includeOnTimeline:true}));
  assert.equal((await f.repository.getMemberFoundationRequirements(timelineIds.auth)).timeline.entryCount,0);
  assert.deepEqual((await f.repository.getMemberTimeline(timelineIds.auth)).entries,[]);
  await assert.rejects(f.repository.completeMemberFoundationRequirement(timelineIds.auth,"timeline"),/At least one active Timeline entry/);
  const milestone = await f.journal.createJournalEntry(timelineIds.auth,draft({eventYear:2001,includeOnTimeline:true}));
  const completed = await f.repository.completeMemberFoundationRequirement(timelineIds.auth,"timeline");
  assert.equal(completed.timeline.entryCount,1); assert.equal(completed.timeline.completed,true);
  const receipt = (await f.db.query("select to_jsonb(c) completion from member_foundation_requirement_completions c order by id")).rows;
  await f.journal.editJournalEntry(timelineIds.auth,milestone.id,edit(milestone,{visibility:"public",includeOnTimeline:true}));
  const after = await f.repository.completeMemberFoundationRequirement(timelineIds.auth,"timeline");
  assert.equal(after.timeline.entryCount,0); assert.equal(after.timeline.completed,true);
  assert.deepEqual((await f.db.query("select to_jsonb(c) completion from member_foundation_requirement_completions c order by id")).rows,receipt);
});

test("public Timeline reads require both choices and never rewrite legacy private or unlisted entries", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const privateMilestone = await f.journal.createJournalEntry(timelineIds.auth,draft({eventYear:2012,includeOnTimeline:true}));
  const unlisted = await addMedia(f);
  await f.db.query("update member_journal_entries set include_on_timeline=false where id=$1",[unlisted.entry]);
  const before = (await f.db.query("select to_jsonb(e) entry from member_journal_entries e order by id")).rows;
  const history = (await f.db.query("select to_jsonb(v) entry from member_journal_entry_versions v order by id")).rows;
  const journal = await f.journal.getJournal(timelineIds.auth);
  assert.deepEqual(new Set(journal.entries.map(entry=>entry.id)),new Set([privateMilestone.id,unlisted.entry]));
  assert.equal(journal.entries.find(entry=>entry.id===privateMilestone.id).visibility,"private");
  for (const view of ["journal","timeline"]) {
    const publicCollection = await f.journal.getJournal(timelineIds.auth,null,false,{view,collection:"public"});
    assert.deepEqual(publicCollection.entries,[]); assert.equal(publicCollection.total,0); assert.deepEqual(publicCollection.years,[]);
  }
  assert.deepEqual(await f.journal.exportJournalTimeline(timelineIds.auth,"public"),[]);
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries,[]);
  assert.equal(await f.visitor.getPublicJournalMedia(f.token,unlisted.id),null);
  assert.equal(f.downloads.length,0);
  const published = await f.journal.createJournalEntry(timelineIds.auth,draft({visibility:"public",includeOnTimeline:true}));
  assert.deepEqual((await f.visitor.getPublicJournal(f.token,unlisted.entry)).entries,[]);
  assert.deepEqual((await f.db.query("select to_jsonb(e) entry from member_journal_entries e where id<>$1 order by id",[published.id])).rows,before);
  assert.deepEqual((await f.db.query("select to_jsonb(v) entry from member_journal_entry_versions v where journal_entry_id<>$1 order by id",[published.id])).rows,history);
});

test("unchecking publication keeps the owner entry and prevents stale requests from republishing it", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const input = draft({title:"",visibility:"public",includeOnTimeline:true});
  const published = await f.journal.createJournalEntry(timelineIds.auth,input);
  const privateEntry = await f.journal.editJournalEntry(timelineIds.auth,published.id,edit(published,{visibility:"private",includeOnTimeline:false}));
  assert.equal(privateEntry.visibility,"private"); assert.equal(privateEntry.includeOnTimeline,false);
  assert.equal((await f.journal.getJournal(timelineIds.auth)).entries[0].id,published.id);
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries,[]);
  await assert.rejects(f.journal.editJournalEntry(timelineIds.auth,published.id,edit(published,{visibility:"public",includeOnTimeline:true})),{status:409});
  await assert.rejects(f.journal.createJournalEntry(timelineIds.auth,input),{status:409});
  assert.equal((await f.journal.getJournalEntry(timelineIds.auth,published.id)).visibility,"private");
  const history = (await f.db.query("select visibility,include_on_timeline from member_journal_entry_versions where journal_entry_id=$1 order by version",[published.id])).rows;
  assert.deepEqual(history,[{visibility:"public",include_on_timeline:true},{visibility:"private",include_on_timeline:false}]);
  const photo = await addMedia(f);
  const photoEntry = await f.journal.getJournalEntry(timelineIds.auth,photo.entry);
  const photoPost = await f.journal.editJournalEntry(timelineIds.auth,photo.entry,edit(photoEntry,{title:"",eventYear:null,visibility:"public",includeOnTimeline:true}));
  assert.equal(photoPost.title,null); assert.equal(photoPost.eventYear,null);
  assert.equal((await f.visitor.getPublicJournal(f.token)).entries[0].media.length,1);
  const privatePhoto = await f.journal.editJournalEntry(timelineIds.auth,photo.entry,edit(photoPost,{visibility:"private",includeOnTimeline:false}));
  assert.equal(privatePhoto.media.length,1,"withdrawing publication does not delete the owner's photo");
  const downloadsBefore = f.downloads.length;
  assert.equal(await f.visitor.getPublicJournalMedia(f.token,photo.id),null);
  assert.equal(f.downloads.length,downloadsBefore,"withdrawn media is denied before storage access");
});

test("owner public Timeline dates and full export fall back to UTC creation dates without changing stored dates", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const older=randomUUID(),dated=randomUUID(),newer=randomUUID();
  await f.db.query("insert into member_journal_entries(id,member_id,kind,body,created_at,visibility,include_on_timeline) values($1,$2,'text','Older post','2025-12-31T23:30:00Z','public',true),($3,$2,'text','Newer post','2027-01-01T00:30:00Z','public',true)",[older,timelineIds.member,newer]);
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,created_at,event_year,visibility,include_on_timeline) values($1,$2,'text','Dated post','2026-01-01T00:00:00Z',1980,'public',true)",[dated,timelineIds.member]);
  await f.journal.createJournalEntry(timelineIds.auth,draft({eventYear:2030,includeOnTimeline:true}));
  const timeline = await f.journal.getJournal(timelineIds.auth,null,false,{collection:"public",view:"timeline",order:"oldest"});
  assert.deepEqual(timeline.entries.map(entry=>entry.id),[dated,older,newer]);
  assert.deepEqual(timeline.years,[2027,2025,1980]); assert.equal(timeline.total,3);
  const year = await f.journal.getJournal(timelineIds.auth,null,false,{collection:"public",view:"timeline",year:2025});
  assert.deepEqual(year.entries.map(entry=>entry.id),[older]); assert.equal(year.total,1);
  assert.equal(year.entries[0].eventYear,null); assert.equal(year.entries[0].title,null);
  const exported = await f.journal.exportJournalTimeline(timelineIds.auth,"public");
  assert.deepEqual(exported.map(entry=>entry.id),[dated,older,newer]);
  assert.equal(exported[1].eventYear,null); assert.equal(exported[1].createdAt,"2025-12-31T23:30:00.000Z");
});

test("owner publication requires card sharing and stays versioned, owner-scoped and backward compatible", async t => {
  const f = await publicJournalFixture(t);
  const privateEntry = await f.journal.createJournalEntry(timelineIds.auth,draft({eventYear:2024,eventMonth:2,eventDay:29,includeOnTimeline:true}));
  assert.equal((await f.journal.getJournal(timelineIds.auth,null,false,{collection:"private"})).publicUrl,null);
  await assert.rejects(f.journal.createJournalEntry(timelineIds.auth,draft({visibility:"public",includeOnTimeline:true})),{status:403});
  await assert.rejects(f.journal.editJournalEntry(timelineIds.otherAuth,privateEntry.id,edit(privateEntry,{visibility:"public"})),{status:404});
  await f.enable();
  const published = await f.journal.editJournalEntry(timelineIds.auth,privateEntry.id,edit(privateEntry,{visibility:"public"}));
  assert.equal(published.visibility,"public"); assert.equal(published.version,"2");
  await assert.rejects(f.journal.editJournalEntry(timelineIds.auth,privateEntry.id,edit(privateEntry,{visibility:"private",title:"Stale"})),{status:409});
  // Legacy editors omit the field; they cannot silently change sharing choices.
  await assert.rejects(f.journal.editJournalEntry(timelineIds.auth,published.id,edit(published,{body:"A private thought from an old editor"})),{status:409});
  assert.equal((await f.journal.getJournalEntry(timelineIds.auth,published.id)).visibility,"public");
  const legacy = await f.journal.editJournalEntry(timelineIds.auth,published.id,edit(published,{body:"Revised chosen words",visibility:"public"}));
  assert.equal(legacy.visibility,"public");
  const another = await f.journal.createJournalEntry(timelineIds.auth,draft({title:"PRIVATE THOUGHT"}));
  const oldPrivateEdit = await f.journal.editJournalEntry(timelineIds.auth,another.id,edit(another,{body:"PRIVATE EDIT"}));
  assert.equal(oldPrivateEdit.visibility,"private");
  assert.deepEqual((await f.journal.getJournal(timelineIds.auth,null,false,{collection:"public"})).entries.map(e=>e.id),[published.id]);
  const privateTimeline = await f.journal.getJournal(timelineIds.auth,null,false,{collection:"private",view:"timeline"});
  assert.deepEqual(privateTimeline.entries,[]); assert.equal(privateTimeline.publicUrl,`/journal/${f.token}`);
  const journal = await f.journal.getJournal(timelineIds.auth);
  assert.deepEqual(new Set(journal.entries.map(e=>e.id)),new Set([published.id,another.id]));
  assert.equal(journal.publicUrl,`/journal/${f.token}`);
  assert.deepEqual(await f.journal.exportJournalTimeline(timelineIds.auth,"private"),[]);
  assert.equal((await f.journal.exportJournalTimeline(timelineIds.auth)).length,1,"legacy export semantics stay intact");
  await f.enable(false);
  assert.equal(await f.visitor.getPublicJournal(f.token),null);
  const unpublished = await f.journal.editJournalEntry(timelineIds.auth,legacy.id,edit(legacy,{visibility:"private"}));
  assert.equal(unpublished.visibility,"private");
  const versions = (await f.db.query("select visibility from member_journal_entry_versions where journal_entry_id=$1 order by version",[legacy.id])).rows;
  assert.deepEqual(versions.map(row=>row.visibility),["private","public","public","private"]);
});

test("public feed only projects explicit opt-ins and cannot use private or foreign cursors", async t => {
  const f = await publicJournalFixture(t); await f.enable(); await f.enable(true,timelineIds.otherMember);
  const secret = await f.journal.createJournalEntry(timelineIds.auth,draft({title:"PRIVATE TITLE",body:"PRIVATE TIMELINE",eventYear:1977,includeOnTimeline:true}));
  const shared = await f.journal.createJournalEntry(timelineIds.auth,draft({visibility:"public",eventYear:1991,includeOnTimeline:true}));
  const foreign = await f.journal.createJournalEntry(timelineIds.otherAuth,draft({visibility:"public",includeOnTimeline:true,body:"FOREIGN BODY"}));
  const feed = await f.visitor.getPublicJournal(f.token);
  assert.deepEqual(feed.entries.map(e=>e.id),[shared.id]);
  assert.deepEqual(Object.keys(feed.entries[0]).sort(),["id","kind","title","body","createdAt","media"].sort());
  assert.doesNotMatch(JSON.stringify(feed),/PRIVATE|FOREIGN|1991|1977|eventYear|includeOnTimeline|saved|version|memberId|personId|email|timeline_position/);
  for (const cursor of [secret.id,foreign.id]) assert.deepEqual((await f.visitor.getPublicJournal(f.token,cursor)).entries,[]);
  assert.equal(await f.visitor.getPublicJournal("guess"),null);
  await f.db.query("delete from member_public_cards where member_id=$1",[timelineIds.member]);
  assert.equal(await f.visitor.getPublicJournal(f.token),null);
});

test("card consent and live membership/auth changes close public feed without publishing private entries", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  await f.journal.createJournalEntry(timelineIds.auth,draft({visibility:"public",includeOnTimeline:true}));
  for (const assignment of ["standing_state='paused'","standing_state='inactive'","standing_state='alumni'","account_state='suspended'","account_state='closed'","billing_state='ended'","program_state='offboarded'","standing_state='cancellation_requested',cancellation_effective_at='2000-01-01'"]) {
    await f.db.query(`update member_lifecycle set ${assignment} where member_id=$1`,[timelineIds.member]);
    assert.equal(await f.visitor.getPublicJournal(f.token),null,assignment);
    await f.db.query("update member_lifecycle set standing_state='active',account_state='active',billing_state='active',program_state='active',cancellation_effective_at=null where member_id=$1",[timelineIds.member]);
  }
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[timelineIds.auth]);
  assert.equal(await f.visitor.getPublicJournal(f.token),null);
  await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1",[timelineIds.auth]);
  await f.db.query("update ruined_members set membership_activated_at=null where id=$1",[timelineIds.member]);
  assert.equal(await f.visitor.getPublicJournal(f.token),null);
});

async function addMedia(f, visibility = "public", member = timelineIds.member) {
  const id = randomUUID(), entry = randomUUID(), path = `${member}/verified/${id}.webp`;
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,event_year,visibility,include_on_timeline) values($1,$2,'images','Chosen photo',2024,$3,true)",[entry,member,visibility]);
  await f.db.query("insert into member_journal_media(id,member_id,entry_id,storage_path,mime_type,byte_size,verified_at,state) values($1,$2,$3,$4,'image/webp',8,now(),'ready')",[id,member,entry,path]);
  f.blobs.set(path,new Blob(["photo123"],{type:"image/webp"}));
  return {id,entry,path};
}

test("visitor media rejects private, removed, pending, deleted and foreign files and never returns signed storage URLs", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const shared = await addMedia(f), secret = await addMedia(f,"private"), foreign = await addMedia(f,"public",timelineIds.otherMember);
  const feed = await f.visitor.getPublicJournal(f.token);
  assert.deepEqual(feed.entries[0].media,[{mimeType:"image/webp",url:`/api/cards/${f.token}/journal/media/${shared.id}`}]);
  assert.doesNotMatch(JSON.stringify(feed),/storage_path|verified|PRIVATE|size|byte_size/);
  for (const id of [secret.id,foreign.id]) assert.equal(await f.visitor.getPublicJournalMedia(f.token,id),null);
  assert.equal(f.downloads.length,0);
  assert.equal(await (await f.visitor.getPublicJournalMedia(f.token,shared.id)).data.text(),"photo123");
  for (const [table,assignment] of [["member_journal_media","removed_at=now()"],["member_journal_media","state='pending',entry_id=null"],["member_journal_entries","visibility='private'"],["member_journal_entries","include_on_timeline=false"],["member_journal_entries","deleted_at=now()"]]) {
    await f.db.query(`update ${table} set ${assignment} where id=$1`,[table==="member_journal_media"?shared.id:shared.entry]);
    assert.equal(await f.visitor.getPublicJournalMedia(f.token,shared.id),null,assignment);
    if (assignment==="deleted_at=now()") break;
    await f.db.query("update member_journal_media set removed_at=null,state='ready',entry_id=$2 where id=$1",[shared.id,shared.entry]);
    await f.db.query("update member_journal_entries set visibility='public',include_on_timeline=true where id=$1",[shared.entry]);
  }
});

test("withdrawal during slow media download or feed projection discards stale content", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const shared = await addMedia(f);
  f.setStorageHook(() => f.enable(false));
  assert.equal(await f.visitor.getPublicJournalMedia(f.token,shared.id),null);
  await f.enable();
  f.setStorageHook(() => f.db.query("update member_journal_entries set visibility='private' where id=$1",[shared.entry]));
  assert.equal(await f.visitor.getPublicJournalMedia(f.token,shared.id),null);
  await f.db.query("update member_journal_entries set visibility='public' where id=$1",[shared.entry]);
  f.setStorageHook(() => f.db.query("update member_journal_entries set include_on_timeline=false where id=$1",[shared.entry]));
  assert.equal(await f.visitor.getPublicJournalMedia(f.token,shared.id),null);
  await f.db.query("update member_journal_entries set include_on_timeline=true where id=$1",[shared.entry]);
  f.setStorageHook(() => f.db.query("update member_journal_media set removed_at=now() where id=$1",[shared.id]));
  assert.equal(await f.visitor.getPublicJournalMedia(f.token,shared.id),null);
  await f.db.query("update member_journal_media set removed_at=null where id=$1",[shared.id]);
  f.setAfterQuery(async query => {
    if (!query.includes("select media.id, media.entry_id")) return;
    f.setAfterQuery(null);
    await f.db.query("update member_journal_entries set visibility='private' where id=$1",[shared.entry]);
  });
  assert.equal(await f.visitor.getPublicJournal(f.token),null);
  await f.db.query("update member_journal_entries set visibility='public' where id=$1",[shared.entry]);
  f.setAfterQuery(async query => {
    if (!query.includes("select media.id, media.entry_id")) return;
    f.setAfterQuery(null);
    await f.db.query("update member_journal_entries set include_on_timeline=false where id=$1",[shared.entry]);
  });
  assert.equal(await f.visitor.getPublicJournal(f.token),null);
  await f.db.query("update member_journal_entries set include_on_timeline=true where id=$1",[shared.entry]);
  f.setAfterQuery(async query => {
    if (!query.includes("select media.id, media.entry_id")) return;
    f.setAfterQuery(null); await f.enable(false);
  });
  assert.equal(await f.visitor.getPublicJournal(f.token),null);
});

test("public JSON and byte routes fail closed in disconnected mode and always disable caching", async () => {
  const cardModel = await load("src/lib/membership/public-card-model.ts");
  const journalModel = await load("src/lib/membership/journal-model.ts");
  let connected = false, allowed = false, calls = 0;
  const repository = { getPublicJournal: async () => {calls++; return allowed?{entries:[],hasMore:false,nextCursor:null}:null;},
    getPublicJournalMedia: async () => {calls++; return allowed?{data:new Blob(["photo"]),mimeType:"image/webp"}:null;} };
  const deps = { "next/server":{NextResponse:Response},"@/lib/platform/config":{getPlatformConfiguration:()=>({mode:connected?"connected":"preview"})},
    "@/lib/membership/public-journal-repository":repository,"@/lib/membership/public-card-model":cardModel,"@/lib/membership/journal-model":journalModel };
  const feed = await load("app/api/cards/[token]/journal/route.ts",deps), media = await load("app/api/cards/[token]/journal/media/[id]/route.ts",deps);
  const context = {params:Promise.resolve({token:"a".repeat(43),id:randomUUID()})}, request = new Request("https://members.example.test/api/cards/token/journal");
  for (const route of [feed,media]) assert.equal((await route.GET(request,context)).status,404);
  assert.equal(calls,0); connected=true;
  for (const route of [feed,media]) {
    assert.equal((await route.GET(request,context)).status,404);
    allowed=true; const response=await route.GET(request,context); assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"private, no-store, max-age=0"); assert.equal(response.headers.get("x-robots-tag"),"noindex, nofollow");
    allowed=false;
  }
});

test("old Timeline editors cannot read, mutate or unmark a now-public milestone", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const entry = await f.journal.createJournalEntry(timelineIds.auth,draft({eventYear:2024,includeOnTimeline:true}));
  const oldTimeline = await f.repository.getMemberTimeline(timelineIds.auth);
  await f.journal.editJournalEntry(timelineIds.auth,entry.id,edit(entry,{visibility:"public"}));
  const current = await f.repository.getMemberTimeline(timelineIds.auth);
  assert.deepEqual(current.entries,[]);
  assert.notEqual(current.revision,oldTimeline.revision);
  const original = await f.journal.getJournalEntry(timelineIds.auth,entry.id);
  for (const revision of [oldTimeline.revision,current.revision]) {
    await assert.rejects(f.repository.upsertMemberTimelineEntry(timelineIds.auth,{...oldTimeline.entries[0],details:"PRIVATE NEW DETAILS"},revision),f.repository.MembershipConflictError);
    await assert.rejects(f.repository.deleteMemberTimelineEntry(timelineIds.auth,entry.id,revision),f.repository.MembershipConflictError);
    await assert.rejects(f.repository.saveMemberTimeline(timelineIds.auth,oldTimeline.entries,revision),f.repository.MembershipConflictError);
  }
  await f.repository.saveMemberTimeline(timelineIds.auth,[],current.revision);
  assert.deepEqual(await f.journal.getJournalEntry(timelineIds.auth,entry.id),original);
});

test("public pagination visits the full opted-in feed without gaps and consent is rechecked during publication", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  for (let n=0;n<33;n++) await f.journal.createJournalEntry(timelineIds.auth,draft({title:`Published ${n}`,visibility:"public",includeOnTimeline:true}));
  const first = await f.visitor.getPublicJournal(f.token);
  assert.equal(first.entries.length,30); assert.equal(first.hasMore,true);
  const next = await f.visitor.getPublicJournal(f.token,first.nextCursor);
  assert.equal(next.entries.length,3); assert.equal(next.hasMore,false);
  assert.equal(new Set([...first.entries,...next.entries].map(entry=>entry.id)).size,33);
  const input = draft({visibility:"public",includeOnTimeline:true});
  f.beforeNextTransaction(() => f.enable(false));
  await assert.rejects(f.journal.createJournalEntry(timelineIds.auth,input),{status:403});
  assert.equal((await f.db.query("select count(*)::int n from member_journal_entries where id=$1",[input.id])).rows[0].n,0);
});
