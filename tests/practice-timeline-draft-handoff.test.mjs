import assert from 'node:assert/strict';
import test from 'node:test';
import * as crypto from 'node:crypto';
import { practiceFixture, ids } from './helpers/practice-fixture.mjs';

const draft = (overrides = {}) => ({ id: null, year: 2001, month: 6, title: 'A memory', details: 'What happened', meaning: 'What it meant', belief: 'An old rule', presentImpact: 'An echo now', perspective: 'A new perspective', ...overrides });
const fields = value => ({ kind: 'text', title: value.title, body: value.details, mediaIds: [], eventYear: value.year, eventMonth: value.month, eventDay: null, includeOnTimeline: true, visibility: 'private', timelineReflection: { meaning: value.meaning, belief: value.belief, presentImpact: value.presentImpact, perspective: value.perspective } });

async function fixture(t, { interceptEntryRead } = {}) {
  const f = await practiceFixture(t);
  const access = await f.loadTypescript('src/lib/membership/access-policy.ts');
  const handoff = await f.loadTypescript('src/lib/practice/timeline-draft-handoff.ts', {
    'server-only': {}, 'node:crypto': crypto,
    '@/lib/database/server': { getApplicationDatabase: () => f.sql },
    '@/lib/foundations/availability': { isFoundationsAvailableToMember: async () => true },
    '@/lib/membership/access-policy': access,
    '@/lib/membership/journal-repository': interceptEntryRead ? { ...f.journal, getJournalEntry: (auth, id) => interceptEntryRead(f, auth, id) } : f.journal,
    '@/lib/membership/journal-model': await f.loadTypescript('src/lib/membership/journal-model.ts'),
    '@/lib/membership/repository': f.repository, './model': f.model,
  });
  return { ...f, handoff };
}

test('Work handoff reads partial private drafts without changing records or inventing missing answers', async t => {
  const f = await fixture(t);
  const value = draft({ year: null, month: null, title: '', details: '', meaning: 'Unfinished meaning', belief: '', presentImpact: '', perspective: '' });
  const state = await f.save('save_timeline_draft', value, '0');
  const resumed = await f.handoff.getPracticeTimelineResume(ids.auth);
  assert.deepEqual(resumed.draft, value);
  assert.equal(resumed.revision, state.revision);
  assert.equal(resumed.sourceEntry, null);
  assert.equal(resumed.savedEntry, null);
  assert.equal((await f.handoff.getPracticeTimelineResume(ids.auth)).entryId, resumed.entryId);
  assert.equal(await f.handoff.getPracticeTimelineResume(ids.otherAuth), null);
  assert.equal((await f.db.query('select count(*)::int as n from member_journal_entries')).rows[0].n, 0);
  assert.deepEqual((await f.get()).timelineDraft, value);
});

test('Lost canonical-save response resumes same private entry and cleanup retries do not duplicate or publish', async t => {
  const f = await fixture(t);
  const value = draft();
  const state = await f.save('save_timeline_draft', value, '0');
  const resume = await f.handoff.getPracticeTimelineResume(ids.auth);
  const saved = await f.journal.createJournalEntry(ids.auth, { id: resume.entryId, ...fields(value) });
  const retried = await f.handoff.getPracticeTimelineResume(ids.auth);
  assert.equal(retried.entryId, saved.id);
  assert.equal(retried.savedEntry.id, saved.id);
  assert.equal(retried.savedEntry.timelineReflection.perspective, value.perspective);
  assert.deepEqual((await f.get()).timelineDraft, value, 'Read does not clear old private work');
  const input = { expectedPracticeRevision: state.revision, entryId: saved.id };
  assert.deepEqual(await f.handoff.completePracticeTimelineResume(ids.auth, input), { cleared: true });
  assert.deepEqual(await f.handoff.completePracticeTimelineResume(ids.auth, input), { cleared: true });
  assert.equal((await f.get()).timelineDraft, null);
  const entries = (await f.db.query('select id,visibility,foundations_meaning from member_journal_entries')).rows;
  assert.deepEqual(entries, [{ id: saved.id, visibility: 'private', foundations_meaning: null }]);
  assert.equal((await f.get()).badges.f1.completed, 0);
});

test('Handoff never clears newer Work drafts, unrelated entries, or another member work', async t => {
  const f = await fixture(t);
  const value = draft();
  let state = await f.save('save_timeline_draft', value, '0');
  const resume = await f.handoff.getPracticeTimelineResume(ids.auth);
  const saved = await f.journal.createJournalEntry(ids.auth, { id: resume.entryId, ...fields(value) });
  const oldRevision = state.revision;
  state = await f.save('save_timeline_draft', { ...value, details: 'Newer unfinished work' }, state.revision);
  await assert.rejects(f.handoff.completePracticeTimelineResume(ids.auth, { expectedPracticeRevision: oldRevision, entryId: saved.id }), error => error.code === 'revision_conflict');
  assert.equal((await f.get()).timelineDraft.details, 'Newer unfinished work');
  await assert.rejects(f.handoff.completePracticeTimelineResume(ids.auth, { expectedPracticeRevision: state.revision, entryId: saved.id }), error => error.code === 'draft_mismatch');
  await assert.rejects(f.handoff.completePracticeTimelineResume(ids.otherAuth, { expectedPracticeRevision: oldRevision, entryId: saved.id }), error => error.status === 404);
  assert.equal((await f.get()).timelineDraft.details, 'Newer unfinished work');
});

test('Unrelated letter autosave after lost cleanup keeps the same Timeline handoff identity', async t => {
  const f = await fixture(t);
  const value = draft();
  let state = await f.save('save_timeline_draft', value, '0');
  const resume = await f.handoff.getPracticeTimelineResume(ids.auth);
  await f.journal.createJournalEntry(ids.auth, { id: resume.entryId, ...fields(value) });
  await f.open('f4');
  state = await f.save('save_letter', { body: 'An unrelated private letter' }, state.revision);
  const resumed = await f.handoff.getPracticeTimelineResume(ids.auth);
  assert.equal(resumed.entryId, resume.entryId);
  assert.equal(resumed.savedEntry.id, resume.entryId);
  await f.handoff.completePracticeTimelineResume(ids.auth, { expectedPracticeRevision: state.revision, entryId: resume.entryId });
  const next = await f.get();
  assert.equal(next.timelineDraft, null);
  assert.equal(next.letter.body, 'An unrelated private letter');
  assert.equal((await f.db.query('select count(*)::int as n from member_journal_entries')).rows[0].n, 1);
});

test('Unfinished existing private edit preserves original and cannot be cleared before a matching canonical save', async t => {
  const f = await fixture(t);
  let state = await f.get();
  state = await f.save('keep_timeline_entry', draft(), state.revision, { expectedTimelineRevision: state.timeline.revision });
  const originalId = state.lastTimelineEntryId;
  const revised = draft({ id: originalId, perspective: 'Not saved yet' });
  state = await f.save('save_timeline_draft', revised, state.revision);
  const resume = await f.handoff.getPracticeTimelineResume(ids.auth);
  assert.equal(resume.sourceEntry.id, originalId);
  assert.equal(resume.savedEntry, null);
  await assert.rejects(f.handoff.completePracticeTimelineResume(ids.auth, { expectedPracticeRevision: state.revision, entryId: originalId }), error => error.code === 'entry_not_saved');
  assert.equal((await f.get()).timelineDraft.perspective, 'Not saved yet');
  const current = await f.journal.getJournalEntry(ids.auth, originalId);
  await f.journal.editJournalEntry(ids.auth, originalId, { expectedVersion: current.version, ...fields(revised) });
  assert.equal((await f.handoff.getPracticeTimelineResume(ids.auth)).savedEntry.id, originalId);
  await f.handoff.completePracticeTimelineResume(ids.auth, { expectedPracticeRevision: state.revision, entryId: originalId });
  assert.equal((await f.get()).timelineDraft, null);
  assert.equal((await f.journal.getJournalEntry(ids.auth, originalId)).timelineReflection.perspective, 'Not saved yet');
});

test('Already published source is returned for review rather than overlaid with an old Work draft', async t => {
  const f = await fixture(t);
  let state = await f.get();
  state = await f.save('keep_timeline_entry', draft(), state.revision, { expectedTimelineRevision: state.timeline.revision });
  const id = state.lastTimelineEntryId;
  const revised = draft({ id, perspective: 'Old private draft' });
  state = await f.save('save_timeline_draft', revised, state.revision);
  const current = await f.journal.getJournalEntry(ids.auth, id);
  const publicFields = fields(draft({ perspective: 'Reviewed public perspective' }));
  await f.journal.editJournalEntry(ids.auth, id, { expectedVersion: current.version, ...publicFields, visibility: 'public' });
  const resume = await f.handoff.getPracticeTimelineResume(ids.auth);
  assert.equal(resume.savedEntry.visibility, 'public');
  assert.equal(resume.savedEntry.timelineReflection.perspective, 'Reviewed public perspective');
  assert.equal((await f.get()).timelineDraft.perspective, 'Old private draft', 'Reading never clears unreviewed source');
});

test('Existing canonical private answers require review even after unrelated Work autosaves', async t => {
  const f = await fixture(t);
  let state = await f.get();
  state = await f.save('keep_timeline_entry', draft(), state.revision, { expectedTimelineRevision: state.timeline.revision });
  const id = state.lastTimelineEntryId;
  state = await f.save('save_timeline_draft', draft({ id, perspective: 'Older draft' }), state.revision);
  const current = await f.journal.getJournalEntry(ids.auth, id);
  await f.journal.editJournalEntry(ids.auth, id, { expectedVersion: current.version, ...fields(draft({ perspective: 'A reviewed private perspective' })) });
  await f.open('f4');
  state = await f.save('save_letter', { body: 'New letter' }, state.revision);
  const resume = await f.handoff.getPracticeTimelineResume(ids.auth);
  assert.equal(resume.savedEntry.timelineReflection.perspective, 'A reviewed private perspective');
  assert.equal((await f.get()).timelineDraft.perspective, 'Older draft');
});

test('Resume uses the timestamp for the actual content version when an entry changes during read', async t => {
  let race = false;
  const f = await fixture(t, { interceptEntryRead: async (fixture, auth, id) => {
    if (race) await fixture.db.query("update member_journal_entries set body='Newer canonical work' where id=$1", [id]);
    return fixture.journal.getJournalEntry(auth, id);
  } });
  let state = await f.get();
  state = await f.save('keep_timeline_entry', draft(), state.revision, { expectedTimelineRevision: state.timeline.revision });
  const id = state.lastTimelineEntryId;
  state = await f.save('save_timeline_draft', draft({ id, details: 'Older unfinished writing' }), state.revision);
  race = true;
  const resume = await f.handoff.getPracticeTimelineResume(ids.auth);
  assert.equal(resume.savedEntry.body, 'Newer canonical work');
  assert.equal((await f.get()).timelineDraft.details, 'Older unfinished writing');
});

test('Resume rejects content that changes after its owner-only read', async t => {
  let race = false;
  const f = await fixture(t, { interceptEntryRead: async (fixture, auth, id) => {
    const entry = await fixture.journal.getJournalEntry(auth, id);
    if (race) await fixture.db.query("update member_journal_entries set body='Changed after read' where id=$1", [id]);
    return entry;
  } });
  let state = await f.get();
  state = await f.save('keep_timeline_entry', draft(), state.revision, { expectedTimelineRevision: state.timeline.revision });
  await f.save('save_timeline_draft', draft({ id: state.lastTimelineEntryId, details: 'Private unfinished writing' }), state.revision);
  race = true;
  await assert.rejects(f.handoff.getPracticeTimelineResume(ids.auth), error => error.code === 'entry_changed');
  assert.equal((await f.get()).timelineDraft.details, 'Private unfinished writing');
});
