import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const configuration = {
    platform: { mode: "connected" },
    auth: { configured: true, missing: [], invalid: [] },
    transport: { enabled: false, sendReady: true, webhookReady: true },
    automation: { enabled: false, activatedAt: "2020-01-01T00:00:00.000Z", ready: true },
    invitationEmailReady: true,
  };
  const reads = { platform: 0, auth: 0, transport: 0, automation: 0, invitationEmailReady: 0 };
  const getter = key => () => { reads[key]++; return configuration[key]; };
  const dependencies = {
    "server-only": {},
    "@/lib/platform/config": { getPlatformConfiguration: getter("platform") },
    "@/lib/supabase/config": { getSupabaseConfigStatus: getter("auth") },
    "@/lib/membership/personal-invitation-delivery": { getPersonalInvitationEmailReady: getter("invitationEmailReady") },
    "./member-sms-config": { getMemberSmsConfigurationStatus: getter("transport") },
    "./member-sms-automation-model": { readMemberSmsAutomationConfiguration: getter("automation") },
  };
  const source = readFileSync(new URL("../src/lib/communications/communications-channel-catalog.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const env = { CRON_SECRET: "private-worker-secret" };
  new Function("require", "module", "exports", "process", code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected runtime dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports, { env });
  assert.ok(Object.values(reads).every(count => count === 0), "import must not inspect configuration or invoke a worker");
  const catalog = mod.exports.getCommunicationsChannelCatalog;
  return { configuration, reads, env, catalog, preview: mod.exports.getCommunicationsChannelPreviewCatalog,
    item: id => catalog().find(item => item.id === id) };
}

test("preview uses the same inventory without live configuration reads or active send states", () => {
  const f = fixture();
  const preview = f.preview();
  assert.ok(Object.values(f.reads).every(count => count === 0));
  assert.equal(preview.length, 12);
  assert.ok(preview.every(item => ["manual", "paused"].includes(item.status)));
  assert.ok(preview.every(item => item.statusLabel.startsWith("Sample ·")));
  assert.ok(preview.every(item => item.detail.startsWith("Sample workspace. Nothing is saved or sent.")));
  assert.deepEqual(preview.map(item => item.id), f.catalog().map(item => item.id));
});

test("SMS requires both explicit switches, configured transport and worker, and an elapsed activation time", () => {
  const f = fixture();
  const sms = () => f.catalog().filter(item => item.id.startsWith("sms:"));
  assert.equal(sms().length, 3, "the confirmation and both catalog views of the call rule share the same gates");
  assert.ok(sms().every(item => item.status === "paused"), "credentials alone never enable SMS");
  f.configuration.transport.enabled = true;
  assert.ok(sms().every(item => item.status === "paused"), "transport alone never enables automation");
  f.configuration.automation.enabled = true;
  f.configuration.transport.enabled = false;
  assert.ok(sms().every(item => item.status === "paused"), "automation alone never enables transport");
  f.configuration.transport.enabled = true;
  assert.ok(sms().every(item => item.status === "enabled" && item.statusLabel === "Configured"));
  f.configuration.automation.activatedAt = "2999-01-01T00:00:00.000Z";
  assert.ok(sms().every(item => item.status === "paused" && item.statusLabel === "Activation scheduled"));
  for (const activatedAt of [null, "invalid"]) {
    f.configuration.automation.activatedAt = activatedAt;
    assert.ok(sms().every(item => item.status === "attention"));
  }
  f.configuration.automation.activatedAt = "2020-01-01T00:00:00.000Z";
  f.configuration.automation.ready = false;
  assert.ok(sms().every(item => item.status === "attention"));
  f.configuration.automation.ready = true;
  f.configuration.transport.sendReady = false;
  assert.ok(sms().every(item => item.status === "attention"));
  f.configuration.transport.sendReady = true;
  f.env.CRON_SECRET = " ";
  assert.ok(sms().every(item => item.status === "attention"));
  f.env.CRON_SECRET = "private-worker-secret";
  f.configuration.auth.configured = false;
  assert.ok(sms().every(item => item.status === "attention"));
});

test("transactional and in-app configuration remains distinct from provider readiness and worker recovery", () => {
  const f = fixture();
  assert.equal(f.item("email:access-verification").statusLabel, "Transactional · configured");
  assert.equal(f.item("email:personal-invitation").statusLabel, "Transactional · configured");
  f.configuration.invitationEmailReady = false;
  assert.equal(f.item("email:personal-invitation").status, "attention");
  assert.equal(f.item("email:access-verification").status, "enabled", "Auth email does not use the invitation email transport");
  f.env.CRON_SECRET = "";
  assert.equal(f.item("notification:foundations-complete").statusLabel, "Worker recovery not configured");
  assert.equal(f.item("notification:support-reply").status, "enabled", "Support saves its in-app alert within the reply transaction");
  f.configuration.platform.mode = "preview";
  for (const id of ["email:access-verification", "notification:foundations-complete", "notification:support-reply"]) {
    assert.equal(f.item(id).status, "attention", id);
  }
  f.configuration.platform.mode = "connected";
  f.configuration.auth.configured = false;
  assert.equal(f.item("email:access-verification").status, "attention");
});

test("manual invitations and app publishing describe their actual boundaries and existing routes", () => {
  const f = fixture();
  const invitation = f.item("manual:invitation-text");
  assert.equal(invitation.status, "manual");
  assert.equal(invitation.action.href, "/my/invitation");
  assert.match(invitation.detail, /prefilled SMS draft/);
  assert.match(invitation.detail, /does not send it through Twilio/);
  assert.match(f.item("sms:membership-call-reminder").detail, /explicit SMS consent.*opt-out suppression/);
  assert.match(f.item("sms:opt-in-confirmation").timing, /Older consent.*eligible call reminder/);
  assert.equal(f.item("manual:operator-alert").action.href, "/ops/messages?mode=alerts");
  assert.match(f.item("manual:operator-alert").detail, /No email, text message, or device push/);
  assert.equal(f.item("manual:board-post").action.href, "/ops/messages?mode=posts");
  assert.match(f.item("manual:board-post").timing, /alert is queued/);
  assert.match(f.item("notification:circle-reveal").trigger, /after.*completed Foundations/);
});

test("Foundations and Membership expose the same SMS rule in their own catalog buckets", () => {
  const rows = fixture().catalog();
  const foundations = rows.find(item => item.id === "sms:foundations-call-reminder");
  const membership = rows.find(item => item.id === "sms:membership-call-reminder");
  assert.equal(foundations.channel, "texts");
  assert.equal(foundations.bucket, "foundations");
  assert.equal(foundations.title, "60-minute Foundations reminder");
  assert.equal(membership.channel, "texts");
  assert.equal(membership.bucket, "membership");
  assert.equal(membership.title, "60-minute Membership / Circle reminder");
  for (const key of ["audience", "timing", "detail", "status", "statusLabel", "action"]) {
    assert.deepEqual(foundations[key], membership[key], key);
  }
  assert.match(foundations.detail, /One shared SMS rule.*same schedule and configuration/);
  assert.equal(rows.some(item => item.id === "sms:call-reminder"), false);
});

test("catalog exposes descriptions only and fresh rows without configuration secrets or recipients", () => {
  const f = fixture();
  for (const config of Object.values(f.configuration).filter(value => typeof value === "object")) {
    Object.assign(config, { secret: "private-config-secret", recipient: "private-recipient@example.test", providerResult: { delivered: true } });
  }
  const before = JSON.stringify(f.configuration);
  const rows = f.catalog();
  assert.equal(JSON.stringify(f.configuration), before, "catalog must not mutate configuration");
  assert.equal(new Set(rows.map(item => item.id)).size, rows.length);
  assert.ok(rows.every(item => item.trigger && item.audience && item.timing && item.detail));
  assert.ok(rows.every(item => item.action?.href?.startsWith("/") && !item.action.href.startsWith("//")));
  assert.doesNotMatch(JSON.stringify(rows), /private-config-secret|private-worker-secret|private-recipient|providerResult/);
  assert.ok(rows.every(item => !Object.hasOwn(item, "send") && !Object.hasOwn(item, "recipientCount")));
  assert.ok(rows.every(item => !/delivered|sending/i.test(item.statusLabel)));
  rows[0].action.href = "/changed";
  assert.equal(f.catalog()[0].action.href, "/my/invitation");
  assert.ok(Object.values(f.reads).every(count => count === 2), "each request rereads only the five safe configuration getters");
});
