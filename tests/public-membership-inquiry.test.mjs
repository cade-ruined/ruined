import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime" || name === "react") return require(name);
    throw new Error(`Unexpected inquiry dependency: ${name}`);
  }, cjsModule, cjsModule.exports, ...Object.values(globals));
  return cjsModule.exports;
}

const topicModel = load("src/lib/contact-topic.ts");
const dependencies = { "@/lib/contact-topic": topicModel };
const Form = load("src/components/ContactForm.tsx", dependencies).default;

test("only the two supported contact topics are accepted; ordinary contact remains the default", () => {
  assert.equal(topicModel.parseContactTopic(undefined), "general");
  assert.equal(topicModel.parseContactTopic("general"), "general");
  assert.equal(topicModel.parseContactTopic("membership"), "membership");
  for (const invalid of [null, "", "operator", "membership\nBcc: someone@example.test", [], ["membership"], {}, 1]) {
    assert.equal(topicModel.parseContactTopic(invalid), null);
    assert.equal(topicModel.contactTopicFromQuery(invalid), "general");
  }
});

test("direct and intercepted contact routes preserve membership context and safely normalize URL values", async () => {
  for (const [file, dependency] of [
    ["app/contact/page.tsx", "@/components/contact/ContactSurface"],
    ["app/@modal/(.)contact/page.tsx", "@/components/contact/ContactModal"],
  ]) {
    const route = load(file, {
      ...dependencies,
      [dependency]: { __esModule: true, default: ({ initialTopic }) => React.createElement("span", { "data-topic": initialTopic }) },
    }).default;
    for (const [value, expected] of [["membership", "membership"], [undefined, "general"], [["membership", "general"], "general"], ["bad-topic", "general"]]) {
      const html = renderToStaticMarkup(await route({ searchParams: Promise.resolve({ topic: value }) }));
      assert.match(html, new RegExp(`data-topic="${expected}"`));
    }
  }
});

test("the shared contact surface passes the topic into the form in page and sheet layouts", () => {
  const Surface = load("src/components/contact/ContactSurface.tsx", {
    "@/components/ContactForm": { __esModule: true, default: Form },
  }).default;
  for (const modal of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Surface, { modal, initialTopic: "membership", titleId: "contact-title" }));
    assert.match(html, /<option value="membership" selected="">Membership<\/option>/);
    assert.match(html, /What brings you to Ruined\?/);
    assert.match(html, /Membership is by invitation\./);
    assert.match(html, /Send inquiry/);
    assert.match(html, /aria-describedby="[^"]+-membership-context"/);
    assert.match(html, /id="[^"]+-membership-context"/);
    assert.doesNotMatch(html, /\$\d|24 hours|48 hours|guaranteed|application approved/i);
  }
  const generic = renderToStaticMarkup(React.createElement(Form));
  assert.match(generic, /<option value="general" selected="">General question<\/option>/);
  assert.match(generic, />Message<\/label>/);
  assert.match(generic, /Send message/);
  assert.doesNotMatch(generic, /What brings you to Ruined|Membership is by invitation/);
});

function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}

function formFixture(initialTopic = "membership") {
  const slots = [];
  let cursor = 0;
  const fetches = [];
  const answers = [];
  const form = { resets: 0, reset() { this.resets += 1; } };
  const Component = load("src/components/ContactForm.tsx", {
    ...dependencies,
    react: {
      ...React,
      useId: () => "fixture",
      useState: (initial) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef: (initial) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
    },
  }, {
    FormData: class { *[Symbol.iterator]() { yield* Object.entries({ name: "Test Person", email: "test@example.test", message: "I would like to learn about membership.", company: "" }); } },
    crypto: { randomUUID },
    fetch: async (url, options) => {
      fetches.push({ url, body: JSON.parse(options.body) });
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer ?? { ok: true };
    },
  }).default;
  const render = () => { cursor = 0; return Component({ initialTopic }); };
  const submit = () => render().props.onSubmit({ preventDefault() {}, currentTarget: form });
  return { render, submit, fetches, answers, form };
}

test("membership selection reaches the submitted payload and confirms the actual next step", async () => {
  const fixture = formFixture();
  await fixture.submit();
  assert.equal(fixture.fetches[0].url, "/api/contact");
  assert.equal(fixture.fetches[0].body.topic, "membership");
  assert.equal(fixture.form.resets, 1);
  const status = descendants(fixture.render()).find((element) => element.props.role === "status");
  assert.equal(status.props.children, topicModel.CONTACT_CONFIRMATIONS.membership);
  assert.match(status.props.children, /reply by email.*next steps.*by invitation/i);
});

test("topic selection is editable and retains ordinary contact functionality", async () => {
  const fixture = formFixture();
  const select = descendants(fixture.render()).find((element) => element.type === "select");
  select.props.onChange({ target: { value: "general" } });
  const textarea = descendants(fixture.render()).find((element) => element.type === "textarea");
  assert.equal(textarea.props.placeholder, "Your question or message.");
  await fixture.submit();
  assert.equal(fixture.fetches[0].body.topic, "general");
  const status = descendants(fixture.render()).find((element) => element.props.role === "status");
  assert.equal(status.props.children, topicModel.CONTACT_CONFIRMATIONS.general);
});

test("failed inquiries retain their context and fields for retry, without claiming receipt", async () => {
  for (const failure of [{ ok: false }, new Error("offline fixture")]) {
    const fixture = formFixture();
    fixture.answers.push(failure);
    await fixture.submit();
    const elements = descendants(fixture.render());
    assert.ok(elements.some((element) => element.props.role === "alert"));
    assert.equal(elements.some((element) => element.props.role === "status"), false);
    assert.equal(elements.find((element) => element.type === "select").props.value, "membership");
    assert.equal(fixture.form.resets, 0);
    await fixture.submit();
    assert.equal(fixture.fetches[0].body.submissionId, fixture.fetches[1].body.submissionId);
    assert.equal(fixture.fetches[1].body.topic, "membership");
    assert.equal(fixture.form.resets, 1);
  }
});

test("editing the topic after a failed send starts a distinct payload rather than reusing its delivery key", async () => {
  const fixture = formFixture();
  fixture.answers.push({ ok: false });
  await fixture.submit();
  const failedForm = fixture.render();
  descendants(failedForm).find((element) => element.type === "select").props.onChange({ target: { value: "general" } });
  failedForm.props.onChange();
  await fixture.submit();
  assert.equal(fixture.fetches[1].body.topic, "general");
  assert.notEqual(fixture.fetches[0].body.submissionId, fixture.fetches[1].body.submissionId);
});

function deliveryFixture() {
  const delivered = [];
  const settings = { RESEND_API_KEY: "mock-only-no-network", RESEND_FROM_EMAIL: "Ruined <connect@example.test>", CONTACT_TO_EMAIL: "connect@example.test" };
  const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const delivery = load("src/lib/communications/resend.ts", {
    "server-only": {},
    "@/lib/communications/general-updates-confirmation-email": {},
    "@/lib/communications/model": { COMMUNICATION_SOURCES: ["store", "artifacts", "about"], normalizeCommunicationEmail: (email) => email.trim().toLowerCase() },
    resend: { Resend: class { emails = { send: async (payload, options) => {
      delivered.push({ payload, options });
      return { data: { id: "mock-only-accepted" }, error: null };
    } }; } },
  });
  const route = load("app/api/contact/route.ts", {
    ...dependencies,
    "node:crypto": { randomUUID },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: (request) => request.headers.get("origin") === "https://ruined.example" },
    "@/lib/communications/resend": delivery,
  });
  const post = (overrides = {}, headers = {}) => route.POST(new Request("https://ruined.example/api/contact", {
    method: "POST",
    headers: { origin: "https://ruined.example", "content-type": "application/json", ...headers },
    body: JSON.stringify({ name: "Test Person", email: "TEST@EXAMPLE.TEST", message: "I would like to know more about joining Ruined.", submissionId: "test-inquiry-request-1234", ...overrides }),
  }));
  const close = () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  return { post, delivered, close };
}

test("the real contact handler delivers the validated topic to the mocked email provider", async () => {
  const fixture = deliveryFixture();
  try {
    assert.equal((await fixture.post({ topic: "membership" })).status, 200);
    const { payload, options } = fixture.delivered[0];
    assert.equal(payload.subject, "Membership inquiry");
    assert.match(payload.text, /Topic: Membership/);
    assert.match(payload.text, /I would like to know more about joining Ruined\./);
    assert.equal(payload.replyTo, "test@example.test");
    assert.equal(payload.to, "connect@example.test");
    assert.equal(options.idempotencyKey, "contact-test-inquiry-request-1234");
    assert.equal((await fixture.post()).status, 200);
    assert.equal(fixture.delivered[1].payload.subject, "New contact message");
    assert.match(fixture.delivered[1].payload.text, /Topic: General question/);
  } finally { fixture.close(); }
});

test("invalid topics, untrusted requests, and honeypots cannot trigger inquiry delivery", async () => {
  const fixture = deliveryFixture();
  try {
    for (const topic of [null, "operator", "membership\r\nBcc: stranger@example.test", ["membership"], {}, 2]) {
      assert.equal((await fixture.post({ topic })).status, 400);
    }
    assert.equal((await fixture.post({ topic: "membership" }, { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await fixture.post({ topic: "membership", company: "bot filled this field" })).status, 200);
    assert.equal((await fixture.post({ topic: "membership", message: "too short" })).status, 400);
    assert.equal((await fixture.post({ topic: "membership", email: "invalid" })).status, 400);
    assert.equal(fixture.delivered.length, 0);
  } finally { fixture.close(); }
});
