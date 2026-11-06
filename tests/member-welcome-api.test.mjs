import assert from 'node:assert/strict';
import test from 'node:test';
import { badgeId as id, loadBadgeModule as load } from './helpers/badge-collection-fixture.mjs';

const model = await load('src/lib/membership/welcome-model.ts');
const snapshot = { ownerId: id(1), dismissedAt: null, calendarViewedAt: null, hasJournalEntry: true };
async function fixture({ mode = 'connected', auth = 'authenticated', trusted = true, upcoming = [] } = {}) {
  const calls = []; let failure;
  const run = async (...args) => { calls.push(args); if (failure) throw failure; return snapshot; };
  const api = await load('app/api/my/welcome/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/auth/request': { isTrustedPlatformOrigin: () => trusted },
    '@/lib/auth/session': { resolvePlatformSession: async (_client, options) => { calls.push(['session', options]); return { status: auth, viewer: { authUserId: id(1) } }; } },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => ({}) },
    '@/lib/platform/config': { getPlatformConfiguration: () => ({ mode }) },
    '@/lib/membership/welcome-model': model,
    '@/lib/database/server': { withFreshApplicationDatabaseRead: async (stage, read) => { calls.push(['read', stage]); return read(); } },
    '@/lib/membership/repository': { getMemberExperiences: async ownerId => { calls.push(['experiences', ownerId]); if (failure) throw failure; return { upcoming }; } },
    '@/lib/membership/welcome-repository': {
      getMemberWelcome: (...args) => run('get', ...args), updateMemberWelcome: (...args) => run('update', ...args),
    },
  });
  return { api, calls, fail: error => { failure = error; } };
}
const request = (method, body, headers = {}) => new Request('https://members.example.test/api/my/welcome', {
  method, headers: { 'content-type': 'application/json', origin: 'https://members.example.test', ...headers },
  ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const valid = { action: 'dismiss', ownerId: id(1) };

test('welcome API verifies the live user, returns private owner-only progress and prevents stale-session reads', async () => {
  const f = await fixture(); const response = await f.api.GET(request('GET'));
  assert.deepEqual(await response.json(), { ...snapshot, hasUpcomingCall: false });
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.deepEqual(f.calls, [['session', { verifyCurrentUser: true }], ['read', 'member-welcome'], ['get', id(1)], ['experiences', id(1)]]);
  f.calls.length = 0;
  assert.equal((await f.api.GET(request('GET', undefined, { 'x-ruined-session-owner': id(2) }))).status, 409);
  assert.equal(f.calls.some(call => call[0] === 'get'), false);
});

test('only validated actions for the currently signed-in owner reach the repository', async () => {
  const f = await fixture();
  for (const action of ['dismiss', 'resume', 'calendar_viewed']) {
    const response = await f.api.POST(request('POST', { ...valid, action }));
    assert.deepEqual(await response.json(), snapshot);
    assert.deepEqual(f.calls.at(-1), ['update', id(1), action]);
  }
  f.calls.length = 0;
  const changed = await f.api.POST(request('POST', { ...valid, ownerId: id(2) }));
  assert.equal(changed.status, 409); assert.equal((await changed.json()).code, 'account_changed');
  const stale = await f.api.POST(request('POST', valid, { 'x-ruined-session-owner': id(2) }));
  assert.equal(stale.status, 409);
  assert.equal(f.calls.some(call => call[0] === 'update'), false);
});

test('welcome writes reject cross-origin, preview and missing identity before accessing state', async () => {
  for (const [options, status] of [[{ trusted: false }, 403], [{ mode: 'preview' }, 503], [{ auth: 'signed_out' }, 401], [{ auth: 'unavailable' }, 503]]) {
    const f = await fixture(options);
    assert.equal((await f.api.POST(request('POST', valid))).status, status);
    assert.equal(f.calls.some(call => call[0] !== 'session'), false);
    if (options.trusted === false) assert.deepEqual(f.calls, []);
    if (options.trusted !== false) assert.equal((await f.api.GET(request('GET'))).status, status);
  }
});

test('welcome rejects malformed, extra, member-id and oversized input without changing state', async () => {
  const f = await fixture();
  for (const body of [null, [], {}, 'not json', { ...valid, memberId: id(2) }, { ...valid, hasJournalEntry: true }, { ...valid, ownerId: 'invalid' }, { ...valid, action: 'seen' }, { ...valid, action: null }]) {
    assert.equal((await f.api.POST(request('POST', body))).status, 400);
  }
  assert.equal((await f.api.POST(request('POST', valid, { 'content-type': 'text/plain' }))).status, 415);
  for (const length of ['513', '-1', 'nonsense']) {
    assert.equal((await f.api.POST(request('POST', valid, { 'content-length': length }))).status, 413);
  }
  assert.equal((await f.api.POST(request('POST', ' '.repeat(513)))).status, 413);
  assert.equal((await f.api.POST(request('POST', ' '.repeat(513), { 'content-length': '1' }))).status, 413);
  assert.equal((await f.api.POST(new Request('https://members.example.test/api/my/welcome', { method: 'POST', headers: { 'content-type': 'application/json' } }))).status, 400);
  assert.equal(f.calls.some(call => call[0] !== 'session'), false);
  f.fail(new model.MemberWelcomeError(403, 'Your member welcome is unavailable.'));
  assert.equal((await f.api.POST(request('POST', valid))).status, 403);
});


test('welcome projects only a future registered joining link from the authorized Calendar', async () => {
  const call = { startsAt: '2100-01-01T12:00:00Z', meetingUrl: 'https://private.example/call', registrationState: 'registered' };
  for (const [upcoming, expected] of [
    [[call], true], [[], false], [[{ ...call, meetingUrl: null }], false],
    [[{ ...call, registrationState: 'waitlisted' }], false],
    [[{ ...call, startsAt: '2000-01-01T12:00:00Z' }], false],
    [[{ ...call, startsAt: 'invalid' }], false],
  ]) {
    const f = await fixture({ upcoming });
    const response = await f.api.GET(request('GET'));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.hasUpcomingCall, expected);
    assert.deepEqual(Object.keys(data).sort(), [...Object.keys(snapshot), 'hasUpcomingCall'].sort());
    assert.doesNotMatch(JSON.stringify(data), /private.example|2100|registered/);
  }
});

test('an unavailable optional Calendar returns a recoverable welcome response without weakening auth gates', async () => {
  const f = await fixture();
  f.fail(new Error('database unavailable'));
  const response = await f.api.GET(request('GET'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /database unavailable|ownerId/);
  const changed = await fixture();
  assert.equal((await changed.api.GET(request('GET', undefined, { 'x-ruined-session-owner': id(2) }))).status, 409);
  assert.deepEqual(changed.calls, [['session', { verifyCurrentUser: true }]]);
});
