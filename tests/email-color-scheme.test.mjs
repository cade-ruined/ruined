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
const footer = await load("src/lib/communications/resend-email-campaign-footer.ts", { parse5, "./admin-email-model": model });
const { preserveRuinedEmailColors, normalizeResendTemplate, renderResendEmailTemplate } = await load("src/lib/communications/resend-email-templates.ts", {
  parse5, "./admin-email-model": model, "./resend-email-campaign-footer": footer,
});
const allNodes = node => [node, ...(node.childNodes ?? []).flatMap(allNodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const schemeNames = new Set(["color-scheme", "supported-color-schemes"]);
const schemeNodes = html => allNodes(parse5.parse(html, { sourceCodeLocationInfo: true }))
  .filter(node => node.tagName === "meta" && schemeNames.has(attr(node, "name")?.toLowerCase()));
function withoutSchemeMetadata(html) {
  for (const node of schemeNodes(html).sort((a, b) => b.sourceCodeLocation.startOffset - a.sourceCodeLocation.startOffset)) {
    const { startOffset, endOffset } = node.sourceCodeLocation;
    html = html.slice(0, startOffset) + html.slice(endOffset);
  }
  return html;
}
function assertFixedPalette(html) {
  const nodes = schemeNodes(html);
  for (const [name, content] of [["color-scheme", "light only"], ["supported-color-schemes", "light"]]) {
    const matches = nodes.filter(node => attr(node, "name")?.toLowerCase() === name);
    assert.equal(matches.length, 1, `Exactly one ${name} declaration is present`);
    assert.equal(attr(matches[0], "content"), content);
    assert.equal(matches[0].parentNode.tagName, "head");
  }
  assert.equal(preserveRuinedEmailColors(html), html, "Re-reviewing or sending must not accumulate markup");
}

// Minimal reproduction of the published Personal Note design. Keep its ink,
// inherited bone text, image sign-off and muted footer; no member data is used.
const body = '<body style="margin:0;background:#080807;color:#e9e4d9">\r\n'
  + '<!--[if mso]><table width="600"><tr><td><![endif]-->'
  + '<table bgcolor="#10100f" background="https://members.theruinedproject.com/membership/design/printers-ink.jpg" style="background:#10100f;color:#e9e4d9">'
  + '<tr><td><img src="https://members.theruinedproject.com/ruined-wordmark-email-bone.png" width="150" alt="Ruined"></td></tr>'
  + '<tr><td style="padding:0 40px 44px;color:#e9e4d9"><p style="margin:0 0 24px">Hi there,</p><p>One considered update.</p><p>RU/NED</p>'
  + '<img src="https://members.theruinedproject.com/membership/email/all-the-love-cadehandy2.png" alt="All the love" width="170"></td></tr>'
  + '<tr><td style="border-top:1px solid #36352f"><p><a href="mailto:connect@theruinedproject.com" style="color:#9b978d;text-decoration:none">connect@theruinedproject.com</a></p></td></tr>'
  + '</table><!--[if mso]></td></tr></table><![endif]-->\r\n</body>';
const personalNote = metadata => '<!doctype html>\r\n<html lang="en"><head><meta charset="utf-8">'
  + metadata + '<title>A note from Ruined</title><style>@media(max-width:480px){.email-pad{padding:24px}}</style></head>' + body + '</html>';

test("Personal Note keeps its exact authored ink, text, links, images and Outlook markup while opting out of recoloring", () => {
  const original = personalNote('<meta name="color-scheme" content="dark">');
  const result = preserveRuinedEmailColors(original);
  assertFixedPalette(result);
  assert.equal(withoutSchemeMetadata(result), withoutSchemeMetadata(original));
  assert.ok(result.includes(body), "All visible content is preserved byte-for-byte");
  assert.doesNotMatch(result, /gmail-blend|mix-blend-mode/, "Imported designs must not receive arbitrary blend wrappers");
});

test("missing, reordered and duplicate palette metadata resolves to one declaration of each kind", () => {
  for (const metadata of [
    "",
    '<meta content="dark" name="color-scheme" data-keep="original">',
    '<META NAME="COLOR-SCHEME" CONTENT="dark"><meta name="color-scheme" content="light dark">'
      + '<meta name="supported-color-schemes" content="dark"><meta name="supported-color-schemes" content="light dark">',
  ]) {
    const original = personalNote(metadata);
    const result = preserveRuinedEmailColors(original);
    assertFixedPalette(result);
    assert.equal(withoutSchemeMetadata(result), withoutSchemeMetadata(original));
  }
});

test("brand fragments without authored head markup gain valid metadata without losing their content", () => {
  for (const original of [body, `<html>${body}</html>`, body.replace(/<\/?body[^>]*>/g, "")]) {
    const result = preserveRuinedEmailColors(original);
    assertFixedPalette(result);
    const document = parse5.parse(result);
    const nodes = allNodes(document);
    assert.equal(nodes.filter(node => node.tagName === "img").length, 2);
    assert.equal(nodes.find(node => node.tagName === "a").attrs.find(item => item.name === "href").value, "mailto:connect@theruinedproject.com");
    assert.ok(result.includes("One considered update."));
    assert.ok(result.includes('style="padding:0 40px 44px;color:#e9e4d9"'));
  }
});

test("light cards retain their dark text and buttons and generic designs receive palette metadata", () => {
  const lightBody = '<body><img src="https://members.theruinedproject.com/ruined-wordmark-email.png" alt="Ruined">'
    + '<table bgcolor="#ffca2c"><tr><td style="color:#23231f"><p>Pricing</p>'
    + '<a style="background:#a83329;color:#fff9ec" href="https://members.example.test/my">Open your profile</a></td></tr></table></body>';
  const original = `<html><head><meta name="color-scheme" content="light"></head>${lightBody}</html>`;
  const result = preserveRuinedEmailColors(original);
  assertFixedPalette(result);
  assert.ok(result.includes(lightBody));
  for (const unknown of [
    '<html><head><meta name="color-scheme" content="light dark"></head><body>A different design.</body></html>',
    '<p>Ruined welcomes you.</p><img src="https://example.test/other-logo.png">',
    '<html><head><style>@media(prefers-color-scheme:dark){p{color:white}}</style></head><body><p>Dark support.</p></body></html>',
  ]) {
    const protectedHtml = preserveRuinedEmailColors(unknown);
    assertFixedPalette(protectedHtml);
    if (unknown.startsWith("<html>")) assert.equal(withoutSchemeMetadata(protectedHtml), withoutSchemeMetadata(unknown));
    else assert.ok(protectedHtml.includes(unknown), "Unbranded fragment source stays intact");
  }
});

test("original source-offset copy edits and campaign placeholders survive protection on the final rendered email", () => {
  const original = personalNote('<meta name="color-scheme" content="dark">')
    .replace("Hi there,", "Hello {{{contact.first_name|friend}}},")
    .replace("One considered update.", "One considered update. {{{DETAIL}}}")
    .replace('</table><!--[if mso]>', '<tr><td><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></td></tr></table><!--[if mso]>');
  const template = normalizeResendTemplate({ id: "template-one", name: "Personal note", status: "published", current_version_id: "version-one",
    has_unpublished_versions: false, subject: "A note from Ruined", from: "Ruined <sender@example.test>", reply_to: ["reply@example.test"],
    html: original, text: null, variables: [{ key: "DETAIL", type: "string", fallback_value: "A small detail." }] });
  const field = template.fields.find(item => item.value === "RU/NED");
  assert.ok(field, "Editor fields still refer to the untouched provider source");
  const rendered = renderResendEmailTemplate(template, { subject: template.subject, values: { DETAIL: "Safe & exact <copy>" },
    copy: { [field.key]: "Ruined team" }, typography: "ruined" }, { campaign: true });
  assertFixedPalette(rendered.html);
  assert.equal(template.html, original, "Rendering must not mutate the provider template or invalidate editor offsets");
  assert.ok(rendered.html.includes("Hello {{{contact.first_name|friend}}},"));
  assert.ok(rendered.html.includes('href="{{{RESEND_UNSUBSCRIBE_URL}}}"'));
  assert.ok(rendered.html.includes("Safe &amp; exact &lt;copy&gt;"));
  assert.ok(rendered.html.includes("Ruined team"));
  assert.ok(rendered.text.includes("Safe & exact <copy>"));
  assert.ok(rendered.text.includes("Ruined team"));
  assert.deepEqual(rendered.replyTo, ["reply@example.test"]);
  assert.equal(rendered.subject, "A note from Ruined");
});


test("full documents without Ruined assets preserve exact artwork, author styles and copy", () => {
  for (const artwork of ["", '<img src="https://example.com/a-different-logo.svg?version=2" alt="An original mark">']) {
    const original = '<!doctype html>\r\n<html lang="en"><head><style>p{color:#23231f}@media(prefers-color-scheme:dark){.authored{color:#fff}}</style></head><body>'
      + artwork + '<!--[if mso]><table><tr><td><![endif]--><p class="authored" style="color:#e9e4d9">Exact &amp; considered.</p><!--[if mso]></td></tr></table><![endif]--></body></html>';
    const result = preserveRuinedEmailColors(original);
    assertFixedPalette(result);
    assert.equal(withoutSchemeMetadata(result), original);
  }
});

test("generic fragments with partial metadata get one valid head without altering their visible bytes", () => {
  const content = '<p style="color:#e9e4d9">One precise note.</p><img src="https://example.com/original.svg" alt="Original">';
  for (const original of [content, '<meta name="color-scheme" content="dark">' + content,
    '<!doctype html><meta name="supported-color-schemes" content="dark">' + content,
    '<body><meta name="color-scheme" content="dark">' + content + '</body>',
    '<html><meta name="color-scheme" content="dark"><style>p{margin:0}</style><body>' + content + '</body></html>']) {
    const result = preserveRuinedEmailColors(original);
    assertFixedPalette(result);
    assert.ok(result.includes(content));
    assert.equal((result.match(/<!doctype/gi) ?? []).length, (original.match(/<!doctype/gi) ?? []).length || (original.includes('<body>') ? 0 : 1));
  }
});

test("misplaced body metadata is removed and replaced in the real head", () => {
  const original = '<html><head><title>Source title</title></head><body><meta name="color-scheme" content="dark"><p>Exact source.</p><meta name="supported-color-schemes" content="dark"></body></html>';
  const result = preserveRuinedEmailColors(original);
  assertFixedPalette(result);
  assert.equal(withoutSchemeMetadata(result), withoutSchemeMetadata(original));
});

test("individual no-logo designs stay individual and source offsets remain editable", () => {
  const original = '<p>A personal note.</p><p>Signed, Ruined.</p>';
  const template = normalizeResendTemplate({ id: "generic", name: "A personal note", status: "published", current_version_id: "one", has_unpublished_versions: false,
    subject: "A note", from: "Ruined <sender@example.test>", reply_to: [], html: original, text: "A personal note.\nSigned, Ruined.", variables: [] });
  const before = structuredClone(template);
  const field = template.fields[0];
  const result = renderResendEmailTemplate(template, { subject: template.subject, values: {}, copy: { [field.key]: "A revised personal note." } }, { campaign: false });
  assertFixedPalette(result.html);
  assert.ok(result.html.includes('<p>A revised personal note.</p><p>Signed, Ruined.</p>'));
  assert.equal(result.text, "A revised personal note.\n\nSigned, Ruined.");
  assert.deepEqual(template, before);
  assert.equal(template.campaignOnly, false);
  assert.doesNotMatch(result.html, /RESEND_UNSUBSCRIBE_URL|contact\./);
});
