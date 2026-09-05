import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, overrides = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in overrides) return overrides[name];
    return require(name);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
const AgreementText = load("src/components/membership/AgreementText.tsx").default;
const renderAgreement = (body) => renderToStaticMarkup(React.createElement(AgreementText, { body }));
const normalize = (text) => text.replace(/\s+/g, " ").trim();
function visibleText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  const children = visibleText(node.props.children);
  return ["p", "h4"].includes(node.type) ? `${children}\n` : children;
}

test("the approved pilot body renders ordered native sections without changing a word or its source hash", () => {
  const draft = source("docs/membership-pilot-agreement-draft.md");
  const body = draft.split("## Proposed member-facing text\n\n")[1]?.split("\n\n---\n")[0];
  assert.ok(body, "Approved member-facing text must be present separately from review notes");
  const before = createHash("sha256").update(body).digest("hex");
  const html = renderAgreement(body);
  assert.equal((html.match(/<h4\b/g) ?? []).length, 9);
  assert.match(html, /<strong[^>]*>The Ruined Project LLC<\/strong>/);
  assert.doesNotMatch(html, /### |\*\*|Internal review notes|Sources checked/);
  const headings = [...body.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  let previous = -1;
  for (const heading of headings) {
    const position = normalize(visibleText(AgreementText({ body }))).indexOf(heading);
    assert.ok(position > previous, `Section order preserved: ${heading}`);
    previous = position;
  }
  assert.equal(normalize(visibleText(AgreementText({ body }))), normalize(body.replace(/^### /gm, "").replace(/\*\*/g, "")));
  assert.equal(createHash("sha256").update(body).digest("hex"), before);
});

test("paragraphs remain distinct and source wrapping does not produce awkward extra line breaks", () => {
  const body = "### A section\r\n\r\nOne wrapped\r\nparagraph with **emphasis**.\r\n\r\nA second paragraph.\r\n";
  const html = renderAgreement(body);
  assert.equal((html.match(/<p\b/g) ?? []).length, 2);
  assert.match(html, /<p>One wrapped paragraph with <strong[^>]*>emphasis<\/strong>\.<\/p>/);
  assert.match(html, /<p>A second paragraph\.<\/p>/);
  assert.equal(normalize(visibleText(AgreementText({ body }))), "A section One wrapped paragraph with emphasis. A second paragraph.");
});

test("HTML and unsupported Markdown stay escaped text, including inside emphasized text", () => {
  const html = renderAgreement('### <img src=x onerror=alert(1)>\n\n**<script>alert("unsafe")</script>** & [open](javascript:alert(1))\n\nUnclosed **bold stays.');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&amp; \[open\]\(javascript:alert\(1\)\)/);
  assert.match(html, /Unclosed \*\*bold stays\./);
  assert.doesNotMatch(html, /<script|<img|<a\b|dangerouslySetInnerHTML/);
});

const JoinForm = load("src/components/membership/JoinForm.tsx", {
  "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
  "@stripe/stripe-js": { loadStripe: () => { throw new Error("Rendering must not initialize Stripe or create a payment"); } },
  "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
  "@/components/membership/AgreementText": { __esModule: true, default: AgreementText },
  "@/components/membership/MemberPhotoUpload": { __esModule: true, default: () => null },
  "@/lib/membership/entry-stage": load("src/lib/membership/entry-stage.ts"),
  "@/lib/membership/phone": load("src/lib/membership/phone.ts"),
}).default;
function join(publishableKey, stage = "payment") {
  return renderToStaticMarkup(React.createElement(JoinForm, {
    disabledReason: null, checkoutDisabledReason: null, checkoutEnabled: true, enabled: true,
    minimumAge: 18, photoStorageReady: true, publishableKey,
    initialOnboarding: {
      email: "member@example.test", requiredFieldsComplete: stage !== "profile",
      agreement: { id: "agreement-1", title: "Pilot agreement", version: "pilot-v1",
        body: "### First section\n\nRead the **exact words**.", acceptanceId: stage === "payment" ? "acceptance-1" : null },
      profile: { mobile: null, fulfillmentAddress: null, apparelSizing: null },
    },
  }));
}

test("Join renders only the published agreement through safe presentation and keeps acceptance server-versioned", () => {
  const html = join("pk_test_fixture", "agreement");
  assert.match(html, /role="region" tabindex="0"/);
  assert.match(html, /aria-label="Published membership agreement"/);
  assert.match(html, /<h4[^>]*>First section<\/h4>/);
  assert.match(html, /<strong[^>]*>exact words<\/strong>/);
  assert.doesNotMatch(html, /4242|###|\*\*/);
  const code = source("src/components/membership/JoinForm.tsx");
  assert.match(code, /<AgreementText body=\{onboarding\.agreement\.body\} \/>/);
  assert.match(code, /agreementVersionId: onboarding\.agreement\.id/);
  assert.doesNotMatch(code, /dangerouslySetInnerHTML|body:\s*onboarding\.agreement\.body/);
});

test("only test checkout shows the documented no-charge instructions and test card", () => {
  const html = join("pk_test_fixture");
  assert.match(html, /no real charge will occur/);
  assert.match(html, /Do not enter a real payment card/);
  assert.match(html, /4242 4242 4242 4242/);
  assert.match(html, /Any future date/);
  assert.match(html, /Any 3-digit number/);
  assert.match(html, /Open test checkout/);
  assert.doesNotMatch(html, /Payment is the final step|Open secure payment/);
});

test("live, missing, and non-test keys never claim that real checkout is a test; profile stays uncluttered", () => {
  for (const key of ["pk_live_fixture", null, "unknown_fixture"]) {
    const html = join(key);
    assert.doesNotMatch(html, /4242|no real charge|Do not enter a real|Any future date|Any 3-digit|Test checkout/);
    assert.match(html, /Membership payment/);
  }
  assert.match(join("pk_live_fixture"), /Open secure payment/);
  assert.doesNotMatch(join("pk_test_fixture", "profile"), /4242|no real charge|Test checkout/);
});
