import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function contextPages(relativeDirectory, contextCall) {
  const directory = new URL(`../${relativeDirectory}/`, import.meta.url);
  const entries = await readdir(directory, { recursive: true });
  const pages = [];

  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.endsWith("page.tsx")) continue;
    const contents = await readFile(new URL(entry, directory), "utf8");
    if (contents.includes(contextCall)) pages.push({ contents, entry });
  }

  return pages.sort((left, right) => left.entry.localeCompare(right.entry));
}

test("permission and connection fallbacks use distinct plain-language copy", async () => {
  const component = await readFile(
    new URL("../src/components/platform/PlatformUnavailable.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /reason\?: "connection" \| "member_access" \| "operator_access"/);
  assert.match(component, /title: "Member access required\."/);
  assert.match(component, /does not have member access/);
  assert.match(component, /email tied to your Ruined Membership/);
  assert.match(component, /title: "Operator access required\."/);
  assert.match(component, /does not have an active operator role/);
  assert.match(component, /title: "Connection required\."/);
  assert.match(component, /unavailable until its secure connection returns/);
  assert.match(component, /accessHref && reason === "connection"/);
  assert.match(component, /text-black\/58/);
  assert.doesNotMatch(component, /text-white\/50/);
});

test("every member page context handles denied before its unavailable fallback", async () => {
  const modernPages = await contextPages("app/my", "getMembershipPageContext(");
  const legacyPages = await contextPages("app/my", "getMemberPageContext(");
  const pages = [...modernPages, ...legacyPages];

  assert.equal(modernPages.length, 11);
  assert.equal(legacyPages.length, 3);
  for (const { contents, entry } of pages) {
    const denied = contents.indexOf('context.state === "denied"');
    const deniedFallback = contents.indexOf('reason="member_access"');
    assert.ok(denied >= 0, `${entry} must recognize an authenticated non-member`);
    assert.ok(deniedFallback > denied, `${entry} must show the member permission fallback`);
    assert.match(contents, /context\.state === "signed_out"[\s\S]*redirect\("\/my\/access"\)/);
  }
});

test("every operator page context uses operator permission copy for denied accounts", async () => {
  const pages = await contextPages("app/ops", "getOperatorPageContext(");
  const overview = await readFile(new URL("../app/ops/page.tsx", import.meta.url), "utf8");

  assert.equal(pages.length, 10);
  for (const { contents, entry } of pages) {
    const denied = contents.indexOf('context.state === "denied"');
    const deniedFallback = contents.indexOf('reason="operator_access"');
    assert.ok(denied >= 0, `${entry} must recognize an authenticated non-operator`);
    assert.ok(deniedFallback > denied, `${entry} must show the operator permission fallback`);
    assert.doesNotMatch(contents, /title="Operator access required\."/);
  }

  assert.match(overview, /OpsOperatingRepositoryError/);
  assert.match(overview, /error\.code === "forbidden"[\s\S]*reason="operator_access"/);
  assert.match(overview, /if \(!viewer\) redirect\("\/ops\/access"\)/);
});
