import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, dependencies = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime" || name === "react") return require(name);
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, property) => property }) };
    throw new Error(`Unexpected public page dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const MembershipWaitlistForm = load("src/components/public-members/MembershipWaitlistForm.tsx").default;
const JourneyMembersPreview = load("src/components/sequence/JourneyMembersPreview.tsx", {
  "react-dom": { createPortal: () => assert.fail("Initial server rendering must not create a modal portal") },
  "./MembershipLandingModal": { __esModule: true, default: () => assert.fail("Initial rendering must not mount the landing page") },
}).default;
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
function elements(node) {
  return [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
}
const descendants = (node, tag) => elements(node).filter((item) => item.tagName === tag);
function text(node) {
  return node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
}
function accessibleText(node) {
  if (attr(node, "aria-hidden") === "true") return "";
  return node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(accessibleText).join("");
}
function assertAccessibleStructure(document) {
  const nodes = elements(document);
  const ids = nodes.map((node) => attr(node, "id")).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "Rendered IDs must be unique");
  for (const node of nodes) {
    for (const id of (attr(node, "aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
      const label = nodes.find((candidate) => attr(candidate, "id") === id);
      assert.ok(label, `${node.tagName} references missing label ${id}`);
      assert.ok(text(label).trim(), `Label ${id} has no text`);
    }
    if (node.tagName === "a" || node.tagName === "button") {
      assert.ok(accessibleText(node).trim() || attr(node, "aria-label"), "Interactive controls need an accessible name");
    }
  }
}

test("the Members walk renders an accessible landing-page snippet with one dialog launcher", () => {
  const preview = parseFragment(renderToStaticMarkup(React.createElement(JourneyMembersPreview, { headingId: "test-members-heading" })));
  assertAccessibleStructure(preview);
  assert.equal(descendants(preview, "h1").length, 0, "Embedded content must not add a second page title");
  const headings = elements(preview).filter((node) => node.tagName === "h2" || (attr(node, "role") === "heading" && attr(node, "aria-level") === "2"));
  assert.equal(headings.length, 1);
  assert.equal(attr(headings[0], "id"), "test-members-heading");
  assert.ok(text(headings[0]).trim());
  assert.equal(attr(descendants(preview, "section")[0], "aria-labelledby"), "test-members-heading");
  assert.equal(descendants(preview, "button").length, 1);
  const launch = descendants(preview, "button")[0];
  assert.equal(attr(launch, "type"), "button");
  assert.equal(attr(launch, "aria-haspopup"), "dialog");
  assert.equal(attr(launch, "aria-expanded"), "false");
  for (const tag of ["form", "iframe", "video"]) assert.equal(descendants(preview, tag).length, 0, `${tag} is not loaded in the snippet`);
  assert.doesNotMatch(text(preview), /Join the waitlist|pay today|\$\s*\d/i);
});

test("desktop and mobile preview instances keep unique headings and launch controls", () => {
  const both = parseFragment(renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(JourneyMembersPreview, { headingId: "desktop-members-heading" }),
    React.createElement(JourneyMembersPreview, { headingId: "mobile-members-heading" }),
  )));
  assertAccessibleStructure(both);
  assert.equal(descendants(both, "button").length, 2);
  assert.deepEqual(descendants(both, "section").map((node) => attr(node, "aria-labelledby")), ["desktop-members-heading", "mobile-members-heading"]);
  assert.equal(descendants(both, "iframe").length, 0);
});

test("the retained standalone waitlist form labels its fields and keeps phone optional", () => {
  const document = parseFragment(renderToStaticMarkup(React.createElement(MembershipWaitlistForm)));
  assertAccessibleStructure(document);
  const form = descendants(document, "form")[0];
  assert.equal(attr(form, "aria-label"), "Membership waitlist");
  const inputs = descendants(form, "input");
  assert.deepEqual(inputs.map((node) => attr(node, "name")), ["website", "name", "email", "phone"]);
  for (const input of inputs) {
    assert.ok(descendants(form, "label").some((label) => attr(label, "for") === attr(input, "id")), "Every waitlist field has a label");
  }
  const byName = (name) => inputs.find((input) => attr(input, "name") === name);
  assert.equal(attr(byName("name"), "required"), "");
  assert.equal(attr(byName("email"), "required"), "");
  assert.equal(attr(byName("email"), "type"), "email");
  assert.equal(attr(byName("phone"), "required"), undefined);
  assert.equal(attr(byName("phone"), "type"), "tel");
  assert.equal(attr(byName("website"), "tabindex"), "-1");
  const submit = descendants(form, "button").find((button) => attr(button, "type") === "submit");
  assert.equal(accessibleText(submit).trim(), "Join the waitlist");
  assert.ok(elements(form).some((node) => attr(node, "role") === "status" && attr(node, "aria-live") === "polite"));
});

test("the former Members subpage redirects visitors to Members in the walk", () => {
  const redirected = new Error("redirect");
  const destinations = [];
  const route = load("app/members/page.tsx", {
    "next/navigation": { redirect: (destination) => {
      destinations.push(destination);
      throw redirected;
    } },
  });
  assert.throws(() => route.default(), (error) => error === redirected);
  assert.deepEqual(destinations, ["/#members"]);
  assert.equal(route.metadata, undefined, "The old subpage does not keep a separate canonical URL");
});
