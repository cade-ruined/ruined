import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { publicJournalFixture, timelineIds, load } from "./helpers/public-journal-fixture.mjs";

const draft = changes => ({ id: randomUUID(), kind: "text", title: "A shared thought", body: "Chosen words", mediaIds: [], ...changes });
const edit = (entry, changes) => ({ expectedVersion: entry.version, kind: entry.kind, title: entry.title ?? "", body: entry.body ?? "",
  mediaIds: entry.media.map(item => item.id), eventYear: entry.eventYear, eventMonth: entry.eventMonth, eventDay: entry.eventDay,
  includeOnTimeline: entry.includeOnTimeline, ...changes });

test("visibility migration leaves legacy content, revisions and history untouched and defaults every row private", async t => {
  const f = await publicJournalFixture(t, { applyPrivacy: false });
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

test("owner publication requires card sharing and stays versioned, owner-scoped and backward compatible", async t => {
  const f = await publicJournalFixture(t);
  const privateEntry = await f.journal.createJournalEntry(timelineIds.auth,draft({eventYear:2024,eventMonth:2,eventDay:29,includeOnTimeline:true}));
  assert.equal((await f.journal.getJournal(timelineIds.auth,null,false,{collection:"private"})).publicUrl,null);
  await assert.rejects(f.journal.createJournalEntry(timelineIds.auth,draft({visibility:"public"})),{status:403});
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
  assert.deepEqual(privateTimeline.entries.map(e=>e.id),[another.id]); assert.equal(privateTimeline.publicUrl,`/journal/${f.token}`);
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
  const foreign = await f.journal.createJournalEntry(timelineIds.otherAuth,draft({visibility:"public",body:"FOREIGN BODY"}));
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
  await f.journal.createJournalEntry(timelineIds.auth,draft({visibility:"public"}));
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
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,visibility) values($1,$2,'images','Chosen photo',$3)",[entry,member,visibility]);
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
  for (const [table,assignment] of [["member_journal_media","removed_at=now()"],["member_journal_media","state='pending',entry_id=null"],["member_journal_entries","visibility='private'"],["member_journal_entries","deleted_at=now()"]]) {
    await f.db.query(`update ${table} set ${assignment} where id=$1`,[table==="member_journal_media"?shared.id:shared.entry]);
    assert.equal(await f.visitor.getPublicJournalMedia(f.token,shared.id),null,assignment);
    if (assignment==="deleted_at=now()") break;
    await f.db.query("update member_journal_media set removed_at=null,state='ready',entry_id=$2 where id=$1",[shared.id,shared.entry]);
    await f.db.query("update member_journal_entries set visibility='public' where id=$1",[shared.entry]);
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
  for (let n=0;n<33;n++) await f.journal.createJournalEntry(timelineIds.auth,draft({title:`Published ${n}`,visibility:"public"}));
  const first = await f.visitor.getPublicJournal(f.token);
  assert.equal(first.entries.length,30); assert.equal(first.hasMore,true);
  const next = await f.visitor.getPublicJournal(f.token,first.nextCursor);
  assert.equal(next.entries.length,3); assert.equal(next.hasMore,false);
  assert.equal(new Set([...first.entries,...next.entries].map(entry=>entry.id)).size,33);
  const input = draft({visibility:"public"});
  f.beforeNextTransaction(() => f.enable(false));
  await assert.rejects(f.journal.createJournalEntry(timelineIds.auth,input),{status:403});
  assert.equal((await f.db.query("select count(*)::int n from member_journal_entries where id=$1",[input.id])).rows[0].n,0);
});
