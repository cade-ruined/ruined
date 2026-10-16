import assert from 'node:assert/strict';
import test from 'node:test';
import { badgeUIFixture, nodes, text } from './helpers/member-badge-ui-fixture.mjs';
const ownerId='11111111-1111-4111-8111-111111111111';
const anotherOwner='22222222-2222-4222-8222-222222222222';
const earned={key:'first-words',label:'First Words',description:'Save your first private Journal entry.',earnedAt:'2026-10-01T16:00:00.000Z',progress:1,target:1,progressLabel:'Earned',publicVisible:false,privateByDefault:true,actionHref:'/my#journal'};
const unearned={key:'make-it-yours',label:'Make It Yours',description:'Add a profile photo, bio, and @name.',earnedAt:null,progress:2,target:3,progressLabel:'2 of 3 profile details',publicVisible:true,privateByDefault:false,actionHref:'/my/profile'};
const collection={ownerId,seenAt:null,badges:[earned,unearned]};
const response=(body,status=200)=>Response.json(body,{status});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture({snapshot=collection,fetch,preview=false}={}){
  return badgeUIFixture({initialCollection:snapshot,preview},{component:'src/components/membership/MemberBadgeCollection.tsx',fetch:fetch??(async(_url,init)=>init.method?response({ok:true,ownerId}):response(snapshot))});
}
const modal=ui=>nodes(ui.draw()).find(node=>node.type==='dialog');
const checkbox=ui=>nodes(ui.draw()).find(node=>node.type==='input'&&node.props.type==='checkbox');
const writes=ui=>ui.requests.filter(request=>['POST','PATCH'].includes(request.method));

test('collection shows authoritative progress and opens unearned details with a working destination',async()=>{
  const ui=fixture({snapshot:{...collection,seenAt:"2026-10-02T12:00:00Z"}});ui.draw();await ui.settle();
  const tree=ui.click('Make It Yours. 2 of 3 profile details. View badge details');
  assert.equal(ui.dialog.open,true);assert.equal(ui.document.activeElement.name,'Close badge details');
  const dialog=modal(ui);assert.equal(text(nodes(tree).find(node=>node.props.id===dialog.props['aria-labelledby'])),'Make It Yours');
  const progress=nodes(tree).find(node=>node.type==='progress');assert.equal(progress.props.value,2);assert.equal(progress.props.max,3);
  assert.ok(nodes(tree).some(node=>node.type==='a'&&node.props.href==='/my/profile'&&text(node).includes('Edit your profile')));
  assert.equal(checkbox(ui),undefined);assert.equal(nodes(tree).some(node=>node.props.download),false);assert.equal(writes(ui).length,0);
  dialog.props.onCancel({preventDefault(){}});ui.draw();assert.equal(ui.dialog.open,false);
  assert.equal(ui.document.activeElement,ui.buttons.get('Make It Yours. 2 of 3 profile details. View badge details'));
  ui.unmount();
});

test('earned private Journal badge has a UTC date, original artwork download, and explicit sharing',async()=>{
  let snapshot=structuredClone(collection);
  const ui=fixture({fetch:async(_url,init)=>{if(init.method==='PATCH'){snapshot.badges[0].publicVisible=true;return response({ok:true,ownerId});}return response(snapshot);}});
  ui.draw();await ui.settle();let tree=ui.click('First Words. Earned. View badge details');
  assert.equal(checkbox(ui).props.checked,false);assert.match(text(tree),/Sharing the badge never shares your Journal entry/);
  assert.equal(text(nodes(tree).find(node=>node.type==='time')),'Oct 1, 2026');
  assert.equal(nodes(tree).find(node=>node.props.download).props.href,'/membership/badges/first-words-v2.png');
  checkbox(ui).props.onChange({currentTarget:{checked:true}});ui.draw();assert.equal(checkbox(ui).props.disabled,true);
  tree=await ui.settle();assert.equal(checkbox(ui).props.checked,true);assert.match(text(tree),/Visibility saved/);
  assert.deepEqual(JSON.parse(writes(ui)[0].body),{action:'visibility',ownerId,badgeKey:'first-words',visible:true});
  assert.equal(writes(ui)[0].headers['x-ruined-session-owner'],ownerId);assert.equal(ui.requests.length,3,'initial refresh, visibility write, server refresh');ui.unmount();
});

test('introduction persists once before continuing to profile, and failed saves stay retryable',async()=>{
  let fail=true;
  const ui=fixture({fetch:async(_url,init)=>init.method==='POST'?(fail?response({error:'unavailable'},503):response({ok:true,ownerId})):response(collection)});
  ui.draw();await ui.settle();ui.click('Continue to profile↗');await ui.settle();
  assert.equal(ui.navigation.length,0);assert.match(text(ui.draw()),/couldn’t save your introduction/);
  fail=false;ui.click('Continue to profile↗');await ui.settle();
  assert.deepEqual(JSON.parse(writes(ui)[1].body),{action:'seen',ownerId});assert.deepEqual(ui.navigation,['/my','refresh']);ui.unmount();
  const seen=fixture({snapshot:{...collection,seenAt:'2026-10-02T12:00:00Z'}});seen.draw();await seen.settle();assert.doesNotMatch(text(seen.draw()),/Continue to profile/);seen.unmount();
});

test('focus refreshes progress; mismatched owners remove old content and stop requests',async()=>{
  let snapshot=structuredClone(collection);
  const ui=fixture({fetch:async()=>response(snapshot)});ui.draw();await ui.settle();
  snapshot.badges[1].progress=3;snapshot.badges[1].earnedAt='2026-10-02T12:00:00Z';snapshot.badges[1].progressLabel='Earned';
  ui.focusWindow();await ui.settle();assert.ok(ui.button('Make It Yours. Earned. View badge details'));
  snapshot={...snapshot,ownerId:anotherOwner};ui.focusWindow();await ui.settle();
  assert.match(text(ui.draw()),/Your session changed/);assert.doesNotMatch(text(ui.draw()),/First Words/);
  const count=ui.requests.length;ui.focusWindow();await ui.settle();assert.equal(ui.requests.length,count);ui.unmount();
});

test('pending requests abort on owner replacement and cannot display an earlier collection',async()=>{
  const pending=deferred();const ui=fixture({fetch:async()=>pending.promise});ui.draw();const signal=ui.requests[0].signal;
  ui.draw({initialCollection:{...collection,ownerId:anotherOwner,badges:[]}});assert.equal(signal.aborted,true);
  pending.resolve(response(collection));await ui.settle();assert.doesNotMatch(text(ui.draw()),/First Words/);ui.unmount();
});

test('preview is labeled and never reads or writes the API',async()=>{
  const ui=fixture({preview:true});const tree=ui.draw();assert.match(text(tree),/Collection preview/);assert.equal(ui.requests.length,0);
  ui.click('First Words. Earned. View badge details');assert.equal(checkbox(ui).props.disabled,true);assert.match(text(ui.draw()),/example progress and dates/);
  ui.click('Close badge details');ui.click('Continue to profile↗');await ui.settle();assert.equal(ui.requests.length,0);assert.deepEqual(ui.navigation,['/my']);ui.unmount();
});

test('session hiding and competing dialogs suspend details without changing visibility',async()=>{
  const ui=fixture();ui.draw();await ui.settle();ui.click('First Words. Earned. View badge details');assert.equal(ui.dialog.open,true);
  ui.setOtherDialog(true);assert.equal(ui.dialog.open,false);ui.setOtherDialog(false);assert.equal(ui.dialog.open,true);
  ui.setAncestorHidden(true);assert.equal(ui.dialog.open,false);assert.equal(writes(ui).length,0);
  ui.unmount();assert.equal(ui.observers.size,0);assert.equal(ui.document.body.style.overflow,'scroll');
});


test('first-visit badge actions acknowledge the introduction before opening the exact destination',async()=>{
  const journal={...earned,earnedAt:null,progress:0,progressLabel:'Not yet earned'};
  const ui=fixture({snapshot:{...collection,badges:[journal]}});ui.draw();await ui.settle();
  ui.click('First Words. Not yet earned. View badge details');ui.click('Open your Journal ↗');await ui.settle();
  assert.deepEqual(JSON.parse(writes(ui)[0].body),{action:'seen',ownerId});assert.deepEqual(ui.navigation,['/my#journal','refresh']);ui.unmount();
  const preview=fixture({snapshot:{...collection,badges:[journal]},preview:true});preview.draw();
  preview.click('First Words. Not yet earned. View badge details');preview.click('Open your Journal ↗');await preview.settle();
  assert.equal(preview.requests.length,0);assert.deepEqual(preview.navigation,['/my#journal']);preview.unmount();
});
