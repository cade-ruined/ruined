import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { badgeUIFixture, nodes, text } from './helpers/member-badge-ui-fixture.mjs';
const ownerId='11111111-1111-4111-8111-111111111111';
const anotherOwner='22222222-2222-4222-8222-222222222222';
const award={key:'early-supporter',label:'I Was Here',description:'Joined the waitlist, then activated a Founders or Originals membership.',earnedAt:'2026-09-28T12:00:00Z'};
const second={key:'another-badge',label:'Another badge',description:'Completed another member milestone.',earnedAt:'2026-09-29T12:00:00Z'};
const response=(body,status=200)=>Response.json(body,{status});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture({badges=[award],fetch,props={},...options}={}){
  return badgeUIFixture({ownerId,...props},{component:'src/components/membership/MemberBadgeCelebration.tsx',
    pathname:'/my/foundations',fetch:fetch??(async(_url,init)=>init.method==='POST'?response({ok:true}):response({ownerId,badges})),...options});
}
const modal=ui=>nodes(ui.draw()).find(node=>node.type==='dialog');
const posts=ui=>ui.requests.filter(request=>request.method==='POST');

test('profile arrival announces pending badges without moving focus or covering the profile',async()=>{
  const ui=fixture({pathname:'/my'});ui.draw();const tree=await ui.settle();
  assert.equal(ui.dialog.opens,0);assert.equal(ui.document.activeElement,ui.original);
  assert.equal(ui.document.body.style.overflow,'scroll');
  assert.ok(nodes(tree).some(node=>node.props.role==='status'&&text(node).includes('New badge earned')));
  assert.match(text(tree),/I Was Here/);assert.equal(posts(ui).length,0);
  ui.click('View badge');assert.equal(ui.dialog.open,true);assert.match(text(modal(ui)),/You earned a badge/);
  assert.ok(nodes(modal(ui)).some(node=>node.props.download));
  assert.equal(posts(ui).length,0,'explicitly viewing still does not acknowledge the badge');
  ui.click('Done');await ui.settle();assert.equal(ui.draw(),null);assert.equal(posts(ui).length,1);
  ui.unmount();assert.equal(ui.windowListeners.get('ruined:member-progress').size,0);
});

test('progress refetch celebrates only newly earned awards while older pending awards stay in the notice',async()=>{
  let available=[award];
  const ui=fixture({pathname:'/my',fetch:async(_url,init)=>{
    if(init.method==='POST'){const key=JSON.parse(init.body).badgeKey;available=available.filter(badge=>badge.key!==key);return response({ok:true});}
    return response({ownerId,badges:available});
  }});
  ui.draw();await ui.settle();assert.equal(ui.dialog.opens,0);
  ui.dispatchWindow('ruined:member-progress');await ui.settle();assert.equal(ui.requests.length,2);
  assert.equal(ui.dialog.opens,0,'refetching an old pending award is not a new achievement');
  available=[award,second];ui.dispatchWindow('ruined:member-progress');await ui.settle();
  assert.equal(ui.dialog.open,true);assert.match(text(modal(ui)),/Another badge/);assert.doesNotMatch(text(modal(ui)),/I Was Here/);
  ui.click('Done');await ui.settle();assert.equal(ui.dialog.open,false);assert.match(text(ui.draw()),/I Was Here/);
  assert.equal(ui.document.activeElement,ui.original,'new achievements return focus to the member’s work rather than the pending-badge notice');
  assert.deepEqual(posts(ui).map(request=>JSON.parse(request.body).badgeKey),[second.key]);
  ui.dispatchWindow('ruined:member-progress');await ui.settle();assert.equal(ui.dialog.open,false);
  ui.click('View badge');assert.equal(ui.dialog.open,true);assert.match(text(modal(ui)),/I Was Here/);
  ui.unmount();
});

test('profile notice allows explicit review of all pending badges without automatic first-arrival reveals',async()=>{
  const ui=fixture({pathname:'/my',badges:[award,second]});ui.draw();await ui.settle();
  assert.equal(ui.dialog.opens,0);assert.match(text(ui.draw()),/2 new badges earned/);
  ui.click('View badges');assert.match(text(modal(ui)),/Badge 1 of 2/);
  ui.click('Continue');await ui.settle();assert.match(text(modal(ui)),/Badge 2 of 2/);
  ui.click('Done');await ui.settle();assert.equal(ui.draw(),null);ui.unmount();
});

test('a progress refresh failure retains the notice and cannot reopen old pending awards',async()=>{
  let fail=false;
  const ui=fixture({pathname:'/my',fetch:async()=>fail?response({error:'unavailable'},503):response({ownerId,badges:[award]})});
  ui.draw();await ui.settle();fail=true;ui.dispatchWindow('ruined:member-progress');await ui.settle();
  assert.equal(ui.dialog.opens,0);assert.match(text(ui.draw()),/New badge earned/);
  fail=false;ui.dispatchWindow('ruined:member-progress');await ui.settle();assert.equal(ui.dialog.opens,0);
  assert.equal(posts(ui).length,0);ui.unmount();
});

test('progress refresh cannot resurrect an acknowledged award and runs after an in-flight acknowledgement',async()=>{
  const stale=deferred(),acknowledgment=deferred();let gets=0,acknowledged=false;
  const ui=fixture({pathname:'/my',fetch:async(_url,init)=>{
    if(init.method==='POST'){await acknowledgment.promise;acknowledged=true;return response({ok:true});}
    if(++gets===2)return stale.promise;
    return response({ownerId,badges:acknowledged?[second]:[award]});
  }});
  ui.draw();await ui.settle();ui.click('View badge');ui.dispatchWindow('ruined:member-progress');
  ui.click('Done');ui.dispatchWindow('ruined:member-progress');assert.equal(gets,2,'refresh waits while acknowledgement is writing');
  acknowledgment.resolve();await ui.settle();assert.equal(gets,3);
  assert.match(text(modal(ui)),/Another badge/);assert.doesNotMatch(text(modal(ui)),/I Was Here/);
  stale.resolve(response({ownerId,badges:[award]}));await ui.settle();
  assert.match(text(modal(ui)),/Another badge/);assert.equal(posts(ui).length,1);ui.unmount();
});

test('profile progress reads suspend on authentication or owner changes and stale account responses stay hidden',async()=>{
  for(const status of [401,403,409]){
    let revoked=false;
    const ui=fixture({pathname:'/my',fetch:async()=>revoked?response({code:'account_changed'},status):response({ownerId,badges:[award]})});
    ui.draw();await ui.settle();revoked=true;ui.dispatchWindow('ruined:member-progress');await ui.settle();
    assert.equal(ui.draw(),null);assert.equal(ui.requests.at(-1).signal.aborted,true);assert.equal(ui.dialog.opens,0);ui.unmount();
  }
  const pending=deferred();let count=0;
  const ui=fixture({pathname:'/my',fetch:async()=>++count===1?response({ownerId,badges:[award]}):pending.promise});
  ui.draw();await ui.settle();ui.dispatchWindow('ruined:member-progress');const signal=ui.requests.at(-1).signal;
  ui.draw({ownerId:anotherOwner});assert.equal(signal.aborted,true);
  pending.resolve(response({ownerId,badges:[award,second]}));await ui.settle();
  assert.equal(ui.draw(),null);assert.equal(ui.dialog.opens,0);ui.unmount();
});

 test('first member visit fetches once, announces the award and keeps its native original-art download',async()=>{
  const ui=fixture();assert.equal(ui.draw(),null);const tree=await ui.settle();
  assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].cache,'no-store');
  assert.equal(ui.dialog.opens,1);assert.equal(ui.document.body.style.overflow,'scroll','the open-dialog CSS locks scroll without changing inline ownership');
  assert.match(text(tree),/You earned a badge/);assert.match(text(tree),/I Was Here/);assert.match(text(tree),/Sep 28, 2026/);
  assert.ok(nodes(tree).some(node=>node.type==='p'&&text(node)===award.description));
  const download=nodes(tree).find(node=>node.props.download);
  assert.equal(download.props.href,'/membership/badges/i-was-here-red-dashes-v2.png');
  assert.equal(download.props.download,'ruined-i-was-here-badge.png');
  ui.draw();ui.setPath('/my/circle');await ui.settle();assert.equal(ui.requests.length,2,'member navigation checks activity without background polling');
  assert.equal(ui.requests[1].headers['x-ruined-session-owner'],ownerId);
  assert.equal(posts(ui).length,0,'opening and downloading never acknowledge');
  ui.unmount();assert.equal(ui.observers.size,0);assert.equal(ui.document.listeners.get('visibilitychange').size,0);
  assert.equal(ui.document.body.style.overflow,'scroll');assert.equal(ui.document.activeElement,ui.original);
});

test('queued badges acknowledge exactly the current award before advancing and restore focus after Done',async()=>{
  const acknowledgment=deferred();
  const ui=fixture({badges:[award,second],fetch:async(_url,init)=>init.method==='POST'?acknowledgment.promise:response({ownerId,badges:[award,second]})});
  ui.draw();await ui.settle();assert.match(text(ui.draw()),/Badge 1 of 2/);
  ui.click('Continue');ui.click('Close badge details');modal(ui).props.onCancel({preventDefault(){}});
  assert.equal(posts(ui).length,1,'double click, close and Escape cannot create parallel acknowledgement');
  assert.deepEqual(JSON.parse(posts(ui)[0].body),{badgeKey:award.key,ownerId});
  assert.match(text(ui.draw()),/I Was Here/);assert.doesNotMatch(text(ui.draw()),/Another badge/);
  acknowledgment.resolve(response({ok:true}));await ui.settle();
  assert.match(text(ui.draw()),/Badge 2 of 2/);assert.match(text(ui.draw()),/Another badge/);
  assert.equal(nodes(ui.draw()).some(node=>node.props.download),false,'a later placeholder cannot download the first artwork');
  // Use a fresh response on every invocation; Response bodies are single use.
  ui.unmount();
  const done=fixture({badges:[award,second]});done.draw();await done.settle();done.click('Continue');await done.settle();done.click('Done');await done.settle();
  assert.equal(done.draw(),null);assert.deepEqual(posts(done).map(request=>JSON.parse(request.body).badgeKey),[award.key,second.key]);
  assert.equal(done.document.activeElement,done.original);assert.equal(done.document.body.style.overflow,'scroll');done.unmount();
});

test('failed acknowledgement retains the badge and explicit retry succeeds',async()=>{
  let fail=true;
  const ui=fixture({fetch:async(_url,init)=>init.method==='POST'?(fail?response({error:'unavailable'},503):response({ok:true})):response({ownerId,badges:[award]})});
  ui.draw();await ui.settle();ui.click('Done');await ui.settle();
  assert.equal(ui.dialog.open,true);assert.match(text(ui.draw()),/Your badge is still here/);
  assert.ok(nodes(ui.draw()).some(node=>node.props.role==='alert'));assert.match(text(ui.draw()),/I Was Here/);
  fail=false;ui.click('Try again');await ui.settle();assert.equal(ui.draw(),null);assert.equal(posts(ui).length,2);ui.unmount();
});

for(const action of ['escape','backdrop','close'])test(`${action} explicitly acknowledges once instead of silently closing`,async()=>{
  const ui=fixture();ui.draw();await ui.settle();
  if(action==='escape'){let prevented=false;modal(ui).props.onCancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);}
  else if(action==='backdrop'){const element={};modal(ui).props.onClick({target:element,currentTarget:element});}
  else ui.click('Close badge details');
  await ui.settle();assert.equal(posts(ui).length,1);assert.equal(ui.draw(),null);ui.unmount();
});

test('billing and authentication routes defer the reveal; profile arrival stays nonblocking',async()=>{
  for(const pathname of ['/my/access','/my/confirmed','/my/join','/my/payment-method','/my/checkout','/my/checkout/return','/my/badges']){
    const ui=fixture({pathname});ui.draw();await ui.settle();assert.equal(ui.dialog.opens,0,pathname);assert.equal(posts(ui).length,0);
    ui.setPath('/my');await ui.settle();assert.equal(ui.dialog.open,false,pathname);assert.match(text(ui.draw()),/New badge earned/);assert.equal(ui.requests.length,2);
    ui.click('View badge');assert.equal(ui.dialog.open,true);ui.unmount();
  }
});

test('another dialog and page visibility defer or suspend without consuming an award',async()=>{
  const ui=fixture({otherDialog:true});ui.draw();await ui.settle();assert.equal(ui.dialog.opens,0);
  ui.setOtherDialog(false);assert.equal(ui.dialog.opens,1);
  ui.setOtherDialog(true);assert.equal(ui.dialog.open,false);assert.equal(posts(ui).length,0);
  ui.setOtherDialog(false);assert.equal(ui.dialog.open,true);
  ui.setHidden(true);assert.equal(ui.dialog.open,false);
  ui.setHidden(false);assert.equal(ui.dialog.open,true);
  ui.setAncestorHidden(true);assert.equal(ui.dialog.open,false);ui.notifyMutations();assert.equal(ui.dialog.open,false);
  assert.equal(posts(ui).length,0);ui.unmount();assert.equal(ui.observers.size,0);
  const hidden=fixture({hidden:true});hidden.draw();await hidden.settle();assert.equal(hidden.dialog.opens,0);hidden.setHidden(false);assert.equal(hidden.dialog.opens,1);hidden.unmount();
});

test('owner response binding and aborts prevent stale fetches or acknowledgements crossing accounts',async()=>{
  const first=deferred();
  const ui=fixture({fetch:async(_url,init)=>init.method==='POST'?response({ok:true}):first.promise});
  ui.draw();const oldSignal=ui.requests[0].signal;ui.draw({ownerId:anotherOwner});assert.equal(oldSignal.aborted,true);
  first.resolve(response({ownerId,badges:[award]}));await ui.settle();assert.equal(ui.draw(),null,'old owner results are never displayed');ui.unmount();
  const pending=deferred();const acknowledging=fixture({fetch:async(_url,init)=>init.method==='POST'?pending.promise:response({ownerId,badges:[award]})});
  acknowledging.draw();await acknowledging.settle();acknowledging.click('Done');const signal=posts(acknowledging)[0].signal;
  acknowledging.unmount();assert.equal(signal.aborted,true);pending.resolve(response({ok:true}));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(acknowledging.dialog.open,false);assert.equal(acknowledging.document.body.style.overflow,'scroll');
});

test('authentication loss during dismissal removes the old owner queue without fetching another account',async()=>{
  for(const status of [401,403,409]){
    const ui=fixture({fetch:async(_url,init)=>init.method==='POST'?response({code:'account_changed'},status):response({ownerId,badges:[award,second]})});
    ui.draw();await ui.settle();ui.click('Continue');await ui.settle();
    assert.equal(ui.draw(),null);assert.equal(ui.dialog.open,false);assert.equal(posts(ui).length,1);assert.equal(ui.requests.length,2);
    assert.equal(posts(ui)[0].signal.aborted,true);ui.unmount();
  }
});

test('suspending or unmounting a reveal never clears another modal’s inline scroll lock',async()=>{
  const ui=fixture();ui.draw();await ui.settle();
  ui.document.body.style.overflow='hidden';ui.setOtherDialog(true);
  assert.equal(ui.dialog.open,false);assert.equal(ui.document.body.style.overflow,'hidden');
  ui.unmount();assert.equal(ui.document.body.style.overflow,'hidden');assert.equal(ui.observers.size,0);
});

test('preview is explicit, performs no API writes, and ordinary visits with no unseen awards stay quiet',async()=>{
  const preview=fixture({props:{previewBadges:[award,second]}});preview.draw();assert.equal(preview.dialog.opens,1);assert.match(text(preview.draw()),/Layout preview/);
  preview.click('Continue');await preview.settle();preview.click('Done');await preview.settle();assert.equal(preview.draw(),null);assert.equal(preview.requests.length,0);preview.unmount();
  const empty=fixture({badges:[]});empty.draw();await empty.settle();assert.equal(empty.draw(),null);assert.equal(empty.dialog.opens,0);empty.unmount();
});

test('reveal motion is bounded to an open dialog and disabled for reduced motion',()=>{
  const css=readFileSync(new URL('../src/components/membership/MemberBadges.module.css',import.meta.url),'utf8');
  assert.match(css,/\.dialog\[open\] \.reveal[^}]+animation:badgeHang 760ms/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)[^}]+\.reveal[^}]+animation:none/);
  assert.doesNotMatch(css,/animation:[^;]*(infinite)/);
  assert.match(css,/:global\(body\):has\(\.dialog\[open\]\)\s*\{\s*overflow:hidden!important/);
  const source=readFileSync(new URL('../src/components/membership/MemberBadgeCelebration.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/localStorage\.|sessionStorage\.|setInterval\(/);
});
