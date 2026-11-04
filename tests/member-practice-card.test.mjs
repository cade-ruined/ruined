import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const loadedModel = { exports: {} }; new Function("require", "module", "exports", compile("src/lib/practice/model.ts"))(require, loadedModel, loadedModel.exports);
const model = loadedModel.exports;
const source = compile("src/components/membership/MemberPracticeCard.tsx");
const text = node => Array.isArray(node) ? node.map(text).join("") : React.isValidElement(node) ? text(node.props.children) : node == null || typeof node === "boolean" ? "" : String(node);

function fixture(ownerId = "owner-a") {
  const slots = [], effects = [], listeners = new Map(), requests = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { const slot = { deps }; slots[index] = slot; effects.push(() => { previous?.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const fetch = (_url, options) => new Promise(resolve => { requests.push({ options, resolve: snapshot => resolve({ ok: true, json: async () => snapshot }) }); });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "fetch", source)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "@/lib/practice/model") return model;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(name);
  }, loaded, loaded.exports, { addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: type => listeners.delete(type) }, { hidden: false }, fetch);
  const render = (owner = ownerId) => { cursor = 0; const tree = loaded.exports.default({ ownerId: owner }); effects.splice(0).forEach(effect => effect()); return tree; };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  render();
  return { render, requests, settle, focus: () => listeners.get("focus")?.(), unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test("the profile Practice card ignores older responses after a newer refresh", async () => {
  const ui = fixture();
  const older = { ...model.previewPracticeSnapshot(new Date("2026-11-04")), ownerId: "owner-a" };
  const newer = structuredClone(older); newer.badges.f1 = { earned: true, earnedAt: "2026-11-04T12:00:00Z", completed: 3, target: 3 };
  ui.focus();
  ui.requests[1].resolve(newer); await ui.settle();
  assert.match(text(ui.render()), /Return to your assignments whenever you need/);
  ui.requests[0].resolve(older); await ui.settle();
  assert.match(text(ui.render()), /Return to your assignments whenever you need/);
  assert.doesNotMatch(text(ui.render()), /Your work is saved|0 of 3 timeline entries/);
  ui.unmount();
});

test("a card response from the prior account cannot populate a new member profile", async () => {
  const ui = fixture();
  ui.render("owner-b");
  ui.requests[0].resolve({ ...model.previewPracticeSnapshot(), ownerId: "owner-a", badges: { f1: { earned: true }, f4: {}, time: {} } }); await ui.settle();
  assert.match(text(ui.render("owner-b")), /Foundations and monthly topics/);
  assert.equal(ui.requests[1].options.headers["x-ruined-session-owner"], "owner-b");
  ui.unmount();
});
