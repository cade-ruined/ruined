import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
function fixture(path, props, { exportName = "default", nestedName, preview = false, respond = () => Response.json({ event: { eventKey: "workshop" } }) } = {}) {
  const state = [];
  const requests = [];
  let cursor = 0;
  let refreshes = 0;
  const hooks = { ...React, useContext: () => preview, useMemo: (fn) => fn(), useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
  } };
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "FormData", output)((name) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/navigation") return { useRouter: () => ({ refresh() { refreshes++; }, push() {} }) };
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "@/components/platform/OperatorPageFrame") return { __esModule: true, default: "main" };
    if (name === "@/components/platform/operatorStyles") return new Proxy({}, { get: () => "control" });
    if (name === "@/components/platform/OperatorArtifactProductPicker") return { __esModule: true, default: "product-picker" };
    if (name === "@/lib/platform/artifact-invariants") return { isLiveAwardableArtifactTemplate: () => true };
    if (name === "@/lib/datetime/zoned-date-time") return { zonedDateTimeLocalToIso: (value) => `${value}:00.000Z`, zonedDateTimeLocalValue: (value) => value?.slice(0, 16) ?? "" };
    throw new Error(`Unexpected UI dependency ${name}`);
  }, compiledModule, compiledModule.exports, async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return respond(requests.at(-1));
  }, function(form) { return { get: (key) => form.fields[key] ?? null }; });
  let Component = compiledModule.exports[exportName];
  if (nestedName) {
    const nested = nodes(Component(props)).find((node) => node.type?.name === nestedName);
    assert.ok(nested, `${nestedName} is rendered by its parent`);
    Component = nested.type;
    props = nested.props;
    state.length = 0;
  }
  const draw = () => { cursor = 0; return Component(props); };
  return { draw, requests, refreshes: () => refreshes,
    click(label) {
      const button = nodes(draw()).find((node) => node.type === "button" && text(node) === label);
      assert.ok(button, `${label} is visible`);
      return button.props.onClick();
    },
    submit(fields = {}) { return nodes(draw()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { fields, reset() {} } }); },
  };
}

const event = {
  eventKey: "workshop", title: "Workshop", startsAt: "2026-09-20T16:00:00Z", timezone: "America/Denver", location: "The Studio", admission: "Members", summary: "Make something lasting.",
  publicationState: "published", eventState: "Upcoming", registrationMode: "external", registrationUrl: "https://events.example.com/workshop", registrationOpen: false, version: 4,
};
const eventFixture = (options = {}, props = {}) => fixture("src/components/platform/OperatorCommunityEvents.tsx", { event, ...props }, { exportName: "CommunityEventEditor", ...options });

test("saved public events show operational details and registration state before offering Edit", () => {
  const f = eventFixture();
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  assert.match(text(f.draw()), /Published on website.*Upcoming.*The Studio.*Closed.*External provider/s);
  assert.ok(nodes(f.draw()).some((node) => node.props?.href === event.registrationUrl));
  f.click("Edit event");
  assert.ok(nodes(f.draw()).some((node) => node.type === "form"));
  f.click("Cancel");
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  assert.equal(f.requests.length, 0);
});

test("public event editing preserves version guards and leaves failed edits visible", async () => {
  const f = eventFixture({ respond: () => Response.json({ error: "Another operator changed this event. Reload first." }, { status: 409 }) });
  f.click("Edit event");
  await f.submit({ title: "Revised workshop", startsAt: "2026-09-20T10:00", publicationState: "published", eventState: "Upcoming", registrationUrl: event.registrationUrl });
  assert.equal(f.requests[0].body.expectedVersion, 4);
  assert.equal(f.requests[0].body.event.eventKey, "workshop");
  assert.equal(f.requests[0].body.event.timezone, "America/Denver");
  assert.ok(nodes(f.draw()).some((node) => node.type === "form"));
  assert.ok(nodes(f.draw()).some((node) => node.props?.role === "alert"));
  assert.match(text(f.draw()), /Another operator/);
});

test("public event success returns to saved details while previews cannot send", async () => {
  const f = eventFixture();
  f.click("Edit event");
  await f.submit({ title: event.title, startsAt: "2026-09-20T10:00" });
  assert.equal(f.requests.length, 1);
  assert.equal(f.refreshes(), 1);
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  const preview = eventFixture({}, { preview: true });
  preview.click("Edit event");
  await preview.submit();
  assert.equal(preview.requests.length, 0);
  const create = eventFixture({}, { event: undefined });
  assert.ok(nodes(create.draw()).some((node) => node.type === "form"), "new events still open directly into their creation form");
});

const shipment = { shipmentId: "shipment-one", memberName: "Example Member", carrier: "UPS", serviceLevel: "Ground", trackingNumber: "123456", trackingUrl: "https://www.ups.com/track", status: "exception", version: 7 };
const artifactProps = { artifacts: [], data: { templates: [{ templateId: "coin", name: "First Coin", status: "active", bindingVerified: true, livemode: true, productGid: "gid://shopify/Product/1", productHandle: "first-coin" }], shipments: [shipment], members: [] } };
const artifactFixture = (nestedName, options = {}) => fixture("src/components/platform/OperatorArtifactAdmin.tsx", artifactProps, { nestedName, ...options });

test("saved Artifact bindings and shipments open editors only after Edit, while delivery state stays visible", () => {
  const f = artifactFixture("ShopifyBindingForm");
  assert.match(text(f.draw()), /Shopify · first coin/);
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  f.click("Edit product");
  assert.ok(nodes(f.draw()).some((node) => node.type === "form"));
  f.click("Cancel");
  assert.equal(nodes(f.draw()).some((node) => node.type === "form"), false);
  assert.equal(f.requests.length, 0);
  const parent = fixture("src/components/platform/OperatorArtifactAdmin.tsx", artifactProps);
  assert.match(text(parent.draw()), /exception/);
  const tracking = artifactFixture("ShipmentUpdateForm");
  assert.equal(nodes(tracking.draw()).some((node) => node.type === "form"), false);
  tracking.click("Edit shipment");
  assert.ok(nodes(tracking.draw()).some((node) => node.type === "form"));
  tracking.click("Cancel");
  assert.equal(tracking.requests.length, 0);
});

test("shipment editing preserves its exact version and evidence; failures and preview writes remain guarded", async () => {
  const fields = { carrier: "UPS", status: "in_transit", trackingNumber: "123456", changeReason: "Carrier confirmed departure" };
  const f = artifactFixture("ShipmentUpdateForm", { respond: () => Response.json({ error: "Shipment was changed elsewhere." }, { status: 409 }) });
  f.click("Edit shipment");
  await f.submit(fields);
  assert.equal(f.requests[0].url, "/api/ops/artifact-shipments/shipment-one");
  assert.equal(f.requests[0].body.expectedVersion, 7);
  assert.equal(f.requests[0].body.changeReason, fields.changeReason);
  assert.ok(nodes(f.draw()).some((node) => node.type === "form"));
  const preview = artifactFixture("ShipmentUpdateForm", { preview: true });
  preview.click("Edit shipment");
  await preview.submit(fields);
  assert.equal(preview.requests.length, 0);
});
