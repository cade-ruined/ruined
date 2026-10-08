import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { timelineFixture, timelineIds as ids } from "./helpers/canonical-journal-fixture.mjs";
import { publicJournalFixture } from "./helpers/public-journal-fixture.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const entry = changes => ({ id: null, year: 2012, month: 9, title: "A meaningful experience", details: "The actual experience, kept intact.", ...changes });
const input = value => ({ id: value.id, year: value.year, month: value.month, title: value.title, details: value.details });
const journalEdit = (value, changes) => ({ expectedVersion: value.version, kind: value.kind, title: value.title ?? "", body: value.body ?? "", mediaIds: value.media.map(media => media.id), eventYear: value.eventYear, eventMonth: value.eventMonth, eventDay: value.eventDay, includeOnTimeline: value.includeOnTimeline, ...changes });

test("meaning migration preserves every existing event/history field and leaves private grants intact", async t => {
  const f = await timelineFixture(t, { meaningMigration: false });
  const id = randomUUID();
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,body,event_year,include_on_timeline,updated_by_auth_user_id) values($1,$2,'text','Original event','Original details',2002,true,$3)", [id, ids.member, ids.auth]);
  await f.db.query("update member_journal_entries set body='Revised details' where id=$1", [id]);
  const rows = (await f.db.query("select to_jsonb(e) row from member_journal_entries e order by id")).rows;
  const history = (await f.db.query("select to_jsonb(v) row from member_journal_entry_versions v order by id")).rows;
  await f.db.exec(await source("db/migrations/20261008200000_foundations_timeline_meaning.sql"));
  assert.deepEqual((await f.db.query("select to_jsonb(e)-'foundations_meaning' row from member_journal_entries e order by id")).rows, rows);
  assert.deepEqual((await f.db.query("select to_jsonb(v)-'foundations_meaning' row from member_journal_entry_versions v order by id")).rows, history);
  assert.equal((await f.repository.getMemberTimeline(ids.auth)).entries[0].meaning, null);
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["member_journal_entries", "member_journal_entry_versions"]) {
      assert.equal((await f.db.query("select has_column_privilege($1,$2,'foundations_meaning','SELECT') allowed", [role, table])).rows[0].allowed, false);
      assert.equal((await f.db.query("select relrowsecurity enabled from pg_class where oid=$1::regclass", [table])).rows[0].enabled, true);
    }
  }
});

test("meaning-only saves retain the original event and produce owner-attributed append-only versions", async t => {
  const f = await timelineFixture(t);
  const first = await f.repository.upsertMemberTimelineEntry(ids.auth, entry(), "0");
  const stored = first.entries[0];
  const before = (await f.db.query("select to_jsonb(e)-array['foundations_meaning','current_version','updated_at','updated_by_auth_user_id'] row from member_journal_entries e where id=$1", [stored.id])).rows;
  const meaning = "I’m valuable when I win.\nI began carrying that into work.";
  const next = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(stored), meaning }, first.revision);
  assert.equal(next.entries[0].meaning, meaning);
  assert.ok(BigInt(next.revision) > BigInt(first.revision));
  assert.deepEqual((await f.db.query("select to_jsonb(e)-array['foundations_meaning','current_version','updated_at','updated_by_auth_user_id'] row from member_journal_entries e where id=$1", [stored.id])).rows, before);
  assert.deepEqual((await f.db.query("select version,foundations_meaning,actor_auth_user_id from member_journal_entry_versions where journal_entry_id=$1 order by version", [stored.id])).rows, [
    { version: 1, foundations_meaning: null, actor_auth_user_id: ids.auth },
    { version: 2, foundations_meaning: meaning, actor_auth_user_id: ids.auth },
  ]);
  const noop = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(next.entries[0]), meaning }, next.revision);
  assert.equal(noop.revision, next.revision);
  await assert.rejects(f.db.query("update member_journal_entry_versions set foundations_meaning='Rewrite' where journal_entry_id=$1", [stored.id]), /append.only/i);
});

test("legacy clients preserve meaning while explicit null or blank clears only that field", async t => {
  const f = await timelineFixture(t);
  let current = await f.repository.upsertMemberTimelineEntry(ids.auth, entry({ meaning: "People leave." }), "0");
  const noop = await f.repository.saveMemberTimeline(ids.auth, current.entries.map(input), current.revision);
  assert.equal(noop.revision, current.revision);
  assert.equal(noop.entries[0].meaning, "People leave.");
  current = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(current.entries[0]), title: "Clarified event title" }, current.revision);
  assert.equal(current.entries[0].meaning, "People leave.");
  for (const clear of [null, "  \n "]) {
    current = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(current.entries[0]), meaning: "A story carried forward." }, current.revision);
    current = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(current.entries[0]), meaning: clear }, current.revision);
    assert.equal(current.entries[0].meaning, null);
    assert.equal(current.entries[0].details, "The actual experience, kept intact.");
    assert.equal(current.entries[0].title, "Clarified event title");
  }
});

test("meaning writes reject stale revisions, other owners, invalid types and oversize text without changing content", async t => {
  const f = await timelineFixture(t);
  const first = await f.repository.upsertMemberTimelineEntry(ids.auth, entry({ meaning: "First meaning" }), "0");
  const next = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(first.entries[0]), meaning: "Current meaning" }, first.revision);
  const versions = await f.versionCount();
  await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(first.entries[0]), meaning: "Stale meaning" }, first.revision), f.repository.MembershipConflictError);
  await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.otherAuth, { ...input(next.entries[0]), meaning: "Foreign change" }, "0"), f.repository.MembershipConflictError);
  for (const meaning of [42, {}, [], "x".repeat(4001)]) {
    await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(next.entries[0]), meaning }, next.revision), f.repository.MembershipInputError);
  }
  await assert.rejects(f.db.query("update member_journal_entries set foundations_meaning=$1 where id=$2", ["x".repeat(4001), first.entries[0].id]), { code: "23514" });
  assert.deepEqual(await f.repository.getMemberTimeline(ids.auth), next);
  assert.equal(await f.versionCount(), versions);
});

test("meaning can be added without truncating Journal content, media identity or exact dates", async t => {
  const f = await timelineFixture(t), id = randomUUID(), media = randomUUID();
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,body,event_year,event_month,event_day,include_on_timeline,timeline_position) values($1,$2,'images','A preserved photograph',$3,2015,8,19,true,1)", [id, ids.member, "Original detail. ".repeat(400)]);
  await f.db.query("insert into member_journal_media(id,member_id,entry_id,storage_path,mime_type,byte_size,state,verified_at) values($1,$2,$3,'preserved/private-photo.webp','image/webp',24,'ready',now())", [media, ids.member, id]);
  const original = await f.repository.getMemberTimeline(ids.auth);
  const before = (await f.db.query("select kind,title,body,event_year,event_month,event_day,timeline_position from member_journal_entries where id=$1", [id])).rows;
  const saved = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(original.entries[0]), meaning: "I can figure things out." }, original.revision);
  assert.equal(saved.entries[0].meaning, "I can figure things out.");
  assert.deepEqual((await f.db.query("select kind,title,body,event_year,event_month,event_day,timeline_position from member_journal_entries where id=$1", [id])).rows, before);
  assert.equal((await f.db.query("select entry_id from member_journal_media where id=$1", [media])).rows[0].entry_id, id);
});

test("Journal editing and publishing retain the private meaning without exposing it in visitor or generic Journal projections", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const secret = "PRIVATE_FOUNDATIONS_MEANING_ONLY";
  const initial = await f.repository.upsertMemberTimelineEntry(ids.auth, entry({ meaning: secret }), "0");
  const id = initial.entries[0].id;
  let journal = await f.journal.getJournalEntry(ids.auth, id);
  assert.equal(Object.hasOwn(journal, "meaning"), false);
  journal = await f.journal.editJournalEntry(ids.auth, id, journalEdit(journal, { body: "Edited Journal details" }));
  assert.equal((await f.repository.getMemberTimeline(ids.auth)).entries[0].meaning, secret);
  journal = await f.journal.editJournalEntry(ids.auth, id, journalEdit(journal, { visibility: "public" }));
  assert.deepEqual((await f.repository.getMemberTimeline(ids.auth)).entries, []);
  assert.equal((await f.db.query("select foundations_meaning from member_journal_entries where id=$1", [id])).rows[0].foundations_meaning, secret);
  const published = await f.visitor.getPublicJournal(f.token);
  assert.equal(published.entries[0].id, id);
  for (const projection of [published, await f.journal.getJournal(ids.auth), await f.journal.exportJournalTimeline(ids.auth, "public")]) {
    assert.equal(JSON.stringify(projection).includes(secret), false);
    assert.equal(JSON.stringify(projection).includes("foundations_meaning"), false);
  }
  const publishedRevision = (await f.repository.getMemberTimeline(ids.auth)).revision;
  await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.auth, { ...input(initial.entries[0]), meaning: "Cannot change published entry through Foundations" }, publishedRevision), f.repository.MembershipConflictError);
  journal = await f.journal.editJournalEntry(ids.auth, id, journalEdit(journal, { visibility: "private" }));
  assert.equal((await f.repository.getMemberTimeline(ids.auth)).entries[0].meaning, secret);
  await f.repository.deleteMemberTimelineEntry(ids.auth, id, (await f.repository.getMemberTimeline(ids.auth)).revision);
  assert.equal((await f.db.query("select foundations_meaning from member_journal_entries where id=$1", [id])).rows[0].foundations_meaning, secret, "Removing from the Timeline keeps its canonical private Journal record.");
});
