import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const none = { status: "none", partnerEmail: null };
const settle = () => new Promise(resolve => setImmediate(resolve));

// Run the real hook's state/effect transitions with deterministic provider
// responses. No browser, authentication, database or email service is contacted.
function hooks() {
  let cursor = 0;
  const slots = [], effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  return {
    react: { ...React,
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useCallback(callback, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
      useEffect(effect, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) { const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); }); } },
    },
    render(render) { cursor = 0; return render(); },
    async effects() { while (effects.length) effects.shift()(); await settle(); },
  };
}

async function fixture({ initial = none, preview = false, failedRead = false } = {}) {
  const h = hooks(), calls = [];
  let readFails = failedRead, writeFails = false;
  const source = await readFile(new URL("../src/components/membership/RegistrationCouplePreference.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  const fetch = async (url, options = {}) => {
    assert.equal(url, "/api/my/registration/couple");
    const method = options.method ?? "GET", body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, body });
    const ok = method === "GET" ? !readFails : !writeFails;
    const couple = method === "GET" ? initial : method === "DELETE" ? none : { status: "pending", partnerEmail: body.partnerEmail };
    return { ok, json: async () => ok ? { couple } : { error: "Preference could not be saved." } };
  };
  new Function("require", "module", "exports", "fetch", js)(name => name === "react" ? h.react : require(name), loaded, loaded.exports, fetch);
  const renderHook = () => h.render(() => loaded.exports.useRegistrationCouple({ enabled: true, preview }));
  const renderEditor = () => h.render(() => loaded.exports.default({ preview }));
  return { ...loaded.exports, calls, renderHook, renderEditor, effects: h.effects, failWrites: () => { writeFails = true; }, allowReads: () => { readFails = false; } };
}

test("individual registration reads its current preference without creating an extra mutation", async () => {
  const f = await fixture();
  assert.equal(f.renderHook().loading, true);
  await f.effects();
  const preference = f.renderHook();
  assert.equal(preference.loading, false);
  assert.equal(preference.kind, "individual");
  await preference.save();
  assert.deepEqual(f.calls, [{ method: "GET", body: null }]);
});

test("couple preference requires affirmative consent and retains editable values after a save failure", async () => {
  const f = await fixture(); f.renderHook(); await f.effects();
  let preference = f.renderHook();
  preference.setKind("couple"); preference.setPartnerEmail("  Partner@Example.test  ");
  preference = f.renderHook();
  await assert.rejects(preference.save, /confirm that you’re registering together/);
  assert.equal(f.calls.length, 1);
  preference.setConsent(true); f.failWrites();
  preference = f.renderHook();
  await assert.rejects(preference.save, /Preference could not be saved/);
  preference = f.renderHook();
  assert.equal(preference.saved.status, "none");
  assert.equal(preference.kind, "couple");
  assert.equal(preference.partnerEmail.trim(), "Partner@Example.test");
  assert.deepEqual(f.calls[1], { method: "POST", body: { partnerEmail: "partner@example.test", consent: true } });
});

test("a failed preference lookup blocks writes instead of replacing an unknown saved preference", async () => {
  const f = await fixture({ failedRead: true, initial: { status: "pending", partnerEmail: "partner@example.test" } });
  f.renderHook(); await f.effects();
  let preference = f.renderHook();
  assert.match(preference.loadError, /Please retry/);
  await assert.rejects(preference.save, /Please load/);
  assert.equal(f.calls.length, 1);
  f.allowReads(); await preference.reload(); preference = f.renderHook();
  assert.equal(preference.kind, "couple");
  assert.equal(preference.partnerEmail, "partner@example.test");
  await preference.save();
  assert.deepEqual(f.calls.map(call => call.method), ["GET", "GET"]);
});

test("confirmed pairs cannot be silently removed in the registration editor", async () => {
  const f = await fixture({ initial: { status: "paired", partnerEmail: "partner@example.test" } });
  f.renderEditor(); await f.effects();
  const tree = f.renderEditor(), html = renderToStaticMarkup(tree);
  assert.match(html, /Circle pairing with partner@example.test is confirmed/);
  assert.match(html, /same Circle/);
  assert.match(html, /Contact Ruined to change your pairing/);
  assert.doesNotMatch(html, /Save Circle preference/);
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(f.calls.map(call => call.method), ["GET"]);
});

test("preview editor is inert and never reads or changes a real registration", async () => {
  const f = await fixture({ preview: true });
  const tree = f.renderEditor(); await f.effects();
  const button = nodes(tree).find(node => node.type === "button" && node.props.type === "submit");
  assert.equal(button.props.disabled, true);
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(f.calls, []);
});
