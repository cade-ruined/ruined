import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { loader } from "./helpers/member-sms-fixture.mjs";

const require = createRequire(import.meta.url), model = loader()('src/lib/communications/member-sms-one-off-model.ts');
const recipient = { memberId: '00000000-0000-4000-8000-000000000001', name: 'Alex Example', maskedPhone: '••• ••• 0100', sharedPhone: false, consentState: 'opted_in' };
const configuration = { enabled: true, ready: true, issues: [] };
const nodes = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.props?.children) : String(node);
function fixture({ preview = false, respond, selected = recipient } = {}) {
  const slots = [], effects = [], calls = [], closed = [], activity = [], busy = [];
  let cursor = 0, changed = false;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = { ...React,
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; changed ||= !Object.is(next, slots[i].value); slots[i].value = next; }]; },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  async function fallback(call) {
    if (call.url.includes('/recipients?')) return Response.json({ recipients: [selected], hasMore: false, configuration });
    const body = JSON.parse(call.body);
    if (call.url.endsWith('/review')) return Response.json({ review: { id: `review-${body.requestId}`, recipient: selected, body: model.renderMemberSmsOneOffBody(body.message), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString(), status: 'reviewed' }, configuration });
    if (call.url.endsWith('/send')) return Response.json({ reviewId: body.reviewId, status: 'accepted', attemptId: 'attempt-1', deliveryStatus: null, message: 'The provider accepted this text.' });
    assert.fail(`Unexpected path ${call.url}`);
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/components/platform/OperatorSmsOneOffComposer.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', code)(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '@/lib/communications/member-sms-one-off-model') return model;
    if (name === './operatorStyles') return { OPERATOR_BUTTON_CLASS: 'button' };
    if (name === './OperatorSmsOneOffComposer.module.css') return new Proxy({}, { get: (_, key) => key });
    assert.fail(`Unexpected dependency ${name}`);
  }, mod, mod.exports, async (url, options) => { assert.equal(preview, false, 'Sample composer must stay offline'); const call = { url, ...options }; calls.push(call); return respond ? respond(call, fallback) : fallback(call); });
  const props = { open: true, preview, onClose: () => closed.push(true), onActivity: () => activity.push(true), onBusyChange: value => busy.push(value) };
  function draw() { for (let i = 0; i < 20; i++) { cursor = 0; changed = false; const tree = mod.exports.default(props); effects.splice(0).forEach(effect => effect()); if (!changed) return tree; } assert.fail('Unstable render'); }
  const find = predicate => nodes(draw()).find(predicate);
  const button = name => { const result = find(node => node.type === 'button' && text(node) === name); assert.ok(result, `Missing button ${name}`); return result; };
  const fill = (id, value) => { const node = find(node => node.props?.id === id); assert.ok(node, id); node.props.onChange({ currentTarget: { value }, target: { value } }); };
  const submit = id => { const form = find(node => node.type === 'form' && nodes(node).some(child => child.props?.id === id)); assert.ok(form); return form.props.onSubmit({ preventDefault() {} }); };
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return draw(); };
  async function draft(message = 'Your membership call is now at 3 p.m. The updated link is in your account.') { draw(); fill('sms-one-off-search', 'Alex'); await submit('sms-one-off-search'); await settle(); const select = find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Choose ')); assert.ok(select); select.props.onClick(); fill('sms-one-off-message', message); return draw(); }
  async function review() { await submit('sms-one-off-message'); await settle(); return draw(); }
  return { draw, find, button, fill, submit, settle, draft, review, calls, props, closed, activity, busy, cleanup() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('sample composer previews the complete text and reviews without any live request or enabled send', async () => {
  const f = fixture({ preview: true }); await f.draft('Your call is at 3 p.m.');
  assert.match(text(f.draw()), /Ruined: Your call is at 3 p.m./); assert.match(text(f.draw()), /Reply STOP to unsubscribe or HELP for help/);
  assert.match(text(f.draw()), /total/); assert.equal(f.find(node => node.type === 'input' && node.props.type === 'tel'), undefined);
  await f.review(); assert.match(text(f.draw()), /Exact text to send/); assert.match(text(f.draw()), /Alex Example/);
  const send = f.button('Sending off in preview'); assert.equal(send.props.disabled, true); send.props.onClick(); await f.settle();
  assert.equal(f.calls.length, 0); f.cleanup();
});

test('review and explicit final send are distinct and final payload contains only frozen review identity', async () => {
  let resolveSend;
  const f = fixture({ selected: { ...recipient, sharedPhone: true }, respond: (call, fallback) => call.url.endsWith('/send') ? new Promise(resolve => { resolveSend = () => resolve(fallback(call)); }) : fallback(call) });
  await f.draft(); assert.match(text(f.draw()), /Shared number/); await f.review();
  assert.match(text(f.draw()), /also linked to another member/);
  assert.equal(f.calls.filter(call => call.url.endsWith('/send')).length, 0);
  const review = JSON.parse(f.calls.find(call => call.url.endsWith('/review')).body);
  assert.equal(review.memberId, recipient.memberId); assert.match(review.requestId, /^[0-9a-f-]{36}$/); assert.equal(Object.hasOwn(review, 'phone'), false);
  const send = f.button('Send text'); send.props.onClick(); send.props.onClick(); f.draw();
  assert.equal(f.calls.filter(call => call.url.endsWith('/send')).length, 1);
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { reviewId: `review-${review.requestId}`, confirm: true });
  assert.equal(f.button('Sending…').props.disabled, true); assert.equal(f.button('Back to texts').props.disabled, true);
  resolveSend(); await f.settle(); assert.match(text(f.draw()), /Text accepted by Twilio/); assert.match(text(f.draw()), /Acceptance is not delivery confirmation/);
  send.props.onClick(); await f.settle(); assert.equal(f.calls.filter(call => call.url.endsWith('/send')).length, 1, 'A stale final-action handler cannot resend a consumed review');
  f.button('View Activity').props.onClick(); f.draw(); assert.equal(f.activity.length, 1); assert.equal(f.find(node => node.props?.id === 'sms-one-off-message').props.value, '');
  assert.ok(f.busy.includes(true)); f.cleanup();
});

test('ambiguous send failure preserves the reviewed text and never offers retry or an automatic fresh review', async () => {
  const f = fixture({ respond: (call, fallback) => { if (call.url.endsWith('/send')) throw Error('Connection lost'); return fallback(call); } });
  await f.draft(); await f.review(); const send = f.button('Send text'); send.props.onClick(); await f.settle();
  assert.match(text(f.draw()), /Send result unconfirmed/); assert.match(text(f.draw()), /Do not resend/);
  assert.equal(f.find(node => node.type === 'button' && text(node) === 'Send text'), undefined);
  assert.equal(f.find(node => node.type === 'button' && text(node) === 'Back to draft'), undefined);
  f.button('View Activity').props.onClick(); f.props.open = false; f.draw(); f.props.open = true; f.draw();
  assert.match(text(f.draw()), /Send result unconfirmed/); send.props.onClick(); await f.settle();
  assert.equal(f.calls.filter(call => call.url.endsWith('/send')).length, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith('/review')).length, 1); f.cleanup();
});

test('explicit pre-send rejection shows the real error and permits a fresh review without inventing Activity', async () => {
  const f = fixture({ respond: (call, fallback) => call.url.endsWith('/send') ? Response.json({ error: 'The review expired before sending.', sendStarted: false }, { status: 409 }) : fallback(call) });
  await f.draft('Call update.'); await f.review(); f.button('Send text').props.onClick(); await f.settle();
  assert.match(text(f.draw()), /Text was not sent/); assert.match(text(f.draw()), /review expired before sending/);
  assert.equal(f.find(node => node.type === 'button' && text(node) === 'View Activity'), undefined);
  f.button('Back to draft').props.onClick(); assert.equal(f.find(node => node.props?.id === 'sms-one-off-message').props.value, 'Call update.'); await f.review();
  const ids = f.calls.filter(call => call.url.endsWith('/review')).map(call => JSON.parse(call.body).requestId);
  assert.notEqual(ids[0], ids[1]); assert.equal(f.calls.filter(call => call.url.endsWith('/send')).length, 1); f.cleanup();
});

test('review retries retain request identity, but editing the draft invalidates the frozen review', async () => {
  let reviews = 0;
  const f = fixture({ respond: (call, fallback) => { if (call.url.endsWith('/review') && ++reviews === 1) throw Error('Review response lost'); return fallback(call); } });
  await f.draft('First wording.'); await f.review(); assert.match(text(f.draw()), /Review response lost/); await f.review();
  const calls = () => f.calls.filter(call => call.url.endsWith('/review')).map(call => JSON.parse(call.body));
  assert.equal(calls()[0].requestId, calls()[1].requestId);
  f.button('Back to draft').props.onClick(); f.fill('sms-one-off-message', 'Changed wording.'); assert.equal(f.find(node => node.type === 'button' && text(node) === 'Send text'), undefined); await f.review();
  assert.notEqual(calls()[1].requestId, calls()[2].requestId); assert.match(text(f.draw()), /Ruined: Changed wording/);
  assert.equal(f.calls.some(call => call.url.endsWith('/send')), false); f.cleanup();
});

test('expired review and mismatched server preview cannot send', async () => {
  for (const fault of ['expired', 'mismatch']) {
    const f = fixture({ respond: async (call, fallback) => { const response = await fallback(call); if (!call.url.endsWith('/review')) return response; const value = await response.json(); if (fault === 'expired') value.review.expiresAt = '2000-01-01T00:00:00Z'; else value.review.body = 'Different message'; return Response.json(value); } });
    await f.draft(); await f.review();
    if (fault === 'expired') { assert.equal(f.button('Send text').props.disabled, true); f.button('Send text').props.onClick(); }
    else { assert.match(text(f.draw()), /wording changed/); assert.equal(f.find(node => node.type === 'button' && text(node) === 'Send text'), undefined); }
    await f.settle(); assert.equal(f.calls.some(call => call.url.endsWith('/send')), false); f.cleanup();
  }
});

test('recipient loading errors do not become empty eligibility and text input never grants consent', async () => {
  const f = fixture({ respond: () => Response.json({ error: 'Member search is unavailable.' }, { status: 503 }) });
  f.draw(); f.fill('sms-one-off-search', 'A'); assert.equal(f.button('Search').props.disabled, true); await f.submit('sms-one-off-search'); assert.equal(f.calls.length, 0);
  f.fill('sms-one-off-search', 'Alex'); await f.submit('sms-one-off-search'); await f.settle();
  assert.match(text(f.draw()), /Member search is unavailable/); assert.doesNotMatch(text(f.draw()), /No eligible opted-in members match/);
  f.fill('sms-one-off-message', 'Text content'); assert.equal(f.button('Review text').props.disabled, true); await f.submit('sms-one-off-message');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET'); assert.equal(f.find(node => node.type === 'input' && node.props.type === 'checkbox'), undefined); f.cleanup();
});
