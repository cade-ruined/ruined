import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { timelineFixture, timelineIds as ids } from "./helpers/canonical-journal-fixture.mjs";
import { publicJournalFixture } from "./helpers/public-journal-fixture.mjs";

const migration = "db/migrations/20261029160000_foundations_timeline_reflections.sql";
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const fields = { belief: "foundations_belief", presentImpact: "foundations_present_impact", perspective: "foundations_perspective" };
const reflection = { belief: "I had to earn my place.", presentImpact: "I take on too much before asking for help.", perspective: "I can belong and still have limits." };
const event = changes => ({ id: null, year: 2012, month: 9, title: "A meaningful experience", details: "What actually happened.", meaning: "I was on my own.", ...changes });
const legacy = value => ({ id: value.id, year: value.year, month: value.month, title: value.title, details: value.details });
const edit = (value, changes) => ({ expectedVersion: value.version, kind: value.kind, title: value.title ?? "", body: value.body ?? "", mediaIds: value.media.map(media => media.id), eventYear: value.eventYear, eventMonth: value.eventMonth, eventDay: value.eventDay, includeOnTimeline: value.includeOnTimeline, ...changes });

test("reflection migration is additive, retains original entries/history and keeps Data API access closed", async t => {
  const f = await timelineFixture(t, { reflectionMigration: false });
  const id = randomUUID();
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,body,event_year,include_on_timeline,foundations_meaning) values($1,$2,'text','Original event','Original details',2002,true,'Original meaning')", [id, ids.member]);
  await f.db.query("update member_journal_entries set body='Revised details' where id=$1", [id]);
  const snapshots = {};
  for (const table of ["member_journal_entries", "member_journal_entry_versions"]) snapshots[table] = (await f.db.query(`select to_jsonb(e) row from ${table} e order by id`)).rows;
  await f.db.exec(await source(migration));
  for (const table of Object.keys(snapshots)) {
    assert.deepEqual((await f.db.query(`select to_jsonb(e)-array['foundations_belief','foundations_present_impact','foundations_perspective'] row from ${table} e order by id`)).rows, snapshots[table]);
    for (const column of Object.values(fields)) for (const role of ["anon", "authenticated"]) {
      assert.equal((await f.db.query("select has_column_privilege($1,$2,$3,'SELECT') allowed", [role, table, column])).rows[0].allowed, false);
    }
    assert.equal((await f.db.query("select relrowsecurity enabled from pg_class where oid=$1::regclass", [table])).rows[0].enabled, true);
  }
  await f.db.exec(await source("db/migrations/20261030120000_public_timeline_reflections.sql"));
  const saved = (await f.repository.getMemberTimeline(ids.auth)).entries[0];
  assert.equal(saved.meaning, "Original meaning");
  for (const field of Object.keys(fields)) assert.equal(saved[field], null);
});

test("reflection-only saves keep canonical content and create private owner-attributed immutable history", async t => {
  const f = await timelineFixture(t);
  const first = await f.repository.upsertMemberTimelineEntry(ids.auth, event(), "0");
  const next = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(first.entries[0]), ...reflection }, first.revision);
  for (const [field, value] of Object.entries(reflection)) assert.equal(next.entries[0][field], value);
  assert.equal(next.entries[0].meaning, first.entries[0].meaning);
  assert.equal(next.entries[0].details, first.entries[0].details);
  assert.ok(BigInt(next.revision) > BigInt(first.revision));
  const history = (await f.db.query("select version,foundations_belief,foundations_present_impact,foundations_perspective,actor_auth_user_id from member_journal_entry_versions where journal_entry_id=$1 order by version", [next.entries[0].id])).rows;
  assert.deepEqual(history, [
    { version: 1, foundations_belief: null, foundations_present_impact: null, foundations_perspective: null, actor_auth_user_id: ids.auth },
    { version: 2, foundations_belief: reflection.belief, foundations_present_impact: reflection.presentImpact, foundations_perspective: reflection.perspective, actor_auth_user_id: ids.auth },
  ]);
  const noop = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(next.entries[0]), ...reflection }, next.revision);
  assert.equal(noop.revision, next.revision);
  await assert.rejects(f.db.query("update member_journal_entry_versions set foundations_belief='Rewrite' where journal_entry_id=$1", [next.entries[0].id]), /append.only/i);
});

test("old clients preserve every reflection; explicit blank or null only clears the selected answer", async t => {
  const f = await timelineFixture(t);
  let current = await f.repository.upsertMemberTimelineEntry(ids.auth, event(reflection), "0");
  const noop = await f.repository.saveMemberTimeline(ids.auth, current.entries.map(legacy), current.revision);
  assert.equal(noop.revision, current.revision);
  for (const field of Object.keys(fields)) for (const clear of [null, "  \n "]) {
    current = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(current.entries[0]), ...reflection }, current.revision);
    current = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(current.entries[0]), [field]: clear }, current.revision);
    assert.equal(current.entries[0][field], null);
    for (const other of Object.keys(fields).filter(key => key !== field)) assert.equal(current.entries[0][other], reflection[other]);
    assert.equal(current.entries[0].meaning, "I was on my own.");
  }
});

test("reflection writes reject stale revisions, other owners, invalid types and oversized answers", async t => {
  const f = await timelineFixture(t);
  const first = await f.repository.upsertMemberTimelineEntry(ids.auth, event(reflection), "0");
  const next = await f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(first.entries[0]), perspective: "A fresh perspective." }, first.revision);
  const count = await f.versionCount();
  await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(first.entries[0]), belief: "Stale" }, first.revision), f.repository.MembershipConflictError);
  await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.otherAuth, { ...legacy(next.entries[0]), belief: "Foreign" }, "0"), f.repository.MembershipConflictError);
  for (const [field, column] of Object.entries(fields)) {
    for (const value of [42, {}, [], "x".repeat(4001)]) await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(next.entries[0]), [field]: value }, next.revision), f.repository.MembershipInputError);
    await assert.rejects(f.db.query(`update member_journal_entries set ${column}=$1 where id=$2`, ["x".repeat(4001), next.entries[0].id]), { code: "23514" });
  }
  assert.deepEqual(await f.repository.getMemberTimeline(ids.auth), next);
  assert.equal(await f.versionCount(), count);
});

test("all private answers survive Journal publication and withdrawal without entering public or generic Journal projections", async t => {
  const f = await publicJournalFixture(t); await f.enable();
  const secrets = { belief: "PRIVATE_BELIEF_ANSWER", presentImpact: "PRIVATE_PRESENT_IMPACT_ANSWER", perspective: "PRIVATE_PERSPECTIVE_ANSWER" };
  const first = await f.repository.upsertMemberTimelineEntry(ids.auth, event(secrets), "0");
  const id = first.entries[0].id;
  let journal = await f.journal.getJournalEntry(ids.auth, id);
  journal = await f.journal.editJournalEntry(ids.auth, id, edit(journal, { body: "Only this event description is public.", visibility: "public" }));
  for (const projection of [journal, await f.visitor.getPublicJournal(f.token), await f.journal.getJournal(ids.auth), await f.journal.exportJournalTimeline(ids.auth, "public")]) {
    for (const [field, column] of Object.entries(fields)) {
      assert.equal(JSON.stringify(projection).includes(secrets[field]), false);
      assert.equal(JSON.stringify(projection).includes(column), false);
    }
  }
  const published = await f.repository.getMemberTimeline(ids.auth);
  assert.deepEqual(published.entries, []);
  await assert.rejects(f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(first.entries[0]), belief: "Not editable here" }, published.revision), f.repository.MembershipConflictError);
  journal = await f.journal.editJournalEntry(ids.auth, id, edit(journal, { visibility: "private" }));
  const restored = await f.repository.getMemberTimeline(ids.auth);
  for (const field of Object.keys(fields)) assert.equal(restored.entries[0][field], secrets[field]);
  await f.repository.deleteMemberTimelineEntry(ids.auth, id, restored.revision);
  const stored = (await f.db.query("select foundations_belief,foundations_present_impact,foundations_perspective from member_journal_entries where id=$1", [id])).rows[0];
  for (const [field, column] of Object.entries(fields)) assert.equal(stored[column], secrets[field]);
});

test("new reflections never truncate long Journal bodies, exact dates or attached media", async t => {
  const f = await timelineFixture(t), id = randomUUID(), media = randomUUID();
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,body,event_year,event_month,event_day,include_on_timeline,timeline_position) values($1,$2,'images','A preserved photograph',$3,2015,8,19,true,1)", [id, ids.member, "Original detail. ".repeat(400)]);
  await f.db.query("insert into member_journal_media(id,member_id,entry_id,storage_path,mime_type,byte_size,state,verified_at) values($1,$2,$3,'preserved/private-photo.webp','image/webp',24,'ready',now())", [media, ids.member, id]);
  const first = await f.repository.getMemberTimeline(ids.auth);
  const original = (await f.db.query("select kind,title,body,event_year,event_month,event_day,timeline_position from member_journal_entries where id=$1", [id])).rows;
  await f.repository.upsertMemberTimelineEntry(ids.auth, { ...legacy(first.entries[0]), ...reflection }, first.revision);
  assert.deepEqual((await f.db.query("select kind,title,body,event_year,event_month,event_day,timeline_position from member_journal_entries where id=$1", [id])).rows, original);
  assert.equal((await f.db.query("select entry_id from member_journal_media where id=$1", [media])).rows[0].entry_id, id);
});
