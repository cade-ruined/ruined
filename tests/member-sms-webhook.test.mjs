import assert from "node:assert/strict";
import test from "node:test";
import twilio from "twilio";
import { configuration, loader, sid } from "./helpers/member-sms-fixture.mjs";

const env = { ...configuration(), MEMBER_SMS_ENABLED: "false" };
const origin = env.TWILIO_WEBHOOK_BASE_URL;
const endpoint = `${origin}/api/twilio/inbound`;
const params = (overrides = {}) => ({ AccountSid: env.TWILIO_ACCOUNT_SID, MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  To: env.TWILIO_PHONE_NUMBER, From: "+12025550123", MessageSid: sid(1), Body: "STOP", OptOutType: "STOP", ...overrides });
function fixture(options = {}) {
  const received = [], receipts = new Set();
  const load = loader(options.env ?? env, {
    "@/lib/database/server": { getApplicationDatabase: () => ({}) },
    "@/lib/communications/member-sms-repository": { applyMemberSmsInbound: async (_sql, inbound) => {
      if (options.failed) throw new Error(`Sensitive fixture ${env.TWILIO_AUTH_TOKEN} ${inbound.phone}`);
      if (receipts.has(inbound.messageSid)) return { duplicate: true };
      receipts.add(inbound.messageSid); received.push(inbound); return { duplicate: false };
    } },
  });
  return { received, POST: load("app/api/twilio/inbound/route.ts").POST };
}
function request(values = params(), overrides = {}) {
  const url = overrides.url ?? endpoint;
  const signature = twilio.getExpectedTwilioSignature(overrides.token ?? env.TWILIO_AUTH_TOKEN, overrides.signingUrl ?? endpoint, values);
  const headers = { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature, ...overrides.headers };
  return new Request(url, { method: "POST", headers, body: overrides.body ?? new URLSearchParams(values).toString() });
}

test("missing, forged, tampered, wrong-account, wrong-service, and wrong-To inbound events never process", async () => {
  const app = fixture();
  const attempts = [
    request(params(), { headers: { "x-twilio-signature": "" } }),
    request(params(), { token: "wrong-fixture-token" }),
    request(params(), { body: new URLSearchParams(params({ From: "+12025550999" })).toString() }),
    request(params({ AccountSid: `AC${"3".repeat(32)}` })),
    request(params({ MessagingServiceSid: `MG${"3".repeat(32)}` })),
    request(params({ To: "+12025550999" })),
    request(params({ MessageSid: "invalid" })),
    request(params({ From: "whatsapp:+12025550123" })),
  ];
  for (const attempt of attempts) assert.equal((await app.POST(attempt)).status, 403);
  assert.equal(app.received.length, 0);
});

test("canonical public URL validates independently of proxy Host; alternate-origin signatures are rejected", async () => {
  const app = fixture();
  assert.equal((await app.POST(request(params(), { url: "https://internal-proxy.test/api/twilio/inbound",
    headers: { host: "attacker.test", "x-forwarded-host": "attacker.test" } }))).status, 200);
  assert.equal((await app.POST(request(params({ MessageSid: sid(2) }), { signingUrl: "https://attacker.test/api/twilio/inbound",
    headers: { host: "attacker.test", "x-forwarded-host": "attacker.test" } }))).status, 403);
  assert.equal((await app.POST(request(params(), { url: `${endpoint}?x=1` }))).status, 400);
  assert.equal((await app.POST(request(params(), { url: `${origin}/api/wrong` }))).status, 400);
  assert.equal(app.received.length, 1);
});

test("verified STOP keeps working while sending is disabled; replays and Advanced Opt-Out replies are empty", async () => {
  const app = fixture();
  for (const [index, type] of ["STOP", "HELP", "START"].entries()) {
    const value = params({ MessageSid: sid(index + 1), OptOutType: type, Body: type });
    for (let i = 0; i < 2; i++) {
      const response = await app.POST(request(value));
      assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/xml/);
      assert.equal(await response.text(), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
  assert.deepEqual(app.received.map(item => item.kind), ["STOP", "HELP", "START"]);
});

test("configured custom opt-out keywords use OptOutType and standard STOP fallback is conservative", async () => {
  const app = fixture();
  assert.equal((await app.POST(request(params({ Body: "custom localized opt-out", OptOutType: "STOP" })))).status, 200);
  const value = params({ MessageSid: sid(2), Body: "  unsubscribe  " }); delete value.OptOutType;
  assert.equal((await app.POST(request(value))).status, 200);
  assert.ok(app.received.every(item => item.kind === "STOP"));
});

test("bad payload shapes and processing failures cannot expose secrets or acknowledge an uncommitted STOP", async () => {
  const app = fixture();
  assert.equal((await app.POST(request(params(), { headers: { "content-type": "application/json" } }))).status, 415);
  assert.equal((await app.POST(request(params(), { headers: { "content-length": "999999" } }))).status, 413);
  assert.equal((await app.POST(request(params(), { body: `${new URLSearchParams(params())}&Body=START` }))).status, 403);
  const failed = await fixture({ failed: true }).POST(request());
  assert.equal(failed.status, 503); assert.equal(await failed.text(), "Webhook processing unavailable");
  assert.equal((await fixture({ env: {} }).POST(request())).status, 503);
  assert.equal(app.received.length, 0);
});
