import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const Link = ({ children, ...props }) => React.createElement("a", props, children);
function load(path, overrides = {}, globals = {}) {
  const loaded = { exports: {} };
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const dependency = name => {
    if (name in overrides) return overrides[name];
    if (name === "next/link") return Link;
    if (name.startsWith("@/components/")) return load(`src/${name.slice(2)}.tsx`, overrides, globals);
    if (name.startsWith("@/lib/")) return load(`src/${name.slice(2)}.ts`, overrides, globals);
    return require(name);
  };
  new Function("require", "module", "exports", ...Object.keys(globals), js)(dependency, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
function hooks() {
  let cursor = 0;
  const values = [], effects = [];
  return {
    effects,
    react: { ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
        return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
      },
      useEffect(effect) {
        const index = cursor++;
        if (!(index in values)) { values[index] = effects.length; effects.push(effect); }
      },
    },
    render(Component, props = {}) { cursor = 0; return Component(props); },
  };
}
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const content = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(content).join("") : typeof node === "string" ? node : "";
const flush = () => new Promise(resolve => setImmediate(resolve));
const endpoint = "/api/my/sms-preferences";
const { MEMBER_COMMUNICATION_NOTICE_VERSION } = load("src/lib/membership/member-communication-preferences-model.ts");
const snapshot = changes => ({ phone: "+12025550123", sms: null, revision: "revision-1", noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION, ...changes });
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const ok = changes => response(200, snapshot(changes));
const event = currentTarget => ({ preventDefault() {}, currentTarget });

async function fixture(initial = ok()) {
  const formHooks = hooks(), authHooks = hooks(), calls = [], queued = [initial], redirects = [], reloads = [];
  const globals = {
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", cache: options.cache, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
      assert.ok(queued.length, `Unexpected request ${options.method || "GET"} ${url}`);
      const result = await queued.shift();
      if (result instanceof Error) throw result;
      return result;
    },
    window: { location: { assign: href => redirects.push(href), reload: () => reloads.push(true) }, setTimeout: () => 1, clearTimeout() {} },
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form[name]; } },
  };
  const Access = load("src/components/platform/PasswordlessAccessForm.tsx", { react: authHooks.react }, globals).default;
  const Form = load("src/components/membership/MemberSmsOptInForm.tsx", {
    react: formHooks.react, "@/components/platform/PasswordlessAccessForm": Access,
  }, globals).default;
  const render = () => formHooks.render(Form);
  const find = predicate => nodes(render()).find(predicate);
  const authNode = () => find(node => node.type === Access);
  const renderAuth = () => { const child = authNode(); assert.ok(child, "Real PasswordlessAccessForm must be mounted"); return authHooks.render(Access, child.props); };
  render();
  for (const effect of formHooks.effects) effect();
  await flush();
  return {
    calls, redirects, reloads, render, authNode, renderAuth,
    queue: (...results) => queued.push(...results),
    input: name => find(node => node.type === "input" && node.props.name === name),
    consent: () => find(node => node.props.name === "sms"),
    button: label => find(node => node.type === "button" && content(node) === label),
    submit: () => find(node => node.type === "form").props.onSubmit(event()),
    changePhone: value => find(node => node.props.name === "phone").props.onChange(event({ value })),
    choose: checked => find(node => node.props.name === "sms").props.onChange(event({ checked })),
    submitAuth: token => nodes(renderAuth()).find(node => node.type === "form").props.onSubmit(event({ token })),
    email: value => nodes(renderAuth()).find(node => node.props.name === "email").props.onChange({ target: { value } }),
    writes: () => calls.filter(call => call.url === endpoint && call.method === "POST"),
    status: () => find(node => node.props.role === "status"),
  };
}

test("authenticated public form reads saved state but always begins with a fresh optional unchecked choice", async () => {
  const f = await fixture(ok({ sms: true }));
  assert.deepEqual(f.calls, [{ url: endpoint, method: "GET", cache: "no-store", headers: undefined, body: null }]);
  assert.equal(f.input("phone").props.value, "+12025550123");
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.consent().props.required, undefined);
  assert.equal(f.button("Save text preference").props.disabled, false);
  assert.match(content(f.render()), /Currently saved: text-message consent recorded/);
  assert.match(content(f.render()), /Your email preferences stay the same/);
  assert.equal(f.input("email"), undefined);
  assert.equal(f.authNode(), undefined);
  assert.equal(f.writes().length, 0);
});

test("explicit opt-in posts the normalized phone and exact consent evidence, never email preferences", async () => {
  const f = await fixture();
  f.changePhone("(202) 555-0124");
  f.choose(true);
  f.queue(ok({ phone: "+12025550124", sms: true, revision: "revision-2" }));
  await f.submit();
  assert.deepEqual(f.writes(), [{ url: endpoint, method: "POST", cache: undefined, headers: { "content-type": "application/json" }, body: {
    phone: "+12025550124", sms: true, expectedRevision: "revision-1", noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION, smsOptIn: { phone: "+12025550124" },
  } }]);
  assert.match(content(f.status()), /Your text-message consent is saved/);
  assert.match(content(f.status()), /Delivery is not currently enabled/);
  assert.equal(f.consent().props.checked, false);
});

test("unchecked submission saves an explicit withdrawal without SMS opt-in evidence", async () => {
  const f = await fixture(ok({ sms: true }));
  f.queue(ok({ sms: false, revision: "revision-2" }));
  await f.submit();
  assert.deepEqual(f.writes()[0].body, {
    phone: "+12025550123", sms: false, expectedRevision: "revision-1", noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION,
  });
  assert.match(content(f.status()), /You are not enrolled in Ruined membership texts/);
});

test("changing a number clears active consent and invalid numbers never reach the API", async () => {
  const f = await fixture();
  f.choose(true);
  f.changePhone("2025550124");
  assert.equal(f.consent().props.checked, false);
  f.queue(ok({ phone: "+12025550124", sms: false }));
  await f.submit();
  assert.equal(f.writes()[0].body.sms, false);
  assert.equal(f.writes()[0].body.smsOptIn, undefined);
  f.changePhone("invalid");
  await f.submit();
  assert.equal(f.writes().length, 1);
  assert.match(content(f.render()), /Enter a valid mobile number/);
  assert.equal(f.status(), undefined);
});

test("signed-out submission opens real email verification and saves nothing until verification plus a second submit", async () => {
  const f = await fixture(response(401, { error: "Sign in required" }));
  assert.equal(f.button("Continue to email verification").props.disabled, false);
  f.changePhone("2025550124");
  f.choose(true);
  await f.submit();
  assert.ok(f.authNode());
  assert.equal(f.writes().length, 0);
  assert.match(content(f.render()), /Your choice has not been saved yet/);
  f.email(" MEMBER@example.com ");
  f.queue(response(200, { ok: true, requestId: "request-local" }));
  await f.submitAuth();
  assert.deepEqual(f.calls.at(-1).body, { email: "member@example.com" });
  assert.equal(f.calls.at(-1).url, "/api/auth/otp/request");
  assert.equal(f.writes().length, 0);
  f.queue(response(200, { redirectTo: "/my" }), ok({ phone: "+12025550123", revision: "verified-revision" }));
  await f.submitAuth("123456");
  assert.deepEqual(f.calls.find(call => call.url === "/api/auth/otp/verify").body, { email: "member@example.com", token: "123456", returnTo: "/my" });
  assert.equal(f.authNode(), undefined);
  assert.equal(f.writes().length, 0, "verification must not replay consent automatically");
  assert.equal(f.status(), undefined);
  assert.equal(f.input("phone").props.value, "2025550124");
  assert.equal(f.consent().props.checked, true);
  assert.deepEqual(f.redirects, []);
  f.queue(ok({ phone: "+12025550124", sms: true }));
  await f.submit();
  assert.equal(f.writes().length, 1);
  assert.equal(f.writes()[0].body.expectedRevision, "verified-revision");
  assert.match(content(f.status()), /consent is saved/);
});

test("a rejected verification never saves the preference or claims enrollment", async () => {
  const f = await fixture(response(401, {}));
  f.changePhone("2025550123"); f.choose(true); await f.submit();
  f.email("member@example.com");
  f.queue(response(200, { ok: true })); await f.submitAuth();
  f.queue(response(400, { error: "That code could not be verified." })); await f.submitAuth("000000");
  assert.match(content(f.renderAuth()), /That code could not be verified/);
  assert.ok(f.authNode());
  assert.equal(f.writes().length, 0);
  assert.equal(f.status(), undefined);
});

test("expired sessions return to verification and never treat a 401 write as a saved preference", async () => {
  const f = await fixture(); f.choose(true);
  f.queue(response(401, { error: "Session expired" })); await f.submit();
  assert.match(content(f.render()), /Your session expired/);
  assert.ok(f.authNode());
  assert.equal(f.status(), undefined);
  await f.submit();
  assert.equal(f.writes().length, 1, "signed-out resubmission must not resend the preference");
});

test("a stale revision refreshes the current number, clears consent, and never replays the rejected choice", async () => {
  const f = await fixture(); f.choose(true);
  f.queue(response(409, { error: "Stale preference" }), ok({ phone: "+12025550125", sms: false, revision: "current-revision" }));
  await f.submit();
  assert.equal(f.writes().length, 1);
  assert.equal(f.calls.at(-1).method, "GET");
  assert.equal(f.input("phone").props.value, "+12025550125");
  assert.equal(f.consent().props.checked, false);
  assert.match(content(f.render()), /Your saved details changed/);
  assert.equal(f.status(), undefined);
  f.choose(true);
  f.queue(ok({ phone: "+12025550125", sms: true })); await f.submit();
  assert.deepEqual(f.writes()[1].body, {
    phone: "+12025550125", sms: true, expectedRevision: "current-revision", noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION, smsOptIn: { phone: "+12025550125" },
  });
});

test("failed writes never report success and release the button for a deliberate retry", async () => {
  for (const failure of [response(500, { error: "The preference could not be stored." }), new Error("Network unavailable")]) {
    const f = await fixture(); f.choose(true); f.queue(failure); await f.submit();
    assert.equal(f.status(), undefined);
    assert.match(content(f.render()), /could not be stored|Network unavailable/);
    assert.equal(f.button("Save text preference").props.disabled, false);
    assert.equal(f.writes().length, 1);
  }
});

test("a failed initial read blocks writes until the visible retry obtains current state", async () => {
  const f = await fixture(response(503, { error: "Unavailable" }));
  assert.match(content(f.render()), /Your text preference could not be loaded/);
  const submit = nodes(f.render()).find(node => node.props.type === "submit");
  assert.equal(submit.props.disabled, true);
  f.changePhone("2025550123"); f.choose(true); await f.submit();
  assert.equal(f.writes().length, 0);
  f.queue(ok({ sms: true, revision: "retry-revision" }));
  await f.button("Try again").props.onClick();
  assert.equal(f.button("Save text preference").props.disabled, false);
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.status(), undefined);
});

test("a pending save disables all preference controls and prevents duplicate submission", async () => {
  const f = await fixture(); f.choose(true);
  let resolve;
  f.queue(new Promise(done => { resolve = done; }));
  const saving = f.submit();
  assert.equal(f.button("Saving…").props.disabled, true);
  assert.equal(f.input("phone").props.disabled, true);
  assert.equal(f.consent().props.disabled, true);
  await f.submit();
  assert.equal(f.writes().length, 1);
  resolve(ok({ sms: true })); await saving;
  assert.match(content(f.status()), /consent is saved/);
  assert.equal(f.button("Save text preference").props.disabled, false);
});


test("a server notice version different from the rendered disclosure blocks submission until the page reloads", async () => {
  for (const noticeVersion of ["membership-reminders-future", "membership-reminders-old", undefined]) {
    const f = await fixture(ok({ noticeVersion }));
    assert.equal(nodes(f.render()).find(node => node.props.type === "submit").props.disabled, true);
    assert.equal(f.consent().props.checked, false);
    assert.match(content(f.render()), /Reload this page/);
    assert.ok(f.button("Reload page"));
    await f.submit();
    assert.equal(f.writes().length, 0, "the client must never adopt a server version it did not display");
    assert.equal(f.status(), undefined);
    await f.button("Reload page").props.onClick();
    assert.deepEqual(f.reloads, [true]);
    assert.equal(f.calls.length, 1, "reload must reload the disclosure, not merely fetch a newer version");
  }
});

test("a 409 refresh with a changed notice blocks stale disclosure consent without replaying it", async () => {
  const f = await fixture(); f.choose(true);
  f.queue(response(409, { error: "The text-message notice has changed." }), ok({ noticeVersion: "membership-reminders-future", revision: "future-notice-revision" }));
  await f.submit();
  assert.equal(f.writes().length, 1);
  assert.equal(f.writes()[0].body.noticeVersion, MEMBER_COMMUNICATION_NOTICE_VERSION);
  assert.equal(f.calls.at(-1).method, "GET");
  assert.equal(f.consent().props.checked, false);
  assert.equal(nodes(f.render()).find(node => node.props.type === "submit").props.disabled, true);
  assert.match(content(f.render()), /Reload this page/);
  assert.ok(f.button("Reload page"));
  assert.equal(f.status(), undefined);
  await f.submit();
  assert.equal(f.writes().length, 1, "a new server version cannot enable the old disclosure to be saved");
  await f.button("Reload page").props.onClick();
  assert.deepEqual(f.reloads, [true]);
});
