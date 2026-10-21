import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(path, dependencies = {}, fetch = () => { throw Error("Unexpected network request"); }, browser = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", "window", "document", "requestAnimationFrame", "Element", output)(name => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name];
  }, mod, mod.exports, fetch, browser.window, browser.document, browser.requestAnimationFrame, browser.Element);
  return mod.exports;
}
const styles = compile("src/components/platform/operatorStyles.ts");
const copy = compile("src/lib/communications/cade-communications.ts");
const model = compile("src/lib/communications/member-lifecycle-email-model.ts");
const view = compile("src/lib/communications/lifecycle-email-view.ts", {"./member-lifecycle-email-model":model});
const nodes = node => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
function harness() {
  const slots = [], effects = [], timers = new Map(); let cursor = 0, changed = false, timerId = 0;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = { ...React,
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === "function" ? initial() : initial, set(next) { const value = typeof next === "function" ? next(slots[i].value) : next; changed ||= !Object.is(value, slots[i].value); slots[i].value = value; } }; return [slots[i].value, slots[i].set]; },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { callback, deps }; return slots[i].callback; },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const browser = {
    window: { addEventListener() {}, removeEventListener() {}, location: { href: "https://example.test/ops/emails", pathname: "/ops/emails", search: "", assign() {} }, setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } },
    document: { addEventListener() {}, removeEventListener() {}, getElementById() { return { focus() {}, scrollIntoView() {} }; } }, requestAnimationFrame(callback) { callback(); }, Element: class Element {},
  };
  function render(Component, props) { for (let i = 0; i < 20; i++) { cursor = 0; changed = false; const tree = Component(props); effects.splice(0).forEach(effect => effect()); if (!changed) return tree; } throw Error("Unstable render"); }
  async function flushTimers(delay) { for (const [id, timer] of timers) if (timer.delay === delay) { timers.delete(id); await timer.callback(); } }
  return { hooks, browser, render, flushTimers };
}
function controls(draw) {
  const find = predicate => nodes(draw()).find(predicate);
  const button = label => { const result = find(node => node.type === "button" && text(node) === label); assert.ok(result, `Missing button: ${label}`); return result; };
  const change = (id, value) => { const field = find(node => node.props?.id === id); assert.ok(field, `Missing field: ${id}`); field.props.onChange({ target: { value }, currentTarget: { value } }); };
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return draw(); };
  const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  return { draw, find, button, change, settle, submit };
}

test("approved manual library excludes red processes and requires all message placeholders to be resolved", () => {
  assert.equal(copy.CADE_MANUAL_TEMPLATES.length,6);
  assert.equal(copy.CADE_MANUAL_TEMPLATES.filter(x=>x.channel==='emails').length,5);
  for (const entry of copy.CADE_MANUAL_TEMPLATES) {
    assert.doesNotMatch(entry.id,/missed|incomplete|future/);
    assert.ok(copy.manualCommunicationDraftIssue(entry.subject,entry.body,entry.channel));
    assert.doesNotMatch(entry.body,/connect@ruined\.com/);
  }
  assert.equal(copy.manualCommunicationDraftIssue('Ready','Alex, here is the actual link: https://example.test'),null);
  for(const placeholder of ['(NAME)','[DATE/TIME]','[IF LINK CHANGED: NEW CALL LINK: LINK]','{LINK}']) assert.ok(copy.manualCommunicationDraftIssue('Ready',placeholder));
  assert.match(copy.CADE_MANUAL_TEMPLATES.find(x=>x.id==='clothing-drop').dependency,/25%.*not an approved/);
});
test("manual copy enters only the chosen field and subject, keeping other design fields intact", () => {
  const h=harness(),applied=[];
  h.browser.window.location.search='?manualTemplate=platform-update';
  const Component=compile('src/components/platform/OperatorManualCommunicationTemplate.tsx',{react:h.hooks,'@/lib/communications/cade-communications':copy,'./operatorStyles':styles},undefined,h.browser).default;
  const props={preview:true,template:{variables:[{key:'BODY',type:'string'}],fields:[{key:'heading',label:'Heading',value:'Keep heading'},{key:'body',label:'Body',value:'Old body'}]},edits:{subject:'Original',copy:{heading:'Keep heading',body:'Old body'},values:{BODY:'Variable untouched'},banner:{url:'https://example.test/banner.jpg',alt:'Banner'},signOff:{text:'All the love'}},onApply:value=>applied.push(value)};
  const f=controls(()=>h.render(Component,props));f.draw();
  assert.equal(f.find(x=>x.props?.id==='manual-communication-template').props.value,'platform-update');
  assert.equal(f.button('Add copy to this draft').props.disabled,true);
  f.change('manual-communication-subject','The confirmed change');f.change('manual-communication-body','Alex, the workshop moves to Friday. Your calendar is updated.');
  f.find(x=>x.type==='input'&&x.props.type==='checkbox').props.onChange({target:{checked:true}});
  assert.equal(f.button('Add copy to this draft').props.disabled,true,'No guessed body target');
  f.change('manual-communication-destination','copy:body');f.button('Add copy to this draft').props.onClick();
  assert.equal(applied.length,1);assert.equal(applied[0].subject,'The confirmed change');assert.equal(applied[0].copy.heading,'Keep heading');assert.equal(applied[0].copy.body,'Alex, the workshop moves to Friday. Your calendar is updated.');assert.deepEqual(applied[0].values,props.edits.values);assert.deepEqual(applied[0].banner,props.edits.banner);assert.equal(applied[0].signOff,null);
});
test('manual closing uses one handwritten After the fear while preserving the message and custom closings',()=>{
  for(const entry of [
    {body:'Alex, the update is ready.\n\nRU/NED\nAfter the fear.',expected:'Alex, the update is ready.\n\nRU/NED',signOff:{text:'After the fear.'}},
    {body:'Alex, the update is ready.\r\n\r\nRU/NED\r\nAfter the fear.\r\n',expected:'Alex, the update is ready.\r\n\r\nRU/NED',signOff:{text:'After the fear.'}},
    {body:'After the fear.\nAlex, the update is ready.\n\nRU/NED\nSee you there.',expected:'After the fear.\nAlex, the update is ready.\n\nRU/NED\nSee you there.',signOff:null},
  ]) {
    const h=harness(),applied=[];h.browser.window.location.search='?manualTemplate=platform-update';
    const Component=compile('src/components/platform/OperatorManualCommunicationTemplate.tsx',{react:h.hooks,'@/lib/communications/cade-communications':copy,'./operatorStyles':styles},undefined,h.browser).default;
    const props={preview:true,template:{variables:[{key:'BODY',type:'string'}],fields:[]},edits:{subject:'Old subject',values:{BODY:'Old copy'},copy:{},signOff:{text:'All the love'}},onApply:value=>applied.push(value)};
    const f=controls(()=>h.render(Component,props));f.draw();f.change('manual-communication-subject','A confirmed update');f.change('manual-communication-body',entry.body);
    f.change('manual-communication-destination','variable:BODY');f.find(x=>x.type==='input'&&x.props.type==='checkbox').props.onChange({target:{checked:true}});f.button('Add copy to this draft').props.onClick();
    assert.equal(applied.length,1);assert.equal(applied[0].values.BODY,entry.expected);assert.deepEqual(applied[0].signOff,entry.signOff);
    const message=[applied[0].values.BODY,applied[0].signOff?.text].filter(Boolean).join('\n');
    assert.equal(message.match(/After the fear\./g)?.length,1);assert.doesNotMatch(message,/All the love/);assert.match(message,/RU\/NED/);
  }
});
test("lifecycle catalog reports unknown, held, globally paused and ready states without inventing activation",()=>{
  assert.ok(view.lifecycleCommunicationItems(null).every(x=>x.status==='attention'));
  const item={key:'checkin_90',enabled:false,ready:true,missing:[],settings:{},eligible:0,nextDueAt:null,lastSentAt:null};
  assert.equal(view.lifecycleCommunicationItems({items:[item],recent:[]}).find(x=>x.id==='lifecycle:checkin_90').status,'approved');
  assert.equal(view.lifecycleCommunicationItems({items:[{...item,enabled:true}],recent:[],deliveryEnabled:false}).find(x=>x.id==='lifecycle:checkin_90').status,'paused');
  assert.equal(view.lifecycleCommunicationItems({items:[{...item,ready:false}],recent:[]}).find(x=>x.id==='lifecycle:checkin_90').status,'held');
  assert.match(view.LIFECYCLE_DESCRIPTIONS.checkin_30.trigger,/first attended Membership/);
  assert.match(view.LIFECYCLE_DESCRIPTIONS.anniversary.timing,/once/);
});
function lifecycleFixture({preview=false,failSave=false}={}) {
  const h=harness(),calls=[],overviews=[];h.browser.window.location.search='?lifecycle=checkin_90';
  let item={key:'checkin_90',title:'90-day member check-in',enabled:false,ready:false,missing:['Connect the finalized short check-in form.'],settings:{},subject:'How is it going, {{member_name}}?',body:'Tell us here: {{survey_link}}',tokens:['{{member_name}}','{{survey_link}}'],revision:1,nextDueAt:'2026-11-05T22:00:00Z',eligible:2,lastSentAt:null,preview:null};
  const Component=compile('src/components/platform/OperatorLifecycleEmails.tsx',{react:h.hooks,'@/lib/communications/member-lifecycle-email-model':model,'@/lib/communications/lifecycle-email-view':view,'./operatorStyles':styles},async(url,options={})=>{
    calls.push({url,...options});
    if(options.method==='PATCH') {
      if(failSave)return Response.json({error:'This message changed. Refresh before saving.'},{status:409});
      const input=JSON.parse(options.body);assert.equal(input.revision,item.revision);
      item={...item,enabled:input.enabled,settings:input.settings,subject:input.subject,body:input.body,revision:item.revision+1,ready:true,missing:[],preview:{subject:'Saved subject',html:'<html><head></head><body>Saved copy</body></html>',text:'Saved copy'}};
      return Response.json(item);
    }
    return Response.json(url.includes('?')?item:{items:[item],recent:[],deliveryEnabled:false,setupRequired:false,closures:[]});
  },h.browser).default;
  const props={preview,onOverview:value=>overviews.push(value)};
  const f=controls(()=>h.render(Component,props));return {...f,calls,overviews};
}
test('lifecycle settings are read-only until an explicit save, and enabling follows a refreshed saved preview',async()=>{
  const f=lifecycleFixture();f.draw();await f.settle();
  assert.equal(f.calls.some(x=>x.method==='PATCH'),false);
  assert.match(text(f.draw()),/paused globally/);assert.equal(f.button('Enable this email').props.disabled,true);
  f.change('lifecycle-surveyUrl','https://example.test/survey');assert.equal(f.button('Enable this email').props.disabled,true);
  const save=f.button('Save without enabling');save.props.onClick();save.props.onClick();await f.settle();
  assert.equal(f.calls.filter(x=>x.method==='PATCH').length,1);
  assert.equal(JSON.parse(f.calls.find(x=>x.method==='PATCH').body).enabled,false);
  assert.equal(f.button('Enable this email').props.disabled,false);
  const iframe=f.find(x=>x.type==='iframe');assert.equal(iframe.props.sandbox,'');assert.match(iframe.props.srcDoc,/Content-Security-Policy/);
  f.button('Enable this email').props.onClick();await f.settle();
  assert.equal(JSON.parse(f.calls.filter(x=>x.method==='PATCH').at(-1).body).revision,2);
  assert.match(text(f.draw()),/Enabled · delivery paused/);
});
test('stale lifecycle save retains edited settings and never reports success',async()=>{
  const f=lifecycleFixture({failSave:true});f.draw();await f.settle();f.change('lifecycle-surveyUrl','https://example.test/unsaved');f.button('Save without enabling').props.onClick();await f.settle();
  assert.match(text(f.draw()),/This message changed/);assert.equal(f.find(x=>x.props?.id==='lifecycle-surveyUrl').props.value,'https://example.test/unsaved');assert.equal(f.button('Enable this email').props.disabled,true);
});
test('local preview does not load or change live lifecycle settings',async()=>{
  const f=lifecycleFixture({preview:true});f.draw();await f.settle();assert.equal(f.calls.length,0);assert.match(text(f.draw()),/live admin workspace/);assert.equal(f.button('Refresh lifecycle status').props.disabled,true);
});

test('reusable manual edits save only on explicit action with revision and preserve placeholders for later drafts',async()=>{
  const h=harness(),calls=[];h.browser.window.location.search='?manualTemplate=urgent-text';
  const Component=compile('src/components/platform/OperatorManualCommunicationTemplate.tsx',{react:h.hooks,'@/lib/communications/cade-communications':copy,'./operatorStyles':styles},async(url,options={})=>{
    calls.push({url,...options});
    if(options.method==='PATCH') {const input=JSON.parse(options.body);assert.deepEqual(input,{key:'manual:urgent-text',subject:'',body:'RU/NED: [CALL] moved to [NEW]. Check your profile.',revision:3});return Response.json({...input,revision:4});}
    return Response.json({key:'manual:urgent-text',subject:'',body:'Existing saved [CALL] text.',revision:3});
  },h.browser).default;
  const props={template:null,edits:{subject:'',values:{},copy:{}},onApply(){throw Error('Unexpected draft import');}};
  const f=controls(()=>h.render(Component,props));f.draw();await f.settle();
  assert.equal(calls.filter(x=>x.method==='PATCH').length,0);
  assert.equal(f.find(x=>x.props?.id==='manual-communication-body').props.value,'Existing saved [CALL] text.');
  f.change('manual-communication-body','RU/NED: [CALL] moved to [NEW]. Check your profile.');
  const save=f.button('Save reusable template');save.props.onClick();save.props.onClick();await f.settle();
  assert.equal(calls.filter(x=>x.method==='PATCH').length,1);
  assert.match(text(f.draw()),/Reusable template saved/);
  assert.equal(f.button('Copy reviewed text').props.disabled,true,'Unfilled template still cannot become reviewed outgoing copy');
});

test('registration copy editing is revision guarded and preserves dynamic tokens without sending',async()=>{
  const h=harness(),calls=[];
  let saved={key:'registration:welcome',subject:'Welcome, {{member_name}}.',body:'Your profile: {{profile_url}}',tokens:['{{member_name}}','{{profile_url}}'],revision:2};
  const Component=compile('src/components/platform/OperatorRegistrationEmailTemplates.tsx',{react:h.hooks,'./operatorStyles':styles},async(url,options={})=>{
    calls.push({url,...options});if(options.method==='PATCH'){const input=JSON.parse(options.body);assert.equal(input.revision,2);assert.equal(input.key,'registration:welcome');saved={...saved,...input,revision:3};}return Response.json(saved);
  },h.browser).default;
  const f=controls(()=>h.render(Component,{}));f.draw();await f.settle();
  assert.equal(calls.filter(x=>x.method==='PATCH').length,0);assert.match(text(f.draw()),/member_name/);
  f.change('registration-copy-subject','You are here, {{member_name}}.');assert.equal(f.find(x=>x.props?.id==='registration-copy-template').props.disabled,true);
  const save=f.button('Save registration template');save.props.onClick();save.props.onClick();await f.settle();
  assert.equal(calls.filter(x=>x.method==='PATCH').length,1);assert.equal(saved.body,'Your profile: {{profile_url}}');assert.match(text(f.draw()),/Reusable copy saved/);
});
test('editing baked lifecycle copy requires saving paused before the updated message can be enabled',async()=>{
  const f=lifecycleFixture();f.draw();await f.settle();f.change('lifecycle-surveyUrl','https://example.test/survey');f.change('lifecycle-subject','Tell us, {{member_name}}.');f.change('lifecycle-body','What changed? {{survey_link}}');
  assert.equal(f.button('Enable this email').props.disabled,true);f.button('Save without enabling').props.onClick();await f.settle();
  const change=JSON.parse(f.calls.find(x=>x.method==='PATCH').body);assert.equal(change.enabled,false);assert.equal(change.subject,'Tell us, {{member_name}}.');assert.equal(change.body,'What changed? {{survey_link}}');assert.equal(f.button('Enable this email').props.disabled,false);
});
