import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { practiceFixture, ids } from './helpers/practice-fixture.mjs';

const draft = (title = 'A beginning') => ({ id: null, year: 2001, title, details: '', meaning: 'I could start again.', presentImpact: 'I choose to try.' });
const time = { action: 'Walk outside', category: 'health', minutes: 30, sourceCategory: 'media', sourceMinutes: 120 };
const rejected = (status, code) => error => error.status === status && (!code || error.code === code);
const reflection = { meaning: 'A meaning I choose to share.', belief: 'A belief I noticed.', presentImpact: 'How it shows up today.', perspective: 'What I see now.' };
const story = (changes = {}) => ({ id: randomUUID(), kind: 'text', title: 'A public beginning', body: 'The moment itself.', mediaIds: [],
  eventYear: 2005, eventMonth: 6, eventDay: 9, includeOnTimeline: true, visibility: 'public', timelineReflection: reflection, ...changes });
const edit = (entry, changes = {}) => ({ expectedVersion: entry.version, kind: entry.kind, title: entry.title ?? '', body: entry.body ?? '',
  mediaIds: entry.media.map(media => media.id), eventYear: entry.eventYear, eventMonth: entry.eventMonth, eventDay: entry.eventDay,
  includeOnTimeline: entry.includeOnTimeline, visibility: entry.visibility, ...changes });

test('Practice saves partial F1 work to its owner, commits atomically and rejects uncertain duplicate retries', async t => {
  const f = await practiceFixture(t);
  let state = await f.get();
  const partial = { ...draft(''), year: null, meaning: '', presentImpact: '' };
  state = await f.save('save_timeline_draft', partial, state.revision);
  assert.deepEqual((await f.get()).timelineDraft, partial);
  assert.equal((await f.get(ids.otherAuth)).timelineDraft, null);
  assert.equal(state.timeline.entries.length, 0);
  await assert.rejects(f.save('keep_timeline_entry', partial, state.revision, { expectedTimelineRevision: state.timeline.revision }), rejected(400));
  const before = state;
  state = await f.save('keep_timeline_entry', draft(), state.revision, { expectedTimelineRevision: state.timeline.revision });
  assert.equal(state.timelineDraft, null);
  assert.equal(state.lastTimelineEntryId, state.timeline.entries[0].id);
  assert.equal(state.badges.f1.completed, 1);
  await assert.rejects(f.save('keep_timeline_entry', draft(), before.revision, { expectedTimelineRevision: before.timeline.revision }), rejected(409, 'revision_conflict'));
  assert.equal((await f.get()).timeline.entries.length, 1);
  const row = (await f.db.query('select visibility from member_journal_entries where id=$1', [state.lastTimelineEntryId])).rows[0];
  assert.equal(row.visibility, 'private');
});

test('F1 preserves legacy completion credit across owner-reviewed publication and rejects stale legacy writes', async t => {
  const f = await practiceFixture(t);
  let state = await f.get();
  for (let index = 0; index < 3; index++) state = await f.save('keep_timeline_entry', { ...draft(`Event ${index}`), belief: 'An existing belief', perspective: 'Another perspective' }, state.revision, { expectedTimelineRevision: state.timeline.revision });
  assert.equal(state.badges.f1.earned, true);
  assert.equal(state.timeline.completeEntryIds.length, 3);
  const first = state.timeline.entries[0];
  const revised = { ...draft(first.title), id: first.id, meaning: 'A revised meaning' };
  state = await f.save('save_timeline_draft', revised, state.revision);
  const staleTimeline = state.timeline.revision;
  await f.repository.upsertMemberTimelineEntry(ids.auth, { ...draft('Other tab'), details: null, meaning: null, presentImpact: null }, staleTimeline);
  await assert.rejects(f.save('keep_timeline_entry', revised, state.revision, { expectedTimelineRevision: staleTimeline }), rejected(409, 'timeline_revision_conflict'));
  assert.deepEqual((await f.get()).timelineDraft, revised, 'Conflict leaves the account draft intact');
  state = await f.get();
  state = await f.save('keep_timeline_entry', revised, state.revision, { expectedTimelineRevision: state.timeline.revision });
  assert.equal(state.timeline.entries.find(entry => entry.id === first.id).belief, 'An existing belief');
  assert.equal(state.timeline.entries.find(entry => entry.id === first.id).perspective, 'Another perspective');
  assert.equal(state.badges.f1.completed, 3, 'Edits and versions are never extra entries');
  const earnedAt = state.badges.f1.earnedAt;
  const owner = await f.journal.getJournalEntry(ids.auth, first.id);
  const reviewed = { ...reflection, belief: null, perspective: null };
  const published = await f.journal.editJournalEntry(ids.auth, first.id, edit(owner, { visibility: 'public', timelineReflection: reviewed }));
  state = await f.get();
  assert.equal(state.badges.f1.earned, true);
  assert.equal(state.badges.f1.earnedAt, earnedAt);
  assert.equal(state.badges.f1.completed, 3);
  assert.equal(state.timeline.entries.filter(entry => entry.id === first.id).length, 1);
  assert.deepEqual(state.timeline.entries.find(entry => entry.id === first.id), {
    ...first, meaning: reviewed.meaning, presentImpact: reviewed.presentImpact, belief: null, perspective: null, visibility: 'public',
  });
  await assert.rejects(f.save('keep_timeline_entry', revised, state.revision, { expectedTimelineRevision: staleTimeline }), rejected(409, 'timeline_revision_conflict'));
  await assert.rejects(f.save('keep_timeline_entry', revised, state.revision, { expectedTimelineRevision: state.timeline.revision }), f.repository.MembershipConflictError);
  assert.equal((await f.journal.getJournalEntry(ids.auth, first.id)).visibility, 'public', 'An old Keep request cannot unpublish a reviewed post');
  // Completion evidence does not require the owner to expose old private answers.
  await f.journal.editJournalEntry(ids.auth, first.id, edit(published, { timelineReflection: null }));
  state = await f.get();
  assert.equal(state.badges.f1.earned, true);
  assert.equal(state.timeline.entries.find(entry => entry.id === first.id).meaning, null);
  assert.equal(state.timeline.entries.find(entry => entry.id === first.id).presentImpact, null);
  assert.equal((await f.db.query('select foundations_meaning from member_journal_entries where id=$1', [first.id])).rows[0].foundations_meaning, 'A revised meaning');
});

test('three distinct complete public Timeline stories earn F1 without counting ordinary posts, partial stories or drafts', async t => {
  const f = await practiceFixture(t);
  await f.journal.createJournalEntry(ids.auth, story({ title: 'An ordinary post', timelineReflection: null }));
  await f.journal.createJournalEntry(ids.auth, story({ title: 'An incomplete reflection', timelineReflection: { ...reflection, meaning: ' ' } }));
  await f.journal.createJournalEntry(ids.auth, story({ title: 'Private canonical reflection', visibility: 'private' }));
  const savedDraft = await f.journal.createJournalDraft(ids.auth, story({ title: 'Unpublished draft' }));
  assert.equal(savedDraft.visibility, 'private');
  let state = await f.get();
  assert.equal(state.badges.f1.completed, 0);
  assert.equal(state.timeline.entries.some(entry => entry.id === savedDraft.id), false);
  const entries = [];
  for (let index = 0; index < 3; index++) {
    entries.push(await f.journal.createJournalEntry(ids.auth, story({ title: `Shared story ${index}` })));
    state = await f.get();
    assert.equal(state.badges.f1.completed, index + 1);
    assert.equal(state.badges.f1.earned, index === 2);
  }
  assert.deepEqual(new Set(state.timeline.completeEntryIds), new Set(entries.map(entry => entry.id)));
  assert.deepEqual((await f.get(ids.otherAuth)).timeline.entries, [], 'Assignment reads stay owner-bound');
  await f.journal.editJournalEntry(ids.auth, entries[0].id, edit(entries[0], { timelineReflection: { ...reflection, perspective: 'A revised perspective.' } }));
  state = await f.get();
  assert.equal(state.badges.f1.completed, 3, 'Versions never count as more entries');
  const stored = (await f.db.query('select foundations_meaning,foundations_present_impact from member_journal_entries where id=$1', [entries[0].id])).rows[0];
  assert.deepEqual(stored, { foundations_meaning: null, foundations_present_impact: null }, 'Public completion uses reviewed canonical answers');
  await f.db.query('update member_journal_entries set deleted_at=statement_timestamp() where id=$1', [entries[1].id]);
  state = await f.get();
  assert.equal(state.badges.f1.completed, 2);
  assert.equal(state.timeline.entries.some(entry => entry.id === entries[1].id), false);
});

test('mixed legacy/private and published evidence share completion while public Journal excludes private work', async t => {
  const f = await practiceFixture(t);
  let state = await f.get();
  state = await f.save('keep_timeline_entry', draft('Legacy kept work'), state.revision, { expectedTimelineRevision: state.timeline.revision });
  const legacyId = state.lastTimelineEntryId;
  const canonical = await f.journal.createJournalEntry(ids.auth, story({ title: 'Published story' }));
  state = await f.save('save_timeline_draft', draft('Private unsaved assignment'), state.revision);
  assert.equal(state.badges.f1.completed, 2);
  assert.equal(state.timeline.entries.find(entry => entry.id === legacyId).visibility, 'private');
  assert.equal(state.timeline.entries.find(entry => entry.id === canonical.id).visibility, 'public');
  const publicPosts = await f.journal.getJournal(ids.auth, null, false, { collection: 'public', view: 'timeline' });
  assert.deepEqual(publicPosts.entries.map(entry => entry.id), [canonical.id]);
  assert.equal(JSON.stringify(publicPosts).includes('Legacy kept work'), false);
  const privatePosts = await f.journal.getJournal(ids.auth, null, false, { collection: 'private' });
  assert.deepEqual(privatePosts.entries.map(entry => entry.id), [legacyId]);
});

test('F1 public support migration preserves entries, histories, drafts, visibility and browser privileges', async t => {
  const f = await practiceFixture(t, { publicTimelineMigration: false });
  const state = await f.get();
  await f.save('keep_timeline_entry', draft(), state.revision, { expectedTimelineRevision: state.timeline.revision });
  await f.journal.createJournalEntry(ids.auth, story());
  await f.journal.createJournalDraft(ids.auth, story());
  const tables = ['member_journal_entries', 'member_journal_entry_versions', 'member_journal_drafts', 'member_practice_work', 'member_badge_awards'];
  const before = new Map();
  for (const table of tables) before.set(table, (await f.db.query(`select to_jsonb(row) as row from ${table} row order by to_jsonb(row)::text`)).rows);
  const migration = await readFile(new URL('../db/migrations/20261106010000_practice_public_timeline.sql', import.meta.url), 'utf8');
  await f.db.exec(migration);
  for (const table of tables) assert.deepEqual((await f.db.query(`select to_jsonb(row) as row from ${table} row order by to_jsonb(row)::text`)).rows, before.get(table));
  assert.equal((await f.get()).badges.f1.completed, 2);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await f.db.query("select has_function_privilege($1,'private.ruined_complete_practice_timeline_entries(uuid)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
  }
});

test('Completion IDs use canonical reflection evidence and retain the same media entry after Keep', async t => {
  const f = await practiceFixture(t);
  const [entry] = (await f.db.query("insert into member_journal_entries(member_id,kind,title,body,event_year,include_on_timeline,timeline_position,foundations_meaning,foundations_present_impact) values($1,'images','A preserved photograph',null,2001,true,1,null,'A lasting effect') returning id", [ids.member])).rows;
  let state = await f.get();
  assert.deepEqual(state.timeline.completeEntryIds, []);
  assert.equal(state.badges.f1.completed, 0);
  state = await f.save('keep_timeline_entry', { ...draft('A preserved photograph'), id: entry.id }, state.revision, { expectedTimelineRevision: state.timeline.revision });
  const stored = (await f.db.query('select title,kind from member_journal_entries where id=$1', [entry.id])).rows[0];
  assert.deepEqual(stored, { title: 'A preserved photograph', kind: 'images' });
  assert.deepEqual(state.timeline.completeEntryIds, [entry.id]);
  assert.equal(state.badges.f1.completed, 1);
});

test('Existing valid F1 badge survives the new rule; an old one-entry complete action does not newly earn it', async t => {
  const f = await practiceFixture(t, { beforeMigration: async f => {
    await f.repository.upsertMemberTimelineEntry(ids.auth, { id: null, year: 2000, title: 'Old event', details: null }, '0');
    await f.repository.completeMemberFoundationRequirement(ids.auth, 'timeline');
    await f.db.query("insert into member_badge_awards values($1,'your-story',now(),'old-receipt',null,1,true,null)", [ids.member]);
  } });
  const state = await f.get();
  assert.equal(state.badges.f1.earned, true);
  assert.equal(state.badges.f1.completed, 3);
  await f.repository.upsertMemberTimelineEntry(ids.otherAuth, { id: null, year: 2000, title: 'One old-style event', details: null }, '0');
  await f.repository.completeMemberFoundationRequirement(ids.otherAuth, 'timeline');
  assert.equal((await f.get(ids.otherAuth)).badges.f1.earned, false);
  const unrelated = (await f.db.query('select * from private.ruined_member_badge_progress($1) where badge_key=$2', [ids.member, 'unrelated-badge'])).rows;
  assert.equal(unrelated.length, 1, 'Other badge rules remain available');
});

test('Server release gates protect drafts and kept work; saving is separate from explicit completion', async t => {
  const f = await practiceFixture(t);
  let state = await f.get();
  assert.deepEqual(state.releases, { f1: true, f2: false, f3: false, f4: false, time: false });
  assert.equal(new Date(f.releaseSchedule.find(row => row.course === 'time').release_at).toISOString(), '2026-12-01T07:00:00.000Z');
  assert.ok(f.releaseSchedule.filter(row => row.course !== 'time').every(row => row.release_at === null));
  await assert.rejects(f.save('save_letter', { body: 'Dear future me' }, state.revision), rejected(403, 'course_locked'));
  await assert.rejects(f.save('keep_time', time, state.revision), rejected(403, 'course_locked'));
  await f.open('f4'); await f.open('time');
  state = await f.save('save_letter', { body: 'Dear future me' }, state.revision);
  assert.equal(state.letter.keptAt, null); assert.equal(state.badges.f4.earned, false);
  state = await f.save('keep_letter', { body: 'Dear future me' }, state.revision);
  assert.ok(state.letter.keptAt); assert.equal(state.badges.f4.earned, true);
  state = await f.save('save_letter', { body: 'Dear future me, updated' }, state.revision);
  assert.equal(state.letter.keptAt, null); assert.equal(state.badges.f4.earned, false);
  state = await f.save('save_time', time, state.revision);
  assert.equal(state.badges.time.completed, 1); assert.equal(state.time.keptAt, null);
  for (const fields of [{ ...time, minutes: 0 }, { ...time, minutes: 121 }, { ...time, sourceCategory: 'health' }, { ...time, sourceMinutes: 10081 }]) {
    await assert.rejects(f.save('keep_time', fields, state.revision), rejected(400));
  }
  state = await f.save('keep_time', time, state.revision);
  assert.equal(state.badges.time.earned, true); assert.ok(state.time.keptAt);
  assert.equal(state.time.minutes, 30, 'No whole-week allocation is invented or required');
  const receipt = state.time.keptAt, revision = state.revision;
  state = await f.save('keep_time', time, revision);
  assert.equal(state.time.keptAt, receipt); assert.equal(state.revision, revision, 'Repeated unchanged keep is idempotent');
  state = await f.save('save_time', { ...time, action: 'A different action' }, state.revision);
  assert.equal(state.time.keptAt, null); assert.equal(state.badges.time.earned, false);
});

test('Practice rejects stale writes, changed owners and entitlement loss without overwriting saved drafts', async t => {
  const f = await practiceFixture(t);
  const initial = await f.get();
  const saved = await f.save('save_timeline_draft', draft(), initial.revision);
  await assert.rejects(f.save('save_timeline_draft', draft('Stale'), initial.revision), rejected(409, 'revision_conflict'));
  await assert.rejects(f.practice.saveMemberPractice(ids.auth, { action: 'save_timeline_draft', ownerId: ids.otherAuth, expectedRevision: saved.revision, fields: draft() }), rejected(409, 'account_changed'));
  f.beforeNextTransaction(() => f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [ids.member]));
  await assert.rejects(f.save('save_timeline_draft', draft('Lost access'), saved.revision), f.repository.MembershipAccessDeniedError);
  await f.db.query("update member_lifecycle set account_state='active' where member_id=$1", [ids.member]);
  assert.equal((await f.get()).timelineDraft.title, 'A beginning');
  const locked = await practiceFixture(t, { launched: false });
  await assert.rejects(locked.save('save_timeline_draft', draft(), '0'), rejected(403, 'course_locked'));
});

test('Practice schema denies browser roles and erases personal drafts when an account is removed', async t => {
  const f = await practiceFixture(t);
  await f.save('save_timeline_draft', draft(), '0');
  const grants = (await f.db.query("select has_table_privilege('authenticated','public.member_practice_work','SELECT,INSERT,UPDATE,DELETE') as work,has_table_privilege('authenticated','public.member_practice_releases','UPDATE') as releases")).rows[0];
  assert.deepEqual(grants, { work: false, releases: false });
  await f.db.query('update ruined_members set deleted_at=now() where id=$1', [ids.member]);
  assert.equal((await f.db.query('select count(*)::integer as n from member_practice_work where member_id=$1', [ids.member])).rows[0].n, 0);
  await assert.rejects(f.db.query('insert into member_practice_work(member_id,updated_by_auth_user_id) values($1,$2)', [ids.member, ids.auth]), /deleted account/i);
});
