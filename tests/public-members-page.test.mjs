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
function load(path, dependencies = {}, environment = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "process", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime" || name === "react") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "next/image") return { __esModule: true, default: ({ src, alt, sizes, className }) => React.createElement("img", { src, alt, sizes, className }) };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, property) => property }) };
    // The public waitlist must not start loading private account or billing data.
    throw new Error(`Unexpected public page dependency: ${name}`);
  }, cjsModule, cjsModule.exports, { env: environment });
  return cjsModule.exports;
}

const membership = load("src/data/public-membership.ts");
const MembershipWaitlistForm = load("src/components/public-members/MembershipWaitlistForm.tsx").default;
const JourneyMembersPreview = load("src/components/sequence/JourneyMembersPreview.tsx", {
  "@/data/public-membership": membership,
  "@/components/public-members/MembershipWaitlistForm": { __esModule: true, default: MembershipWaitlistForm },
}).default;
const preview = parseFragment(renderToStaticMarkup(React.createElement(JourneyMembersPreview, { headingId: "test-members-heading" })));
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
  assert.equal(new Set(ids).size, ids.length, "rendered IDs must be unique");
  for (const node of nodes) {
    for (const id of (attr(node, "aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
      const label = nodes.find((candidate) => attr(candidate, "id") === id);
      assert.ok(label, `${node.tagName} references missing label ${id}`);
      assert.ok(text(label).trim(), `label ${id} has no text`);
    }
    if (node.tagName === "a") {
      assert.ok(accessibleText(node).trim() || attr(node, "aria-label"), "every link has a name beyond decorative arrows");
    }
  }
}

test("the Members walk section stays focused on its title, signup form, and film", () => {
  assertAccessibleStructure(preview);
  assert.equal(descendants(preview, "h1").length, 0, "embedded content does not add a second page title");
  assert.equal(descendants(preview, "h2").length, 1);
  assert.equal(attr(descendants(preview, "h2")[0], "id"), "test-members-heading");
  assert.equal(text(descendants(preview, "h2")[0]), membership.MEMBERSHIP_INTRO.headline);
  assert.equal(attr(descendants(preview, "section")[0], "aria-labelledby"), "test-members-heading");
  assert.equal(descendants(preview, "form").length, 1, "signup is available directly in the walk");
  assert.equal(attr(descendants(preview, "form")[0], "aria-label"), "Membership waitlist");
  assert.deepEqual(descendants(preview, "a").map((link) => attr(link, "href")), [
    "/media/membership-introduction.mp4",
  ]);
  assert.equal(descendants(preview, "video").length, 1);
  assert.equal(descendants(preview, "figcaption").length, 0);
  assert.equal(descendants(preview, "iframe").length, 0);
  assert.doesNotMatch(text(preview), /Explore membership & pricing|Member sign-in|Leave your details|We’ll be in touch|Inside Ruined|2:15/);
  assert.ok(!descendants(preview, "p").some((paragraph) => text(paragraph).trim() === "Members"), "the title does not need an extra Members eyebrow");
  assert.doesNotMatch(text(preview), /\$\s*\d|\bUSD\s*\d|\b\d+(?:\.\d{2})?\s*\/\s*(?:month|year|mo|yr)\b/i);
});

test("the embedded signup labels its fields and makes phone optional", () => {
  const form = descendants(preview, "form")[0];
  const inputs = descendants(form, "input");
  assert.deepEqual(inputs.map((node) => attr(node, "name")), ["website", "name", "email", "phone"]);
  for (const input of inputs) {
    assert.ok(descendants(form, "label").some((label) => attr(label, "for") === attr(input, "id")), "every waitlist field has a label");
  }
  const byName = (name) => inputs.find((input) => attr(input, "name") === name);
  assert.equal(attr(byName("name"), "required"), "");
  assert.equal(attr(byName("email"), "required"), "");
  assert.equal(attr(byName("email"), "type"), "email");
  assert.equal(attr(byName("email"), "inputmode"), "email");
  assert.equal(attr(byName("phone"), "required"), undefined);
  assert.equal(attr(byName("phone"), "type"), "tel");
  assert.equal(attr(byName("website"), "tabindex"), "-1");
  const submit = descendants(form, "button").find((button) => attr(button, "type") === "submit");
  assert.ok(submit);
  assert.equal(accessibleText(submit).trim(), "Join the waitlist");
  assert.ok(elements(form).some((node) => attr(node, "role") === "status" && attr(node, "aria-live") === "polite"));
});

test("desktop and mobile signup copies retain unique IDs and associated labels", () => {
  const bothPreviews = parseFragment(renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(JourneyMembersPreview, { headingId: "desktop-members-heading" }),
    React.createElement(JourneyMembersPreview, { headingId: "mobile-members-heading" }),
  )));
  assertAccessibleStructure(bothPreviews);
  assert.equal(descendants(bothPreviews, "form").length, 2);
  for (const form of descendants(bothPreviews, "form")) {
    for (const input of descendants(form, "input")) {
      assert.ok(descendants(form, "label").some((label) => attr(label, "for") === attr(input, "id")), "each form owns its input labels");
    }
  }
});

test("the former Members subpage redirects visitors to the signup in the walk", () => {
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
  assert.equal(route.metadata, undefined, "the old subpage does not keep a separate canonical URL");
});

test("opening public invitations preserves the film and sends signup to the member site without a local form", () => {
  const OpenMembers = load("src/components/sequence/JourneyMembersPreview.tsx", {
    "@/data/public-membership": membership,
    "@/components/public-members/MembershipWaitlistForm": { __esModule: true, default: MembershipWaitlistForm },
  }, { NEXT_PUBLIC_MEMBERSHIP_SIGNUP_ENABLED: "true" }).default;
  const document = parseFragment(renderToStaticMarkup(React.createElement(OpenMembers, { headingId: "open-members" })));
  assertAccessibleStructure(document);
  assert.equal(descendants(document, "form").length, 0);
  const invitation = descendants(document, "a").find(link => accessibleText(link).trim() === "Request your invitation");
  assert.equal(attr(invitation, "href"), "https://members.theruinedproject.com/signup");
  assert.equal(attr(invitation, "target"), undefined, "continue in the same tab");
  assert.equal(descendants(document, "video").length, 1);
  assert.equal(attr(descendants(document, "video")[0], "poster"), "/membership/foundations/beginning.webp");
  assert.equal(attr(descendants(document, "source")[0], "src"), "/media/membership-introduction.mp4");
  assert.doesNotMatch(text(document), /pay|charge|subscription|\$\s*\d/i, "public CTA must not promise a payment flow before the member site checks readiness");
});

test("public invitation release is closed unless its build flag explicitly says true", () => {
  for (const value of [undefined, "", "false", "1", "yes"]) {
    const WaitlistMembers = load("src/components/sequence/JourneyMembersPreview.tsx", {
      "@/data/public-membership": membership,
      "@/components/public-members/MembershipWaitlistForm": { __esModule: true, default: MembershipWaitlistForm },
    }, { NEXT_PUBLIC_MEMBERSHIP_SIGNUP_ENABLED: value }).default;
    const document = parseFragment(renderToStaticMarkup(React.createElement(WaitlistMembers, { headingId: "closed-members" })));
    assert.equal(descendants(document, "form").length, 1);
    assert.equal(attr(descendants(document, "form")[0], "aria-label"), "Membership waitlist");
    assert.equal(descendants(document, "a").some(link => attr(link, "href") === membership.MEMBERSHIP_LINKS.signUp), false);
  }
});
