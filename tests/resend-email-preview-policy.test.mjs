import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../next.config.mjs';
test('only the email workspace permits template images and the Ruined font origin without changing active-content policy', async () => {
  const headers = await config.headers();
  const base = headers.find(route => route.source === '/(.*)').headers.find(header => header.key === 'Content-Security-Policy').value;
  const email = headers.filter(route => ['/ops/emails', '/ops/messages'].includes(route.source));
  assert.equal(email.length, 2);
  assert.deepEqual(email.find(route => route.source === '/ops/messages').has, [{ type: 'query', key: 'mode', value: 'emails' }]);
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
