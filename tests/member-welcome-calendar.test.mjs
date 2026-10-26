import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { badgeUIFixture } from './helpers/member-badge-ui-fixture.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const component = 'src/components/membership/MemberWelcomeCalendarVisit.tsx';
const fixture = (props = {}, fetch = async () => Response.json({ ownerId, calendarViewedAt: '2026-10-26T12:00:00Z' })) =>
  badgeUIFixture({ ownerId, ...props }, { component, fetch });

test('an actual Calendar mount silently records an owner-bound visit once per mount', async () => {
  const ui = fixture();
  assert.equal(ui.draw(), null); await ui.settle();
  assert.equal(ui.requests.length, 1);
  const request = ui.requests[0];
  assert.equal(request.url, '/api/my/welcome'); assert.equal(request.method, 'POST');
  assert.equal(request.cache, 'no-store'); assert.equal(request.credentials, 'same-origin');
  assert.equal(request.headers['x-ruined-session-owner'], ownerId);
  assert.deepEqual(JSON.parse(request.body), { action: 'calendar_viewed', ownerId });
  assert.equal(ui.draw(), null); await ui.settle(); assert.equal(ui.requests.length, 1);
  ui.unmount(); assert.equal(request.signal.aborted, true);
});

test('Calendar visit never writes in preview or without an owner and aborts old account requests', async () => {
  for (const props of [{ preview: true }, { ownerId: '' }]) {
    const ui = fixture(props); assert.equal(ui.draw(), null); await ui.settle();
    assert.deepEqual(ui.requests, []); ui.unmount();
  }
  const ui = fixture(); ui.draw(); const first = ui.requests[0];
  ui.draw({ ownerId: otherOwner });
  assert.equal(first.signal.aborted, true);
  assert.deepEqual(JSON.parse(ui.requests[1].body), { action: 'calendar_viewed', ownerId: otherOwner });
  assert.equal(ui.requests[1].headers['x-ruined-session-owner'], otherOwner);
  ui.draw({ preview: true }); assert.equal(ui.requests[1].signal.aborted, true);
  assert.equal(ui.requests.length, 2); ui.unmount();
});

test('Calendar visit network and access failures are silent and cannot disrupt Calendar', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, ...[401, 403, 409, 503].map(status => async () => Response.json({ error: 'unavailable' }, { status }))]) {
    const ui = fixture({}, fetch); assert.equal(ui.draw(), null); await ui.settle();
    assert.equal(ui.draw(), null); assert.equal(ui.requests.length, 1); ui.unmount();
  }
});

const code = ts.transpileModule(await readFile(new URL('../app/my/experiences/page.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function pageFixture({ state = 'authenticated', invitedCalendarOnly = false, viewer = true } = {}) {
  const dependencies = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'next/navigation': { redirect: path => { throw { redirect: path }; } },
    '@/components/membership/MemberExperiences': { default: 'Calendar' },
    '@/components/membership/MemberWelcomeCalendarVisit': { default: 'CalendarVisit' },
    '@/components/platform/PlatformUnavailable': { default: 'Unavailable' },
    '@/lib/membership/page-context': { getMembershipPageContext: async () => ({ state, invitedCalendarOnly,
      viewer: viewer && state !== 'preview' ? { authUserId: ownerId } : null,
      data: ['authenticated', 'preview'].includes(state) ? { upcoming: [] } : null }) },
    '@/lib/membership/preview': { PREVIEW_MEMBER_EXPERIENCES: {} },
    '@/lib/membership/repository': { getMemberExperiences: () => {} },
  };
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports.default;
}

test('Calendar tracks welcome only for authenticated profile-enabled members, never held invitees or previews', async () => {
  const actual = await pageFixture()();
  assert.equal(actual.type, 'Fragment');
  assert.deepEqual(actual.props.children[0], { type: 'CalendarVisit', props: { ownerId } });
  assert.equal(actual.props.children[1].type, 'Calendar');
  assert.equal(actual.props.children[1].props.writable, true);
  for (const options of [{ invitedCalendarOnly: true }, { state: 'preview' }, { viewer: false }]) {
    const tree = await pageFixture(options)();
    assert.equal(tree.type, 'Calendar');
    assert.equal(tree.props.writable, options.viewer === false);
  }
  assert.equal((await pageFixture({ state: 'denied' })()).type, 'Unavailable');
  assert.equal((await pageFixture({ state: 'unavailable' })()).type, 'Unavailable');
  await assert.rejects(pageFixture({ state: 'signed_out' })(), error => error.redirect === '/my/access');
});
