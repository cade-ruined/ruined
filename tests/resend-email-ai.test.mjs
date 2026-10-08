import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as parse5 from "parse5";
import ts from "typescript";

async function load(file, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = await load("src/lib/communications/admin-email-model.ts");
const aiError = await load("src/lib/communications/admin-email-ai.ts");
const templates = await load("src/lib/communications/resend-email-templates.ts", { parse5, "./admin-email-model": model });

async function fixture(t, options = {}) {
  const previousKey = process.env.OPENAI_API_KEY, previousModel = process.env.OPENAI_EMAIL_MODEL;
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENAI_EMAIL_MODEL = "fixture-model";
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_EMAIL_MODEL; else process.env.OPENAI_EMAIL_MODEL = previousModel;
  });
  const template = templates.normalizeResendTemplate({
    id: "template-id", current_version_id: "provider-version", name: "Provider design", status: "published", has_unpublished_versions: false,
    from: "Private Sender <private-sender@example.test>", reply_to: ["private-reply@example.test"], subject: "An update",
    html: '<html><body><img src="https://private-assets.example.test/exact-mark.svg"><p>Original introduction.</p><p>Original closing.</p><p>{{{COUNT}}} places.</p></body></html>',
    text: null, variables: [{ key: "COUNT", type: "number", fallback_value: 2 }],
  });
  const input = { prompt: "Make the introduction clearer.", templateId: template.id, templateVersion: template.version,
    mode: "campaign", segmentId: "private-segment", topicId: "private-topic", recipients: ["private-recipient@example.test"],
    members: [{ email: "private-member@example.test", phone: "+15550001234" }], html: "Browser-supplied markup must not be used",
    edits: { subject: "Current subject", values: { COUNT: "3" }, copy: Object.fromEntries(template.fields.map((field, index) => [field.key, index ? field.value : "Current edited introduction."])) } };
  const valid = { subject: "A clearer update", values: { COUNT: "3" }, copy: Object.fromEntries(template.fields.map((field, index) => [field.key, index ? field.value : "A clearer introduction."])) };
  const calls = [];
  let rateAllowed = options.rateAllowed ?? true;
  let response = options.response ?? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(valid) }] }] };
  let httpOk = options.httpOk ?? true, throwTransport = false;
  t.mock.method(globalThis, "fetch", async (url, request) => {
    calls.push({ kind: "fetch", url, request });
    if (throwTransport) throw Error("Provider connection secret detail");
    return { ok: httpOk, status: httpOk ? 200 : 429, json: async () => response };
  });
  const ai = await load("src/lib/communications/resend-email-ai.ts", {
    "server-only": {}, "./admin-email-ai": aiError, "./admin-email-model": model,
    "./admin-email-repository": { consumeAdminEmailGeneration: async actor => { calls.push({ kind: "rate", actor }); return rateAllowed; } },
    "./resend-email-service": {
      getResendEmailTemplate: async (actor, id) => {
        calls.push({ kind: "template", actor, id });
        if (options.denied) throw new model.AdminEmailError(403, "Administrator access required");
        assert.equal(id, template.id);
        return template;
      },
      prepareResendEmail: async (actor, value) => {
        calls.push({ kind: "prepare", actor, input: value });
        return templates.renderResendEmailTemplate(template, value.edits, { campaign: value.mode === "campaign" });
      },
    },
  });
  return { ai, input, valid, template, calls,
    setOutput: output => { response = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }; },
    setResponse: value => { response = value; }, setRate: value => { rateAllowed = value; },
    setHttpOk: value => { httpOk = value; }, setTransportFailure: () => { throwTransport = true; } };
}

test("AI edits only supplied copy slots and sends no provider HTML or recipient metadata", async t => {
  const f = await fixture(t), original = JSON.stringify(f.input);
  assert.deepEqual(await f.ai.generateResendEmailCopy("admin", f.input), f.valid);
  assert.equal(JSON.stringify(f.input), original);
  const call = f.calls.find(item => item.kind === "fetch");
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  const request = JSON.parse(call.request.body), supplied = JSON.parse(request.input);
  assert.deepEqual(Object.keys(supplied).sort(), ["fields", "prompt", "subject", "variables"]);
  assert.equal(request.store, false);
  assert.equal(request.model, "fixture-model");
  assert.equal(request.text.format.strict, true);
  assert.equal(supplied.fields[0].text, "Current edited introduction.");
  assert.equal(supplied.variables[0].text, "3");
  assert.doesNotMatch(request.input, /private-recipient|private-member|private-assets|private-sender|private-reply|private-segment|private-topic|exact-mark|Browser-supplied|<html>|1555000/);
  const schema = request.text.format.schema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.copy.additionalProperties, false);
  assert.equal(schema.properties.values.additionalProperties, false);
  assert.deepEqual(schema.properties.copy.required, f.template.fields.map(field => field.key));
  assert.deepEqual(schema.properties.values.required, ["COUNT"]);
  assert.equal(f.calls.filter(item => item.kind === "rate").length, 1);
  assert.equal(f.calls.filter(item => item.kind === "prepare").length, 2);
});

test("missing key, invalid prompt and exhausted durable limit never call AI", async t => {
  const f = await fixture(t);
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 503);
  assert.equal(f.calls.length, 0);
  process.env.OPENAI_API_KEY = "fixture-key";
  for (const prompt of [undefined, "", " ", "x".repeat(6001)]) await assert.rejects(f.ai.generateResendEmailCopy("admin", { ...f.input, prompt }), error => error.status === 400);
  assert.equal(f.calls.length, 0);
  f.setRate(false);
  await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 429);
  assert.equal(f.calls.some(item => item.kind === "fetch"), false);
});

test("AI copy revisions retain the administrator banner without exposing or changing its fields", async t => {
  const f = await fixture(t);
  const banner = { url: "https://images.example.com/private-banner.jpg", alt: "Private banner description", linkUrl: "https://example.com/private-destination" };
  f.input.edits.banner = banner;
  const result = await f.ai.generateResendEmailCopy("admin", f.input);
  assert.deepEqual(result, { ...f.valid, banner });
  const request = JSON.parse(f.calls.find(item => item.kind === "fetch").request.body);
  assert.doesNotMatch(request.input, /private-banner|Private banner|private-destination/);
  assert.deepEqual(Object.keys(request.text.format.schema.properties).sort(), ["copy", "subject", "values"]);
  assert.deepEqual(f.calls.filter(item => item.kind === "prepare").at(-1).input.edits.banner, banner);
  f.setOutput({ ...f.valid, banner: { ...banner, url: "https://other.example.com/unrequested.jpg" } });
  await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 502);
  assert.deepEqual(f.input.edits.banner, banner);
});

test("administrator authorization failure propagates before rate consumption or AI", async t => {
  const f = await fixture(t, { denied: true });
  await assert.rejects(f.ai.generateResendEmailCopy("guide", f.input), error => error.status === 403);
  assert.equal(f.calls.some(item => ["rate", "fetch"].includes(item.kind)), false);
});

test("provider errors, incomplete results and refusals preserve copy with safe errors", async t => {
  const f = await fixture(t), original = JSON.stringify(f.input.edits);
  f.setHttpOk(false);
  await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 503 && /current copy is unchanged/.test(error.message));
  f.setHttpOk(true);
  for (const response of [
    { status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(f.valid) }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Provider refusal detail" }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "broken-json" }] }] }, null,
  ]) {
    f.setResponse(response);
    await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 503 && !/Provider refusal detail/.test(error.message));
  }
  f.setTransportFailure();
  await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 503 && !/secret/.test(error.message));
  assert.equal(JSON.stringify(f.input.edits), original);
});

test("output preserves every known slot and cannot add top-level, copy or variable fields", async t => {
  const f = await fixture(t);
  for (const output of [
    { ...f.valid, html: "<p>Injected design</p>" }, { ...f.valid, recipients: ["someone@example.test"] },
    { ...f.valid, copy: {} }, { ...f.valid, values: {} },
    { ...f.valid, copy: { ...f.valid.copy, unknown: "New slot" } }, { ...f.valid, values: { ...f.valid.values, unknown: "New variable" } },
  ]) {
    f.setOutput(output);
    await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 502);
  }
});

test("invalid returned copy is rejected by the authoritative template renderer", async t => {
  const f = await fixture(t);
  for (const output of [
    { ...f.valid, subject: "Subject\nBcc: other@example.test" }, { ...f.valid, values: { COUNT: "not-a-number" } },
    { ...f.valid, copy: { ...f.valid.copy, [f.template.fields[0].key]: "{{{contact.email}}}" } },
    { ...f.valid, copy: { ...f.valid.copy, [f.template.fields[0].key]: "x".repeat(12001) } },
  ]) {
    f.setOutput(output);
    await assert.rejects(f.ai.generateResendEmailCopy("admin", f.input), error => error.status === 502 && /current copy is unchanged/.test(error.message));
  }
});
