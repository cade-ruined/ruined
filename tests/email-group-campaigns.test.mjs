import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as parse5 from 'parse5';
import ts from 'typescript';
import { loadPGliteForSchemaChecks } from '../scripts/check-support-schema.mjs';
import { json, serializeJsonBindings } from './helpers/postgres-json-bindings.mjs';

async function load(path, dependencies={}, globals={}) {
  const code=ts.transpileModule(await readFile(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function('require','module','exports',...Object.keys(globals),code)(name=>{assert.ok(name in dependencies,`Unexpected dependency ${name}`);return dependencies[name];},loaded,loaded.exports,...Object.values(globals));
  return loaded.exports;
}
const model=await load('src/lib/communications/admin-email-model.ts');
const campaignModel=await load('src/lib/communications/email-group-campaign-model.ts',{'./admin-email-model':model,parse5});
const id=()=>crypto.randomUUID();
async function fixture(t) {
  const PGlite=await loadPGliteForSchemaChecks(),pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`create role anon;create role authenticated;create schema private;
    create table platform_users(auth_user_id uuid primary key,status text not null);
    create table platform_role_grants(auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table operator_audit_events(id bigint generated always as identity,actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb check(jsonb_typeof(metadata)='object'));`);
  await pg.exec(await readFile(new URL('../db/migrations/20261013210000_admin_email_group_campaigns.sql',import.meta.url),'utf8'));
  const admin=id(),guide=id(),other=id();
  await pg.query("insert into platform_users values($1,'active'),($2,'active'),($3,'active')",[admin,guide,other]);
  await pg.query("insert into platform_role_grants values($1,'ops_admin',null),($2,'guide',null),($3,'ops_admin',null)",[admin,guide,other]);
  const committedClaims=new Set(),faults=[];
  function wrap(client,claims=[]) {
    class Query {
      constructor(strings,params){this.strings=strings;this.params=params;}
      flatten(strings=[''],params=[]) {
        strings[strings.length-1]+=this.strings[0];
        this.params.forEach((value,index)=>{if(value instanceof Query)value.flatten(strings,params);else{params.push(value);strings.push('');}strings[strings.length-1]+=this.strings[index+1];});
        return {strings,params};
      }
      then(resolve,reject) {
        const {strings,params}=this.flatten(),query=strings.reduce((text,part,index)=>text+(index?`$${index}`:'')+part,'');
        const fail=faults.findIndex(pattern=>query.includes(pattern));
        if(fail>=0){faults.splice(fail,1);return Promise.reject(Error('injected database acknowledgement failure')).then(resolve,reject);}
        return client.query(query,serializeJsonBindings(strings,params)).then(result=>{if(query.includes("set status='sending'"))for(const row of result.rows)claims.push(row.id);return result.rows;}).then(resolve,reject);
      }
    }
    const sql=(strings,...params)=>new Query(strings,params);sql.json=json;
    sql.begin=async callback=>{const claims=[];const result=await client.transaction(tx=>callback(wrap(tx,claims)));claims.forEach(key=>committedClaims.add(key));return result;};
    return sql;
  }
  const db=wrap(pg);
  const repository=await load('src/lib/communications/admin-email-repository.ts',{'server-only':{},'@/lib/database/server':{getApplicationDatabase:()=>db},'./admin-email-model':model});
  const fixed={group:id(),template:id(),version:id(),topic:id()};
  const members=[{email:'alice@example.com',name:'Alice Example'},{email:'bob@example.com',name:'Bob Person'}];
  const state={members:members.slice(0,1),groupRevision:1,archived:false,allowed:new Set(members.map(m=>m.email)),topicDefault:'opt_out',suppressed:[],requests:[],sends:[],sendFailure:null,mode:'connected',viewer:admin,version:fixed.version,onFinalPermission:null};
  state.contacts=members.map(m=>({id:id(),email:m.email,unsubscribed:false}));
  state.topics=new Map(state.contacts.map(c=>[c.id,[{id:fixed.topic,subscription:'opt_in'}]]));
  const env={RESEND_API_KEY:'mock-key',ADMIN_EMAIL_SENDING_ENABLED:'true',ADMIN_EMAIL_GROUP_SENDING_ENABLED:'true',CRON_SECRET:'mock-cron-secret',RESEND_TOPIC_UPDATES_ID:fixed.topic};
  const message={from:'Ruined <hello@example.com>',replyTo:['reply@example.com'],subject:'For {{{contact.first_name|you}}}',html:'<html><body><p>Hello {{{contact.first_name|there}}}</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></body></html>',text:'Hello {{{contact.first_name|there}}}. {{{RESEND_UNSUBSCRIBE_URL}}}'};
  const groups={
    resolveEmailGroup:async(actor,key,revision)=>{await repository.assertAdminEmailAccess(actor);if(key!==fixed.group)throw new model.AdminEmailError(404,'Group missing');if(state.archived||revision!==undefined&&revision!==state.groupRevision)throw new model.AdminEmailError(409,'Group changed');return{group:{id:key,name:'Selected members',revision:state.groupRevision},members:structuredClone(state.members)};},
    requireEmailGroupRevision:async(tx,key,revision)=>{if(key!==fixed.group||state.archived||revision!==state.groupRevision)throw new model.AdminEmailError(409,'Group changed');},
    checkEmailGroupRecipientPermission:async email=>state.allowed.has(email),
    checkEmailGroupRecipientPermissionInTransaction:async(tx,email,reason,options)=>{assert.ok(options?.expectedIdentity,'a frozen identity is required at every transaction fence');if(state.onFinalPermission)await state.onFinalPermission(email);const current=state.members.find(m=>m.email===email),expected=options.expectedIdentity;return state.allowed.has(email)&&!!current&&(current.memberId??null)===(expected.memberId??null)&&(current.personId??null)===(expected.personId??null);},
  };
  async function provider(path,method='GET',body,key,deadline) {
    state.requests.push({path,method,deadline});
    if(method==='GET'&&path===`/topics/${fixed.topic}`)return {default_subscription:state.topicDefault};
    if(method==='GET'&&path.startsWith('/contacts/')){const contact=state.contacts.find(c=>c.email===decodeURIComponent(path.slice('/contacts/'.length)));if(!contact)throw new model.AdminEmailError(404,'Missing contact');return structuredClone(contact);}
    assert.equal(method,'POST');assert.equal(path,'/emails');
    const deliveryId=key.split('/')[1];assert.ok(committedClaims.has(deliveryId),'sending fence was committed before provider POST');
    assert.equal(body.to.length,1);assert.doesNotMatch(JSON.stringify(body),/\{\{\{/);
    state.sends.push({body:structuredClone(body),key,deliveryId});
    if(state.sendFailure)return state.sendFailure();
    return {id:`provider-${deliveryId}`};
  }
  async function list(path,limit,deadline) {
    state.requests.push({path,method:'GET',deadline});
    if(state.listFailure)await state.listFailure(path,deadline);
    if(path==='/suppressions')return state.suppressed.map(email=>({id:id(),email}));
    if(path==='/contacts')return structuredClone(state.contacts);
    const match=path.match(/^\/contacts\/([^/]+)\/topics$/);if(match)return structuredClone(state.topics.get(match[1])??[]);
    throw Error(`Unexpected provider list ${path}`);
  }
  const service=await load('src/lib/communications/email-group-campaign-service.ts',{'server-only':{},'node:crypto':crypto,'@/lib/database/server':{getApplicationDatabase:()=>db},'@/lib/platform/config':{getPlatformConfiguration:()=>({mode:state.mode})},'./admin-email-model':model,'./admin-email-repository':repository,'./email-group-campaign-model':campaignModel,'./email-group-repository':groups,'./resend-email-service':{
    resendEmailProvider:provider,listResendEmailRecords:list,prepareResendEmail:async(actor,input)=>{await repository.assertAdminEmailAccess(actor);if(input.templateVersion!==state.version)throw new model.AdminEmailError(409,'Template version changed');return {...message,subject:input.edits.subject??message.subject};},
  }},{process:{env}});
  const draft={name:'A considered update',groupId:fixed.group,groupRevision:1,purpose:'general_updates',templateId:fixed.template,templateVersion:fixed.version,edits:{values:{},copy:{}}};
  const save=async(extra={})=>(await service.saveEmailGroupCampaign(admin,{...draft,...extra})).campaign;
  const review=async(extra={})=>{const campaign=await save(extra);return service.reviewEmailGroupCampaign(admin,campaign.id,campaign.revision);};
  const queue=async(extra={})=>{const reviewed=await review(extra);await service.queueEmailGroupCampaign(admin,reviewed.id);return reviewed;};
  const outcomes=async()=> (await pg.query('select * from admin_email_group_deliveries order by email_normalized')).rows;
  const publicRoute=await load('app/api/email-groups/unsubscribe/route.ts',{'@/lib/communications/admin-email-model':model,'@/lib/communications/email-group-campaign-model':campaignModel,'@/lib/communications/email-group-campaign-service':service});
  return {pg,db,admin,guide,other,fixed,state,env,service,save,review,queue,outcomes,draft,publicRoute,faults,message,repository};
}

test('admin grants precede all provider access, and reviews remain actor-bound',async t=>{
  const f=await fixture(t);
  for(const work of [()=>f.service.getEmailGroupCampaigns(f.guide),()=>f.service.saveEmailGroupCampaign(f.guide,f.draft),()=>f.service.reviewEmailGroupCampaign(f.guide,id(),1),()=>f.service.queueEmailGroupCampaign(f.guide,id())])await assert.rejects(work,error=>error.status===403);
  assert.equal(f.state.requests.length,0);
  const review=await f.review();await assert.rejects(()=>f.service.queueEmailGroupCampaign(f.other,review.id),error=>error.status===404);
  assert.equal(f.state.sends.length,0);
});

test('durable queue freezes reviewed bytes, sends one recipient, and idempotent queue never creates duplicates',async t=>{
  const f=await fixture(t),review=await f.queue();
  assert.equal(f.state.sends.length,0);assert.equal((await f.outcomes()).length,1);
  await f.service.queueEmailGroupCampaign(f.admin,review.id);assert.equal((await f.outcomes()).length,1);
  f.message.html='<p>This change must not reach the approved message.</p>';
  const result=await f.service.processEmailGroupCampaignBatch();assert.equal(result.sent,1);
  const [send]=f.state.sends;assert.match(send.body.html,/Hello Alice/);assert.doesNotMatch(send.body.html,/This change/);
  assert.equal(send.body.topic_id,f.fixed.topic);assert.deepEqual(send.body.reply_to,['reply@example.com']);
  assert.equal(send.body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  const token=new URL(send.body.headers['List-Unsubscribe'].slice(1,-1)).searchParams.get('token');
  const [row]=await f.outcomes();assert.equal(row.unsubscribe_hash,crypto.createHash('sha256').update(token).digest('hex'));assert.notEqual(row.unsubscribe_hash,token);
  assert.equal(row.status,'sent');assert.match(row.safe_reason,/Accepted by Resend; inbox delivery is not confirmed/);
  const detail=await f.service.getEmailGroupCampaigns(f.admin,review.campaignId);assert.equal(detail.outcomes[0].providerId,`provider-${row.id}`);assert.doesNotMatch(JSON.stringify(detail),/unsubscribe_hash|payload_hash|snapshot|recipient_hash/);
  await f.service.processEmailGroupCampaignBatch();assert.equal(f.state.sends.length,1);
});

test('concurrent workers share one committed claim and campaign cannot be queued by a second review',async t=>{
  const f=await fixture(t),campaign=await f.save();
  const first=await f.service.reviewEmailGroupCampaign(f.admin,campaign.id,1),second=await f.service.reviewEmailGroupCampaign(f.admin,campaign.id,1);
  await f.service.queueEmailGroupCampaign(f.admin,first.id);
  await assert.rejects(()=>f.service.queueEmailGroupCampaign(f.admin,second.id),error=>error.status===409);
  await Promise.all([f.service.processEmailGroupCampaignBatch(),f.service.processEmailGroupCampaignBatch()]);
  assert.equal(f.state.sends.length,1);assert.equal((await f.outcomes())[0].status,'sent');
});

test('unknown provider response is terminal and leaves later recipients available without resending the attempted recipient',async t=>{
  const f=await fixture(t);f.state.members=f.state.contacts.map((c,i)=>({email:c.email,name:i?'Bob Person':'Alice Example'}));
  await f.queue();f.state.sendFailure=()=>{throw Error('network acknowledgement lost');};
  const result=await f.service.processEmailGroupCampaignBatch();assert.equal(result.unknown,1);assert.equal(f.state.sends.length,1);
  assert.deepEqual((await f.outcomes()).map(r=>r.status).sort(),['pending','unknown']);
  f.state.sendFailure=null;await f.service.processEmailGroupCampaignBatch();await f.service.processEmailGroupCampaignBatch();
  assert.equal(f.state.sends.length,2);assert.equal(new Set(f.state.sends.map(s=>s.body.to[0])).size,2);
  const overview=await f.service.getEmailGroupCampaigns(f.admin);assert.equal(overview.campaigns[0].status,'attention');assert.equal(overview.campaigns[0].unknown,1);
});

test('provider success followed by lost database acknowledgement remains unknown and cannot be replayed',async t=>{
  const f=await fixture(t);await f.queue();f.faults.push("set status='sent'");
  assert.equal((await f.service.processEmailGroupCampaignBatch()).unknown,1);
  await f.service.processEmailGroupCampaignBatch();assert.equal(f.state.sends.length,1);assert.equal((await f.outcomes())[0].status,'unknown');
});

test('known provider rejection is a terminal failure rather than a blind retry',async t=>{
  const f=await fixture(t);await f.queue();f.state.sendFailure=()=>{throw new model.AdminEmailError(422,'Untrusted private provider details');};
  assert.equal((await f.service.processEmailGroupCampaignBatch()).failed,1);await f.service.processEmailGroupCampaignBatch();
  const [row]=await f.outcomes();assert.equal(row.status,'failed');assert.doesNotMatch(row.safe_reason,/Untrusted/);assert.equal(f.state.sends.length,1);
});

test('changed template, group revision, and permission invalidate review before queue',async t=>{
  const f=await fixture(t),review=await f.review();
  f.state.version=id();await assert.rejects(()=>f.service.queueEmailGroupCampaign(f.admin,review.id),error=>error.status===409);f.state.version=f.fixed.version;
  f.state.groupRevision=2;await assert.rejects(()=>f.service.queueEmailGroupCampaign(f.admin,review.id),error=>error.status===409);f.state.groupRevision=1;
  f.state.allowed.clear();await assert.rejects(()=>f.service.queueEmailGroupCampaign(f.admin,review.id),error=>error.status===409);
  assert.equal((await f.outcomes()).length,0);assert.equal(f.state.sends.length,0);
});

test('current permissions and the original administrator are checked after queue and immediately before handoff',async t=>{
  const f=await fixture(t);await f.queue();let checks=0;
  f.state.onFinalPermission=()=>{if(++checks===2)f.state.allowed.clear();};
  assert.equal((await f.service.processEmailGroupCampaignBatch()).cancelled,1);assert.equal(f.state.sends.length,0);assert.equal((await f.outcomes())[0].status,'cancelled');
  f.state.allowed.add('alice@example.com');f.state.onFinalPermission=null;await f.queue();
  await f.pg.query('update platform_role_grants set revoked_at=now() where auth_user_id=$1',[f.admin]);
  assert.equal((await f.service.processEmailGroupCampaignBatch()).cancelled,1);assert.equal(f.state.sends.length,0);
});

test('general topic defaults and explicit choices intersect local consent and provider suppression; membership purpose does not inherit marketing',async t=>{
  const f=await fixture(t),contact=f.state.contacts[0];f.state.topics.set(contact.id,[]);
  await assert.rejects(()=>f.review(),error=>error.status===400);
  f.state.topicDefault='opt_in';assert.equal((await f.review()).recipientCount,1);
  f.state.topics.set(contact.id,[{id:f.fixed.topic,subscription:'opt_out'}]);await assert.rejects(()=>f.review(),error=>error.status===400);
  const memberReview=await f.queue({purpose:'membership_updates'});assert.equal(memberReview.recipientCount,1);
  await f.service.processEmailGroupCampaignBatch();assert.equal(f.state.sends.length,1);assert.equal(f.state.sends[0].body.topic_id,undefined);
  f.state.suppressed=['alice@example.com'];await assert.rejects(()=>f.review({purpose:'membership_updates'}),error=>error.status===400);
  f.state.suppressed=[];contact.unsubscribed=true;await assert.rejects(()=>f.review({purpose:'membership_updates'}),error=>error.status===400);
  contact.unsubscribed=false;f.state.contacts=[];assert.equal((await f.review({purpose:'membership_updates'})).recipientCount,1);
  await assert.rejects(()=>f.review(),error=>error.status===400);f.state.allowed.clear();await assert.rejects(()=>f.review({purpose:'membership_updates'}),error=>error.status===400);
});

test('disabled delivery preserves draft and review while cron exits without provider work',async t=>{
  const f=await fixture(t);f.env.ADMIN_EMAIL_GROUP_SENDING_ENABLED='false';delete f.env.CRON_SECRET;
  const review=await f.review();await assert.rejects(()=>f.service.queueEmailGroupCampaign(f.admin,review.id),error=>error.status===503);
  const before=f.state.requests.length,result=await f.service.processEmailGroupCampaignBatch();assert.equal(result.sendingReady,false);assert.equal(f.state.requests.length,before);
  assert.equal((await f.outcomes()).length,0);assert.equal((await f.service.getEmailGroupCampaigns(f.admin)).campaigns[0].status,'draft');
});

test('unsubscribe GET does not withdraw, one-click POST is empty and purpose-scoped, and pending matching mail cancels',async t=>{
  const f=await fixture(t);await f.queue();await f.service.processEmailGroupCampaignBatch();
  const url=f.state.sends[0].body.headers['List-Unsubscribe'].slice(1,-1);
  await f.queue();await f.queue({purpose:'membership_updates'});
  const response=await f.publicRoute.GET(new Request(url));assert.equal(response.status,200);assert.match(await response.text(),/general group emails/);
  assert.equal((await f.pg.query('select count(*)::int as count from admin_email_group_withdrawals')).rows[0].count,0);
  const post=await f.publicRoute.POST(new Request(url,{method:'POST',body:'List-Unsubscribe=One-Click'}));assert.equal(post.status,202);assert.equal(await post.text(),'');
  assert.equal((await f.pg.query('select * from admin_email_group_withdrawals')).rows[0].purpose,'general_updates');
  assert.deepEqual((await f.outcomes()).map(r=>r.status).sort(),['cancelled','pending','sent']);
  await f.service.processEmailGroupCampaignBatch();assert.equal(f.state.sends.length,2);assert.equal(f.state.sends[1].body.topic_id,undefined);
  assert.equal((await f.publicRoute.POST(new Request(url,{method:'POST',body:'List-Unsubscribe=One-Click'}))).status,202);
  await assert.rejects(()=>f.review(),error=>error.status===400);assert.equal(f.state.allowed.has('alice@example.com'),true,'native unsubscribe does not impersonate a canonical member preference change');
});

test('public unsubscribe rejects invalid tokens and overlarge bodies before mutation',async t=>{
  const f=await fixture(t);await f.queue();await f.service.processEmailGroupCampaignBatch();const url=f.state.sends[0].body.headers['List-Unsubscribe'].slice(1,-1);
  assert.equal((await f.publicRoute.GET(new Request('https://example.com/?token=not-valid'))).status,404);
  assert.equal((await f.publicRoute.POST(new Request(url,{method:'POST',body:'x'.repeat(2049)}))).status,413);
  assert.equal((await f.pg.query('select count(*)::int as count from admin_email_group_withdrawals')).rows[0].count,0);
});

test('database protects approvals and delivery claims, and client roles cannot read private campaign data',async t=>{
  const f=await fixture(t),review=await f.queue();await f.service.processEmailGroupCampaignBatch();
  await assert.rejects(()=>f.pg.query("update admin_email_group_campaign_reviews set snapshot='{}'::jsonb where id=$1",[review.id]),/immutable/);
  await assert.rejects(()=>f.pg.query("update admin_email_group_campaigns set status='draft' where id=$1",[review.campaignId]),/immutable/);
  await assert.rejects(()=>f.pg.query("update admin_email_group_deliveries set status='pending'"),/immutable/);
  for(const role of ['anon','authenticated']){await f.pg.exec(`set role ${role}`);await assert.rejects(()=>f.pg.query('select * from admin_email_group_deliveries'),/permission denied/);await f.pg.exec('reset role');}
});

test('actual admin route uses origin/session/JSON checks before parsing, preserves errors, and queue never sends',async t=>{
  const f=await fixture(t),OpsOperatingRepositoryError=class extends Error{},AdminEmailAIError=class extends Error{constructor(message,status){super(message);this.status=status;}};
  const session={getCurrentPlatformViewer:async()=>f.state.viewer?{authUserId:f.state.viewer}:null};
  const ops=await load('src/lib/platform/ops-api.ts',{'next/server':{NextResponse:Response},'@/lib/auth/request':{isTrustedPlatformOrigin:request=>request.headers.get('origin')===new URL(request.url).origin},'@/lib/auth/session':session,'@/lib/platform/ops-operating-repository':{OpsOperatingRepositoryError}});
  const api=await load('src/lib/communications/admin-email-api.ts',{'server-only':{},'@/lib/communications/admin-email-model':model,'@/lib/communications/admin-email-ai':{AdminEmailAIError},'@/lib/communications/admin-email-repository':f.repository,'@/lib/platform/ops-api':ops,'@/lib/platform/ops-operating-repository':{OpsOperatingRepositoryError}});
  const route=await load('app/api/ops/emails/groups/campaigns/route.ts',{'@/lib/auth/session':session,'@/lib/communications/admin-email-api':api,'@/lib/communications/admin-email-model':model,'@/lib/communications/email-group-campaign-service':f.service,'@/lib/platform/ops-api':ops});
  const request=(body,headers={})=>new Request('https://members.example.com/api/ops/emails/groups/campaigns',{method:'POST',headers:{origin:'https://members.example.com','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  assert.equal((await route.POST(request('{',{origin:'https://untrusted.example.com'}))).status,403);
  f.state.viewer=null;assert.equal((await route.POST(request('{'))).status,401);assert.equal((await route.GET(new Request('https://members.example.com/'))).status,401);
  f.state.viewer=f.guide;assert.equal((await route.POST(request('{'))).status,403);
  f.state.viewer=f.admin;assert.equal((await route.POST(request('{',{'content-type':'text/plain'}))).status,415);assert.equal((await route.POST(request('x'.repeat(64001)))).status,413);
  const saved=await route.POST(request({action:'save',draft:f.draft}));assert.equal(saved.status,200);const {campaign}=await saved.json();
  const reviewed=await route.POST(request({action:'review',id:campaign.id,revision:1}));assert.equal(reviewed.status,200);const review=await reviewed.json();
  const queued=await route.POST(request({action:'send',reviewId:review.id}));assert.equal(queued.status,200);assert.equal((await queued.json()).status,'queued');assert.equal(f.state.sends.length,0);
  const detail=await route.GET(new Request(`https://members.example.com/?id=${campaign.id}`));assert.equal(detail.headers.get('cache-control'),'no-store');assert.equal((await detail.json()).campaign.status,'queued');
});

test('actual cron requires exact configured bearer authorization before it processes any delivery',async t=>{
  const f=await fixture(t);await f.queue();
  const route=await load('app/api/internal/communications/group-emails/route.ts',{'node:crypto':crypto,'next/server':{NextResponse:Response},'@/lib/communications/email-group-campaign-service':f.service},{process:{env:f.env}});
  const request=value=>new Request('https://example.com/api/internal/communications/group-emails',{headers:value?{authorization:value}:{}});
  assert.equal((await route.GET(request())).status,401);assert.equal((await route.POST(request('Bearer invalid'))).status,401);assert.equal(f.state.sends.length,0);
  assert.equal((await route.GET(request('Bearer mock-cron-secret'))).status,200);assert.equal(f.state.sends.length,1);
});

test('a reused email address cannot transfer approval to another member or person',async t=>{
  const f=await fixture(t);f.state.members[0]={...f.state.members[0],memberId:id(),personId:id()};await f.queue();
  f.state.members[0].personId=id();
  assert.equal((await f.service.processEmailGroupCampaignBatch()).cancelled,1);assert.equal(f.state.sends.length,0);
});

test('interrupted stale claims become uncertain and never return to the automatic queue',async t=>{
  const f=await fixture(t);await f.queue();
  await f.pg.query("update admin_email_group_deliveries set status='sending',attempted_at=now()-interval '6 minutes',unsubscribe_hash='interrupted-token-digest',payload_hash='interrupted-payload-digest'");
  await f.service.processEmailGroupCampaignBatch();assert.equal((await f.outcomes())[0].status,'unknown');assert.equal(f.state.sends.length,0);
  assert.equal((await f.service.getEmailGroupCampaigns(f.admin)).campaigns[0].status,'attention');
});

test('one review reads the general topic default once while each recipient retains an independent topic check',async t=>{
  const f=await fixture(t);f.state.members=f.state.contacts.map(c=>({email:c.email,name:'Example'}));
  assert.equal((await f.review()).recipientCount,2);
  assert.equal(f.state.requests.filter(r=>r.path===`/topics/${f.fixed.topic}`).length,1);
  assert.equal(f.state.requests.filter(r=>/^\/contacts\/[^/]+\/topics$/.test(r.path)).length,2);
});

test('all worker provider reads and the only POST share one absolute delivery deadline',async t=>{
  const f=await fixture(t);await f.queue();f.state.requests=[];const started=Date.now();
  assert.equal((await f.service.processEmailGroupCampaignBatch()).sent,1);
  assert.ok(f.state.requests.length>=9);
  const deadlines=new Set(f.state.requests.map(request=>request.deadline));assert.equal(deadlines.size,1);
  const [deadline]=deadlines;assert.ok(deadline>=started+149000&&deadline<=Date.now()+150000);
  assert.equal(f.state.requests.at(-1).method,'POST');
});

test('provider budget exhaustion after the committed claim cancels before any POST',async t=>{
  const f=await fixture(t);await f.queue();let suppressionReads=0;
  f.state.listFailure=(path,deadline)=>{if(path==='/suppressions'&&++suppressionReads===2){assert.equal(typeof deadline,'number');throw new model.AdminEmailError(503,'Delivery budget exhausted');}};
  const result=await f.service.processEmailGroupCampaignBatch();assert.equal(result.claimed,1);assert.equal(result.cancelled,1);assert.equal(result.unknown,0);
  assert.equal(f.state.sends.length,0);assert.equal((await f.outcomes())[0].status,'cancelled');
});
