import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { publicJournalFixture, source, timelineIds as ids, load } from "./helpers/public-journal-fixture.mjs";

const migration = "db/migrations/20261030120000_public_timeline_reflections.sql";
const reflection = { meaning: "I was on my own.", belief: "I had to handle everything.", presentImpact: "I hesitate to ask for help.", perspective: "Asking is part of belonging." };
const draft = changes => ({ id: randomUUID(), kind: "text", title: "A new beginning", body: "I moved to a new city.", mediaIds: [], eventYear: 2012, eventMonth: 9, eventDay: 8, includeOnTimeline: true, visibility: "private", timelineReflection: reflection, ...changes });
const edit = (entry, changes = {}) => ({ expectedVersion: entry.version, kind: entry.kind, title: entry.title ?? "", body: entry.body ?? "", mediaIds: entry.media.map(media => media.id), eventYear: entry.eventYear, eventMonth: entry.eventMonth, eventDay: entry.eventDay, includeOnTimeline: entry.includeOnTimeline, visibility: entry.visibility, ...changes });

test("guided Timeline answers are a complete bounded structure and legacy private answers are never writable publication input", async () => {
  const model = await load("src/lib/membership/journal-model.ts");
  assert.deepEqual(model.validateJournalInput(draft({ timelineReflection: { ...reflection, meaning: "  revised  ", perspective: " " } })).timelineReflection, { ...reflection, meaning: "revised", perspective: null });
  assert.equal(model.validateJournalInput(draft({ timelineReflection: null })).timelineReflection, null);
  for (const invalid of [[], "answer", {}, { ...reflection, unknown: "value" }, { ...reflection, belief: 42 }, { ...reflection, belief: "x".repeat(4001) }, { ...reflection, perspective: undefined }]) {
    assert.throws(() => model.validateJournalInput(draft({ timelineReflection: invalid })), model.JournalError);
  }
  assert.throws(() => model.validateJournalInput(draft({ legacyTimelineReflection: reflection })), model.JournalError);
  assert.throws(() => model.validateJournalInput(draft({ eventYear: null, eventMonth: null, eventDay: null })), /year and title/);
  assert.throws(() => model.validateJournalInput(draft({ title: "" })), /year and title/);
  assert.throws(() => model.validateJournalInput(draft({ visibility: "public", includeOnTimeline: false })), /public Timeline/);
});

test("public story migration preserves every original record/history and keeps browser Data API access closed", async t => {
  const f = await publicJournalFixture(t, { publicReflectionMigration: false });
  const id = randomUUID();
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,body,event_year,include_on_timeline,foundations_meaning) values($1,$2,'text','Original','Private context',2001,true,'PRIVATE LEGACY')", [id, ids.member]);
  await f.db.query("update member_journal_entries set body='Private revised context' where id=$1", [id]);
  const before = {};
  for (const table of ["member_journal_entries", "member_journal_entry_versions"]) before[table] = (await f.db.query(`select to_jsonb(e) row from ${table} e order by id`)).rows;
  await f.db.exec(await source(migration));
  for (const table of Object.keys(before)) {
    assert.deepEqual((await f.db.query(`select to_jsonb(e)-'timeline_reflection' row from ${table} e order by id`)).rows, before[table]);
    for (const role of ["anon", "authenticated"]) assert.equal((await f.db.query("select has_column_privilege($1,$2,'timeline_reflection','SELECT') allowed", [role, table])).rows[0].allowed, false);
  }
  for (const value of [[], "bad", {}, { ...reflection, secret: "no" }, { ...reflection, meaning: "x".repeat(4001) }]) {
    await assert.rejects(f.db.query("update member_journal_entries set timeline_reflection=$1::jsonb where id=$2", [JSON.stringify(value), id]), { code: "23514" });
  }
});

test("private story drafts stay private until explicit publication; published dates and answers withdraw together", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const saved = await f.journal.createJournalEntry(ids.auth, draft());
  assert.deepEqual(saved.timelineReflection, reflection);
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries, []);
  const published = await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { visibility: "public", timelineReflection: reflection }));
  const visitor = (await f.visitor.getPublicJournal(f.token)).entries[0];
  assert.deepEqual(visitor.timelineReflection, reflection);
  assert.deepEqual([visitor.eventYear, visitor.eventMonth, visitor.eventDay], [2012, 9, 8]);
  assert.equal("legacyTimelineReflection" in visitor, false);
  assert.equal("version" in visitor, false);
  const history = (await f.db.query("select version,timeline_reflection,visibility,actor_auth_user_id from member_journal_entry_versions where journal_entry_id=$1 order by version", [saved.id])).rows;
  assert.deepEqual(history.map(row => [row.version, row.timeline_reflection, row.visibility, row.actor_auth_user_id]), [[1, reflection, "private", ids.auth], [2, reflection, "public", ids.auth]]);
  await assert.rejects(f.db.query("update member_journal_entry_versions set timeline_reflection=null where journal_entry_id=$1", [saved.id]), /append.only/i);
  const withdrawn = await f.journal.editJournalEntry(ids.auth, saved.id, edit(published, { visibility: "private" }));
  assert.deepEqual(withdrawn.timelineReflection, reflection);
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries, []);
});

test("omitted structured answers survive edits; explicit null clears only reviewed publication data", async t => {
  const f = await publicJournalFixture(t);
  let saved = await f.journal.createJournalEntry(ids.auth, draft());
  const originalVersion = saved.version;
  saved = await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved));
  assert.equal(saved.version, originalVersion);
  saved = await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { body: "New context, same reflection." }));
  assert.deepEqual(saved.timelineReflection, reflection);
  await assert.rejects(f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { eventYear: null, eventMonth: null, eventDay: null })), /year and title/);
  saved = await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { timelineReflection: null }));
  assert.equal(saved.timelineReflection, undefined);
  assert.equal((await f.db.query("select timeline_reflection from member_journal_entries where id=$1", [saved.id])).rows[0].timeline_reflection, null);
});

test("private structured answers require review on publication, while public edits preserve omitted answers", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  let saved = await f.journal.createJournalEntry(ids.auth, draft());
  await assert.rejects(f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { visibility: "public" })), error => error.status === 409 && /review all/.test(error.message));
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries, []);
  saved = await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { visibility: "public", timelineReflection: reflection }));
  saved = await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { body: "Reviewed public context." }));
  assert.deepEqual(saved.timelineReflection, reflection);
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries[0].timelineReflection, reflection);
});

test("legacy reflections are owner-only recovery and never automatically copied into published stories", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const legacy = await f.repository.upsertMemberTimelineEntry(ids.auth, { id: null, year: 2010, month: 3, title: "Older private moment", details: "Context", ...reflection }, "0");
  const id = legacy.entries[0].id;
  const owner = await f.journal.getJournalEntry(ids.auth, id);
  assert.deepEqual(owner.legacyTimelineReflection, reflection);
  assert.equal(owner.timelineReflection, undefined);
  await assert.rejects(f.journal.getJournalEntry(ids.otherAuth, id), error => error.status === 404);
  const published = await f.journal.editJournalEntry(ids.auth, id, edit(owner, { visibility: "public" }));
  assert.equal(published.legacyTimelineReflection, undefined);
  const visitor = (await f.visitor.getPublicJournal(f.token)).entries[0];
  for (const secret of Object.values(reflection)) assert.equal(JSON.stringify(visitor).includes(secret), false);
  assert.equal("timelineReflection" in visitor, false);
  assert.equal("eventYear" in visitor, false, "Ordinary older public posts do not acquire new date exposure.");
  const withdrawn = await f.journal.editJournalEntry(ids.auth, id, edit(published, { visibility: "private" }));
  assert.deepEqual(withdrawn.legacyTimelineReflection, reflection);
  const reviewed = { ...reflection, meaning: "The answer I chose to share." };
  await f.journal.editJournalEntry(ids.auth, id, edit(withdrawn, { visibility: "public", timelineReflection: reviewed }));
  assert.deepEqual((await f.visitor.getPublicJournal(f.token)).entries[0].timelineReflection, reviewed);
  assert.equal((await f.db.query("select foundations_meaning from member_journal_entries where id=$1", [id])).rows[0].foundations_meaning, reflection.meaning);
});

test("structured create and edit retries are idempotent across JSON key order and reject stale/foreign edits", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const input = draft({ visibility: "public" });
  const saved = await f.journal.createJournalEntry(ids.auth, input);
  assert.equal((await f.journal.createJournalEntry(ids.auth, input)).version, saved.version);
  const reordered = Object.fromEntries(Object.entries(reflection).reverse());
  assert.equal((await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { timelineReflection: reordered }))).version, saved.version);
  const changed = await f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { timelineReflection: { ...reflection, perspective: "A new perspective." } }));
  assert.notEqual(changed.version, saved.version);
  await assert.rejects(f.journal.editJournalEntry(ids.auth, saved.id, edit(saved, { timelineReflection: reflection })), error => error.status === 409);
  await assert.rejects(f.journal.editJournalEntry(ids.otherAuth, saved.id, edit(changed)), error => error.status === 404);
});

test("published guided stories satisfy Foundations without counting ordinary public posts or rewriting completion receipts", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  await f.journal.createJournalEntry(ids.auth, draft({ visibility: "public", timelineReflection: null }));
  assert.equal((await f.repository.getMemberFoundationRequirements(ids.auth)).timeline.entryCount, 0);
  const story = await f.journal.createJournalEntry(ids.auth, draft({ visibility: "public" }));
  assert.equal((await f.repository.getMemberFoundationRequirements(ids.auth)).timeline.entryCount, 1);
  const completed = await f.repository.completeMemberFoundationRequirement(ids.auth, "timeline");
  assert.equal(completed.timeline.completed, true);
  await f.journal.editJournalEntry(ids.auth, story.id, edit(story, { visibility: "private", includeOnTimeline: false }));
  const later = await f.repository.getMemberFoundationRequirements(ids.auth);
  assert.equal(later.timeline.entryCount, 0);
  assert.equal(later.timeline.completedAt, completed.timeline.completedAt);
});

test("reflection changes during public projection discard the stale story", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const story = await f.journal.createJournalEntry(ids.auth, draft({ visibility: "public" }));
  let changed = false;
  f.setAfterQuery(async query => {
    if (!changed && query.includes("case when timeline_reflection is not null then event_year")) {
      changed = true;
      await f.db.query("update member_journal_entries set timeline_reflection=$1::jsonb where id=$2", [JSON.stringify({ ...reflection, perspective: "Updated while the visitor was loading." }), story.id]);
    }
  });
  assert.equal(await f.visitor.getPublicJournal(f.token), null);
  assert.equal(changed, true);
});
