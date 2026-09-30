import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const viewer = { authUserId: "00000000-0000-4000-8000-000000000001" };
async function fixture({ destination = null, billingState = "pending", state = "authenticated", missingViewer = false, failure = false } = {}) {
  const source = await readFile(new URL("../app/my/join/complete/page.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} }, lookups = [], logs = [];
  const Unavailable = () => null;
  const deps = {
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "next/navigation": { redirect: href => { throw Object.assign(Error("redirect"), { href }); } },
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/platform/page-data": { getMemberPageContext: async () => ({ state, member: { billingState }, viewer: missingViewer ? null : viewer }) },
    "@/lib/membership/registration-repository": { getMemberRegistrationDestination: async id => { lookups.push(id); if (failure) throw Error("PRIVATE DATABASE DETAIL"); return destination; } },
    "@/lib/sharing": { privateSharingMetadata: {} },
  };
  new Function("require", "module", "exports", "console", code)(name => name in deps ? deps[name] : require(name), loaded, loaded.exports, { error: (...args) => logs.push(args) });
  return { page: loaded.exports.default, lookups, logs, Unavailable };
}

test("legacy checkout completion respects every durable registration stage before billing status", async () => {
  for (const destination of ["/my/join", "/my/payment-method", "/my/registered"]) {
    for (const billingState of ["pending", "active"]) {
      const f = await fixture({ destination, billingState });
      await assert.rejects(f.page, error => error.href === destination);
      assert.deepEqual(f.lookups, [viewer.authUserId]);
    }
  }
});

test("existing members preserve payment confirmation and activated home behavior", async () => {
  const pending = await fixture();
  const html = renderToStaticMarkup(await pending.page());
  assert.match(html, /Stripe is confirming your payment/);
  assert.match(html, /return screen never activates access by itself/);
  const active = await fixture({ billingState: "active" });
  await assert.rejects(active.page, error => error.href === "/my");
});

test("registration lookup failure cannot fall through to payment confirmation or member home", async () => {
  for (const billingState of ["pending", "active"]) {
    const f = await fixture({ failure: true, billingState });
    const result = await f.page();
    assert.equal(result.type, f.Unavailable); assert.equal(result.props.accessHref, "/my/access");
    assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE DATABASE/);
  }
  const malformed = await fixture({ missingViewer: true });
  assert.equal((await malformed.page()).type, malformed.Unavailable); assert.deepEqual(malformed.lookups, []);
});

test("signed-out, denied, unavailable and preview visits never make a live registration lookup", async () => {
  const signedOut = await fixture({ state: "signed_out" });
  await assert.rejects(signedOut.page, error => error.href === "/my/access"); assert.deepEqual(signedOut.lookups, []);
  for (const state of ["denied", "unavailable"]) {
    const f = await fixture({ state }); assert.equal((await f.page()).type, f.Unavailable); assert.deepEqual(f.lookups, []);
  }
  const preview = await fixture({ state: "preview" });
  assert.match(renderToStaticMarkup(await preview.page()), /Confirmation in progress/); assert.deepEqual(preview.lookups, []);
});
