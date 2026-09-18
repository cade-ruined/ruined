import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "a" };
    throw new Error(`Unexpected deletion UI dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  return typeof node === "object" ? text(node.props?.children) : String(node);
}
function fixture(props = {}) {
  const slots = [];
  const effects = [];
  let pendingEffects = [];
  const replacements = [];
  let cursor = 0;
  let refreshes = 0;
  let resets = 0;
  let focuses = 0;
  const hooks = {
    ...React,
    useId: () => "delete-panel",
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { dependencies, cleanup: effect() };
        });
      }
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
  const Component = load("src/components/platform/OperatorMemberDeleteAction.tsx", {
    react: hooks,
    "next/navigation": { useRouter: () => ({ replace: (href) => replacements.push(href), refresh() { refreshes++; } }) },
    "@/components/platform/operatorStyles": {},
  }).default;
  const draw = () => {
    cursor = 0;
    pendingEffects = [];
    const result = Component({ memberId: "member-one", ...props });
    for (const node of nodes(result)) {
      if (node.props?.ref && node.type === "form") node.props.ref.current = { reset() { resets++; } };
      if (node.props?.ref && node.type === "button") node.props.ref.current = { focus() { focuses++; } };
    }
    pendingEffects.forEach((effect) => effect());
    return result;
  };
  const button = (label) => {
    const match = nodes(draw()).find((node) => node.type === "button" && text(node) === label);
    assert.ok(match, `button ${label} exists`);
    return match;
  };
  const field = (name) => {
    const match = nodes(draw()).find((node) => node.props?.name === name);
    assert.ok(match, `field ${name} exists`);
    return match;
  };
  const submit = () => {
    const form = nodes(draw()).find((node) => node.type === "form");
    assert.ok(form);
    return form.props.onSubmit({ preventDefault() {} });
  };
  return {
    draw, button, field, submit, replacements,
    refreshes: () => refreshes, resets: () => resets, focuses: () => focuses,
    unmount: () => effects.forEach((effect) => effect?.cleanup?.()),
  };
}
const eligible = (patch = {}) => ({ allowed: true, blockers: [], confirmationEmail: "Member@ruined.test", memberName: "Example Member", lifecycleVersion: 7, ...patch });
function requestsFor(t, handler = () => Response.json({ deletion: eligible() })) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const item = { url, ...options };
    requests.push(item);
    return handler(item, requests.length);
  });
  return requests;
}
async function open(f) { await f.button("Delete member").props.onClick(); }
function confirm(f, email = "  MEMBER@ruined.test  ", reason = "test_account") {
  f.field("reason").props.onChange({ target: { value: reason } });
  f.field("confirmationEmail").props.onChange({ target: { value: email } });
  f.submit();
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("record exposes deletion only to member override administrators and carries preview scope", () => {
  const empty = { __esModule: true, default: () => null };
  const dependencies = {
    "@/lib/platform/operator-return-location": load("src/lib/platform/operator-return-location.ts"),
    "@/lib/platform/operator-member-guidance": load("src/lib/platform/operator-member-guidance.ts"),
    "@/components/platform/OperatorMemberActions": { OperatorNoteAction: () => null, OperatorTaskCreateAction: () => null, OperatorOverrideAction: () => null },
  };
  for (const name of ["OperatorPageFrame", "OperatorMemberSetup", "OperatorProfileSupport", "OperatorProgress", "OperatorMemberAvatar", "OperatorMemberReferrals", "OperatorMemberWorkspace", "StateLabel"]) {
    dependencies[`@/components/platform/${name}`] = empty;
  }
  const DeleteAction = () => null;
  dependencies["@/components/platform/OperatorMemberDeleteAction"] = { __esModule: true, default: DeleteAction };
  const Record = load("src/components/platform/OperatorMemberRecord.tsx", dependencies).default;
  const record = load("src/lib/platform/ops-preview.ts").getPreviewOpsMemberRecord("preview-01");
  for (const capabilities of [[], ["task.manage", "member.note.write"], ["member.override.write"]]) {
    const next = { ...record, access: { ...record.access, capabilities } };
    const actions = nodes(Record({ record: next, preview: true })).filter((node) => node.type === DeleteAction);
    assert.equal(actions.length, capabilities.includes("member.override.write") ? 1 : 0);
    if (actions.length) assert.deepEqual({ memberId: actions[0].props.memberId, preview: actions[0].props.preview }, { memberId: record.header.memberId, preview: true });
  }
});

test("eligibility is requested only on open, and preview never makes a request", async (t) => {
  const requests = requestsFor(t);
  const f = fixture();
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  assert.equal(requests.length, 0);
  await open(f);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/ops/members/member-one/deletion");
  assert.equal(requests[0].cache, "no-store");
  assert.equal(requests[0].method, undefined);
  assert.match(text(f.draw()), /does not cancel billing/);
  assert.match(text(f.draw()), /Membership, financial and audit history are retained/);
  assert.doesNotMatch(text(f.draw()), /test or duplicate accounts only/);
  const preview = fixture({ preview: true });
  await open(preview);
  assert.equal(requests.length, 1);
  assert.match(text(preview.draw()), /Preview only/);
  assert.equal(nodes(preview.draw()).some((node) => node.type === "form"), false);
});

test("server blockers are readable and contradictory eligibility fails closed", async (t) => {
  requestsFor(t, () => Response.json({ deletion: eligible({ blockers: ["Close the member account first.", "A billing subscription is still active."] }) }));
  const f = fixture();
  await open(f);
  assert.match(text(f.draw()), /Close the member account first/);
  assert.match(text(f.draw()), /billing subscription is still active/);
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  assert.ok(f.button("Check eligibility again"));
});

test("typed confirmation and a valid reason are required; review and Enter never delete", async (t) => {
  const requests = requestsFor(t);
  const f = fixture();
  await open(f);
  assert.equal(f.button("Review deletion").props.disabled, true);
  confirm(f, "someone-else@ruined.test");
  assert.match(text(f.draw()), /type the member’s email exactly/);
  confirm(f, "MEMBER@ruined.test", "");
  assert.equal(nodes(f.draw()).some((node) => node.props?.["aria-label"] === "Review member deletion"), false);
  confirm(f, "MEMBER@ruined.test", "forged_reason");
  assert.equal(nodes(f.draw()).some((node) => node.props?.["aria-label"] === "Review member deletion"), false);
  confirm(f);
  assert.equal(f.button("Permanently delete member").props.type, "button");
  f.submit();
  f.submit();
  assert.equal(requests.length, 1);
  assert.equal(f.draw().props["data-operator-dirty"], "true");
});

test("editing confirmation invalidates even a previously captured final action", async (t) => {
  const requests = requestsFor(t);
  const f = fixture();
  await open(f);
  confirm(f);
  const finalAction = f.button("Permanently delete member").props.onClick;
  f.field("confirmationEmail").props.onChange({ target: { value: "different@ruined.test" } });
  await finalAction();
  assert.equal(requests.length, 1);
  assert.equal(nodes(f.draw()).some((node) => node.props?.["aria-label"] === "Review member deletion"), false);
  confirm(f);
  const nextAction = f.button("Permanently delete member").props.onClick;
  f.field("reason").props.onChange({ target: { value: "duplicate_account" } });
  await nextAction();
  assert.equal(requests.length, 1);
});

test("ordinary closed-account removals and member requests have explicit reviewed reasons", async (t) => {
  const requests = requestsFor(t, request => request.method === "DELETE" ? Response.json({ deleted: true }) : Response.json({ deletion: eligible() }));
  for (const [reason, label] of [["account_removal", "Account removal"], ["member_request", "Member request"]]) {
    const f = fixture();
    await open(f);
    confirm(f, "member@ruined.test", reason);
    assert.match(text(f.draw()), new RegExp(`Reason: ${label}`));
    assert.match(text(f.draw()), /historical membership record stays/);
    await f.button("Permanently delete member").props.onClick();
    assert.equal(JSON.parse(requests.at(-1).body).reason, reason);
    assert.deepEqual(f.replacements, ["/ops/members/history/member-one"]);
  }
});

test("final confirmation submits the reviewed version once and navigates only after confirmed success", async (t) => {
  const pending = deferred();
  const requests = requestsFor(t, (request) => request.method === "DELETE" ? pending.promise : Response.json({ deletion: eligible() }));
  const f = fixture();
  await open(f);
  confirm(f, " member@RUINED.test ", "duplicate_account");
  const action = f.button("Permanently delete member").props.onClick;
  const deleting = action();
  await action();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "DELETE");
  assert.deepEqual(JSON.parse(requests[1].body), { confirmationEmail: "Member@ruined.test", expectedLifecycleVersion: 7, reason: "duplicate_account" });
  assert.equal(f.draw().props["data-operator-pending"], "true");
  assert.equal(f.field("reason").props.disabled, true);
  assert.equal(f.button("Cancel").props.disabled, true);
  assert.deepEqual(f.replacements, []);
  pending.resolve(Response.json({ deleted: true, cleanupPending: true }));
  await deleting;
  await action();
  assert.equal(requests.length, 2);
  assert.deepEqual(f.replacements, ["/ops/members/history/member-one"]);
  assert.equal(f.refreshes(), 1);
  assert.match(text(f.draw()), /Remaining file cleanup is pending/);
  assert.equal(f.draw().props["data-operator-dirty"], "false");
  assert.equal(f.draw().props["data-operator-pending"], "false");
  assert.ok(f.resets() >= 1);
});

test("a stale lifecycle conflict reloads eligibility and requires fresh typing and review", async (t) => {
  const requests = requestsFor(t, (request, index) => request.method === "DELETE"
    ? Response.json({ error: "Changed." }, { status: 409 })
    : Response.json({ deletion: eligible({ lifecycleVersion: index === 1 ? 7 : 8 }) }));
  const f = fixture();
  await open(f);
  confirm(f);
  const oldAction = f.button("Permanently delete member").props.onClick;
  await oldAction();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].method, undefined);
  assert.match(text(f.draw()), /member changed/);
  assert.equal(f.field("confirmationEmail").props.value, "");
  assert.equal(f.field("reason").props.value, "");
  assert.equal(f.button("Review deletion").props.disabled, true);
  await oldAction();
  assert.equal(requests.length, 3);
  assert.deepEqual(f.replacements, []);
  confirm(f);
  await f.button("Permanently delete member").props.onClick();
  assert.equal(JSON.parse(requests[3].body).expectedLifecycleVersion, 8);
});

test("conflict blockers replace stale eligibility without another deletion", async (t) => {
  const requests = requestsFor(t, (request, index) => request.method === "DELETE"
    ? Response.json({}, { status: 409 })
    : Response.json({ deletion: index === 1 ? eligible() : eligible({ allowed: false, blockers: ["The account was reopened."] }) }));
  const f = fixture();
  await open(f);
  confirm(f);
  await f.button("Permanently delete member").props.onClick();
  assert.match(text(f.draw()), /account was reopened/);
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
});

for (const [status, expected] of [[401, /session has expired/], [403, /Only an administrator/], [503, /temporarily unavailable/]]) {
  test(`${status} deletes fail closed with a clear message and eligibility-only retry`, async (t) => {
    const requests = requestsFor(t, (request) => request.method === "DELETE"
      ? Response.json({}, { status }) : Response.json({ deletion: eligible() }));
    const f = fixture();
    await open(f);
    confirm(f);
    const action = f.button("Permanently delete member").props.onClick;
    await action();
    assert.match(text(f.draw()), expected);
    assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
    assert.deepEqual(f.replacements, []);
    await action();
    assert.equal(requests.length, 2);
    await f.button("Check eligibility again").props.onClick();
    assert.equal(requests.length, 3);
    assert.equal(requests[2].method, undefined);
    assert.equal(f.field("confirmationEmail").props.value, "");
  });
}

test("invalid eligibility and ambiguous deletion responses never permit a destructive retry", async (t) => {
  const requests = requestsFor(t, (request, index) => request.method === "DELETE"
    ? Response.json({ deleted: "true" })
    : Response.json({ deletion: index === 1 ? eligible({ lifecycleVersion: null }) : eligible() }));
  const f = fixture();
  await open(f);
  assert.match(text(f.draw()), /could not be verified/);
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  await f.button("Check eligibility again").props.onClick();
  confirm(f);
  await f.button("Permanently delete member").props.onClick();
  assert.match(text(f.draw()), /Deletion was not confirmed/);
  assert.deepEqual(f.replacements, []);
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
});

test("pending eligibility cannot duplicate requests, and unmount aborts its response", async (t) => {
  const pending = deferred();
  const requests = requestsFor(t, () => pending.promise);
  const f = fixture();
  const action = f.button("Delete member").props.onClick;
  const checking = action();
  await action();
  assert.equal(requests.length, 1);
  assert.equal(f.draw().props["data-operator-pending"], "true");
  assert.match(text(f.draw()), /Checking eligibility/);
  f.unmount();
  assert.equal(requests[0].signal.aborted, true);
  pending.resolve(Response.json({ deletion: eligible() }));
  await checking;
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
});

test("cancel clears confirmation and dirty state and restores trigger focus", async (t) => {
  const requests = requestsFor(t);
  const f = fixture();
  await open(f);
  confirm(f);
  f.button("Cancel").props.onClick();
  assert.equal(f.draw().props["data-operator-dirty"], "false");
  assert.equal(f.button("Delete member").props["aria-expanded"], false);
  assert.equal(f.focuses(), 1);
  assert.ok(f.resets() >= 1);
  assert.equal(requests.length, 1);
});
