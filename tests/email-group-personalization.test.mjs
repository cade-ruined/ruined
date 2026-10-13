import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "parse5";
import { loader } from "./helpers/member-sms-fixture.mjs";

const {personalizeEmailGroupMessage:personalize}=loader()("src/lib/communications/email-group-campaign-model.ts");
const url="https://members.example.test/api/email-groups/unsubscribe?token=reviewed-token";
const recipient={email:"avery@example.test",name:"Avery Person"};
const footer='<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>';
const message=(overrides={})=>({from:"Ruined <hello@example.test>",replyTo:[],subject:"Hello {{{contact.first_name|friend}}}",
  html:'<!doctype html><html><body><!--[if mso]>unchanged<![endif]--><p>Hello {{{contact.first_name|friend}}}</p>'+footer+"</body></html>",
  text:"Hello {{{contact.first_name|friend}}}",...overrides});
function elements(html,tag) {
  const found=[];
  function visit(node) { if(node.tagName===tag) found.push(node); for(const child of node.childNodes??[])visit(child); }
  visit(parse(html)); return found;
}

test("group personalization retains design markup and supplies a per-person unsubscribe in both formats",()=>{
  const result=personalize(message(),recipient,url);
  assert.equal(result.subject,"Hello Avery");
  assert.match(result.html,/<!--[\s\S]+?-->/);
  assert.ok(result.html.includes("<p>Hello Avery</p>"));
  assert.equal(elements(result.html,"a")[0].attrs.find(a=>a.name==="href").value,url);
  assert.ok(result.text.includes(url));
});
test("group personalization escapes recipient names even in unquoted attributes",()=>{
  const evil={email:"avery@example.test",name:'Avery x=1 onmouseover=alert(1) ` <tag> " &'};
  const result=personalize(message({html:'<p title={{{contact.last_name}}}>{{{contact.last_name}}}</p>'+footer}),evil,url);
  const p=elements(result.html,"p")[0];
  assert.deepEqual(p.attrs,[{name:"title",value:'x=1 onmouseover=alert(1) ` <tag> " &'}]);
  assert.equal(elements(result.html,"tag").length,0);
});
test("group personalization validates the completed URL instead of trusting native markers",()=>{
  assert.throws(()=>personalize(message({html:'<a href="{{{contact.first_name|javascript:alert(1)}}}">Bad link</a>'+footer}),{...recipient,name:""},url),/unsupported address/);
  assert.throws(()=>personalize(message({html:'<a href="{{{contact.first_name}}}">Bad link</a>'+footer}),{...recipient,name:"https://user:pass@example.test"},url),/unsupported address/);
  const result=personalize(message({html:'<a href="mailto:{{{contact.email}}}">Contact</a>'+footer}),recipient,url);
  assert.equal(elements(result.html,"a")[0].attrs[0].value,"mailto:avery@example.test");
});
test("group personalization rejects active code, unknown fields, incomplete tokens and sender variables",()=>{
  for(const html of [
    '<script>let x="{{{contact.first_name}}}"</script>'+footer,
    '<p onclick="{{{contact.first_name}}}">Text</p>'+footer,
    '<p>{{{contact.private_field}}}</p>'+footer,
    "<p>{{incomplete}}</p>"+footer,
  ]) assert.throws(()=>personalize(message({html}),recipient,url));
  assert.throws(()=>personalize(message({from:"{{{contact.email}}}"}),recipient,url),/sender and reply/);
  assert.throws(()=>personalize(message({replyTo:["{{{contact.email}}}"]}),recipient,url),/sender and reply/);
});
test("group personalization requires a real unsubscribe anchor and uses explicit name fallbacks",()=>{
  assert.throws(()=>personalize(message({html:"<p>{{{RESEND_UNSUBSCRIBE_URL}}}</p>"}),recipient,url),/working unsubscribe link/);
  const result=personalize(message(),{...recipient,name:""},url);
  assert.equal(result.subject,"Hello friend");
  assert.ok(result.html.includes("<p>Hello friend</p>"));
});
