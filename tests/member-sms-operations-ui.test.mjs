import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { loader } from "./helpers/member-sms-fixture.mjs";

const require = createRequire(import.meta.url);
const model = loader()('src/lib/communications/member-sms-operations-model.ts');
const templates = model.getMemberSmsTemplatePreviews('https://members.example.test');
function harness(fetch) {
  const slots = [], effects = []; let cursor = 0, changed = false;
  const same = (left, right) => left && right && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  const hooks = { ...React,
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; changed ||= !Object.is(next, slots[i].value); slots[i].value = next; }]; },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/platform/OperatorSmsOperations.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', code)(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'next/link') return function TestLink({ children, ...props }) { return React.createElement('a', props, children); };
    if (name === './OperatorSmsOperations.module.css') return new Proxy({}, { get: (_, key) => key });
    if (name === './operatorStyles') return { OPERATOR_BUTTON_CLASS: 'button' };
    if (name === './OperatorSmsOneOffComposer') return function OneOffComposerStub() { return null; };
    if (name === '@/lib/communications/member-sms-operations-model') return model;
    if (name === '@/lib/communications/member-sms-model') return loader()('src/lib/communications/member-sms-model.ts');
    if (name === '@/lib/communications/communications-catalog') return { COMMUNICATION_BUCKETS: [{ value: 'registration', label: 'Registration' }, { value: 'foundations', label: 'Foundations' }, { value: 'membership', label: 'Membership' }] };
    throw Error(`Unexpected dependency ${name}`);
  }, mod, mod.exports, fetch);
  function render(props) { for (let i = 0; i < 20; i++) { cursor = 0; changed = false; const node = mod.exports.default(props); effects.splice(0).forEach(effect => effect()); if (!changed) return node; } throw Error('Unstable render'); }
  return { render, exports: mod.exports, cleanup() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const expanded = node => node == null || typeof node !== 'object' ? node : Array.isArray(node) ? node.map(expanded) : typeof node.type === 'function' ? expanded(node.type(node.props)) : { ...node, props: { ...node.props, children: expanded(node.props?.children) } };
const nodes = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.props?.children) : String(node);
const settle = () => new Promise(resolve => setImmediate(resolve));
const recipient = { memberId: 'member-1', name: 'Alex Example', maskedPhone: '••• ••• 0123', sharedPhone: false };
const attempt = (patch = {}) => ({ id: 'attempt-1', kind: 'opt_in_confirmation', reminderKey: 'consent:1', recipient, call: null, createdAt: '2026-11-02T19:00:00Z', updatedAt: '2026-11-02T19:00:01Z', status: 'accepted', deliveryStatus: null, deliveryUpdatedAt: null, deliveryErrorCode: null, blockedReason: null, messageSid: null, body: templates[0].body, bodySource: 'snapshot', ...patch });
const overview = (patch = {}) => ({ generatedAt: '2026-11-02T19:00:00Z', automation: { enabled: true, transportEnabled: true, automationEnabled: true, ready: true, callReady: true, warnings: [], activatedAt: '2026-11-01T00:00:00Z', state: 'enabled', missing: [], schedule: '*/5 * * * *', batchSize: 100 }, templates, communications: [], jobs: { items: [], truncated: false }, upcoming: { items: [], horizonEnd: '2026-11-16T19:00:00Z', truncated: false, label: 'Current eligibility forecast.', currentOptIns: 7, eligibleOptIns: 5 }, history: { items: [attempt()], nextCursor: null }, ...patch });
const props = (patch = {}) => ({ view: 'catalog', bucket: null, onNavigate() {}, ...patch });
function button(tree, name) { const value = nodes(expanded(tree)).find(node => node.type === 'button' && text(node) === name); assert.ok(value, `Missing ${name}`); return value; }

test('SMS sample view uses real templates but never requests or mutates live data', () => {
  const h = harness(() => assert.fail('Preview must not request live data'));
  const messages = text(expanded(h.render(props({ preview: true }))));
  assert.match(messages, /fictional/); assert.match(messages, /Exact message wording/); assert.match(messages, /2½ hours|150 minutes/);
  assert.match(messages, /Example with sample call details/); assert.match(messages, /Reply STOP/);
  const activity = text(expanded(h.render(props({ preview: true, view: 'activity' }))));
  assert.match(activity, /Alex Example/); assert.match(activity, /Delivered/);
  assert.equal(nodes(expanded(h.render(props({ preview: true })))).some(node => node.type === 'button' && /^(Send text|Pause|Save)$/i.test(text(node))), false);
});

test('independent read-only SMS loading exposes actual wording and recoverable errors', async () => {
  const requests = []; let fail = false;
  const h = harness(async (url, options) => { requests.push([url, options]); return fail ? { ok: false, json: async () => ({ error: 'Text records temporarily unavailable.' }) } : { ok: true, json: async () => overview() }; });
  h.render(props({ view: 'activity' })); await settle();
  let tree = h.render(props({ view: 'activity' }));
  assert.equal(requests[0][0], '/api/ops/messages/texts'); assert.equal(requests[0][1].method, 'GET'); assert.equal(requests[0][1].cache, 'no-store');
  assert.match(text(expanded(tree)), /Accepted by Twilio/); assert.doesNotMatch(text(expanded(tree)), /The carrier reported delivery/);
  assert.match(text(expanded(tree)), /Saved with this send attempt/);
  fail = true; await button(tree, 'Refresh texts').props.onClick(); await settle(); tree = h.render(props({ view: 'activity' }));
  assert.match(text(expanded(tree)), /Text records temporarily unavailable/); assert.match(text(expanded(tree)), /last successfully loaded records/); assert.match(text(expanded(tree)), /Alex Example/);
  assert.doesNotMatch(text(expanded(tree)), /No text attempts recorded/);
});

test('delivery labels distinguish acceptance, carrier handoff, delivery, failure and uncertainty', () => {
  const { exports: { smsDeliveryLabel } } = harness(() => assert.fail());
  assert.equal(smsDeliveryLabel(attempt()).label, 'Accepted by Twilio');
  assert.equal(smsDeliveryLabel(attempt({ deliveryStatus: 'sent' })).label, 'Sent to carrier');
  assert.equal(smsDeliveryLabel(attempt({ deliveryStatus: 'delivered' })).label, 'Delivered');
  assert.equal(smsDeliveryLabel(attempt({ deliveryStatus: 'failed' })).label, 'Failed');
  assert.equal(smsDeliveryLabel(attempt({ status: 'unknown' })).label, 'Outcome unconfirmed');
  assert.match(smsDeliveryLabel(attempt({ status: 'unknown' })).explanation, /not be automatically resent/);
  assert.equal(smsDeliveryLabel(attempt({ status: 'blocked', blockedReason: 'phone_suppressed' })).label, 'Blocked');
});

test('recipient counts distinguish current permissions from eligible members even without upcoming messages', async () => {
  const h = harness(async () => ({ ok: true, json: async () => overview() }));
  h.render(props()); await settle();
  const tree = expanded(h.render(props()));
  const counts = nodes(tree).find(node => node.type === 'dl' && node.props['aria-label'] === 'Text recipients');
  assert.ok(counts);
  assert.deepEqual(nodes(counts).filter(node => node.type === 'dt').map(text), ['Eligible opted-in members', 'Current opt-ins in total']);
  assert.deepEqual(nodes(counts).filter(node => node.type === 'dd').map(text), ['5', '7']);
  assert.match(text(tree), /current paid or complimentary access and an open profile/);
  assert.match(text(tree), /Each text still checks its audience and sending requirements/);
  h.cleanup();
});

test('upcoming texts show window, recipient, confirmation dependency and limited forecast caveat', async () => {
  const data = overview({ upcoming: { items: [{ id: 'next', kind: 'call_reminder', reminderKey: 'call:1', recipient, call: { eventId: 'event-1', title: 'Foundations 01', startsAt: '2026-11-03T22:00:00Z', timeZone: 'America/Denver', foundations01: true }, dueAt: '2026-11-03T19:30:00Z', expiresAt: '2026-11-03T19:40:00Z', body: 'Prepared call text', source: 'forecast', confirmation: 'required', confirmationBody: 'Confirmation first', confirmationStatus: null, blockedReason: null }], horizonEnd: '2026-11-16T19:00:00Z', truncated: true, label: 'Current eligibility forecast.', currentOptIns: 7, eligibleOptIns: 5 } });
  const h = harness(async () => ({ ok: true, json: async () => data }));
  h.render(props({ view: 'upcoming' })); await settle();
  const tree = expanded(h.render(props({ view: 'upcoming' }))), rendered = text(tree);
  assert.match(rendered, /Alex Example/); assert.match(rendered, /0123/); assert.match(rendered, /Projected/); assert.match(rendered, /Send window begins/); assert.match(rendered, /Send window ends/);
  assert.match(rendered, /12:30 PM MST/); assert.match(rendered, /Prepared call text/); assert.match(rendered, /Confirmation first/);
  assert.match(rendered, /limited set/); assert.match(rendered, /checked again before sending/); assert.match(rendered, /not a delivery guarantee/);
});

test('activity pagination retains previous attempts and never invents missing historical wording', async () => {
  const urls = [];
  const h = harness(async url => { urls.push(url); return { ok: true, json: async () => overview({ history: urls.length === 1 ? { items: [attempt({ body: null, bodySource: 'unavailable' })], nextCursor: 'older cursor/' } : { items: [attempt(), attempt({ id: 'attempt-2', bodySource: 'verified_reconstruction' })], nextCursor: null } }) }; });
  h.render(props({ view: 'activity' })); await settle(); let tree = h.render(props({ view: 'activity' }));
  assert.match(text(expanded(tree)), /cannot be verified/);
  await button(tree, 'Load older activity').props.onClick(); await settle(); tree = h.render(props({ view: 'activity' }));
  assert.equal(urls[1], '/api/ops/messages/texts?cursor=older%20cursor%2F');
  assert.match(text(expanded(tree)), /2 attempts loaded/); assert.match(text(expanded(tree)), /original send record/);
  assert.equal(nodes(expanded(tree)).filter(node => node.type === 'details').length, 2);
  h.cleanup();
});

test('message stages and tabs report navigation without causing a send', () => {
  const changes = [], h = harness(() => assert.fail());
  const p = props({ preview: true, bucket: 'registration', onNavigate: next => changes.push(next) });
  let tree = expanded(h.render(p));
  assert.match(text(tree), /Exact message wording/); assert.doesNotMatch(text(tree), /Example with sample call details/);
  button(tree, 'Upcoming').props.onClick();
  assert.deepEqual(changes, [{ view: 'upcoming' }]);
  nodes(tree).find(node => node.type === 'select').props.onChange({ currentTarget: { value: 'foundations' } });
  assert.deepEqual(changes[1], { bucket: 'foundations' });
});

test('expired and interrupted jobs remain distinct from a delivered message', async () => {
  const job = { id: 'job-1', kind: 'call_reminder', recipient, call: null, dueAt: '2026-11-02T18:00:00Z', expiresAt: '2026-11-02T18:10:00Z', createdAt: '2026-11-02T18:00:00Z', updatedAt: '2026-11-02T18:01:00Z', status: 'processing', outcome: null };
  const h = harness(async () => ({ ok: true, json: async () => overview({ history: { items: [], nextCursor: null }, jobs: { items: [job, { ...job, id: 'job-2', status: 'finished', outcome: 'expired' }], truncated: true } }) }));
  h.render(props({ view: 'activity' })); await settle();
  const rendered = text(expanded(h.render(props({ view: 'activity' }))));
  assert.match(rendered, /Jobs without a send attempt/); assert.match(rendered, /Needs review/); assert.match(rendered, /Expired/);
  assert.match(rendered, /will not be automatically retried/); assert.match(rendered, /No provider send attempt is recorded/);
  assert.match(rendered, /processing jobs first/); assert.doesNotMatch(rendered, /The carrier reported delivery/);
});

test('one-off activity shows the operator and separates blocked requests from interrupted results', async () => {
  const request = { id: 'request-1', recipient, body: 'Ruined: A reviewed service update.', actorName: 'Cade Example', createdAt: '2026-11-02T18:00:00Z', claimedAt: '2026-11-02T18:00:01Z', status: 'claimed', outcome: null };
  const h = harness(async () => ({ ok: true, json: async () => overview({ history: { items: [attempt({ kind: 'one_off', actorName: 'Cade Example', body: 'Exact one-off wording.' })], nextCursor: null }, oneOffRequests: { items: [request, { ...request, id: 'request-2', status: 'finished', outcome: 'blocked' }], truncated: false } }) }));
  h.render(props({ view: 'activity' })); await settle();
  const rendered = text(expanded(h.render(props({ view: 'activity' }))));
  assert.match(rendered, /One-off text/); assert.match(rendered, /Requested by/); assert.match(rendered, /Cade Example/); assert.match(rendered, /Exact one-off wording/);
  assert.match(rendered, /Needs review/); assert.match(rendered, /Not sent/); assert.match(rendered, /Eligibility checks stopped/);
  assert.match(rendered, /will not be automatically resent/); assert.doesNotMatch(rendered, /Awaiting result/);
});
