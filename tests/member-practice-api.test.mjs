import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBadgeModule } from './helpers/badge-collection-fixture.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const another = '22222222-2222-4222-8222-222222222222';
const model = await loadBadgeModule('src/lib/practice/model.ts');
class BadgeNotificationError extends Error {}
class MembershipAccessDeniedError extends Error {}
class MembershipConflictError extends Error {}
class MembershipInputError extends Error {}
const valid = { action: 'save_letter', ownerId: owner, expectedRevision: '0', fields: { body: 'Dear future me' } };

async function fixture({ trusted = true, mode = 'connected', auth = 'authenticated' } = {}) {
  const calls = [];
  const api = await loadBadgeModule('app/api/my/practice/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/auth/request': { isTrustedPlatformOrigin: () => trusted },
    '@/lib/auth/session': { resolvePlatformSession: async (_client, options) => { calls.push(['session', options]); return { status: auth, viewer: { authUserId: owner } }; } },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => ({}) },
    '@/lib/platform/config': { getPlatformConfiguration: () => ({ mode }) },
    '@/lib/membership/badge-repository': { BadgeNotificationError },
    '@/lib/membership/repository': { MembershipAccessDeniedError, MembershipConflictError, MembershipInputError },
    '@/lib/practice/model': model,
    '@/lib/practice/repository': {
      getMemberPracticeSnapshot: async id => { calls.push(['get', id]); return { ownerId: id }; },
      saveMemberPractice: async (id, input) => {
        const action = model.parsePracticeAction(input);
        if (action.ownerId !== id) throw new model.PracticeError(409, 'Account changed.', 'account_changed');
        calls.push(['save', id, action]); return { ownerId: id, revision: '1' };
      },
    },
  });
  return { api, calls };
}
function request(method, body, headers = {}) {
  return new Request('https://members.example.test/api/my/practice', { method,
    headers: { 'content-type': 'application/json', origin: 'https://members.example.test', ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

test('Practice API verifies the current account and returns private uncached owner-bound snapshots', async () => {
  const f = await fixture();
  const response = await f.api.GET(request('GET'));
  assert.deepEqual(await response.json(), { ownerId: owner });
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.deepEqual(f.calls, [['session', { verifyCurrentUser: true }], ['get', owner]]);
  f.calls.length = 0;
  assert.equal((await f.api.GET(request('GET', undefined, { 'x-ruined-session-owner': another }))).status, 409);
  assert.equal(f.calls.some(call => call[0] === 'get'), false);
  const saved = await f.api.POST(request('POST', valid));
  assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { ownerId: owner, revision: '1' });
  assert.equal((await f.api.POST(request('POST', { ...valid, ownerId: another }))).status, 409);
});

test('Practice API rejects unauthorized access, CSRF, invalid fields and unbounded streamed requests', async () => {
  for (const [options, status] of [[{ trusted: false }, 403], [{ mode: 'preview' }, 503], [{ auth: 'signed_out' }, 401], [{ auth: 'unavailable' }, 503]]) {
    const f = await fixture(options);
    assert.equal((await f.api.POST(request('POST', valid))).status, status);
    assert.equal(f.calls.some(call => call[0] === 'save'), false);
  }
  const f = await fixture();
  for (const value of [null, [], {}, 'bad json', { ...valid, extra: true }, { ...valid, fields: { body: 'Hello', keptAt: '2020-01-01' } }, { ...valid, expectedRevision: '1e2' }, { ...valid, fields: { body: '\0' } }]) {
    assert.equal((await f.api.POST(request('POST', value))).status, 400);
  }
  assert.equal((await f.api.POST(request('POST', valid, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await f.api.POST(request('POST', valid, { 'content-length': '200001' }))).status, 413);
  assert.equal((await f.api.POST(request('POST', ' '.repeat(200001)))).status, 413);
  assert.equal(f.calls.some(call => call[0] === 'save'), false);
});

test('Practice validates complete work independently of drafts and rejects fabricated receipt and budget fields', () => {
  const draft = { id: null, year: null, title: '', details: '', meaning: '', presentImpact: '' };
  assert.equal(model.parsePracticeAction({ ...valid, action: 'save_timeline_draft', fields: draft }).fields.year, null);
  assert.throws(() => model.parsePracticeAction({ ...valid, action: 'keep_timeline_entry', expectedTimelineRevision: '0', fields: draft }), /year/);
  for (const fields of [
    { action: 'Walk', category: 'unknown', minutes: 1, sourceCategory: 'media', sourceMinutes: 1 },
    { action: 'Walk', category: 'health', minutes: 1.5, sourceCategory: 'media', sourceMinutes: 2 },
    { action: 'Walk', category: 'health', minutes: 1, sourceCategory: 'media', sourceMinutes: 2, keptAt: '2020-01-01' },
  ]) assert.throws(() => model.parsePracticeAction({ ...valid, action: 'save_time', fields }));
  const preview = model.previewPracticeSnapshot(new Date('2026-12-01T06:59:59Z'));
  assert.equal(preview.releases.time, false); assert.equal(preview.canWrite, false);
  assert.equal(model.previewPracticeSnapshot(new Date('2026-12-01T07:00:00Z')).releases.time, true);
});
