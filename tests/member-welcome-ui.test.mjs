import assert from 'node:assert/strict';
import test from 'node:test';
import { welcomeUIFixture, nodes, text } from './helpers/member-welcome-ui-fixture.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const initial = { ownerId, dismissedAt: null, calendarViewedAt: null, hasJournalEntry: false };
const response = (data, status = 200) => Response.json(data, { status });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const posts = ui => ui.requests.filter(item => item.method === 'POST');
const gets = ui => ui.requests.filter(item => item.method !== 'POST');
function fixture({ props = {}, fetch } = {}) {
  let privateWrites = 0;
  const ui = welcomeUIFixture({ ownerId, initialWelcome: initial, profileReady: false, onWritePrivate: () => { privateWrites++; }, ...props },
    { fetch: fetch ?? (async () => response(props.initialWelcome ?? initial)) });
  return { ...ui, privateWrites: () => privateWrites };
}

test('welcome credits existing member evidence and keeps each first action directly usable', () => {
  for (const [profileReady, hasJournalEntry, calendarViewedAt, total] of [
    [false, false, null, 0], [true, false, null, 1], [false, true, null, 1], [false, false, '2026-10-26T12:00:00Z', 1],
    [true, true, null, 2], [true, true, '2026-10-26T12:00:00Z', 3],
  ]) {
    const ui = fixture({ props: { profileReady, initialWelcome: { ...initial, hasJournalEntry, calendarViewedAt } } });
    const tree = ui.draw();
    assert.match(text(tree), new RegExp(`${total} of 3 complete`));
    const rows = nodes(tree).filter(node => node.type === 'li');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => Boolean(row.props['data-complete'])), [profileReady, hasJournalEntry, Boolean(calendarViewedAt)]);
    assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href === '/my/profile'));
    assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href === '/my/experiences'));
    assert.ok(nodes(tree).some(node => node.type === 'details'));
    assert.match(text(tree), /Journal is private/);
    assert.match(text(tree), /Add to Timeline/);
    if (total === 3) { assert.match(text(tree), /You’re at home here/); ui.button('Finish'); }
    assert.equal(gets(ui).length, 1); assert.equal(posts(ui).length, 0); ui.unmount();
  }
});

test('Write privately opens only the supplied private composer without inventing progress', () => {
  const ui = fixture(); ui.draw(); ui.click('Write privately');
  assert.equal(ui.privateWrites(), 1);
  assert.match(text(ui.draw()), /0 of 3 complete/);
  assert.equal(gets(ui).length, 1); assert.equal(posts(ui).length, 0);
  ui.unmount();
});

test('Calendar guidance promises a next call only when the member has one scheduled', () => {
  const emptyCalendar = fixture();
  assert.match(text(emptyCalendar.draw()), /Explore your calendar/);
  assert.match(text(emptyCalendar.draw()), /This is where your calls and joining links will appear/);
  assert.doesNotMatch(text(emptyCalendar.draw()), /Find your next call/);
  emptyCalendar.unmount();
  const scheduled = fixture({ props: { hasUpcomingCall: true } });
  assert.match(text(scheduled.draw()), /Find your next call/);
  assert.match(text(scheduled.draw()), /Your scheduled calls and joining links live in Calendar/);
  assert.doesNotMatch(text(scheduled.draw()), /Explore your calendar/);
  scheduled.unmount();
});

test('dismiss and resume wait for persisted server state and preserve completed actions', async () => {
  const saving = deferred(); let server = { ...initial, hasJournalEntry: true, dismissedAt: '2026-10-26T12:00:00Z' };
  const ui = fixture({ props: { initialWelcome: { ...initial, hasJournalEntry: true } }, fetch: async (_url, init) => {
    if (init.method !== 'POST') return response({ ...initial, hasJournalEntry: true });
    const action = JSON.parse(init.body).action;
    if (action === 'dismiss') return saving.promise;
    server = { ...server, dismissedAt: null }; return response(server);
  } });
  ui.draw(); ui.click('Do this later'); ui.click('Do this later');
  assert.equal(posts(ui).length, 1);
  assert.match(text(ui.draw()), /1 of 3 complete/);
  assert.equal(ui.button('Do this later').props.disabled, true);
  assert.deepEqual(JSON.parse(posts(ui)[0].body), { action: 'dismiss', ownerId });
  assert.equal(posts(ui)[0].headers['x-ruined-session-owner'], ownerId);
  saving.resolve(response(server)); await ui.settle();
  assert.doesNotMatch(text(ui.draw()), /of 3 complete/); ui.button('Getting started');
  assert.ok(nodes(ui.draw()).some(node => node.type === 'details'), 'the replayable guide stays available after dismissal');
  ui.click('Getting started'); await ui.settle();
  assert.deepEqual(JSON.parse(posts(ui)[1].body), { action: 'resume', ownerId });
  assert.match(text(ui.draw()), /1 of 3 complete/);
  ui.unmount();
});

test('failed dismissals remain recoverable and do not hide the profile guidance', async () => {
  let fail = true;
  const ui = fixture({ fetch: async () => fail ? response({ error: 'unavailable' }, 503) : response({ ...initial, dismissedAt: '2026-10-26T12:00:00Z' }) });
  ui.draw(); ui.click('Do this later'); await ui.settle();
  assert.match(text(ui.draw()), /0 of 3 complete/);
  assert.match(text(ui.draw()), /Couldn’t save this change/);
  assert.equal(ui.button('Do this later').props.disabled, false);
  fail = false; ui.click('Do this later'); await ui.settle(); ui.button('Getting started');
  assert.doesNotMatch(text(ui.draw()), /Couldn’t save/); ui.unmount();
});

test('preview interaction and progress stay local without network requests', async () => {
  const ui = fixture({ props: { preview: true } });
  ui.draw(); ui.click('Write privately'); assert.equal(ui.privateWrites(), 1);
  assert.match(text(ui.draw()), /0 of 3 complete/);
  ui.dispatch('ruined:member-progress', { hasJournalEntry: true });
  assert.match(text(ui.draw()), /0 of 3 complete/, 'only explicit preview evidence changes preview progress');
  ui.dispatch('ruined:member-progress', { preview: true, hasJournalEntry: true });
  assert.match(text(ui.draw()), /1 of 3 complete/);
  ui.click('Do this later'); ui.button('Getting started'); ui.click('Getting started');
  assert.match(text(ui.draw()), /1 of 3 complete/);
  ui.dispatch('focus'); await ui.settle(); assert.deepEqual(ui.requests, []); ui.unmount();
});

test('progress events refetch private server evidence instead of trusting event payloads', async () => {
  const pending = deferred();
  let reads = 0;
  const ui = fixture({ fetch: async () => ++reads === 1 ? response(initial) : pending.promise });
  ui.draw(); ui.dispatch('ruined:member-progress', { hasJournalEntry: true, calendarViewedAt: 'forged' });
  assert.match(text(ui.draw()), /0 of 3 complete/);
  assert.equal(gets(ui).length, 2); assert.equal(gets(ui)[1].cache, 'no-store');
  assert.equal(gets(ui)[1].headers['x-ruined-session-owner'], ownerId);
  pending.resolve(response({ ...initial, hasJournalEntry: true })); await ui.settle();
  assert.match(text(ui.draw()), /1 of 3 complete/);
  assert.equal(posts(ui).length, 0); ui.unmount();
});

test('a cached profile remount refreshes server progress so returning from Calendar is already credited', async () => {
  const fresh = { ...initial, calendarViewedAt: '2026-10-26T12:00:00Z' };
  const ui = fixture({ fetch: async () => response(fresh) });
  assert.match(text(ui.draw()), /0 of 3 complete/);
  await ui.settle();
  assert.equal(gets(ui).length, 1); assert.equal(gets(ui)[0].cache, 'no-store');
  assert.match(text(ui.draw()), /1 of 3 complete/);
  const rows = nodes(ui.draw()).filter(node => node.type === 'li');
  assert.equal(rows[2].props['data-complete'], true);
  assert.equal(posts(ui).length, 0); ui.unmount();
  const failed = fixture({ fetch: async () => { throw Error('offline'); } });
  failed.draw(); await failed.settle(); assert.match(text(failed.draw()), /0 of 3 complete/);
  failed.button('Write privately'); failed.unmount();
});

test('missing initial progress is optional, fetches once and ignores foreign or malformed responses', async () => {
  for (const result of [{ ...initial, ownerId: otherOwner, hasJournalEntry: true }, { ownerId }, { ...initial, hasJournalEntry: 'true' }]) {
    const ui = fixture({ props: { initialWelcome: null }, fetch: async () => response(result) });
    assert.match(text(ui.draw()), /Your guide is below/); await ui.settle();
    assert.equal(gets(ui).length, 1); assert.doesNotMatch(text(ui.draw()), /of 3 complete/);
    assert.ok(nodes(ui.draw()).some(node => node.type === 'details')); ui.unmount();
  }
  const ui = fixture({ props: { initialWelcome: null }, fetch: async () => response({ ...initial, hasJournalEntry: true }) });
  ui.draw(); await ui.settle(); assert.match(text(ui.draw()), /1 of 3 complete/); ui.unmount();
});

test('foreign write responses never dismiss the current owner guide', async () => {
  const ui = fixture({ fetch: async () => response({ ...initial, ownerId: otherOwner, dismissedAt: '2026-10-26T12:00:00Z' }) });
  ui.draw(); ui.click('Do this later'); await ui.settle();
  assert.match(text(ui.draw()), /0 of 3 complete/); assert.match(text(ui.draw()), /Couldn’t save this change/); ui.unmount();
});

test('account changes and unmounts abort old reads and writes before they can alter a new owner', async () => {
  const oldRead = deferred(), oldWrite = deferred();
  const ui = fixture({ fetch: async (_url, init) => init.method === 'POST' ? oldWrite.promise : oldRead.promise });
  ui.draw(); ui.dispatch('focus'); ui.click('Do this later');
  const firstRead = gets(ui)[0], firstWrite = posts(ui)[0];
  ui.draw({ ownerId: otherOwner, initialWelcome: { ...initial, ownerId: otherOwner, hasJournalEntry: true } });
  assert.equal(firstRead.signal.aborted, true); assert.equal(firstWrite.signal.aborted, true);
  oldRead.resolve(response({ ...initial, dismissedAt: '2026-10-26T12:00:00Z' }));
  oldWrite.resolve(response({ ...initial, dismissedAt: '2026-10-26T12:00:00Z' })); await ui.settle();
  assert.match(text(ui.draw()), /1 of 3 complete/); ui.button('Do this later');
  ui.unmount();
  assert.equal(ui.listeners.get('focus').size, 0); assert.equal(ui.listeners.get('ruined:member-progress').size, 0);
});

test('a newer progress refresh aborts stale reads so completion cannot go backwards', async () => {
  const first = deferred(); let requests = 0;
  const ui = fixture({ fetch: async () => ++requests === 1 ? first.promise : response({ ...initial, hasJournalEntry: true }) });
  ui.draw(); ui.dispatch('focus'); ui.dispatch('ruined:member-progress');
  assert.equal(gets(ui)[0].signal.aborted, true); await ui.settle(); assert.match(text(ui.draw()), /1 of 3 complete/);
  first.resolve(response(initial)); await ui.settle(); assert.match(text(ui.draw()), /1 of 3 complete/); ui.unmount();
});

test('an older progress read cannot reopen a successfully dismissed welcome', async () => {
  const staleRead = deferred();
  const ui = fixture({ fetch: async (_url, init) => init.method === 'POST'
    ? response({ ...initial, dismissedAt: '2026-10-26T12:00:00Z' }) : staleRead.promise });
  ui.draw(); ui.dispatch('focus'); ui.click('Do this later'); await ui.settle();
  ui.button('Getting started');
  staleRead.resolve(response(initial)); await ui.settle();
  assert.doesNotMatch(text(ui.draw()), /of 3 complete/);
  ui.button('Getting started'); ui.unmount();
});
