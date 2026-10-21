import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as parse5 from "parse5";
import ts from "typescript";

async function load(name, dependencies = {}) {
  const source = await readFile(new URL(`../src/lib/communications/${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const admin = await load("admin-email-model");
const campaignFooter = await load("resend-email-campaign-footer", { parse5 });
const templates = await load("resend-email-templates", { parse5, "./admin-email-model": admin, "./resend-email-campaign-footer": campaignFooter });
const model = await load("member-email-cadence-model");
const copy = await load("member-email-cadence-copy", { "./member-email-cadence-model": model });
const renderer = await load("member-email-cadence-renderer", { parse5, "./admin-email-model": admin,
  "./resend-email-templates": templates, "./member-email-cadence-copy": copy });
const nodes = node => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const variable = key => ({ key, type: "string", fallback_value: null });
const event = { id: "call-one", title: "Foundations 01", startsAt: "2026-11-05T22:00:00Z", endsAt: "2026-11-05T23:30:00Z", timeZone: "America/Denver",
  version: "1", visibility: "invite_only", circle_id: null, block_id: null, progression_level_slug: null, registration_mode: "internal", kind: "weekly_call" };
function fixture(provider = {}, draft = {}) {
  const template = templates.normalizeResendTemplate({ id: "template-one", name: "Authored Resend design", status: "published", current_version_id: "version-one",
    from: "Ruined <sender@example.test>", reply_to: ["reply@example.test"], subject: "Existing subject", text: null,
    variables: [variable("HEADING"), variable("BODY")],
    html: '<!DOCTYPE html><html><head><style>.original{padding:24px}</style></head><body><!--[if mso]>Original Outlook fallback<![endif]--><table width="600" cellspacing="0" style="border:1px solid #222"><tr><td class="original"><img src="https://assets.example.test/original-logo.png" width="140" alt="Exact Ruined mark"><h1>{{{HEADING}}}</h1><p data-message="true">{{{BODY}}}</p><a href="https://example.test/original?x=1&amp;y=2">Original footer</a></td></tr></table></body></html>', ...provider });
  const plan = { id: "plan-one", revision: 1, active: true, activatedAt: "2026-10-12T18:00:00Z", eventId: event.id, kind: "foundations_01", track: "members",
    templateId: template.id, templateVersion: template.version, template, event, siteUrl: "https://members.example.test", bodyTarget: "variable:BODY", headingTarget: "variable:HEADING", bindings: {}, ...draft };
  return { plan, event, stage: "day_before", memberName: "Jamie", email: "jamie@example.test" };
}

test("actual cadence rendering retains the approved design assets, layout, comments and authored links", () => {
  const result = renderer.renderCadenceEmail(fixture());
  assert.match(result.html, /<style>\.original\{padding:24px\}<\/style>/);
  assert.match(result.html, /<!--\[if mso\]>Original Outlook fallback<!\[endif\]-->/);
  assert.ok(result.html.includes('<table width="600" cellspacing="0" style="border:1px solid #222">'));
  assert.ok(result.html.includes('<img src="https://assets.example.test/original-logo.png" width="140" alt="Exact Ruined mark">'));
  assert.equal(attr(nodes(parse5.parse(result.html)).find(node => node.tagName === "a" && attr(node, "href")?.includes("/original")), "href"), "https://example.test/original?x=1&y=2");
  assert.match(result.html, /IvyOra/);
  assert.equal(result.from, "Ruined <sender@example.test>");
  assert.deepEqual(result.replyTo, ["reply@example.test"]);
  assert.equal(result.to, "jamie@example.test");
  assert.equal(result.subject, "Tomorrow: Foundations 01.");
  assert.doesNotMatch(result.html + result.text, /RUINED_CADENCE_BODY_|\{\{\{/);
});

test("server bindings and body text remain escaped while line breaks and exact URL destinations are rendered once", () => {
  const f = fixture({ variables: [variable("HEADING"), variable("BODY"), variable("NAME"), variable("CALL"), variable("DATE"), variable("TIME"), variable("LINK"), variable("COUNT")],
    html: '<html><body><h1>{{{HEADING}}}</h1><p>{{{NAME}}} | {{{CALL}}} | {{{DATE}}} | {{{TIME}}} | {{{COUNT}}}</p><p data-message="true">{{{BODY}}}</p><a href="{{{LINK}}}">Calendar</a></body></html>' },
  { bindings: { NAME: { source: "member_name" }, CALL: { source: "call_title" }, DATE: { source: "call_date" }, TIME: { source: "call_time" }, LINK: { source: "call_url" }, COUNT: { source: "literal", value: "Four calls" } } });
  f.memberName = '<img src=x onerror="alert(1)"> & Jamie';
  const result = renderer.renderCadenceEmail(f);
  const all = nodes(parse5.parse(result.html));
  assert.equal(all.filter(node => node.tagName === "img").length, 0);
  assert.ok(result.html.includes("&lt;img src=x onerror=&quot;"));
  assert.match(result.html, /<br>/);
  assert.match(result.text, /Thursday, November 5/);
  assert.match(result.text, /3:00(?:–4:30)? PM M[ST]/);
  assert.match(result.text, /Four calls/);
  const expected = new Set(["https://members.example.test/my/experiences#experience-call-one", "https://members.example.test/my", "https://members.example.test/my/account#email-reminders"]);
  for (const anchor of all.filter(node => node.tagName === "a")) {
    assert.ok(expected.has(attr(anchor, "href")), `Malformed or nested URL: ${attr(anchor, "href")}`);
    assert.equal(nodes(anchor).slice(1).some(node => node.tagName === "a"), false);
  }
  for (const url of expected) assert.ok(all.some(node => node.tagName === "a" && attr(node, "href") === url), url);
});

test("generated links keep readable inline color and wrapping after a mail client removes head styles, without changing approved copy", () => {
  const authoredLink = '<a href="https://example.test/original" style="color:#f3efe6">Original footer</a>';
  const f = fixture({ html: `<html><head><style>a{color:#ffca2c}</style></head><body style="background:#111111;color:#f3efe6"><h1>{{{HEADING}}}</h1><p data-message="true">{{{BODY}}}</p>${authoredLink}</body></html>` });
  const approved = copy.cadenceCopy({ event: f.event, kind: f.plan.kind, track: f.plan.track,
    stage: f.stage, memberName: f.memberName, siteUrl: f.plan.siteUrl });
  const result = renderer.renderCadenceEmail(f);
  assert.equal(result.subject, approved.subject);
  const document = parse5.parse(result.html);
  const authored = nodes(document).find(node => node.tagName === "a" && attr(node, "href") === "https://example.test/original");
  assert.match(attr(authored, "style"), /^color:#f3efe6;/, "existing design links keep their authored color");
  assert.doesNotMatch(attr(authored, "style"), /overflow-wrap|word-break|text-decoration/, "cadence-only styles do not overwrite design links");
  const html = nodes(document).find(node => node.tagName === "html");
  html.childNodes = html.childNodes.filter(node => node.tagName !== "head");
  const stripped = parse5.parse(parse5.serialize(document));
  assert.equal(nodes(stripped).filter(node => node.tagName === "style").length, 0);
  const body = nodes(stripped).find(node => attr(node, "data-message") === "true");
  const bodyText = node => node.nodeName === "#text" ? node.value : node.tagName === "br" ? "\n" : (node.childNodes ?? []).map(bodyText).join("");
  assert.equal(bodyText(body), approved.body, "approved wording, punctuation, line breaks and displayed URLs are unchanged");
  const links = nodes(body).filter(node => node.tagName === "a");
  assert.deepEqual(links.map(link => attr(link, "href")), [approved.callUrl, approved.profileUrl, approved.preferencesUrl]);
  for (const link of links) {
    const styles = Object.fromEntries(attr(link, "style").split(";").filter(Boolean).map(rule => rule.split(":")));
    assert.equal(styles.color, "#ffca2c");
    assert.equal(styles["overflow-wrap"], "anywhere");
    assert.equal(styles["word-break"], "break-word");
    assert.equal(styles["text-decoration"], "underline");
    assert.equal(bodyText(link), attr(link, "href"));
  }
});

test("static copy targets replace just their selected visible span and preserve neighboring copy", () => {
  const f = fixture({ variables: [], html: '<html><body><h1>Old headline</h1><p>Old message</p><p>Keep this footer.</p></body></html>' });
  f.plan.bodyTarget = `copy:${f.plan.template.fields.find(field => field.value === "Old message").key}`;
  f.plan.headingTarget = `copy:${f.plan.template.fields.find(field => field.value === "Old headline").key}`;
  const result = renderer.renderCadenceEmail(f);
  assert.match(result.html, /Keep this footer\./);
  assert.doesNotMatch(result.html + result.text, /Old message|Old headline/);
  assert.match(result.text, /Jamie,/);
});

test("an authored text alternative cannot retain stale content instead of the new cadence body", () => {
  const result = renderer.renderCadenceEmail(fixture({ text: "Old authored message with obsolete event details." }));
  assert.match(result.text, /Jamie,/);
  assert.match(result.text, /Thursday, November 5/);
  assert.doesNotMatch(result.text, /Old authored message/);
});

test("message variable must be visible text, never only an attribute or hidden area", () => {
  for (const area of ['<p hidden>{{{BODY}}}</p>', '<p aria-hidden="true">{{{BODY}}}</p>', '<p aria-hidden="TRUE">{{{BODY}}}</p>',
    '<p style="display:none">{{{BODY}}}</p>', '<p style="visibility:hidden">{{{BODY}}}</p>', '<p style="mso-hide:all">{{{BODY}}}</p>',
    '<img src="https://example.test/photo.png" alt="{{{BODY}}}">', '<p title="{{{BODY}}}">Only a tooltip</p>']) {
    const f = fixture({ html: `<html><body><h1>{{{HEADING}}}</h1>${area}</body></html>` });
    assert.throws(() => renderer.renderCadenceEmail(f), /visible text|hidden field|message area/i, area);
  }
  const repeated = fixture({ html: '<html><body><h1>{{{HEADING}}}</h1><p>{{{BODY}}}</p><span hidden>{{{BODY}}}</span></body></html>' });
  assert.throws(() => renderer.renderCadenceEmail(repeated), /hidden field|message area/i);
});

test("published individual designs are required and body and heading cannot share a target", () => {
  for (const provider of [{ status: "draft" }, { html: '<p>{{{contact.first_name|friend}}}</p><p>{{{BODY}}}</p><h1>{{{HEADING}}}</h1>' }]) {
    assert.throws(() => renderer.renderCadenceEmail(fixture(provider)), /published individual.email/i);
  }
  assert.throws(() => renderer.renderCadenceEmail(fixture({}, { headingTarget: "variable:BODY" })), /separate message and heading/);
  assert.throws(() => renderer.renderCadenceEmail(fixture({}, { bodyTarget: "copy:not-a-real-field" })), /separate message and heading/);
});

test("unbound variables, forged bindings and unfinished placeholders stop rendering", () => {
  for (const bindings of [{ UNKNOWN: { source: "literal", value: "x" } }, { BODY: { source: "untrusted" } }, { BODY: { source: "literal", value: "[INSERT LINK]" } }, { BODY: { source: "literal", value: "{{{OTHER}}}" } }]) {
    assert.throws(() => renderer.renderCadenceEmail(fixture({}, { bindings })), /fields|placeholders/);
  }
  const f = fixture({ variables: [variable("HEADING"), variable("BODY"), variable("REQUIRED")], html: '<h1>{{{HEADING}}}</h1><p>{{{BODY}}}</p><p>{{{REQUIRED}}}</p>' });
  assert.throws(() => renderer.renderCadenceEmail(f), /Add a value/);
});

test("conflicting managed artwork never changes the approved closing and source remains unchanged", () => {
  const f = fixture({ html: '<html><body><h1>{{{HEADING}}}</h1><p>{{{BODY}}}</p><img data-ruined-sign-off="true" src="https://assets.example.test/sign-off.png" alt="All the love" width="140"></body></html>',
    text: '{{{HEADING}}}\n{{{BODY}}}\n\nAll the love\nRU/NED' });
  assert.equal(f.plan.template.signOffText, "All the love");
  const result = renderer.renderCadenceEmail(f);
  assert.equal(nodes(parse5.parse(result.html)).filter(node => node.tagName === "img" && attr(node, "data-ruined-sign-off") !== undefined).length, 1);
  assert.match(result.html,/membership\/email\/after-the-fear-cadehandy2\.png/);
  assert.doesNotMatch(result.html,/assets\.example\.test\/sign-off\.png/);
  assert.equal((result.text.match(/All the love/g) ?? []).length, 0);
  assert.equal((result.text.match(/After the fear\./g) ?? []).length, 1);
  assert.match(f.plan.template.html, /alt="All the love"/);
  assert.doesNotMatch(result.html, /All the love,<br>/);
});

test("a long escaped server-generated body is not cut off by the template variable limit", () => {
  const f = fixture();
  f.memberName = `${"A&<B> ".repeat(2000)}end-of-name`;
  const result = renderer.renderCadenceEmail(f);
  assert.ok(result.text.length > 12_000);
  assert.ok(result.text.includes("end-of-name,"));
  assert.ok(result.html.includes("end-of-name,"));
  assert.equal(nodes(parse5.parse(result.html)).some(node => node.tagName === "b"), false);
  assert.match(result.text, /RU\/NED\nAfter the fear\./);
});

test("plain-text reminder edits preserve personalization, call details, access and preference links", () => {
  const f = fixture({}, { messages: { day_before: { subject: "A little preparation", message: 'Bring your notebook.\n\n<img src="x" onerror="bad()"> & be present.' } } });
  const result = renderer.renderCadenceEmail(f);
  assert.equal(result.subject, "A little preparation");
  assert.match(result.text, /Jamie,/);
  assert.match(result.text, /Bring your notebook/);
  assert.match(result.text, /Foundations 01/);
  assert.match(result.text, /Thursday, November 5/);
  assert.match(result.text, /3:00(?:–4:30)? PM M[ST]/);
  for (const path of ["/my/experiences#experience-call-one", "/my/account#email-reminders", "/my"]) assert.ok(result.text.includes(`https://members.example.test${path}`));
  assert.match(result.html, /&lt;img src=/);
  assert.equal(nodes(parse5.parse(result.html)).filter(node => node.tagName === "img").length, 1, "untrusted prose cannot create an image");
  assert.equal(copy.cadenceMessageDefaults({ event, kind: "foundations_01", track: "members", stage: "day_before" }).subject, "Tomorrow: Foundations 01.");
  const untouched = renderer.renderCadenceEmail({ ...f, stage: "orientation" });
  assert.equal(untouched.subject, "What we mean by Foundations.");
  assert.doesNotMatch(untouched.text, /Bring your notebook/);
});

test("message editing rejects forged stages, headers, oversized text and unfinished placeholders", () => {
  const invalid = [null, [], "hello", { random: { message: "Hello" } }, { day_before: null }, { day_before: [] },
    { day_before: { body: "Hello" } }, { day_before: { subject: "   " } }, { day_before: { message: "" } },
    { day_before: { subject: "Hello\r\nBcc: stranger@example.com" } }, { day_before: { subject: "x".repeat(201) } },
    { day_before: { message: "x".repeat(12001) } }, { day_before: { message: "Hello\u0000there" } },
    { day_before: { message: "[INSERT LINK]" } }, { day_before: { message: "{{MEMBER_NAME}}" } }];
  for (const messages of invalid) assert.throws(() => renderer.renderCadenceEmail(fixture({}, { messages })), error => error.status === 400, JSON.stringify(messages));
  assert.doesNotThrow(() => renderer.renderCadenceEmail(fixture({}, { messages: { day_before: { message: "Notes:\n\tBring a pen." } } })));
  assert.doesNotThrow(() => renderer.renderCadenceEmail(fixture({}, { messages: {} })));
});

test("approved After-the-fear artwork moves to the signature once with its original asset geometry", () => {
  const f=fixture({html:'<html><body><h1>{{{HEADING}}}</h1><p>{{{BODY}}}</p><img data-ruined-sign-off="true" src="https://assets.example.test/after-the-fear-cadehandy2.png" width="170" height="60" alt="After the fear"></body></html>'});
  const result=renderer.renderCadenceEmail(f);
  const images=nodes(parse5.parse(result.html)).filter(node=>node.tagName==='img');
  assert.equal(images.length,1);assert.equal(attr(images[0],'width'),'170');assert.equal(attr(images[0],'height'),'60');
  assert.equal(attr(images[0],'src'),'https://assets.example.test/after-the-fear-cadehandy2.png');
  assert.equal(attr(images[0],'alt'),'After the fear.');
  assert.match(result.text,/Tyler, Libby, Cade & Mitch\nRU\/NED\nAfter the fear\./);
  assert.equal(result.text.match(/After the fear\./g).length,1);
  assert.ok(result.text.indexOf('After the fear.')<result.text.indexOf('Your profile:'));
});

test("generic approved-design messages allow identity/account bindings, reject call bindings and escape prose", () => {
  const f=fixture({variables:[variable('HEADING'),variable('BODY'),variable('NAME')],html:'<html><body><h1>{{{HEADING}}}</h1><p>{{{BODY}}}</p><p>{{{NAME}}}</p></body></html>'},{bindings:{NAME:{source:'member_name'}}});
  const message={subject:'A milestone.',heading:'A milestone.',body:'A <script>literal</script> note.\nhttps://members.example.test/my\n\nRU/NED\nAfter the fear.',memberName:'Jamie <&>',links:['https://members.example.test/my']};
  const result=renderer.renderCadenceDesignMessage(f.plan,message);
  assert.equal(result.subject,message.subject);assert.equal(result.from,'Ruined <sender@example.test>');
  assert.equal(nodes(parse5.parse(result.html)).filter(node=>node.tagName==='script').length,0);
  assert.match(result.text,/Jamie <&>/);assert.match(result.text,/A <script>literal<\/script> note\./);
  assert.match(result.text,/After the fear\./);assert.doesNotMatch(result.text,/Foundations 01|November 5/);
  for(const source of ['call_title','call_date','call_time','call_url']) {
    assert.throws(()=>renderer.renderCadenceDesignMessage({...f.plan,bindings:{NAME:{source}}},message),/call-specific/);
  }
  assert.throws(()=>renderer.renderCadenceDesignMessage(f.plan,{...message,links:['javascript:alert(1)']}),/website links/);
});
