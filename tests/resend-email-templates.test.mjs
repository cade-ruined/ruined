import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as parse5 from "parse5";
import ts from "typescript";

async function load(file, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = await load("src/lib/communications/admin-email-model.ts");
const { normalizeResendTemplate, renderResendEmailTemplate, normalizeResendEmailBanner } = await load("src/lib/communications/resend-email-templates.ts", {
  parse5, "./admin-email-model": model,
});
const provider = overrides => ({ id: "template-one", name: "An existing design", status: "published", current_version_id: "version-one",
  has_unpublished_versions: false, subject: "An update", from: "Ruined <sender@example.test>", reply_to: ["reply@example.test"],
  text: null, variables: [], html: "<!doctype html><html><body><p>A considered note.</p></body></html>", ...overrides });
const edits = (template, overrides = {}) => ({ subject: template.subject, values: {}, copy: {}, ...overrides });
const allNodes = node => [node, ...(node.childNodes ?? []).flatMap(allNodes)];

test("static designs round-trip byte-for-byte including assets, links, style, comments and CRLF", () => {
  const html = '<!DOCTYPE html>\r\n<html><head><style>@media(max-width:600px){.hero{width:100%}}</style><title>Existing title</title></head><body>\r\n'
    + '<!--[if mso]><table><tr><td>Original fallback</td></tr></table><![endif]-->'
    + '<span style="display:none;max-height:0">Private preheader</span><svg viewBox="0 0 1 1"><text>Official geometry</text></svg>'
    + '<table cellspacing="0" style="width:100%"><tr><td><img src="https://assets.example.test/original-logo.svg" width="140" alt="Exact mark">'
    + '<p class=copy>  Welcome &amp; hello.  </p><a href="https://example.test/path?a=1&amp;b=2" style="color:#111">Read more</a></td></tr></table>\r\n</body></html>';
  const template = normalizeResendTemplate(provider({ html }));
  const copy = Object.fromEntries(template.fields.map(field => [field.key, field.value]));
  assert.equal(renderResendEmailTemplate(template, edits(template, { copy }), { campaign: false }).html, html);
  assert.deepEqual(template.fields.map(field => field.value), ["Welcome & hello.", "Read more"]);
  assert.equal(template.campaignOnly, false);
});

test("copy replacements touch only selected text spans and keep duplicate nodes independent", () => {
  const html = '<html><body><p>  Hello &amp; welcome  </p><p>Hello &amp; welcome</p><a href="https://example.test/fixed">Original link</a></body></html>';
  const template = normalizeResendTemplate(provider({ html, text: "Hello & welcome\nHello & welcome\nOriginal link" }));
  const first = template.fields[0];
  const rendered = renderResendEmailTemplate(template, edits(template, { copy: { [first.key]: 'Less & more <script>alert("x")</script>' } }), { campaign: false });
  assert.equal(rendered.html, html.replace("  Hello &amp; welcome  ", "  Less &amp; more &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;  "));
  assert.match(rendered.text, /Less & more <script>/);
  assert.equal((rendered.text.match(/Hello & welcome/g) ?? []).length, 1);
  assert.match(rendered.text, /https:\/\/example.test\/fixed/);
  assert.equal(renderResendEmailTemplate(template, edits(template, { copy: { [first.key]: "" } }), { campaign: false }).html,
    html.replace("  Hello &amp; welcome  ", "    "));
});

test("declared string and numeric variables use supplied values and typed fallbacks", () => {
  const template = normalizeResendTemplate(provider({ html: '<p>Hello {{{NAME}}}. There are {{{COUNT}}} places.</p>', subject: "Hello {{{NAME}}}",
    text: "Hello {{{NAME}}}. There are {{{COUNT}}} places.", variables: [
      { key: "NAME", type: "string", fallback_value: "friend" }, { key: "COUNT", type: "number", fallback_value: 0 },
    ] }));
  const fallback = renderResendEmailTemplate(template, edits(template), { campaign: false });
  assert.equal(fallback.html, "<p>Hello friend. There are 0 places.</p>");
  assert.equal(fallback.subject, "Hello friend");
  const rendered = renderResendEmailTemplate(template, edits(template, { values: { NAME: "A < B & C", COUNT: "1e2" } }), { campaign: false });
  assert.equal(rendered.html, "<p>Hello A &lt; B &amp; C. There are 100 places.</p>");
  assert.equal(rendered.text, "Hello A < B & C. There are 100 places.");
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { values: { COUNT: "NaN" } }), { campaign: false }), /valid number/);
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { values: { COUNT: "0x20" } }), { campaign: false }), /valid number/);
});

test("variables cannot inject attributes, markup, script schemes or structural styling", () => {
  const template = normalizeResendTemplate(provider({
    html: '<a href={{{LINK}}} title={{{TITLE}}}><img src="https://example.test/fixed.svg">{{{LABEL}}}</a>',
    variables: ["LINK", "TITLE", "LABEL"].map(key => ({ key, type: "string", fallback_value: null })),
  }));
  const values = { LINK: "https://example.test/path?x=1&y=2", TITLE: 'Safe" autofocus onfocus="alert(1)', LABEL: "<script>x</script>" };
  const rendered = renderResendEmailTemplate(template, edits(template, { values }), { campaign: false });
  const anchor = allNodes(parse5.parse(rendered.html)).find(node => node.tagName === "a");
  assert.deepEqual(anchor.attrs.map(attr => attr.name), ["href", "title"]);
  assert.equal(anchor.attrs.find(attr => attr.name === "title").value, values.TITLE);
  assert.equal(anchor.attrs.find(attr => attr.name === "href").value, values.LINK);
  assert.doesNotMatch(rendered.html, /<script>/);
  for (const LINK of ["javascript:alert(1)", "data:text/html,<script>x</script>", "https://user:password@example.test", "https://example.test/a\nb"]) {
    assert.throws(() => renderResendEmailTemplate(template, edits(template, { values: { ...values, LINK } }), { campaign: false }), /link|Link|URL|whitespace/i);
  }
  for (const html of ['<p style="color:{{{VALUE}}}">Fixed</p>', '<script>{{{VALUE}}}</script>', '<p onclick="{{{VALUE}}}">Fixed</p>', '<div class="{{{VALUE}}}">Fixed</div>']) {
    const unsafe = normalizeResendTemplate(provider({ html, variables: [{ key: "VALUE", type: "string", fallback_value: "red" }] }));
    assert.throws(() => renderResendEmailTemplate(unsafe, edits(unsafe), { campaign: false }), /layout or active code/);
  }
});

test("campaign contact fallback and unsubscribe markers are preserved exactly and rejected for individuals", () => {
  const html = '<p>Hello {{{contact.first_name|friend}}},</p><p>One update.</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>';
  const template = normalizeResendTemplate(provider({ html, text: "Hello {{{contact.first_name|friend}}}\n{{{RESEND_UNSUBSCRIBE_URL}}}", has_unpublished_versions: true }));
  assert.equal(template.campaignOnly, true);
  assert.equal(template.hasUnpublishedVersions, true);
  assert.equal(renderResendEmailTemplate(template, edits(template), { campaign: true }).html, html);
  assert.throws(() => renderResendEmailTemplate(template, edits(template), { campaign: false }), /campaign personalization/);
  const field = template.fields.find(item => item.value === "One update.");
  const changed = renderResendEmailTemplate(template, edits(template, { copy: { [field.key]: "A clearer update." } }), { campaign: true });
  assert.equal(changed.html, html.replace("One update.", "A clearer update."));
  assert.match(changed.text, /\{\{\{contact.first_name\|friend\}\}\}/);
  assert.match(changed.text, /A clearer update/);
  assert.match(changed.text, /RESEND_UNSUBSCRIBE_URL/);
});

test("undeclared, missing and malformed placeholders or forged copy keys fail closed", () => {
  const template = normalizeResendTemplate(provider());
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { copy: { "text:0:1": "Injected" } }), { campaign: false }), /design changed/);
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { values: { UNKNOWN: "value" } }), { campaign: false }), /does not have/);
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { subject: "{{{contact.email}}}" }), { campaign: true }), /campaign personalization/);
  assert.throws(() => normalizeResendTemplate(provider({ html: "<p>{{BROKEN}}</p>" })), /unsupported|incomplete/);
  const missing = normalizeResendTemplate(provider({ html: "<p>{{{BODY}}}</p>", variables: [{ key: "BODY", type: "string", fallback_value: null }] }));
  assert.throws(() => renderResendEmailTemplate(missing, edits(missing), { campaign: false }), /Add a value/);
  assert.throws(() => renderResendEmailTemplate(missing, edits(missing, { values: { BODY: "{{{contact.email}}}" } }), { campaign: true }), /plain text/);
  const unknown = normalizeResendTemplate(provider({ html: "<p>{{{UNKNOWN}}}</p>" }));
  assert.throws(() => renderResendEmailTemplate(unknown, edits(unknown), { campaign: false }), /UNKNOWN/);
});

test("hidden preheaders and head text remain unchanged while variables there may fill safely", () => {
  const html = '<html><head><title>{{{TITLE}}}</title><style>body{color:black}</style></head><body><div hidden>Hidden</div><span aria-hidden="true">Hidden2</span><span style="mso-hide:all">Hidden3</span><p>Visible</p></body></html>';
  const template = normalizeResendTemplate(provider({ html, variables: [{ key: "TITLE", type: "string", fallback_value: "A title" }] }));
  assert.deepEqual(template.fields.map(field => field.value), ["Visible"]);
  assert.equal(renderResendEmailTemplate(template, edits(template), { campaign: false }).html, html.replace("{{{TITLE}}}", "A title"));
});

test("render enforces subject, individual field and combined edit limits", () => {
  const template = normalizeResendTemplate(provider({ html: "<p>{{{BODY}}}</p><p>One</p><p>Two</p><p>Three</p><p>Four</p>",
    variables: [{ key: "BODY", type: "string", fallback_value: "A note" }] }));
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { subject: "Subject\nBcc: x@example.test" }), { campaign: false }), /one line/);
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { values: { BODY: "x".repeat(6001) } }), { campaign: false }), /6,000/);
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { copy: { [template.fields[0].key]: "x".repeat(12001) } }), { campaign: false }), /12,000/);
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { values: { BODY: "x" }, copy: Object.fromEntries(template.fields.map(field => [field.key, "x".repeat(12000)])) }), { campaign: false }), /48,000/);
});

test("unsubscribe labels and decorative punctuation are never editable copy fields", () => {
  const html = '<p>Useful copy.</p><p>—</p><span> → </span><a href="{{{RESEND_UNSUBSCRIBE_URL}}}"><span>Unsubscribe from emails</span></a>';
  const template = normalizeResendTemplate(provider({ html }));
  assert.deepEqual(template.fields.map(field => field.value), ["Useful copy."]);
  const rendered = renderResendEmailTemplate(template, edits(template, { copy: { [template.fields[0].key]: "Changed copy." } }), { campaign: true });
  assert.ok(rendered.html.includes('<a href="{{{RESEND_UNSUBSCRIBE_URL}}}"><span>Unsubscribe from emails</span></a>'));
  const start = html.indexOf("Unsubscribe from emails"), end = start + "Unsubscribe from emails".length;
  assert.throws(() => renderResendEmailTemplate(template, edits(template, { copy: { [`text:${start}:${end}`]: "" } }), { campaign: true }), /design changed/);
});

const banner = { url: "https://images.example.com/event.jpg?size=1200&quality=90", alt: 'The next gathering — "A & B"', linkUrl: "https://www.example.com/gathering?source=email&format=banner" };

test("optional banner sits below the exact logo and above the first visible heading without changing original bytes", () => {
  const logo = '<a href="https://www.example.com"><img src="https://images.example.com/official-logo.png" width="150" height="45" alt="Ruined"></a>';
  const html = '<!doctype html>\r\n<html><head><style>h1{color:#ffca2c}</style></head><body>'
    + '<div hidden><h1>Private preheader</h1></div><div style="display:none"><h1>Another hidden heading</h1></div>'
    + '<table width="100%" style="max-width:600px"><tbody><tr><td style="padding:32px">'
    + logo + '<h1>One considered update.</h1><p>Hello {{{contact.first_name|friend}}}.</p>'
    + '<!--[if mso]><p>Original conditional fallback</p><![endif]--><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>'
    + '</td></tr></tbody></table></body></html>';
  const text = 'An authored plain-text alternative.\n\n{{{RESEND_UNSUBSCRIBE_URL}}}';
  const template = normalizeResendTemplate(provider({ html, text }));
  const rendered = renderResendEmailTemplate(template, edits(template, { banner }), { campaign: true });
  const nodes = allNodes(parse5.parse(rendered.html, { sourceCodeLocationInfo: true }));
  const image = nodes.find(node => node.tagName === "img" && node.attrs.some(attr => attr.name === "src" && attr.value === banner.url));
  assert.ok(image);
  const wrapper = image.parentNode.parentNode.parentNode.parentNode.parentNode;
  assert.equal(wrapper.tagName, "table");
  const { startOffset, endOffset } = wrapper.sourceCodeLocation;
  assert.equal(rendered.html.slice(0, startOffset) + rendered.html.slice(endOffset), html);
  assert.equal(html.slice(0, startOffset).endsWith(logo), true);
  assert.equal(rendered.html.slice(endOffset).startsWith("<h1>One considered update.</h1>"), true);
  assert.equal(image.attrs.find(attr => attr.name === "alt").value, banner.alt);
  assert.equal(image.attrs.find(attr => attr.name === "width").value, "536");
  assert.equal(image.attrs.find(attr => attr.name === "style").value, "display:block;width:100%;max-width:536px;height:auto;border:0");
  assert.ok(!image.attrs.some(attr => attr.name === "height"));
  assert.equal(image.parentNode.attrs.find(attr => attr.name === "href").value, banner.linkUrl);
  assert.equal(rendered.text, `${banner.alt}\n${banner.linkUrl}\n\n${text}`);
  assert.equal(template.html, html);
  assert.equal(renderResendEmailTemplate(template, edits(template), { campaign: true }).html, html);
  const removed = renderResendEmailTemplate(template, edits(template, { banner: null }), { campaign: true });
  assert.equal(removed.html, html);
  assert.equal(removed.text, text);
});

test("heading-free designs preserve logo-only paragraphs and tables and never nest a banner under inline text or table rows", () => {
  const logos = [
    '<p><a href="https://www.example.com"><img alt="Ruined" src="https://images.example.com/logo.png"></a></p>',
    '<table><tbody><tr><td><img alt="Ruined" src="https://images.example.com/logo.png"></td></tr></tbody></table>',
  ];
  for (const logo of logos) {
    const html = `<html><body><div style="width:720px;padding:0 24px">${logo}<p><a href="https://www.example.com"><strong>First copy.</strong></a></p><p>Second copy.</p></div></body></html>`;
    const template = normalizeResendTemplate(provider({ html }));
    const rendered = renderResendEmailTemplate(template, edits(template, { banner: { url: banner.url, alt: "A gathering" } }), { campaign: false });
    const nodes = allNodes(parse5.parse(rendered.html, { sourceCodeLocationInfo: true }));
    const image = nodes.find(node => node.tagName === "img" && node.attrs.some(attr => attr.name === "src" && attr.value === banner.url));
    const wrapper = image.parentNode.parentNode.parentNode.parentNode;
    assert.equal(wrapper.tagName, "table");
    assert.equal(wrapper.parentNode.tagName, "div");
    assert.equal(image.attrs.find(attr => attr.name === "width").value, "672");
    assert.equal(rendered.html.slice(0, wrapper.sourceCodeLocation.startOffset).endsWith(logo), true);
    assert.equal(rendered.html.slice(wrapper.sourceCodeLocation.endOffset).startsWith('<p><a href="https://www.example.com"><strong>First copy.'), true);
    assert.equal(rendered.text, `A gathering\n\n${renderResendEmailTemplate(template, edits(template), { campaign: false }).text}`);
  }
  for (const html of [
    '<table width="580"><tr><td><img src="https://images.example.com/logo.png" alt="Ruined"></td></tr></table>',
    '<table width="580"><tr><td></td></tr></table>',
    '<html><head><title>Only metadata</title></head></html>',
  ]) {
    const template = normalizeResendTemplate(provider({ html }));
    const rendered = renderResendEmailTemplate(template, edits(template, { banner }), { campaign: false });
    const nodes = allNodes(parse5.parse(rendered.html, { sourceCodeLocationInfo: true }));
    const image = nodes.find(node => node.tagName === "img" && node.attrs.some(attr => attr.name === "src" && attr.value === banner.url));
    const wrapper = image.parentNode.parentNode.parentNode.parentNode.parentNode;
    assert.equal(wrapper.tagName, "table");
    assert.ok(["body", "td"].includes(wrapper.parentNode.tagName));
    const { startOffset, endOffset } = wrapper.sourceCodeLocation;
    assert.equal(rendered.html.slice(0, startOffset) + rendered.html.slice(endOffset), html);
    if (html.includes('alt="Ruined"')) assert.ok(rendered.html.indexOf('alt="Ruined"') < rendered.html.indexOf(banner.url.replaceAll("&", "&amp;")));
  }
});

test("banner input rejects non-public or malformed URLs, placeholders, control characters and oversize fields", () => {
  const invalidUrls = [
    "/banner.jpg", "http://images.example.com/banner.jpg", "//images.example.com/banner.jpg", "javascript:alert(1)", "data:image/png;base64,x",
    "https://user:password@images.example.com/banner.jpg", "https://localhost/banner.jpg", "https://internal/banner.jpg", "https://service.local/banner.jpg",
    "https://service.internal/banner.jpg", "https://127.0.0.1/banner.jpg", "https://2130706433/banner.jpg", "https://10.0.0.1/banner.jpg", "https://[::1]/banner.jpg",
    "https://images.example.com/a\nb.jpg", "https://images.example.com/a b.jpg", "https://images.example.com/{{{IMAGE}}}", "https://images.example.com/%0ab.jpg",
    "https://images.example.com/" + "a".repeat(2048), "https://images.example.com/\" onerror=alert(1)",
  ];
  for (const url of invalidUrls) {
    assert.throws(() => normalizeResendEmailBanner({ ...banner, url }), /HTTPS|public|domain/);
    assert.throws(() => normalizeResendEmailBanner({ ...banner, linkUrl: url }), /HTTPS|public|domain/);
  }
  for (const alt of [undefined, "", "   ", "x".repeat(301), "Alternative\ntext", "{{{ALT}}}"]) {
    assert.throws(() => normalizeResendEmailBanner({ ...banner, alt }), /alternative text/);
  }
  for (const value of ["banner", [], {}, { ...banner, html: "<script>bad</script>" }, { ...banner, linkUrl: null }]) {
    assert.throws(() => normalizeResendEmailBanner(value));
  }
  assert.deepEqual(normalizeResendEmailBanner({ url: banner.url, alt: "  A gathering  ", linkUrl: "" }), { url: banner.url, alt: "A gathering" });
  assert.equal(normalizeResendEmailBanner(undefined), null);
  assert.equal(normalizeResendEmailBanner(null), null);
});

test("banner alt escapes markup and plaintext retains edited copy and provider markers", () => {
  const template = normalizeResendTemplate(provider({ html: '<h1>Original heading</h1><p>Original copy</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>', text: "Stale copy" }));
  const field = template.fields.find(item => item.value === "Original copy");
  const alt = '<img src=x onerror="bad()"> & artwork';
  const rendered = renderResendEmailTemplate(template, edits(template, { copy: { [field.key]: "Revised copy" }, banner: { url: banner.url, alt } }), { campaign: true });
  const nodes = allNodes(parse5.parse(rendered.html));
  const images = nodes.filter(node => node.tagName === "img");
  assert.equal(images.length, 1);
  assert.equal(images[0].attrs.find(attr => attr.name === "alt").value, alt);
  assert.ok(!images[0].attrs.some(attr => attr.name === "onerror"));
  assert.match(rendered.text, /Revised copy/);
  assert.doesNotMatch(rendered.text, /Stale copy/);
  assert.match(rendered.text, /RESEND_UNSUBSCRIBE_URL/);
  assert.equal(rendered.text.startsWith(`${alt}\n\nOriginal heading`), true);
});
