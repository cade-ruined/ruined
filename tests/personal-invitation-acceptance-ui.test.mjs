import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, property) => property }) };
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

const descendants = element => React.isValidElement(element) ? [element, ...React.Children.toArray(element.props.children).flatMap(descendants)] : [];
const text = element => typeof element === "string" || typeof element === "number" ? String(element) : React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join("") : "";
const input = (tree, name) => descendants(tree).find(element => element.type === "input" && element.props.name === name);
const button = (tree, label) => descendants(tree).find(element => element.type === "button" && text(element).startsWith(label));
const form = tree => descendants(tree).find(element => element.type === "form");
const event = { preventDefault() {} };
const token = "P".repeat(43);
const start = Date.parse("2026-09-20T00:00:00.000Z");
const expiryAt = new Date(start + 48 * 60 * 60 * 1000).toISOString();

async function harness(options = {}) {
  const slots = [], calls = [], redirects = [], effects = [];
  const timers = new Map(); let cursor = 0, clock = start, timerId = 0;
  class Clock extends Date { static now() { return clock; } }
  const expiry = await load("src/lib/membership/invitation-expiry.ts", {}, { Date: Clock });
  const hooks = { ...React,
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial; return [slots[id], value => { slots[id] = typeof value === "function" ? value(slots[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(callback, dependencies) {
      const id = cursor++, previous = slots[id];
      if (!previous || dependencies.some((value, index) => value !== previous.dependencies[index])) effects.push(() => { previous?.cleanup?.(); slots[id] = { dependencies, cleanup: callback() }; });
    },
  };
  const component = await load("src/components/membership/PersonalInvitationAcceptance.tsx", {
    react: hooks, "@/lib/membership/invitation-expiry": expiry,
    "@/lib/membership/personal-invitation-presentation": await load("src/lib/membership/personal-invitation-presentation.ts"),
    "./use-invitation-expiry": { useInvitationExpired: value => expiry.memberInvitationExpired(value) },
  }, {
    Date: Clock,
    window: { location: { assign: value => redirects.push(value) }, setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id) },
    fetch: async (url, init) => {
      const call = { url, method: init.method, body: JSON.parse(init.body) }; calls.push(call);
      return options.fetch ? options.fetch(call) : { ok: true, json: async () => url.endsWith("/request") ? { ok: true, requestId: "opaque-reference" } : { ok: true, redirectTo: "/my/join" } };
    },
  });
  const props = { invitationToken: token, recipientName: "Alex <Rivera>", inviterName: "Cade", expiresAt: expiryAt, ...options.props };
  const render = () => { cursor = 0; const tree = component.default(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const advance = milliseconds => { clock += milliseconds; const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); };
  return { render, calls, redirects, advance };
}

test("personal invitation accepts the entered email and verifies its code with the same opaque token", async () => {
  const ui = await harness();
  const initial = ui.render();
  assert.match(renderToStaticMarkup(initial), /Alex &lt;Rivera&gt;/);
  assert.match(text(initial), /approval to join/);
  assert.equal(input(initial, "email").props.value, "", "never put the recipient's stored email on a public page");
  assert.equal(input(initial, "email").props.autoComplete, "email");
  input(initial, "email").props.onChange({ target: { value: "  Alex@Example.test  " } });
  await form(ui.render()).props.onSubmit(event);
  assert.deepEqual(ui.calls, [{ url: "/api/auth/otp/request", method: "POST", body: { email: "alex@example.test", invitationToken: token } }]);
  const verification = ui.render();
  assert.match(text(verification), /If it matches this invitation, check your inbox/);
  assert.match(text(verification), /confirmation link instead, follow it/);
  assert.equal(verification.props.id, "accept-invitation");
  const code = input(verification, "token");
  assert.equal(code.props.autoComplete, "one-time-code"); assert.equal(code.props.inputMode, "numeric");
  code.props.onChange({ target: { value: "123 456" } });
  await form(ui.render()).props.onSubmit(event);
  assert.deepEqual(ui.calls[1], { url: "/api/auth/otp/verify", method: "POST", body: { email: "alex@example.test", token: "123456", invitationToken: token } });
  assert.deepEqual(ui.redirects, ["/my/join"]);
  assert.doesNotMatch(JSON.stringify(ui.calls), /recipientName|inviterName|returnTo/);
});

test("complimentary acceptance explains ongoing or limited membership separately from the invitation deadline", async () => {
  const ongoing = await harness({ props: { membershipType: "complimentary" } });
  assert.match(text(ongoing.render()), /No payment is needed. Your complimentary membership is ongoing/);
  assert.match(text(ongoing.render()), /complete your profile and accept the membership agreement/);
  assert.match(text(ongoing.render()), /Accept by/);
  const complimentaryEndsAt = "2027-01-01T06:59:59.999Z";
  const limited = await harness({ props: { membershipType: "complimentary", complimentaryEndsAt } });
  assert.match(text(limited.render()), /Dec 31, 2026, 11:59 PM MST/);
  assert.deepEqual(descendants(limited.render()).filter(element => element.type === "time").map(element => element.props.dateTime), [complimentaryEndsAt, expiryAt]);
  const standard = await harness();
  assert.doesNotMatch(text(standard.render()), /Complimentary membership|No payment is needed/);
  assert.equal(ongoing.calls.length + limited.calls.length + standard.calls.length, 0);
});

test("resending observes a real 60-second cooldown and keeps the invitation's deadline", async () => {
  const ui = await harness();
  input(ui.render(), "email").props.onChange({ target: { value: "alex@example.test" } });
  await form(ui.render()).props.onSubmit(event);
  const resend = button(ui.render(), "Send again in 60s");
  assert.equal(resend.props.disabled, true);
  await resend.props.onClick();
  assert.equal(ui.calls.length, 1);
  ui.advance(60_000);
  const available = button(ui.render(), "Send a new code"); assert.equal(available.props.disabled, false);
  await available.props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.calls.length, 2); assert.deepEqual(ui.calls[1].body, ui.calls[0].body);
  assert.equal(descendants(ui.render()).find(element => element.type === "time").props.dateTime, expiryAt);
});

test("preview, missing tokens, and expired invitations cannot request or verify codes", async () => {
  for (const props of [{ preview: true }, { invitationToken: undefined }, { expiresAt: "2000-01-01T00:00:00Z" }]) {
    const ui = await harness({ props }), tree = ui.render();
    assert.equal(button(tree, "Accept invitation").props.disabled, true);
    await form(tree).props.onSubmit(event);
    assert.equal(ui.calls.length, 0);
  }
  for (const action of ["verify", "resend"]) {
    const ui = await harness({ props: { expiresAt: new Date(start + 30_000).toISOString() } });
    input(ui.render(), "email").props.onChange({ target: { value: "alex@example.test" } });
    await form(ui.render()).props.onSubmit(event);
    const stale = ui.render();
    ui.advance(60_000);
    if (action === "verify") await form(stale).props.onSubmit(event); else await button(stale, "Send again").props.onClick();
    assert.equal(ui.calls.length, 1, "recheck expiry at submission even if a sleeping tab still shows enabled controls");
    assert.match(text(ui.render()), /This invitation has expired/);
  }
});

test("changing an email clears its code without bypassing the resend cooldown", async () => {
  const ui = await harness();
  input(ui.render(), "email").props.onChange({ target: { value: "typo@example.test" } });
  await form(ui.render()).props.onSubmit(event);
  input(ui.render(), "token").props.onChange({ target: { value: "123456" } });
  button(ui.render(), "Use another email").props.onClick();
  input(ui.render(), "email").props.onChange({ target: { value: "alex@example.test" } });
  await form(ui.render()).props.onSubmit(event); assert.equal(ui.calls.length, 1);
  ui.advance(60_000);
  await form(ui.render()).props.onSubmit(event);
  assert.equal(ui.calls[1].body.email, "alex@example.test");
  assert.equal(input(ui.render(), "token").props.value, "");
});

test("request and verification failures stay in their respective forms with recoverable errors", async () => {
  for (const failingStage of ["request", "verify"]) {
    const ui = await harness({ fetch: async call => ({ ok: !call.url.endsWith(failingStage), json: async () => ({ error: "This request could not be completed." }) }) });
    input(ui.render(), "email").props.onChange({ target: { value: "alex@example.test" } });
    await form(ui.render()).props.onSubmit(event);
    if (failingStage === "verify") await form(ui.render()).props.onSubmit(event);
    const tree = ui.render();
    assert.match(text(descendants(tree).find(element => element.props.role === "alert")), /could not be completed/);
    assert.ok(input(tree, failingStage === "request" ? "email" : "token"));
    assert.equal(form(tree).props["aria-busy"], false); assert.equal(ui.redirects.length, 0);
  }
});

test("duplicate submissions are ignored during an in-flight request and redirect targets must stay in membership", async () => {
  let resolveRequest;
  const ui = await harness({ fetch: async () => new Promise(resolve => { resolveRequest = resolve; }) });
  input(ui.render(), "email").props.onChange({ target: { value: "alex@example.test" } });
  const first = form(ui.render()).props.onSubmit(event);
  await form(ui.render()).props.onSubmit(event); assert.equal(ui.calls.length, 1);
  resolveRequest({ ok: true, json: async () => ({ ok: true }) }); await first;
  for (const redirectTo of ["https://unrelated.example", "//unrelated.example", "/ops"]) {
    const unsafe = await harness({ fetch: async () => ({ ok: true, json: async () => ({ redirectTo }) }) });
    input(unsafe.render(), "email").props.onChange({ target: { value: "alex@example.test" } });
    await form(unsafe.render()).props.onSubmit(event); await form(unsafe.render()).props.onSubmit(event);
    assert.equal(unsafe.redirects.length, 0); assert.match(text(unsafe.render()), /could not be verified/);
  }
});
