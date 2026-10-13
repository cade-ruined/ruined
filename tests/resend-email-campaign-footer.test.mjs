import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as parse5 from "parse5";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/communications/resend-email-campaign-footer.ts", import.meta.url), "utf8");
const loaded = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(name => { assert.equal(name, "parse5"); return parse5; }, loaded, loaded.exports);
const { withCampaignUnsubscribe, hasCampaignUnsubscribe } = loaded.exports;
const marker = "{{{RESEND_UNSUBSCRIBE_URL}}}";
const nodes = node => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;

test("personal-note footer stays inside its contact cell after the sign-off, retaining all original bytes", () => {
  const html = '<!doctype html>\r\n<html><head></head><body style="background:#080807;color:#e9e4d9">'
    + '<!--[if mso]><table><tr><td><![endif]--><table><tr><td><p>One considered note.</p><img alt="All the love" src="https://example.test/signoff.png"></td></tr>'
    + '<tr><td style="border-top:1px solid #36352f;color:#9b978d"><p><a href="mailto:hello@example.test">Contact us</a></p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></body></html>';
  const output = withCampaignUnsubscribe(html, "One considered note.");
  const footer = nodes(parse5.parse(output.html, { sourceCodeLocationInfo: true })).find(node => attr(node, "data-ruined-campaign-footer"));
  assert.equal(footer.parentNode.tagName, "td");
  assert.match(attr(footer.parentNode, "style"), /border-top/);
  assert.equal(output.html.slice(0, footer.sourceCodeLocation.startOffset) + output.html.slice(footer.sourceCodeLocation.endOffset), html);
  assert.ok(output.html.indexOf('alt="All the love"') < footer.sourceCodeLocation.startOffset);
  assert.equal(output.text, `One considered note.\n\nUnsubscribe: ${marker}`);
  assert.ok(hasCampaignUnsubscribe(output.html));
  assert.deepEqual(withCampaignUnsubscribe(output.html, output.text), output);
});

test("existing real unsubscribe links accept provider whitespace and avoid duplicates", () => {
  for (const token of [marker, "{{{ RESEND_UNSUBSCRIBE_URL }}}"] ) {
    const html = `<html><body><footer><a href='${token}'><span>Manage preferences</span></a></footer></body></html>`;
    assert.ok(hasCampaignUnsubscribe(html));
    const output = withCampaignUnsubscribe(html, `Preferences: ${token}`);
    assert.equal(output.html, html);
    assert.equal(output.text, `Preferences: ${token}`);
  }
});

test("comments, hidden or empty anchors and plain-text markers cannot replace the visible footer", () => {
  for (const content of [
    `<!-- <a href="${marker}">Unsubscribe</a> -->`, `<p>${marker}</p>`,
    `<a href="${marker}"></a>`, `<a href="${marker}"><span hidden>Hidden</span></a>`,
    `<div hidden><a href="${marker}">Hidden</a></div>`,
    `<div style="display:none"><a href="${marker}">Hidden</a></div>`,
    `<div aria-hidden="true"><a href="${marker}">Hidden</a></div>`,
    `<template><a href="${marker}">Inert</a></template>`,
  ]) {
    assert.equal(hasCampaignUnsubscribe(content), false);
    const output = withCampaignUnsubscribe(content, "Note");
    assert.ok(hasCampaignUnsubscribe(output.html));
    assert.ok(output.html.startsWith(content));
  }
});

test("full documents and source fragments get a valid table outside inline text and rows", () => {
  for (const html of ["<p>A note.</p>", "<table><tr><td>A note.</td></tr></table>", '<html><body><a href="https://example.test">Read more</a></body></html>', '<html><head><title>A note</title></head></html>']) {
    const output = withCampaignUnsubscribe(html, "A note.");
    const document = parse5.parse(output.html);
    const footer = nodes(document).find(node => attr(node, "data-ruined-campaign-footer"));
    assert.equal(footer.parentNode.tagName, "body");
    assert.ok(hasCampaignUnsubscribe(output.html));
  }
});
