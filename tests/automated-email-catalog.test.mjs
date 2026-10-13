import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const configuration = {
    registration: { enabled: false, ready: false, missing: ["private-configuration-detail"] },
    renewal: { enabled: false, ready: false, missing: ["private-configuration-detail"] },
    digest: { enabled: false, ready: false, missing: ["private-configuration-detail"], timeZone: "America/Denver" },
  };
  const reads = { registration: 0, renewal: 0, digest: 0 };
  const getter = key => () => { reads[key]++; return configuration[key]; };
  const dependencies = {
    "server-only": {},
    "@/lib/membership/registration-message-delivery": { getRegistrationMessageConfiguration: getter("registration") },
    "@/lib/stripe/renewal-worker": { getRenewalNoticeConfiguration: getter("renewal") },
    "@/lib/platform/work-queue-digest-delivery": { getWorkQueueDigestConfiguration: getter("digest") },
  };
  const source = readFileSync(new URL("../src/lib/communications/automated-email-catalog.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  assert.deepEqual(reads, { registration: 0, renewal: 0, digest: 0 }, "importing the catalog must not inspect configuration");
  return { configuration, reads, catalog: mod.exports.getAutomatedEmailCatalog };
}

test("each workflow reports its own configuration without implying delivery success", () => {
  const f = fixture();
  assert.deepEqual(f.catalog().map(item => item.state), ["paused", "paused", "paused"]);
  Object.assign(f.configuration.registration, { enabled: true, ready: true });
  Object.assign(f.configuration.renewal, { enabled: true, ready: false });
  Object.assign(f.configuration.digest, { enabled: false, ready: true });
  const mixed = f.catalog();
  assert.deepEqual(mixed.map(({ id, state, statusLabel }) => ({ id, state, statusLabel })), [
    { id: "registration", state: "configured", statusLabel: "Configured" },
    { id: "renewal", state: "incomplete", statusLabel: "Setup incomplete" },
    { id: "work_digest", state: "paused", statusLabel: "Paused" },
  ]);
  Object.assign(f.configuration.registration, { enabled: false, ready: false });
  Object.assign(f.configuration.renewal, { ready: true });
  Object.assign(f.configuration.digest, { enabled: true, ready: true });
  assert.deepEqual(f.catalog().map(item => item.state), ["paused", "configured", "configured"], "configuration is read again rather than cached");
  assert.deepEqual(f.reads, { registration: 3, renewal: 3, digest: 3 });
});

test("digest timing distinguishes daylight-saving Mountain time from fixed MST and invalid setup", () => {
  const f = fixture(), digest = () => f.catalog().find(item => item.id === "work_digest");
  assert.match(digest().timing, /following daylight saving time/);
  Object.assign(f.configuration.digest, { enabled: true, ready: true, timeZone: "Etc/GMT+7" });
  assert.match(digest().timing, /UTC−7.*year-round/);
  assert.doesNotMatch(digest().timing, /daylight saving/);
  Object.assign(f.configuration.digest, { ready: false, timeZone: null });
  assert.equal(digest().state, "incomplete");
  assert.match(digest().timing, /Time zone setup is incomplete/);
});

test("catalog exposes only the three existing workflows and public management descriptions", () => {
  const f = fixture();
  for (const config of Object.values(f.configuration)) Object.assign(config, {
    secret: "do-not-expose-secret", recipient: "private-recipient@example.test", providerResult: { delivered: true },
  });
  const rows = f.catalog(), serialized = JSON.stringify(rows);
  assert.deepEqual(rows.map(item => item.id), ["registration", "renewal", "work_digest"]);
  assert.deepEqual(rows.map(item => item.management.href), ["/ops/registrations", "/ops/access-billing", "/ops/work"]);
  assert.doesNotMatch(serialized, /private-configuration-detail|do-not-expose-secret|private-recipient|providerResult|delivered/);
  assert.ok(rows.every(item => item.trigger && item.timing && item.recipients && item.controlBoundary));
  assert.ok(rows.every(item => !Object.hasOwn(item, "send") && !Object.hasOwn(item, "recipientsCount")));
  rows[0].management.href = "/changed";
  assert.equal(f.catalog()[0].management.href, "/ops/registrations", "callers cannot alter the shared catalog for later requests");
});
