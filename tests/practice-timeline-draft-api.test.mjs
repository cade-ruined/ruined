import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBadgeModule } from './helpers/badge-collection-fixture.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';
const model = await loadBadgeModule('src/lib/practice/model.ts');
const journalModel = await loadBadgeModule('src/lib/membership/journal-model.ts');
class MembershipAccessDeniedError extends Error {}
async function fixture({ trusted = true, mode = 'connected', auth = 'authenticated' } = {}) {
  const calls = [];
  const api = await loadBadgeModule('app/api/my/practice/timeline-draft/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/auth/request': { isTrustedPlatformOrigin: () => trusted },
    '@/lib/auth/session': { resolvePlatformSession: async (_client, options) => { calls.push(['session', options]); return { status: auth, viewer: { authUserId: owner } }; } },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => ({}) },
    '@/lib/platform/config': { getPlatformConfiguration: () => ({ mode }) },
    '@/lib/membership/journal-model': journalModel,
    '@/lib/membership/repository': { MembershipAccessDeniedError },
    '@/lib/practice/model': model,
    '@/lib/practice/timeline-draft-handoff': { completePracticeTimelineResume: async (id, input) => { calls.push(['clear', id, input]); return { cleared: true }; } },
  });
  return { api, calls };
}
const request = (body = { expectedPracticeRevision: '1', entryId }, headers = {}) => new Request('https://members.example.test/api/my/practice/timeline-draft', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://members.example.test', 'x-ruined-session-owner': owner, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('Draft cleanup verifies current owner and returns private uncached response', async () => {
  const f = await fixture();
  const result = await f.api.POST(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { cleared: true });
  assert.match(result.headers.get('cache-control'), /private, no-store/);
  assert.equal(result.headers.get('vary'), 'Cookie');
  assert.deepEqual(f.calls, [['session', { verifyCurrentUser: true }], ['clear', owner, { expectedPracticeRevision: '1', entryId }]]);
});

test('Draft cleanup blocks cross-account, unsigned, cross-origin and unbounded requests before mutation', async () => {
  for (const [options, status] of [[{ trusted: false }, 403], [{ mode: 'preview' }, 503], [{ auth: 'signed_out' }, 401], [{ auth: 'unavailable' }, 503]]) {
    const f = await fixture(options);
    assert.equal((await f.api.POST(request())).status, status);
    assert.equal(f.calls.some(call => call[0] === 'clear'), false);
  }
  const f = await fixture();
  assert.equal((await f.api.POST(request(undefined, { 'x-ruined-session-owner': entryId }))).status, 409);
  assert.equal((await f.api.POST(request(undefined, { 'x-ruined-session-owner': '' }))).status, 409);
  assert.equal((await f.api.POST(request(undefined, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await f.api.POST(request('not json'))).status, 400);
  assert.equal((await f.api.POST(request(' '.repeat(2049)))).status, 413);
  assert.equal(f.calls.some(call => call[0] === 'clear'), false);
});
