import assert from 'node:assert/strict';
import test from 'node:test';
import { practiceFixture, ids } from './helpers/practice-fixture.mjs';

const draft = (title = 'A beginning') => ({ id: null, year: 2001, title, details: '', meaning: 'I could start again.', presentImpact: 'I choose to try.' });
const time = { action: 'Walk outside', category: 'health', minutes: 30, sourceCategory: 'media', sourceMinutes: 120 };
const rejected = (status, code) => error => error.status === status && (!code || error.code === code);

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

test('F1 counts three distinct complete private entries, preserves extra canonical fields and rejects stale journal revisions', async t => {
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
  await f.db.query("update member_journal_entries set visibility='public' where id=$1", [first.id]);
  assert.equal((await f.get()).badges.f1.earned, false, 'A public event is not private assignment evidence');
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
