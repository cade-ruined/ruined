import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../next.config.mjs';
test('only the email workspace permits template image origins without changing active-content policy', async () => {
  const headers = await config.headers();
  const base = headers.find(route => route.source === '/(.*)').headers.find(header => header.key === 'Content-Security-Policy').value;
  const email = headers.filter(route => ['/ops/emails', '/ops/messages'].includes(route.source));
  assert.equal(email.length, 2);
  assert.deepEqual(email.find(route => route.source === '/ops/messages').has, [{ type: 'query', key: 'mode', value: 'emails' }]);
  for (const route of email) {
    const policy = route.headers[0].value;
    assert.match(policy, /img-src 'self' data: blob: https:/);
    assert.equal(policy.replace(/img-src [^;]+/, ''), base.replace(/img-src [^;]+/, ''));
  }
});
