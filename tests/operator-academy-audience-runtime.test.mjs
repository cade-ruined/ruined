import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, request = () => { throw Error("No real network in Academy tests"); }, FormDataImpl = FormData) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "FormData", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return React;
    if (name === "@/components/platform/operatorStyles") return {};
    throw Error(`Unexpected Academy audience dependency: ${name}`);
  }, cjsModule, cjsModule.exports, request, FormDataImpl);
  return cjsModule.exports;
}
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const options = { circles: [{ id: "circle-one", label: "Circle One" }, { id: "circle-two", label: "Circle Two" }], blocks: [{ id: "block-one", label: "Block One" }], collections: [] };
function fixture({ audiences = [], preview = false, referenceOptions = options } = {}) {
  const slots = [];
  let cursor = 0;
  const requests = [];
  let refreshes = 0;
  const hooks = { ...React, useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  } };
  const actions = load("src/components/platform/OperatorAcademyActions.tsx", {
    react: hooks,
    "next/navigation": { useRouter: () => ({ push() {}, refresh() { refreshes++; } }) },
  }, async (url, init) => { requests.push({ url, method: init.method, body: JSON.parse(init.body) }); return Response.json({ resource: { resourceId: "saved" } }); }, function(form) { return form.data; });
  function draw() {
    cursor = 0;
    const form = actions.OperatorAcademyEditorForm({ options: referenceOptions, resource: { audiences, resourceId: "lesson", revision: 4 }, preview });
    const fields = nodes(form).find((node) => node.type?.name === "ResourceFields");
    const audience = nodes(fields.type(fields.props)).find((node) => node.type?.name === "AudienceFields");
    return { form, audience: audience.type(audience.props) };
  }
  const checkbox = (name, value) => nodes(draw().audience).find((node) => node.type === "input" && node.props.name === name && (value === undefined || node.props.value === value));
  // Reproduce HTML successful-control rules from the actual rendered attributes,
  // then exercise the production FormData.getAll payload path with native FormData.
  function serialize() {
    const dom = parseFragment(renderToStaticMarkup(draw().audience));
    const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)];
    const data = new FormData();
    for (const node of elements(dom).filter((node) => node.tagName === "input")) {
      const attrs = Object.fromEntries(node.attrs.map((attr) => [attr.name, attr.value]));
      if (Object.hasOwn(attrs, "checked") && !Object.hasOwn(attrs, "disabled")) data.append(attrs.name, attrs.value);
    }
    return data;
  }
  return { draw, checkbox, requests, serialize, refreshes: () => refreshes,
    check(name, value, checked) { const control = checkbox(name, value); assert.ok(control); assert.notEqual(control.props.disabled, true, "use only enabled checkboxes"); control.props.onChange({ target: { checked } }); },
    submit() { return draw().form.props.onSubmit({ preventDefault() {}, currentTarget: { data: serialize() } }); },
  };
}

test("Academy audience uses labeled checkbox groups and keeps multiple scoped selections", async () => {
  const f = fixture({ audiences: [{ kind: "circle", id: "circle-one" }] });
  const tree = f.draw().audience;
  assert.equal(nodes(tree).some((node) => node.type === "select"), false);
  assert.deepEqual(nodes(tree).filter((node) => node.type === "legend").map(text), ["Audience", "Circles", "Blocks"]);
  assert.doesNotMatch(text(tree), /Command|Control/);
  assert.equal(f.checkbox("circleIds", "circle-one").props.checked, true);
  f.check("circleIds", "circle-two", true);
  f.check("blockIds", "block-one", true);
  assert.deepEqual(f.serialize().getAll("circleIds"), ["circle-one", "circle-two"]);
  await f.submit();
  assert.deepEqual(f.requests[0], { url: "/api/ops/academy/resources/lesson", method: "PATCH", body: {
    audiences: [{ id: "circle-one", kind: "circle" }, { id: "circle-two", kind: "circle" }, { id: "block-one", kind: "block" }],
    bodyText: "", captionsUrl: "", collectionId: "", contentType: "article", durationLabel: "", expectedRevision: 4, externalUrl: "", featured: false, position: 1, presenter: "", slug: "", summary: "", thumbnailUrl: "", title: "", videoUrl: "",
  } });
});

test("All active members excludes disabled scopes from FormData without forgetting prior selections", async () => {
  const f = fixture({ audiences: [{ kind: "circle", id: "circle-one" }, { kind: "block", id: "block-one" }] });
  f.checkbox("audienceAll").props.onChange({ target: { checked: true } });
  const scopes = nodes(f.draw().audience).filter((node) => node.type === "input" && node.props.name !== "audienceAll");
  assert.ok(scopes.every((node) => node.props.disabled === true));
  assert.deepEqual([...f.serialize()], [["audienceAll", "yes"]]);
  await f.submit();
  assert.deepEqual(f.requests[0].body.audiences, [{ kind: "all_members", id: null }]);
  f.checkbox("audienceAll").props.onChange({ target: { checked: false } });
  assert.equal(f.checkbox("circleIds", "circle-one").props.checked, true);
  assert.equal(f.checkbox("circleIds", "circle-two").props.checked, false);
  assert.equal(f.checkbox("blockIds", "block-one").props.checked, true);
  assert.deepEqual([...f.serialize()], [["circleIds", "circle-one"], ["blockIds", "block-one"]]);
  f.check("circleIds", "circle-one", false);
  assert.deepEqual(f.serialize().getAll("circleIds"), []);
});

test("Academy audience empty options are clear, default audience is empty, and preview never writes", async () => {
  const f = fixture({ referenceOptions: { ...options, circles: [], blocks: [] }, preview: true });
  assert.match(text(f.draw().audience), /No circles available.*No blocks available/);
  assert.equal(f.checkbox("audienceAll").props.checked, false);
  assert.deepEqual([...f.serialize()], []);
  f.checkbox("audienceAll").props.onChange({ target: { checked: true } });
  await f.submit();
  assert.deepEqual(f.requests, []);
  assert.equal(f.refreshes(), 0);
});

test("every Academy preview link resolves its exact lesson and unknown previews return not found without live reads", async () => {
  const academy = load("src/lib/platform/ops-academy-preview.ts");
  const Editor = () => null;
  let reads = 0;
  const Page = load("app/ops/academy/[resourceId]/page.tsx", {
    "next/navigation": { notFound() { throw Error("not-found"); }, redirect() { throw Error("unexpected redirect"); } },
    "@/components/platform/OperatorAcademyEditor": { __esModule: true, default: Editor },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: () => null },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({ state: "preview", role: "ops_admin", dashboard: {}, viewer: null }) },
    "@/lib/platform/ops-academy-preview": academy,
    "@/lib/platform/ops-academy-repository": { getOpsAcademyEditor() { reads++; throw Error("Preview must not read live data"); } },
  }).default;
  for (const expected of academy.PREVIEW_OPS_ACADEMY.resources) {
    const tree = await Page({ params: Promise.resolve({ resourceId: expected.resourceId }) });
    assert.equal(tree.type, Editor);
    assert.equal(tree.props.preview, true);
    for (const key of ["resourceId", "title", "status", "hasUnpublishedChanges", "currentVersion", "latestVersion", "revision"]) assert.equal(tree.props.editor.resource[key], expected[key]);
    assert.deepEqual(tree.props.editor.resource.audiences, expected.audiences);
  }
  await assert.rejects(Page({ params: Promise.resolve({ resourceId: "not-in-preview" }) }), /not-found/);
  assert.equal(reads, 0);
});
