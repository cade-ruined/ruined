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
    fetch:fetch??(async(_url,init)=>init.method==='POST'?response({ok:true}):response({ownerId,badges})),...options});
}
const modal=ui=>nodes(ui.draw()).find(node=>node.type==='dialog');
const posts=ui=>ui.requests.filter(request=>request.method==='POST');

 test('first member visit fetches once, announces the award and keeps its native original-art download',async()=>{
  const ui=fixture();assert.equal(ui.draw(),null);const tree=await ui.settle();
  assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].cache,'no-store');
  assert.equal(ui.dialog.opens,1);assert.equal(ui.document.body.style.overflow,'scroll','the open-dialog CSS locks scroll without changing inline ownership');
  assert.match(text(tree),/You earned a badge/);assert.match(text(tree),/I Was Here/);assert.match(text(tree),/Sep 28, 2026/);
  assert.ok(nodes(tree).some(node=>node.type==='p'&&text(node)===award.description));
  const download=nodes(tree).find(node=>node.props.download);
  assert.equal(download.props.href,'/membership/badges/i-was-here-red-dashes-v2.png');
  assert.equal(download.props.download,'ruined-i-was-here-badge.png');
  ui.draw();ui.setPath('/my/circle');await ui.settle();assert.equal(ui.requests.length,1,'ordinary navigation never polls');
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

test('billing and authentication routes defer the reveal until normal member navigation',async()=>{
  for(const pathname of ['/my/access','/my/confirmed','/my/join','/my/payment-method','/my/checkout','/my/checkout/return']){
    const ui=fixture({pathname});ui.draw();await ui.settle();assert.equal(ui.dialog.opens,0,pathname);assert.equal(posts(ui).length,0);
    ui.setPath('/my');assert.equal(ui.dialog.opens,1,pathname);assert.equal(ui.requests.length,1);ui.unmount();
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
