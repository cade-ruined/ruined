import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const Link = ({ children, ...props }) => React.createElement("a", props, children);
function load(path, overrides = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const dependency = name => {
    if (name in overrides) return overrides[name];
    if (name === "next/link") return Link;
    if (name === "@/lib/sharing") return { sharingMetadata: () => ({}) };
    if (name.startsWith("@/components/")) return load(`src/${name.slice(2)}.tsx`, overrides);
    if (name.startsWith("@/lib/")) return load(`src/${name.slice(2)}.ts`, overrides);
    if (name.startsWith("@/data/")) return load(`src/${name.slice(2)}.ts`, overrides);
    return require(name);
  };
  new Function("require", "module", "exports", "fetch", "window", js)(dependency, loaded, loaded.exports,
    () => assert.fail("Public SMS examples cannot send requests"),
    new Proxy({}, { get: () => assert.fail("Public SMS examples cannot persist or navigate") }));
  return loaded.exports;
}
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];

test("public SMS terms render consent evidence without an account or enrollment form", () => {
  const page = load("app/membership/text-messages/page.tsx");
  const html = renderToStaticMarkup(React.createElement(page.default));
  for (const text of ["recurring text messages from Ruined", "membership updates and call reminders", "Message frequency varies", "Message and data rates may apply", "Consent is not a condition of purchase or membership", "STOP", "HELP", "Interactive example", "No enrollment", "not currently enabled", "third parties or affiliates", "marketing or promotional purposes"]) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/membership#your-invitation"/);
  assert.match(html, /href="\/membership\/text-messages"/);
  assert.match(html, /mailto:connect@theruinedproject.com/);
  assert.doesNotMatch(html, /<form\b|type="submit"|action="/);
  assert.equal(page.metadata.alternates.canonical, "https://members.theruinedproject.com/membership/text-messages");
  assert.match(html, /START alone does not restore Ruined membership texts/);
  assert.match(html, /collect fresh text-message consent before messages can resume/);
  const checkbox = html.match(/<input[^>]*name="example-text-updates"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.doesNotMatch(checkbox, /checked|required/);
});

test("public example changes independent local choices, resets texts for a new number, and cannot enroll", () => {
  let cursor = 0;
  const slots = [];
  const react = { ...React, useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [slots[i], next => { slots[i] = next; }];
  } };
  const Example = load("src/components/membership/MemberSmsOptInExample.tsx", { react }).default;
  const render = () => { cursor = 0; return Example(); };
  const input = name => nodes(render()).find(node => node.type === "input" && node.props.name === name);
  const phone = () => nodes(render()).find(node => node.props.id === "sms-example-mobile");
  assert.equal(input("example-text-updates").props.checked, false);
  assert.equal(input("example-text-updates").props.required, undefined);
  input("example-text-updates").props.onChange({ currentTarget: { checked: true } });
  assert.equal(input("example-text-updates").props.checked, true);
  assert.match(renderToStaticMarkup(render()), /No text-message consent has been submitted/);
  input("example-email-updates").props.onChange({ currentTarget: { checked: false } });
  assert.equal(input("example-text-updates").props.checked, true);
  phone().props.onChange({ currentTarget: { value: "2025550124" } });
  assert.equal(input("example-text-updates").props.checked, false);
  phone().props.onChange({ currentTarget: { value: "" } });
  assert.equal(input("example-text-updates").props.disabled, true);
  assert.equal(nodes(render()).some(node => node.type === "form" || node.props.type === "submit"), false);
});

test("privacy revision is current and protects mobile data and SMS consent from marketing sharing", () => {
  const Privacy = load("app/privacy/page.tsx").default;
  const html = renderToStaticMarkup(React.createElement(Privacy));
  const legal = load("src/lib/membership/registration-legal-model.ts");
  assert.equal(legal.REGISTRATION_PRIVACY_VERSION, "privacy-2026-10-08");
  assert.match(html, /Effective October 8, 2026/);
  assert.match(html, /do not sell or share mobile information, SMS opt-in data, or consent with third parties or affiliates for their marketing or promotional purposes/);
  assert.match(html, /service providers only as needed to operate and deliver the text-message program/);
  assert.match(html, /Those providers may not use it for their own marketing or promotional purposes/);
  assert.match(html, /href="\/membership\/text-messages"/);
});

test("member footer keeps SMS terms and privacy on the member site while public navigation stays unchanged", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  const navigation = load("src/data/navigation.ts");
  const Footer = load("src/components/SiteFooter.tsx", {
    "next/image": () => null,
    "@/hooks/useBackgroundPathname": { useBackgroundPathname: () => "/membership/text-messages" },
    "@/data/navigation": { ...navigation, SERVICE_NAV_ITEMS: [...navigation.SERVICE_NAV_ITEMS, { label: "Future service", href: "/future-service" }] },
  }).default;
  try {
    for (const origin of ["https://members.theruinedproject.com", "https://members.theruinedproject.com/"]) {
      process.env.NEXT_PUBLIC_SITE_URL = origin;
      const html = renderToStaticMarkup(React.createElement(Footer));
      assert.match(html, /href="\/privacy">Privacy Policy<\/a>/);
      assert.match(html, /href="\/membership\/text-messages">SMS Terms<\/a>/);
      assert.doesNotMatch(html, /href="https:\/\/theruinedproject.com\/privacy"/);
      assert.match(html, /href="https:\/\/theruinedproject.com\/store"/);
      assert.match(html, /href="https:\/\/theruinedproject.com\/contact"/);
      assert.match(html, /href="https:\/\/theruinedproject.com\/future-service">Future service<\/a>/);
    }
    process.env.NEXT_PUBLIC_SITE_URL = "https://theruinedproject.com";
    const publicHtml = renderToStaticMarkup(React.createElement(Footer));
    assert.match(publicHtml, /href="\/privacy">Privacy<\/a>/);
    assert.doesNotMatch(publicHtml, /SMS Terms/);
    assert.match(publicHtml, /href="\/store"/);
    assert.match(publicHtml, /href="\/future-service">Future service<\/a>/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});
