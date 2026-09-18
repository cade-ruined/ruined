import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const formSource = readFileSync(new URL("../src/components/public-members/MembershipWaitlistForm.tsx", import.meta.url), "utf8");
const formOutput = ts.transpileModule(formSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}

function fixture(values = {}) {
  const fields = { name: "Test Person", email: "test@example.test", phone: "+1 555 010 2020", website: "", ...values };
  const slots = [];
  let cursor = 0;
  const fetches = [];
  const answers = [];
  const form = { resets: 0, reset() { this.resets += 1; } };
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "FormData", "fetch", formOutput)((name) => {
    if (name === "react") return {
      ...React,
      useId: () => "waitlist-fixture",
      useRef: (initial) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useState: (initial) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = value; }];
      },
    };
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, property) => property }) };
    throw new Error(`Unexpected waitlist form dependency: ${name}`);
  }, cjsModule, cjsModule.exports, class {
    get(name) { return fields[name] ?? null; }
  }, async (url, options) => {
    fetches.push({ url, options, body: JSON.parse(options.body) });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return await (answer ?? { ok: true, json: async () => ({ ok: true }) });
  });
  const render = () => { cursor = 0; return cjsModule.exports.default(); };
  const submit = () => render().props.onSubmit({ preventDefault() {}, currentTarget: form });
  return { fields, render, submit, fetches, answers, form };
}

test("waitlist submission sends its fields to the membership endpoint and confirms an accepted response", async () => {
  const view = fixture();
  await view.submit();
  assert.equal(view.fetches.length, 1);
  assert.equal(view.fetches[0].url, "/api/members/waitlist");
  assert.equal(view.fetches[0].options.method, "POST");
  assert.equal(view.fetches[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(view.fetches[0].body, view.fields);
  assert.equal(view.form.resets, 1);
  const elements = descendants(view.render());
  assert.ok(elements.find((item) => item.props.role === "status").props.children);
  assert.equal(elements.filter((item) => item.type === "input").length, 0);
  assert.equal(elements.some((item) => item.props.role === "alert"), false);
});

test("phone remains optional and the honeypot is excluded from keyboard navigation", async () => {
  const view = fixture({ phone: "" });
  const elements = descendants(view.render());
  const inputs = elements.filter((item) => item.type === "input");
  assert.equal(inputs.find((item) => item.props.name === "name").props.required, true);
  assert.equal(inputs.find((item) => item.props.name === "email").props.required, true);
  assert.equal(inputs.find((item) => item.props.name === "phone").props.required, undefined);
  assert.equal(inputs.find((item) => item.props.name === "website").props.tabIndex, -1);
  await view.submit();
  assert.equal(view.fetches[0].body.phone, "");
});

test("pending requests disable fields and prevent repeated submissions before a rerender", async () => {
  const view = fixture();
  let resolve;
  view.answers.push(new Promise((done) => { resolve = done; }));
  const initial = view.render();
  const event = { preventDefault() {}, currentTarget: view.form };
  const first = initial.props.onSubmit(event);
  await initial.props.onSubmit(event);
  assert.equal(view.fetches.length, 1);
  const pending = view.render();
  assert.equal(pending.props["aria-busy"], true);
  assert.equal(descendants(pending).find((item) => item.type === "fieldset").props.disabled, true);
  const button = descendants(pending).find((item) => item.type === "button");
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.children[0], "Joining…");
  resolve({ ok: true, json: async () => ({ ok: true }) });
  await first;
  await view.submit();
  assert.equal(view.fetches.length, 1);
});

test("failed or malformed replies preserve details and permit a retry without claiming a saved place", async () => {
  for (const failure of [
    { ok: false, json: async () => ({ error: "Please enter a valid email address." }) },
    { ok: true, json: async () => ({ error: "Please try again." }) },
    { ok: false, json: async () => ({ ok: true }) },
    { ok: true, json: async () => null },
    { ok: true, json: async () => { throw new Error("invalid response"); } },
    new Error("offline"),
  ]) {
    const view = fixture();
    view.answers.push(failure);
    await view.submit();
    assert.equal(view.form.resets, 0);
    const failed = view.render();
    assert.equal(failed.props["aria-busy"], false);
    const elements = descendants(failed);
    const error = elements.find((item) => item.props.role === "alert");
    assert.ok(error.props.children.length > 0);
    assert.equal(elements.find((item) => item.props.role === "status").props.children, false);
    assert.equal(elements.find((item) => item.type === "fieldset").props.disabled, false);
    await view.submit();
    assert.equal(view.fetches.length, 2);
    assert.deepEqual(view.fetches[0].body, view.fetches[1].body);
    assert.equal(view.form.resets, 1);
  }
});
