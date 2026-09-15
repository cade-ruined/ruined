import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? node.type?.name === "Notice" ? text(node.type(node.props)) : text(node.props?.children) : String(node);
const Dialog = ({ children }) => children;
const product = { id: "gid://shopify/Product/123", handle: "first-coin", title: "The First Coin" };
const template = { templateId: "template-one", name: "The First Coin", templateSlug: "first-coin", version: 1, versionId: "version-one", versionStatus: "published", status: "active", bindingVerified: true, livemode: true, productGid: product.id, productHandle: product.handle };
const shipment = { shipmentId: "shipment-one", memberName: "Example Member", carrier: "UPS", serviceLevel: "Ground", trackingNumber: "123456", trackingUrl: "https://www.ups.com/track", status: "exception", version: 7 };
const artifacts = [{ artifactJobId: "job-one", artifactAwardId: "award-one", name: "The First Coin", memberName: "Example Member", state: "in_production" }];
const data = { templates: [template, { ...template, templateId: "test-template", versionId: "test-version", livemode: false }], shipments: [shipment], members: [{ memberId: "member-one", name: "Example Member" }] };
const production = React.createElement("section", { id: "artifact-production" }, React.createElement("article", { id: "artifact-job-one" }, "Production job"));

function fixture({ name = "default", props = {}, hash = "", preview = false, respond = async () => Response.json({}) } = {}) {
  const values = { artifacts, data, production, preview, ...props };
  const state = [];
  const effects = [];
  const listeners = new Map();
  const requests = [];
  const scrolls = [];
  let cursor = 0;
  let changed = false;
  let resets = 0;
  let refreshes = 0;
  const hooks = { ...React, useContext: () => preview, useMemo: (work) => work(),
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], (next) => { const value = typeof next === "function" ? next(state[i]) : next; changed ||= !Object.is(state[i], value); state[i] = value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; },
    useEffect(work, deps) { const i = cursor++; if (!state[i] || deps.some((value, index) => !Object.is(value, state[i][index]))) { state[i] = deps; effects.push(work); } },
  };
  const browserWindow = {
    location: { pathname: "/ops/artifacts", search: "?preserve=1", hash },
    history: { state: { next: true }, replaceState(next, unused, url) { void unused; this.state = next; browserWindow.location.hash = new URL(url, "https://example.test").hash; } },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); },
  };
  const invariantModule = { exports: {} };
  new Function("module", "exports", ts.transpileModule(readFileSync(new URL("../src/lib/platform/artifact-invariants.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(invariantModule, invariantModule.exports);
  const code = ts.transpileModule(readFileSync(new URL("../src/components/platform/OperatorArtifactAdmin.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "requestAnimationFrame", "fetch", "FormData", `${code}\nmodule.exports.forms = { TemplateCreateForm, ArtifactAwardForm, ShipmentCreateForm, ShopifyBindingForm, ShipmentUpdateForm };`)((dependency) => {
    if (dependency === "react") return hooks;
    if (dependency === "react/jsx-runtime") return require(dependency);
    if (dependency === "next/navigation") return { useRouter: () => ({ refresh() { refreshes++; } }) };
    if (dependency === "@/components/platform/OperatorDialog") return { __esModule: true, default: Dialog };
    if (dependency === "@/components/platform/OperatorArtifactProductPicker") return { __esModule: true, default: "product-picker" };
    if (dependency === "@/components/platform/operatorStyles") return new Proxy({}, { get: () => "operator-control" });
    if (dependency === "@/lib/platform/artifact-invariants") return invariantModule.exports;
    throw new Error(`Unexpected artifact UI dependency ${dependency}`);
  }, loadedModule, loadedModule.exports, browserWindow, { getElementById: (id) => ({ scrollIntoView() { scrolls.push(id); } }) }, (callback) => callback(), async (url, options) => { const request = { url, method: options.method, body: JSON.parse(options.body) }; requests.push(request); return respond(request); }, class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } });
  const Subject = name === "default" ? loadedModule.exports.default : loadedModule.exports.forms[name];
  const draw = () => { let result; do { cursor = 0; changed = false; result = Subject(values); while (effects.length) effects.shift()(); } while (changed); return result; };
  return {
    draw, requests, browserWindow, listeners, scrolls, refreshes: () => refreshes, resets: () => resets,
    modal: () => nodes(draw()).find((node) => node.type === Dialog),
    form: () => nodes(draw()).find((node) => node.type === "form"),
    click(label) { const target = nodes(draw()).find((node) => ["button", "a"].includes(node.type) && text(node) === label); assert.ok(target, label); target.props.onClick({ preventDefault() {} }); },
    submit(fields = {}) { return this.form().props.onSubmit({ preventDefault() {}, currentTarget: { values: fields, reset() { resets++; } } }); },
  };
}

test("Artifacts has one primary action and focused view selection while warnings stay visible", () => {
  const f = fixture();
  assert.equal(f.modal(), undefined);
  const links = nodes(f.draw()).find((node) => node.props?.["aria-label"] === "Artifact views");
  assert.deepEqual(nodes(links).filter((node) => node.type === "a").map(text), ["Production", "Templates", "Shipping"]);
  assert.equal(nodes(links).find((node) => node.props?.["aria-current"] === "page").props.href, "#artifact-production");
  assert.equal(nodes(f.draw()).find((node) => node.props?.id === "artifact-templates").props.hidden, true);
  assert.match(text(nodes(f.draw()).find((node) => node.props?.["aria-label"] === "Artifact attention")), /1 shipment needs attention.*1 template is not ready to award/);
  f.click("Templates");
  assert.equal(nodes(f.draw()).find((node) => node.props?.id === "artifact-templates").props.hidden, false);
  assert.equal(f.browserWindow.location.hash, "#artifact-templates");
  assert.equal(f.browserWindow.location.search, "?preserve=1");
  assert.deepEqual(f.requests, []);
});

test("Artifact bento workspaces keep production and saved editors mounted when changing views", () => {
  const f = fixture();
  const productionPanel = () => nodes(f.draw()).find((node) => node.type === "div" && node.props.children === production);
  assert.equal(productionPanel().props.hidden, false);
  for (const view of ["Templates", "Shipping", "Production"]) {
    f.click(view);
    assert.equal(productionPanel().props.children, production);
    assert.equal(productionPanel().props.hidden, view !== "Production");
    assert.equal(nodes(f.draw()).filter((node) => node.type?.name === "ShopifyBindingForm").length, 2);
    assert.equal(nodes(f.draw()).filter((node) => node.type?.name === "ShipmentUpdateForm").length, 1);
  }
  assert.equal(f.requests.length, 0);
});

test("production bento cards keep job links and preview-safe actions in mounted collapsed workspaces", () => {
  const source = readFileSync(new URL("../src/components/platform/OperatorArtifactQueue.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const dependencies = { react: React, "react/jsx-runtime": require("react/jsx-runtime"), "next/link": { __esModule: true, default: "a" }, "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" }, "@/components/platform/OperatorEmptyState": { __esModule: true, default: "empty-state" }, "@/components/platform/StateLabel": { __esModule: true, default: "state-label" }, "@/components/platform/OperatorWorkActions": { OperatorArtifactAction: "production-action" } };
  new Function("require", "module", "exports", compiled)((name) => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, mod, mod.exports);
  const tree = mod.exports.default({ artifacts: [{ ...artifacts[0], memberId: "member-one", reason: "Completed Foundations", earnedAt: "2026-09-01T12:00:00Z", dueAt: null }], preview: true });
  const card = nodes(tree).find((node) => node.type === "article");
  assert.equal(card.props.id, "artifact-job-one");
  assert.match(card.props.className, /operator-bento-card/);
  assert.equal(nodes(card).find((node) => node.type === "a").props.href, "/ops/members/member-one#journey");
  const disclosure = nodes(card).find((node) => node.type === "details");
  assert.equal(disclosure.props.open, undefined);
  assert.match(text(disclosure), /Update production/);
  assert.deepEqual(nodes(disclosure).find((node) => node.type === "production-action").props, { artifactJobId: "job-one", state: "in_production", preview: true });
});

test("all existing Artifact deep links reveal the right workspace or task without a mutation", () => {
  for (const [hash, title, view] of [["#award-artifact", "Award an Artifact", "production"], ["#new-artifact-template", "New template", "templates"], ["#new-artifact-shipment", "Add tracking", "shipping"], ["#artifact-templates", null, "templates"], ["#artifact-fulfillment", null, "shipping"], ["#artifact-job-one", null, "production"]]) {
    const f = fixture({ hash });
    assert.equal(f.modal()?.props.title ?? null, title);
    assert.equal(nodes(f.draw()).find((node) => node.props?.["aria-current"] === "page").props.href, view === "shipping" ? "#artifact-fulfillment" : `#artifact-${view}`);
    assert.deepEqual(f.requests, []);
    if (hash === "#artifact-job-one") assert.deepEqual(f.scrolls, ["artifact-job-one"]);
  }
});

test("creation dialogs restore a meaningful focus target and success returns to the corresponding saved list", () => {
  for (const [label, name, focus, hash] of [["Award an Artifact", "ArtifactAwardForm", "open-award-artifact", "#artifact-production"], ["+ New template", "TemplateCreateForm", "open-new-artifact-template", "#artifact-templates"], ["+ Add tracking", "ShipmentCreateForm", "open-new-artifact-shipment", "#artifact-fulfillment"]]) {
    const f = fixture(); f.click(label);
    assert.equal(f.modal().props.returnFocusId, focus);
    nodes(f.modal()).find((node) => node.type?.name === name).props.onSuccess("Saved successfully.");
    assert.equal(f.modal(), undefined);
    assert.match(text(f.draw()), /Saved successfully/);
    assert.equal(f.browserWindow.location.hash, hash);
  }
  const cancelled = fixture(); cancelled.click("Award an Artifact"); cancelled.modal().props.onClose();
  assert.equal(cancelled.modal(), undefined);
  assert.deepEqual(cancelled.requests, []);
});

test("all five form previews remain non-mutating even through their new dialogs", async () => {
  for (const [name, props, open] of [["ArtifactAwardForm", {}, null], ["TemplateCreateForm", {}, null], ["ShipmentCreateForm", {}, null], ["ShopifyBindingForm", { templateId: template.templateId, productGid: product.id, productHandle: product.handle, livemode: true }, "Edit product"], ["ShipmentUpdateForm", { shipment }, "Edit shipment"]]) {
    const f = fixture({ name, props, preview: true });
    if (open) f.click(open);
    await f.form().props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview must not read a form"); } });
    assert.deepEqual(f.requests, [], name);
    assert.equal(f.refreshes(), 0, name);
    assert.match(text(f.draw()), /Preview only/, name);
  }
});

test("awards retain exact live template versions and idempotent retry identity after a failed request", async () => {
  const f = fixture({ name: "ArtifactAwardForm", respond: async () => Response.json({ error: "Try again." }, { status: 503 }) });
  const templateSelect = nodes(f.form()).find((node) => node.props?.name === "templateVersionId");
  assert.deepEqual(nodes(templateSelect).filter((node) => node.type === "option").map((node) => node.props.value), ["", "version-one"]);
  f.form().props.onChange();
  const payload = { memberId: "member-one", templateVersionId: "version-one", reason: "Completed Foundations", acquisitionType: "earned" };
  await f.submit(payload); await f.submit(payload);
  assert.equal(f.requests[0].body.requestKey, f.requests[1].body.requestKey);
  assert.match(f.requests[0].body.requestKey, /^[a-f0-9-]{36}$/);
  assert.deepEqual({ ...f.requests[0].body, requestKey: undefined }, { ...payload, requestKey: undefined });
  assert.equal(f.form().props["data-operator-dirty"], "true");
  assert.equal(f.resets(), 0);
  assert.match(text(f.draw()), /Try again/);
});

test("template product selection and pending saves participate in dialog guards", async () => {
  let resolve;
  const successes = [];
  const f = fixture({ name: "TemplateCreateForm", props: { onSuccess: (message) => successes.push(message) }, respond: () => new Promise((done) => { resolve = done; }) });
  nodes(f.draw()).find((node) => node.type === "product-picker").props.onSelect(product);
  assert.equal(f.form().props["data-operator-dirty"], "true");
  const request = f.submit({ name: "The First Coin", slug: product.handle, productGid: product.id, productHandle: product.handle, livemode: "on", description: "A hand forged artifact." });
  assert.equal(f.form().props["data-operator-pending"], "true");
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.productGid, product.id);
  assert.equal(f.requests[0].body.productHandle, product.handle);
  assert.equal(f.requests[0].body.livemode, true);
  resolve(Response.json({})); await request;
  assert.deepEqual(successes, ["Template published and bound to Shopify."]);
  assert.equal(f.form().props["data-operator-dirty"], undefined);
});

test("shipment edits preserve versions, transition choices and correction evidence inside the dialog", async () => {
  const f = fixture({ name: "ShipmentUpdateForm", props: { shipment }, respond: async () => Response.json({ error: "Shipment changed elsewhere." }, { status: 409 }) });
  f.click("Edit shipment");
  assert.equal(f.modal().props.returnFocusId, "edit-artifact-shipment-shipment-one");
  f.form().props.onChange();
  await f.submit({ carrier: "UPS", trackingNumber: "123456", status: "in_transit", changeReason: "Carrier confirmed departure" });
  assert.equal(f.requests[0].body.expectedVersion, 7);
  assert.equal(f.requests[0].body.changeReason, "Carrier confirmed departure");
  assert.equal(f.requests[0].method, "PATCH");
  assert.equal(f.form().props["data-operator-dirty"], "true");
  assert.match(text(f.draw()), /Shipment changed elsewhere/);
});
