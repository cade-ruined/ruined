import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : node == null || typeof node === "boolean" ? "" : String(node);
const share = {
  kind: "share", title: "Send the payment link", detail: "Ask the member to review their price and membership terms.",
  operatorHref: "/ops/members/member-id#membership", recipient: "cherry@example.test",
  memberUrl: "https://members.theruinedproject.com/access?returnTo=%2Fmy%2Factivate",
  message: "Complete your Ruined membership checkout.\n\nhttps://members.theruinedproject.com/access?returnTo=%2Fmy%2Factivate\n\nSign in with cherry@example.test. We'll email you a confirmation code.",
};
function fixture({ action = share, preview = false, disabled = false, writeText } = {}) {
  let cursor = 0, reviews = 0, focusCount = 0, selectCount = 0;
  const slots = [], writes = [], mutations = [];
  const deps = {
    react: { ...React,
      useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], value => { slots[index] = value; }]; },
      useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "./operatorStyles": { OPERATOR_BUTTON_CLASS: "button" },
  };
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../src/components/platform/OperatorRegistrationNextStep.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", "navigator", "fetch", code)(name => {
    assert.ok(Object.hasOwn(deps, name), `No sending, billing or profile service dependency allowed: ${name}`);
    return deps[name];
  }, loaded, loaded.exports, { clipboard: writeText === null ? undefined : { writeText: value => { writes.push(value); return writeText ? writeText(value) : Promise.resolve(); } } },
  (...args) => { mutations.push(args); throw new Error("Follow-up controls must not send emails, charge or grant access."); });
  const props = { action, preview, disabled, onReviewProfile: () => { reviews++; } };
  function render() {
    cursor = 0;
    const tree = loaded.exports.default(props);
    const input = nodes(tree).find(node => node.type === "input");
    if (input) input.props.ref.current = { focus: () => { focusCount++; }, select: () => { selectCount++; } };
    return tree;
  }
  const button = label => nodes(render()).find(node => node.type === "button" && text(node) === label);
  return { render, button, writes, mutations, props, reviews: () => reviews, selections: () => ({ focusCount, selectCount }),
    click: async label => { const selected = button(label); assert.ok(selected, label); selected.props.onClick(); await flush(); } };
}

test("follow-up presents the exact recipient and readonly link; copying either form sends nothing", async () => {
  const f = fixture();
  const input = nodes(f.render()).find(node => node.type === "input");
  assert.equal(input.props["aria-label"], "Member follow-up link"); assert.equal(input.props.value, share.memberUrl); assert.equal(input.props.readOnly, true);
  assert.match(text(f.render()), /Send to cherry@example\.test/);
  await f.click("Copy link"); assert.deepEqual(f.writes, [share.memberUrl]);
  assert.match(text(f.render()), /Link copied\. Paste it into your email or text to cherry@example\.test\./);
  assert.equal(nodes(f.render()).filter(node => node.props.role === "status").length, 1);
  await f.click("Copy message"); assert.deepEqual(f.writes, [share.memberUrl, share.message]);
  assert.match(text(f.render()), /Message copied/); assert.deepEqual(f.mutations, []); assert.equal(f.reviews(), 0);
  let selected = 0; input.props.onFocus({ currentTarget: { select: () => { selected++; } } }); assert.equal(selected, 1);
});

test("copy rejection selects the visible link and leaves a useful manual fallback", async () => {
  let fail = true;
  const f = fixture({ writeText: async () => { if (fail) throw Error("Permission denied"); } });
  await f.click("Copy message");
  assert.match(text(f.render()), /Could not copy automatically\. Select the link below and copy it manually\./);
  assert.deepEqual(f.selections(), { focusCount: 1, selectCount: 1 });
  assert.equal(f.button("Copy link").props.disabled, false);
  fail = false; await f.click("Copy link"); assert.match(text(f.render()), /Link copied/);
  assert.doesNotMatch(text(f.render()), /Could not copy/); assert.deepEqual(f.mutations, []);
});

test("missing clipboard support also falls back to selecting the link", async () => {
  const f = fixture({ writeText: null }); await f.click("Copy link");
  assert.deepEqual(f.writes, []); assert.deepEqual(f.selections(), { focusCount: 1, selectCount: 1 });
  assert.match(text(f.render()), /copy it manually/); assert.deepEqual(f.mutations, []);
});

test("rapid duplicate clicks and a second copy action cannot issue competing writes", async () => {
  let finish;
  const f = fixture({ writeText: () => new Promise(resolve => { finish = resolve; }) });
  const link = f.button("Copy link"), message = f.button("Copy message");
  link.props.onClick(); link.props.onClick(); message.props.onClick();
  assert.deepEqual(f.writes, [share.memberUrl]);
  assert.equal(f.button("Copy link").props.disabled, true); assert.equal(f.button("Copy message").props.disabled, true);
  finish(); await flush();
  assert.equal(f.button("Copy link").props.disabled, false); assert.deepEqual(f.mutations, []);
});

test("disabled copy controls reject callbacks even before a rerender", async () => {
  const f = fixture({ disabled: true });
  for (const label of ["Copy link", "Copy message"]) { assert.equal(f.button(label).props.disabled, true); await f.click(label); }
  assert.deepEqual(f.writes, []); assert.deepEqual(f.mutations, []); assert.equal(f.reviews(), 0);
});

test("preview copies clearly marked samples without triggering a send, payment or access mutation", async () => {
  const f = fixture({ preview: true });
  await f.click("Copy link"); await f.click("Copy message");
  assert.deepEqual(f.writes, [`PREVIEW — SAMPLE ONLY\n\n${share.memberUrl}`, `PREVIEW — SAMPLE ONLY\n\n${share.message}`]);
  assert.deepEqual(f.mutations, []); assert.equal(f.reviews(), 0);
});

test("review, release and complete instructions expose only their intended operator action", async () => {
  const review = fixture({ action: { kind: "review", title: "Review billing", detail: "Check existing payment.", operatorHref: share.operatorHref } });
  const reviewLink = nodes(review.render()).find(node => node.props.href === share.operatorHref);
  assert.ok(reviewLink); assert.match(text(reviewLink), /Review member record/);
  assert.equal(nodes(review.render()).filter(node => node.type === "input" || node.type === "button").length, 0);
  const release = fixture({ action: { kind: "release", title: "Review profile access", detail: "Confirm first.", operatorHref: share.operatorHref } });
  assert.equal(release.reviews(), 0); await release.click("Review profile access"); assert.equal(release.reviews(), 1);
  assert.deepEqual(release.mutations, []); assert.deepEqual(release.writes, []);
  const complete = fixture({ action: { kind: "complete", title: "No onboarding follow-up needed", detail: "Complete.", operatorHref: share.operatorHref } });
  assert.equal(nodes(complete.render()).filter(node => node.type === "input" || node.type === "button").length, 0);
  assert.deepEqual(complete.mutations, []); assert.deepEqual(complete.writes, []);
});
