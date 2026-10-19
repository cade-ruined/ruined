import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../next.config.mjs';
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server.js';
test('only the email workspace permits template images and the Ruined font origin without changing active-content policy', async () => {
  const headers = await config.headers();
  const response = await unstable_getResponseFromNextConfig({ url: 'https://members.theruinedproject.com/my', nextConfig: config });
  const base = response.headers.get('Content-Security-Policy');
  assert.ok(base);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  const email = headers.filter(route => route.headers.some(header => header.key === 'Content-Security-Policy' && /img-src 'self' data: blob: https:(?:;|$)/.test(header.value)));
  assert.deepEqual(email.map(({ source, has, missing }) => ({ source, ...(has ? { has } : {}), ...(missing ? { missing } : {}) })), [
    { source: '/ops/emails' },
    { source: '/ops/messages', has: [{ type: 'query', key: 'mode', value: 'emails' }] },
    { source: '/ops/email-automations' },
    { source: '/ops/messages', has: [{ type: 'query', key: 'mode', value: 'automations' }] },
    { source: '/ops/messages', missing: [{ type: 'query', key: 'mode' }] },
  ]);
  const hub = await unstable_getResponseFromNextConfig({ url: 'https://members.theruinedproject.com/ops/messages', nextConfig: config });
  assert.match(hub.headers.get('Content-Security-Policy'), /img-src 'self' data: blob: https:/);
  for (const route of email) {
    const policy = route.headers[0].value;
    assert.match(policy, /img-src 'self' data: blob: https:/);
    assert.match(policy, /font-src 'self' data: https:\/\/members\.theruinedproject\.com(?:;|$)/);
    assert.equal(policy.replace(/(?:img|font)-src [^;]+/g, ''), base.replace(/(?:img|font)-src [^;]+/g, ''));
  }
});

test('only the three email brand fonts allow opaque-origin preview reads', async () => {
  const fontHeaders = (await config.headers()).filter(route => route.source.startsWith('/fonts/'));
  assert.deepEqual(fontHeaders.map(route => route.source).sort(), ['/fonts/CadeHandy2.otf', '/fonts/Inter-Variable-Latin.woff2', '/fonts/IvyOraText-Medium.ttf']);
  for (const route of fontHeaders) assert.deepEqual(route.headers, [{ key: 'Access-Control-Allow-Origin', value: '*' }]);
  for (const route of ['/api/ops/emails/resend/preview', '/api/ops/emails/resend/broadcasts', '/api/ops/emails/resend/review']) {
    assert.ok(config.outputFileTracingIncludes[route].includes('./public/fonts/CadeHandy2.otf'));
  }
});
