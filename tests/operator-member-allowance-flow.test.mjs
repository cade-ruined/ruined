import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const signInUrl = "https://members.theruinedproject.com/access";
const email = "new.member@example.com";
const otherEmail = "another.member@example.com";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return React;
    if (name === "@/components/platform/OperatorDialog") return { __esModule: true, default: ({ children }) => children };
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "next/navigation") return { useRouter: () => ({ refresh() { throw new Error("Allowance UI must not refresh or claim identity"); } }) };
    if (name === "@/components/platform/operatorStyles") return new Proxy({}, { get: () => "control" });
    throw new Error(`Unexpected allowance-flow dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
function nodes(node) {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node !== "object") return String(node);
  if (typeof node.type === "function") return text(node.type(node.props));
  return text(node.props?.children);
}
function fixture(preview = false) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(callback) { effects[effectCursor++] = callback; },
  };
  const Component = load("src/components/platform/OpsActions.tsx", { react: hooks }).OpsInvitationActions;
  const draw = () => { cursor = 0; effectCursor = 0; return Component({ preview }); };
  const find = (predicate) => nodes(draw()).find(predicate);
  const button = (label) => { const node = find((node) => node.type === "button" && text(node) === label); assert.ok(node, `Missing button: ${label}`); return node; };
  const input = () => find((node) => node.props?.id === "ops-invitation-email");
  const change = (value) => input().props.onChange({ currentTarget: { value } });
  const submit = (value = input().props.value) => find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields: { email: value } } });
  draw();
  return { draw, find, button, input, change, submit, effects };
}
function requests(t, handler = ({ body, method }) => method === "DELETE"
  ? Response.json({ revocation: { email: JSON.parse(body).email, revoked: 1 } })
  : success(JSON.parse(body).email)) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { const call = { url, ...options }; calls.push(call); return handler(call); });
  t.mock.method(globalThis, "FormData", function (form) { return { get: (key) => form.fields[key] ?? null }; });
  return calls;
}
function success(value = email, extras = {}) {
  return Response.json({ invitation: { email: value, expiresAt: new Date(Date.now() + 604_800_000).toISOString(), reissued: false, ...extras } }, { status: 201 });
}
function clipboard(t, writeText) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: writeText ? { clipboard: { writeText } } : {} });
  t.after(() => descriptor ? Object.defineProperty(globalThis, "navigator", descriptor) : delete globalThis.navigator);
}

test("Add member shows two visible steps, one primary action, and no premature share or destructive submit", () => {
  const f = fixture();
  const tree = f.draw();
  assert.deepEqual(nodes(tree).filter((n) => n.type === "h3").map(text), ["1. Allow email to join", "2. Share sign-in instructions"]);
  assert.equal(nodes(tree).some((n) => n.type === "h2" || n.type === "details"), false);
  const form = nodes(tree).find((n) => n.type === "form");
  assert.deepEqual(nodes(form).filter((n) => n.type === "button").map(text), ["Add member"]);
  assert.equal(f.button("Add member").props.disabled, false);
  assert.equal(f.button("Remove a pending allowance").props.type, "button");
  assert.equal(f.find((n) => n.props?.id === "member-share-message"), undefined);
  assert.match(text(tree), /does not send a message/);
  assert.match(text(tree), /Allow their email first/);
});

test("untouched live and preview Add dialogs are clean, but changing the email requests discard confirmation", () => {
  for (const preview of [false, true]) {
    const f = fixture(preview);
    const marker = () => f.find((node) => node.props?.["aria-label"] === "Add member steps");
    assert.equal(marker().props["data-operator-dirty"], undefined);
    assert.equal(marker().props["data-operator-pending"], undefined);
    f.change(email);
    assert.equal(marker().props["data-operator-dirty"], "true");
  }
});

test("confirmed allowance identifies exact email/expiry and gives explicit operator/member next steps without sending", async (t) => {
  const calls = requests(t);
  const f = fixture();
  f.change(`  ${email.toUpperCase()}  `);
  await f.submit();
  assert.equal(calls.length, 1);
  assert.deepEqual({ url: calls[0].url, method: calls[0].method, body: JSON.parse(calls[0].body) }, { url: "/api/ops/invitations", method: "POST", body: { email } });
  assert.equal(f.input().props.value, email);
  assert.match(text(f.draw()), new RegExp(`Email allowed for ${email}`));
  assert.match(text(f.draw()), /No email was sent/);
  assert.match(text(f.draw()), /They request their own code.*profile, agreement, and payment.*Then you place them in a Circle/);
  const expiration = f.find((n) => n.type === "time");
  assert.ok(Date.parse(expiration.props.dateTime) > Date.now());
  assert.equal(f.button("Copy message").props.disabled, false);
  const message = f.find((n) => n.props?.id === "member-share-message");
  assert.equal(message.props.readOnly, true);
  assert.match(message.props.value, /Request your own email code/);
  assert.ok(message.props.value.includes(email) && message.props.value.includes(signInUrl));
  assert.equal(f.find((n) => n.props?.id === "member-share-link").props.value, signInUrl);
  assert.ok(nodes(f.draw()).some((n) => n.props?.role === "status" && /No email was sent/.test(text(n))));
});

test("a renewed allowance is not described as a new account or sent invitation", async (t) => {
  requests(t, () => success(email, { reissued: true }));
  const f = fixture();
  await f.submit(email);
  assert.match(text(f.draw()), /Allowance renewed/);
  assert.doesNotMatch(text(f.draw()), /Account created|Invitation sent|Email sent/);
});

test("transport, conflict, malformed and expired results keep input but never unlock sharing", async (t) => {
  const badResults = [
    () => Response.json({ error: "That member already has active access." }, { status: 409 }),
    () => { throw new Error("Network unavailable"); },
    () => Response.json({ invitation: null }),
    () => success(otherEmail),
    () => success(email, { expiresAt: "not-a-date" }),
    () => success(email, { expiresAt: new Date(Date.now() - 1000).toISOString() }),
    () => success(email, { reissued: "yes" }),
  ];
  let respond;
  const calls = requests(t, () => respond());
  for (respond of badResults) {
    const f = fixture();
    await f.submit(email);
    assert.equal(f.input().props.value, email);
    assert.equal(f.find((n) => n.props?.id === "member-share-message"), undefined);
    assert.equal(f.button("Add member").props.disabled, false);
    assert.ok(nodes(f.draw()).some((n) => n.props?.role === "alert"));
  }
  assert.equal(calls.length, badResults.length);
});

test("rapid submits post once, and changing email discards late results without overwriting current context", async (t) => {
  const first = deferred();
  const second = deferred();
  const calls = requests(t, (call) => JSON.parse(call.body).email === email ? first.promise : second.promise);
  const f = fixture();
  const pending = f.submit(email);
  await f.submit(email);
  assert.equal(calls.length, 1);
  assert.equal(f.input().props.disabled, true);
  f.change(otherEmail); // A stale native handler must also be safe if invoked directly.
  const current = f.submit();
  second.resolve(success(otherEmail));
  await current;
  first.resolve(success(email));
  await pending;
  assert.equal(calls.length, 2);
  assert.equal(f.input().props.value, otherEmail);
  assert.equal(f.find((n) => n.props?.id === "member-share-message").props.value.includes(email), false);
  assert.match(text(f.draw()), new RegExp(`Email allowed for ${otherEmail}`));
});

test("unmounted UI cannot display a late allowance response", async (t) => {
  const response = deferred();
  requests(t, () => response.promise);
  const f = fixture();
  const unmount = f.effects[0]();
  const pending = f.submit(email);
  unmount();
  response.resolve(success());
  await pending;
  assert.equal(f.find((n) => n.props?.id === "member-share-message"), undefined);
});

test("clipboard message/link are explicit actions with accessible confirmation and never send another request", async (t) => {
  const calls = requests(t);
  const copied = [];
  clipboard(t, async (value) => copied.push(value));
  const f = fixture();
  await f.submit(email);
  f.button("Copy message").props.onClick();
  await tick();
  assert.equal(copied[0], f.find((n) => n.props?.id === "member-share-message").props.value);
  assert.ok(nodes(f.draw()).some((n) => n.props?.role === "status" && /Message copied/.test(text(n))));
  f.button("Copy link").props.onClick();
  await tick();
  assert.equal(copied[1], signInUrl);
  assert.match(text(f.draw()), /Paste it into your own email or chat/);
  assert.match(text(f.draw()), /Nothing was sent automatically/);
  assert.equal(calls.length, 1);
});

test("blocked or missing clipboard leaves selectable labeled fields and focuses the manual fallback", async (t) => {
  requests(t);
  const f = fixture();
  await f.submit(email);
  let focused = 0;
  let selected = 0;
  const field = f.find((n) => n.props?.id === "member-share-message");
  field.props.ref.current = { focus() { focused++; }, select() { selected++; } };
  clipboard(t, async () => { throw new Error("Clipboard permission denied"); });
  f.button("Copy message").props.onClick();
  await tick();
  assert.equal(focused, 1);
  assert.equal(selected, 1);
  assert.ok(nodes(f.draw()).some((n) => n.props?.role === "alert" && /copy it manually/.test(text(n))));
  assert.equal(f.find((n) => n.props?.id === "member-share-message").props.readOnly, true);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  f.button("Copy link").props.onClick();
  await tick();
  assert.match(text(f.draw()), /Select the link below/);
  assert.equal(f.button("Copy message").props.disabled, false);
});

test("rapid clipboard clicks copy once and an old completion cannot claim the newly entered email was copied", async (t) => {
  requests(t);
  const done = deferred();
  const copied = [];
  clipboard(t, async (value) => { copied.push(value); await done.promise; });
  const f = fixture();
  await f.submit(email);
  const handler = f.button("Copy message").props.onClick;
  handler(); handler();
  assert.equal(copied.length, 1);
  f.change(otherEmail);
  handler();
  assert.equal(copied.length, 1, "A stale copy handler cannot act for a previous allowance");
  done.resolve();
  await tick();
  assert.doesNotMatch(text(f.draw()), /Message copied/);
  assert.equal(f.input().props.value, otherEmail);
});

test("expired allowance has no active sharing or invitation message, including an old copy handler", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  requests(t);
  const copied = [];
  clipboard(t, async (value) => copied.push(value));
  const f = fixture();
  await f.submit(email);
  const copy = f.button("Copy message").props.onClick;
  now += 604_800_001;
  assert.equal(f.button("Copy message").props.disabled, true);
  assert.equal(f.find((n) => n.props?.id === "member-share-message"), undefined);
  assert.match(text(f.draw()), /Joining allowance expired/);
  copy();
  await tick();
  assert.equal(copied.length, 0);
  assert.match(text(f.draw()), /Allow this email again before sharing/);
});

test("removal is separately confirmed for the exact email and cancel/edit invalidates stale confirmation", async (t) => {
  const calls = requests(t);
  const f = fixture();
  await f.submit(email);
  f.button("Remove a pending allowance").props.onClick();
  assert.equal(calls.length, 1);
  assert.match(text(f.draw()), /does not delete a member account, end a membership, or change operator access/);
  const oldConfirm = f.button("Confirm removal").props.onClick;
  f.button("Keep allowance").props.onClick();
  oldConfirm(); await tick();
  assert.equal(calls.length, 1);
  f.button("Remove a pending allowance").props.onClick();
  const staleConfirm = f.button("Confirm removal").props.onClick;
  f.change(otherEmail);
  staleConfirm(); await tick();
  assert.equal(calls.length, 1);
  f.change(email);
  f.button("Remove a pending allowance").props.onClick();
  f.button("Confirm removal").props.onClick();
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual({ method: calls[1].method, body: JSON.parse(calls[1].body) }, { method: "DELETE", body: { email } });
  assert.match(text(f.draw()), /Pending allowance removed.*No member account was deleted/);
  assert.equal(f.input().props.value, email);
});

test("ambiguous or failed removal keeps exact review/input and blocks old sharing until the allowance is reconfirmed", async (t) => {
  let fail = true;
  const calls = requests(t, (call) => call.method === "DELETE"
    ? (fail ? Response.json({ error: "The invitation could not be revoked." }, { status: 503 }) : Response.json({ revocation: { email: otherEmail, revoked: 1 } }))
    : success());
  const f = fixture();
  await f.submit(email);
  f.button("Remove a pending allowance").props.onClick();
  const remove = f.button("Confirm removal").props.onClick;
  remove(); remove();
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(f.input().props.value, email);
  assert.ok(f.find((n) => n.props?.["aria-label"] === "Confirm pending allowance removal"));
  assert.equal(f.button("Copy message").props.disabled, true);
  assert.equal(f.find((n) => n.props?.id === "member-share-message"), undefined);
  assert.match(text(f.draw()), /Check this allowance before sharing/);
  fail = false;
  f.button("Confirm removal").props.onClick(); await tick();
  assert.match(text(f.draw()), /removal could not be confirmed/);
  f.button("Keep allowance").props.onClick();
  await f.submit(email);
  assert.equal(f.button("Copy message").props.disabled, false);
});

test("zero removed allowances never claims an invitation was revoked or an account was deleted", async (t) => {
  requests(t, () => Response.json({ revocation: { email, revoked: 0 } }));
  const f = fixture();
  f.change(email);
  f.button("Remove a pending allowance").props.onClick();
  f.button("Confirm removal").props.onClick(); await tick();
  assert.match(text(f.draw()), /No pending allowance was found/);
  assert.doesNotMatch(text(f.draw()), /Pending allowance removed|live invitations revoked/);
  assert.match(text(f.draw()), /Existing member accounts are unchanged/);
});

test("preview demonstrates both steps and removal using sample identity without submitted-identity reads or fetch", async (t) => {
  const calls = requests(t, () => { throw new Error("Preview cannot call any API"); });
  const f = fixture(true);
  assert.equal(f.input().props.readOnly, true);
  assert.equal(f.button("Add member").props.disabled, false);
  const form = f.find((n) => n.type === "form");
  await form.props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Do not read a submitted preview identity"); } });
  assert.match(text(f.draw()), /Preview — sample only/);
  assert.match(text(f.draw()), /Sample email allowed. No data changed/);
  assert.match(f.find((n) => n.props?.id === "member-share-message").props.value, /^PREVIEW — SAMPLE ONLY/);
  assert.equal(f.button("Copy message").props.disabled, false);
  f.button("Remove a pending allowance").props.onClick();
  f.button("Confirm removal").props.onClick(); await tick();
  assert.match(text(f.draw()), /Sample allowance removed. No data changed/);
  assert.equal(calls.length, 0);
});

test("Members page keeps the compatible Add member anchor and exact Administrator/preview guards without changing directory inputs", async () => {
  const directory = { members: [], filter: "all", page: 1, pageCount: 1, pageSize: 25, query: "", totalResults: 0 };
  const context = { state: "ready", role: "ops_admin", viewer: { authUserId: "admin" }, dashboard: { members: [] } };
  const calls = [];
  const Page = load("app/ops/members/page.tsx", {
    "next/navigation": { redirect: (path) => { throw new Error(`redirect:${path}`); } },
    "@/components/platform/OperatorMemberInvitations": { __esModule: true, default: (props) => React.createElement("div", { "data-allowance": true, "data-preview": props.preview }) },
    "@/lib/platform/ops-member-invitation-repository": { getPendingMemberInvitations: async () => ({ entries: [], query: "", page: 1, pageCount: 1, totalResults: 0 }) },
    "@/components/platform/OperatorMemberDirectory": { __esModule: true, default: () => React.createElement("div", { "data-directory": true }) },
    "@/components/platform/OperatorPeopleWorkspace": { __esModule: true, default: ({ children, pendingJoining }) => React.createElement("div", { "data-people-workspace": true }, children, pendingJoining) },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: ({ children }) => React.createElement("main", null, children) },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: () => React.createElement("p", null, "Unavailable") },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => context },
    "@/lib/platform/repository": { getOperatorMemberDirectoryPage: async (...input) => { calls.push(input); return directory; } },
  }).default;
  const render = () => Page({ searchParams: Promise.resolve({ q: "name", page: "2", filter: "unassigned" }) });
  const admin = nodes(await render());
  assert.ok(admin.some((n) => n.props?.["data-people-workspace"]));
  assert.ok(admin.some((n) => n.props?.["data-allowance"]));
  assert.match(source("src/components/platform/OperatorPeopleWorkspace.tsx"), /id="allow-member-email"/);
  assert.deepEqual(calls[0], ["admin", { query: "name", page: 2, filter: "unassigned" }]);
  context.role = "circle_leader";
  assert.equal(nodes(await render()).some((n) => n.props?.["data-allowance"]), false);
  context.role = "ops_admin";
  context.state = "preview";
  context.viewer = null;
  const before = calls.length;
  assert.equal(nodes(await render()).find((n) => n.props?.["data-allowance"]).props["data-preview"], true);
  assert.equal(calls.length, before);
});
