import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

async function load(path,dependencies={}) {
  const source=await readFile(new URL(`../${path}`,import.meta.url),"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function("require","module","exports",output)(name=>{
    assert.ok(name in dependencies,`Unexpected dependency: ${name}`);return dependencies[name];
  },loaded,loaded.exports);
  return loaded.exports;
}
const pricingConfirmation=await load("src/lib/membership/registration-pricing-confirmation.ts");
const email=await load("src/lib/membership/registration-email.ts", {"./registration-pricing-confirmation":pricingConfirmation});
const confirmedFoundingPricing = {confirmed:true,awardedAt:"2026-10-02T18:00:00.000Z",
  monthlyAmountCents:34900,annualAmountCents:349000,currency:"usd"};

test("welcome confirms only a persisted paid-path founding rate with explicit no-charge terms",()=>{
  const input={kind:"welcome",memberName:"Alex",completionBasis:"saved_card",siteUrl:new URL("https://members.example.test")};
  const founding=email.createRegistrationEmail({...input,foundingPricing:confirmedFoundingPricing});
  for (const output of [founding.html,founding.text]) {
    assert.match(output,/Your Founding rate is locked in/);
    assert.match(output,/\$349\/month/);
    assert.match(output,/\$3,490\/year with annual billing/);
    assert.match(output,/Individual membership/);
    assert.match(output,/applicable tax added at checkout/);
    assert.match(output,/Nothing has been charged/);
    assert.match(output,/confirm checkout before billing begins/);
    assert.match(output,/continuously active/);
    assert.match(output,/rejoining requires a new eligibility check/);
  }
  for (const override of [
    {foundingPricing:null}, {foundingPricing:{...confirmedFoundingPricing,confirmed:false}},
    {foundingPricing:{...confirmedFoundingPricing,monthlyAmountCents:NaN}},
    {foundingPricing:confirmedFoundingPricing,completionBasis:"complimentary"},
    {foundingPricing:confirmedFoundingPricing,kind:"profile_ready"},
  ]) {
    const result=email.createRegistrationEmail({...input,...override});
    assert.doesNotMatch(result.html+result.text,/Founding rate is locked|\$349/);
  }
});

test("visual emails use the supplied welcome letter, escape identity, and preserve the separate profile-ready message",async()=>{
  const input={kind:"welcome",memberName:'Alex <script> & "Friend"',completionBasis:"saved_card",siteUrl:new URL("https://members.example.test")};
  const result=email.createRegistrationEmail(input);
  assert.match(result.html,/Alex &lt;script&gt; &amp; &quot;Friend&quot;/);
  assert.doesNotMatch(result.html,/<script>/);
  assert.equal(result.subject,"Welcome to RU/NED");
  assert.match(result.text,/Alex <script> & "Friend", you’re in\./);
  assert.match(result.text,/First, thank you\./);
  assert.match(result.html,/<strong>Your first Foundations call is November 5 at 3:00PM MT\.<\/strong>/);
  assert.match(result.html,/begins with <strong>Foundations<\/strong>/);
  assert.match(result.text,/including onboarding, access, reminders, and details for your first call/);
  assert.match(result.text,/See you November 5\.\n\nTyler, Libby, Cade & Mitch\nRU\/NED\nAfter the fear\n/);
  assert.doesNotMatch(result.html,/<h1\b/);
  assert.ok(result.text.startsWith('Alex <script> & "Friend", you’re in.'));
  assert.match(result.html,/first-thank-you-cadehandy2.png" width="250" alt="First, thank you\."/);
  assert.match(result.html,/after-the-fear-cadehandy2.png" width="220" alt="After the fear"/);
  assert.match(result.html,/<strong>Tyler, Libby, Cade &amp; Mitch<\/strong><\/p><img src="https:\/\/members.example.test\/ruined-wordmark-email-bone.png"/);
  const newEmphasis="We know where we’re going. And some of what we build along the way will exist because of the people who walk through the door and help shape it.";
  assert.ok(result.html.includes(`We have a lot we want to build with RU/NED. <strong>${newEmphasis}</strong>`));
  assert.ok(result.text.includes(newEmphasis));
  assert.doesNotMatch(result.text,/Some of it we already know|help shape what comes next/);
  assert.match(result.html,/background="https:\/\/members.example.test\/membership\/design\/printers-ink.jpg"/);
  assert.doesNotMatch(result.text,/View your registration|Your card was saved|profile is now open/);
  assert.match(result.html,/src="https:\/\/members.example.test\/ruined-wordmark-email-bone.png"/);
  assert.match(result.html,/src="https:\/\/members.example.test\/membership\/card\/share\/invitation-spin-v1.jpg"/);
  const personalized=email.createRegistrationEmail({...input,invitationImageSrc:"cid:ruined-invitation"});
  assert.match(personalized.html,/src="cid:ruined-invitation"/);
  assert.equal(personalized.text,result.text,"the invitation image does not alter the approved welcome letter");
  for(const asset of ["ruined-wordmark-email-bone.png","membership/card/share/invitation-spin-v1.jpg","membership/design/printers-ink.jpg","membership/email/first-thank-you-cadehandy2.png","membership/email/after-the-fear-cadehandy2.png"]) {
    assert.ok((await readFile(new URL(`../public/${asset}`,import.meta.url))).length>0);
  }
  const complimentary=email.createRegistrationEmail({...input,completionBasis:"complimentary"});
  assert.deepEqual(complimentary,result,"the same welcome letter reaches paid-path and complimentary registrations");
  const ready=email.createRegistrationEmail({...input,kind:"profile_ready"});
  assert.match(ready.html,/invitation-spin-v1.jpg/);
  assert.match(ready.text,/profile is now open/);
  assert.doesNotMatch(ready.text,/November 5|First, thank you/);
  assert.match(ready.text,/explicitly confirm activation/);
  assert.match(ready.text,/does not authorize future charges/);
  assert.match(ready.text,/Open your profile: https:\/\/members.example.test\/my/);
  assert.match(ready.text,/After the fear\./);
  assert.doesNotMatch(ready.html,/printers-ink/);
});

async function fixture(t,{kind="welcome",activated=false,basis="saved_card"}={}) {
  const PGlite=await loadPGliteForSchemaChecks(),pg=new PGlite();
  const ids=Object.fromEntries(["member","person","auth","message"].map(key=>[key,crypto.randomUUID()]));
  const migration=await readFile(new URL("../db/migrations/20260930140000_member_registration_access.sql",import.meta.url),"utf8");
  const tables=["member_registration_access","member_registration_messages"].map(name=>{
    const table=migration.match(new RegExp(`create table public\\.${name} \\([\\s\\S]+?\\n\\);`));
    assert.ok(table,`Missing actual ${name} table`);return table[0];
  }).join("\n");
  const pricingMigration=await readFile(new URL("../db/migrations/20261002140000_registration_founding_pricing.sql",import.meta.url),"utf8");
  const pricingTable=pricingMigration.match(/create table public\.member_registration_pricing_decisions \([\s\S]+?\n\);/);
  assert.ok(pricingTable,"Missing actual registration pricing decision table");
  const payloadGuards=migration.slice(migration.indexOf("create function private.ruined_guard_registration_message_payload()"),
    migration.indexOf("create function private.ruined_member_profile_released("));
  assert.match(payloadGuards,/create trigger registration_message_payload_erasure/);
  await pg.exec(`create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key,status text);
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,deleted_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text);
    create table person_profiles(person_id uuid primary key,display_name text);
    create table person_private_profiles(person_id uuid primary key,legal_name text);
    create table person_email_addresses(id uuid primary key default gen_random_uuid(),person_id uuid,email_normalized text,verification_state text,retired_at timestamptz);
    create table member_personal_invitations(id uuid primary key,member_id uuid,origin text,
      recipient_name text,inviter_name text,inviter_tag text,issued_at timestamptz,expires_at timestamptz,
      accepted_member_id uuid,accepted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key);
    create table member_payment_method_setup_attempts(id uuid primary key);
    create table test_registration_readiness(member_id uuid,ready boolean);
    create function private.ruined_lock_member_complimentary_funding(uuid) returns boolean language sql as 'select true';
    create function private.ruined_member_registration_ready(uuid) returns boolean language sql as
      'select ready from test_registration_readiness where member_id=$1';
    ${tables}
    ${pricingTable[0]}
    create table test_registration_pricing_current(member_id uuid primary key,current boolean);
    create function private.ruined_registration_founding_pricing_is_current(uuid) returns boolean language sql as
      'select coalesce((select current from test_registration_pricing_current where member_id=$1),true)';
    ${payloadGuards}`);
  await pg.query("insert into people values($1,'active')",[ids.person]);
  await pg.query("insert into ruined_members values($1,$2,'alex@example.test',null)",[ids.member,ids.person]);
  await pg.query("insert into member_lifecycle values($1,'provisional')",[ids.member]);
  await pg.query("insert into person_profiles values($1,'Alex Rivera')",[ids.person]);
  await pg.query("insert into person_private_profiles values($1,'Alex Rivera')",[ids.person]);
  await pg.query("insert into person_email_addresses(person_id,email_normalized,verification_state) values($1,'alex@example.test','verified')",[ids.person]);
  await pg.query("insert into platform_users values($1)",[ids.auth]);
  await pg.query("insert into test_registration_readiness values($1,true)",[ids.member]);
  await pg.query(`insert into member_registration_access(member_id,registered_at,completion_basis,profile_activated_at,activated_by_auth_user_id)
    values($1,now(),$2,case when $3 then now() else null end,case when $3 then $4::uuid else null end)`,[ids.member,basis,activated,ids.auth]);
  await pg.query("insert into member_registration_messages(id,member_id,kind) values($1,$2,$3)",[ids.message,ids.member,kind]);
  const sends=[],responses=[],faults=[],hooks=[],committed=[],rendered=[];
  function wrap(client) {
    const sql=(strings,...params)=>{
      const query=strings.reduce((text,part,index)=>text+(index?`$${index}`:"")+part,"");
      const fault=faults.findIndex(pattern=>query.includes(pattern));
      if(fault>=0){faults.splice(fault,1);throw new Error("Injected database failure");}
      return client.query(query,params).then(result=>result.rows);
    };
    sql.json=JSON.stringify;
    sql.begin=async operation=>{
      const result=await client.transaction(tx=>operation(wrap(tx)));
      committed.push((await pg.query("select * from member_registration_messages where id=$1",[ids.message])).rows[0]);
      const hook=hooks.shift();if(hook) await hook();
      return result;
    };
    return sql;
  }
  const repo=await load("src/lib/membership/registration-message-repository.ts",{
    "server-only":{},"@/lib/database/server":{getApplicationDatabase:()=>wrap(pg)},
  });
  const worker=await load("src/lib/membership/registration-message-delivery.ts",{
    "server-only":{},"node:crypto":crypto,
    "@/lib/platform/config":{getPlatformConfiguration:()=>({mode:"connected"})},
    "@/lib/support/model":{SUPPORT_EMAIL:"connect@theruinedproject.com"},
    "./registration-email":email,"./registration-message-repository":repo,
    "./registration-invitation-image":{renderRegistrationInvitationHero:async input=>{
      rendered.push(input);return Buffer.from(JSON.stringify(input));
    }},
    resend:{Resend:class{emails={send:async(payload,options)=>{
      const saved=committed.at(-1);
      assert.ok(saved.first_send_attempt_at,"uncertainty fence committed before send");
      assert.deepEqual(payload,saved.delivery_payload,"identical bytes committed before send");
      sends.push({payload,options});
      const response=responses.shift();if(response instanceof Error)throw response;
      return response?{data:null,error:response}:{data:{id:"provider-accepted"},error:null};
    }};}},
  });
  const settings={NODE_ENV:"test",MEMBER_REGISTRATION_EMAILS_ENABLED:"true",RESEND_API_KEY:"no-network-test-key",
    RESEND_FROM_EMAIL:"Ruined <connect@theruinedproject.com>",NEXT_PUBLIC_SITE_URL:"https://members.example.test"};
  const old=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));Object.assign(process.env,settings);
  t.after(async()=>{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await pg.close();});
  return {pg,ids,worker,sends,responses,faults,hooks,rendered,
    invite:async ({origin="member",owner=crypto.randomUUID(),recipient="Alex from invitation",inviter="Original Inviter",tag="original",member=ids.member,
      issued="2026-09-01T12:00:00.000Z",expires="2026-09-03T12:00:00.000Z",accepted="2026-09-02T12:00:00.000Z"}={})=>{
      const id=crypto.randomUUID();
      await pg.query(`insert into member_personal_invitations values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id,owner,origin,recipient,inviter,tag,issued,expires,member,accepted]);
      return id;
    },
    row:async()=>(await pg.query("select * from member_registration_messages where id=$1",[ids.message])).rows[0],
    due:()=>pg.query("update member_registration_messages set available_at=now()-interval '1 minute' where id=$1",[ids.message]),
    activate:()=>pg.query("update member_registration_access set profile_activated_at=now(),activated_by_auth_user_id=$2 where member_id=$1",[ids.member,ids.auth]),
  };
}

test("welcome uses canonical verified identity and sends once; duplicate enqueue is rejected",async t=>{
  const f=await fixture(t);
  assert.equal((await f.worker.processRegistrationMessageBatch(10,{memberId:f.ids.member})).sent,1);
  assert.equal(f.sends[0].payload.to,"alex@example.test");
  assert.equal(f.sends[0].options.idempotencyKey,`registration:${f.ids.message}`);
  assert.equal((await f.row()).status,"sent");
  assert.equal((await f.row()).provider_message_id,"provider-accepted");
  assert.equal((await f.worker.processRegistrationMessageBatch()).claimed,0);
  await assert.rejects(f.pg.query("insert into member_registration_messages(member_id,kind) values($1,'welcome')",[f.ids.member]),/unique/);
});

test("welcome reads the recorded founding decision and preserves its confirmation on an uncertain retry",async t=>{
  const f=await fixture(t);
  await f.pg.query(`insert into member_registration_pricing_decisions(member_id,person_id,registered_at,
    completion_basis,founding_eligible,occupied_count_at_decision,monthly_amount_cents,annual_amount_cents)
    values($1,$2,now(),'saved_card',true,49,34900,349000)`,[f.ids.member,f.ids.person]);
  f.responses.push(new Error("transport lost"));
  assert.equal((await f.worker.processRegistrationMessageBatch()).failed,1);
  assert.match(f.sends[0].payload.html,/Your Founding rate is locked in/);
  assert.match(f.sends[0].payload.text,/\$349\/month/);
  await f.pg.query("insert into test_registration_pricing_current values($1,false)",[f.ids.member]);
  await f.due();
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.deepEqual(f.sends[0],f.sends[1],"an uncertain send retries the exact confirmed payload and idempotency key");
});

test("a lapsed pricing decision is not newly confirmed in a welcome message",async t=>{
  const f=await fixture(t);
  await f.pg.query(`insert into member_registration_pricing_decisions(member_id,person_id,registered_at,
    completion_basis,founding_eligible,occupied_count_at_decision,monthly_amount_cents,annual_amount_cents)
    values($1,$2,now(),'saved_card',true,10,34900,349000)`,[f.ids.member,f.ids.person]);
  await f.pg.query("insert into test_registration_pricing_current values($1,false)",[f.ids.member]);
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.doesNotMatch(f.sends[0].payload.html+f.sends[0].payload.text,/Founding rate is locked|\$349/);
});

test("welcome card uses the original accepted invitation, not a current profile or newer invitation",async t=>{
  const f=await fixture(t),owner=crypto.randomUUID();
  await f.invite({owner});
  await f.invite({recipient:"New unaccepted request",accepted:null});
  await f.invite({recipient:"Another member's private card",member:crypto.randomUUID(),accepted:"2026-08-01T12:00:00.000Z"});
  await f.invite({recipient:"Later accepted card",accepted:"2026-09-03T12:00:00.000Z"});
  await f.pg.query("update person_profiles set display_name='Current profile name'");
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.equal(f.rendered.length,1);
  assert.deepEqual(f.rendered[0],{
    recipientName:"Alex from invitation",inviterName:"Original Inviter",inviterTag:"original",invitationSource:"member",
    issuedAt:"2026-09-01T12:00:00.000Z",expiresAt:"2026-09-03T12:00:00.000Z",
    wearSeed:crypto.createHash("sha256").update(`ruined-invitation:${owner}`).digest("hex").slice(0,24),
  });
  const [attachment]=f.sends[0].payload.attachments;
  assert.equal(attachment.contentId,"ruined-invitation");
  assert.equal(attachment.filename,"your-invitation.jpg");
  assert.deepEqual(JSON.parse(Buffer.from(attachment.content,"base64").toString()),f.rendered[0]);
  assert.match(f.sends[0].payload.html,/src="cid:ruined-invitation"/);
  assert.doesNotMatch(f.sends[0].payload.html,/\/invitation\/[^<\s]*/);
});

test("direct invitation card retains direct attribution and the original issued year/deadline",async t=>{
  const f=await fixture(t);
  await f.invite({origin:"ruined_direct",owner:null,inviter:"Ruined",tag:null,
    issued:"2025-12-31T12:00:00.000Z",expires:"2026-01-02T12:00:00.000Z",accepted:"2026-01-01T12:00:00.000Z"});
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.equal(f.rendered[0].invitationSource,"ruined_direct");
  assert.equal(f.rendered[0].inviterName,"The Ruined Project");
  assert.equal(f.rendered[0].issuedAt,"2025-12-31T12:00:00.000Z");
  assert.equal(f.rendered[0].expiresAt,"2026-01-02T12:00:00.000Z");
});

test("generic registration without a personal invitation never invents a sender or attachment",async t=>{
  const f=await fixture(t);
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.equal(f.rendered.length,0);assert.equal(f.sends[0].payload.attachments,undefined);
  assert.match(f.sends[0].payload.html,/invitation-spin-v1.jpg/);
});

test("default-off flag leaves queued service messages untouched",async t=>{
  const f=await fixture(t);delete process.env.MEMBER_REGISTRATION_EMAILS_ENABLED;
  const result=await f.worker.processRegistrationMessageBatch();
  assert.equal(result.ready,false);assert.equal(result.claimed,0);assert.equal(f.sends.length,0);
  assert.equal((await f.row()).status,"pending");
});

test("provider success followed by database failure retries identical message and provider key",async t=>{
  const f=await fixture(t);await f.invite();f.faults.push("set status='sent'");
  assert.equal((await f.worker.processRegistrationMessageBatch()).failed,1);
  assert.equal(f.sends.length,1);assert.ok((await f.row()).first_send_attempt_at);
  await f.pg.query("update person_profiles set display_name='A different name'");
  await f.pg.query("delete from member_personal_invitations");
  await f.due();assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.deepEqual(f.sends[0],f.sends[1]);
  assert.equal(f.rendered.length,1,"retry reuses the frozen attachment bytes even when its source is gone");
});

test("already prepared older welcome messages are not rewritten during retry",async t=>{
  const f=await fixture(t);
  const prior={from:"Ruined <connect@theruinedproject.com>",to:"alex@example.test",replyTo:"connect@theruinedproject.com",
    subject:"Original approved email",html:"<p>Original frozen message</p>",text:"Original frozen message"};
  await f.pg.query("update member_registration_messages set delivery_payload=$1::jsonb,first_send_attempt_at=now()",[JSON.stringify(prior)]);
  await f.invite();assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.deepEqual(f.sends[0].payload,prior);assert.equal(f.rendered.length,0);
});

test("uncertain delivery outside provider replay window needs manual review and never resends",async t=>{
  const f=await fixture(t);f.responses.push(new Error("transport lost"));
  await f.worker.processRegistrationMessageBatch();
  await f.pg.query("update member_registration_messages set first_send_attempt_at=now()-interval '24 hours'");
  await f.due();assert.equal((await f.worker.processRegistrationMessageBatch()).manualReview,1);
  assert.equal(f.sends.length,1);assert.equal((await f.row()).status,"manual_review");
});

test("member deletion between preparation and delivery prevents the send",async t=>{
  const f=await fixture(t);f.hooks.push(()=>f.pg.query("update ruined_members set deleted_at=now()"));
  assert.equal((await f.worker.processRegistrationMessageBatch()).deferred,1);
  assert.equal((await f.row()).status,"cancelled");assert.equal((await f.row()).delivery_payload,null);
  assert.equal(f.sends.length,0);
});

test("account erasure scrubs image/email bytes, cancels unsent messages, and preserves delivery history",async t=>{
  const f=await fixture(t);await f.invite();
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  const sent=await f.row();assert.ok(sent.delivery_payload.attachments[0].content);
  await assert.rejects(f.pg.query("update member_registration_messages set delivery_payload=null where id=$1",[f.ids.message]),/immutable/);
  await assert.rejects(f.pg.query("update member_registration_messages set delivery_payload='{}'::jsonb where id=$1",[f.ids.message]),/immutable/);
  await assert.rejects(f.pg.query("update member_registration_messages set member_id=$1 where id=$2",[crypto.randomUUID(),f.ids.message]),/cannot change its identity/);
  const unsentId=crypto.randomUUID();
  await f.pg.query(`insert into member_registration_messages(id,member_id,kind,status,attempts,locked_at,lock_token,
    first_send_attempt_at,delivery_payload,last_error) values($1,$2,'profile_ready','sending',2,now(),$3,now(),$4::jsonb,'provider_timeout')`,
    [unsentId,f.ids.member,crypto.randomUUID(),JSON.stringify(sent.delivery_payload)]);
  const unsentBefore=(await f.pg.query("select * from member_registration_messages where id=$1",[unsentId])).rows[0];
  await f.pg.query("update ruined_members set deleted_at=now() where id=$1",[f.ids.member]);
  const erased=await f.row();
  assert.equal(erased.delivery_payload,null);assert.equal(erased.status,"sent");
  for(const key of ["id","member_id","kind","attempts","first_send_attempt_at","sent_at","provider_message_id","created_at"]){
    assert.deepEqual(erased[key],sent[key],`sent ${key} remains auditable`);
  }
  const cancelled=(await f.pg.query("select * from member_registration_messages where id=$1",[unsentId])).rows[0];
  assert.equal(cancelled.delivery_payload,null);assert.equal(cancelled.status,"cancelled");
  assert.equal(cancelled.locked_at,null);assert.equal(cancelled.lock_token,null);assert.equal(cancelled.last_error,"account_deleted");
  assert.equal(cancelled.attempts,2);assert.deepEqual(cancelled.first_send_attempt_at,unsentBefore.first_send_attempt_at);
  assert.equal((await f.worker.processRegistrationMessageBatch()).claimed,0,"deleted message cannot be retried");
  await assert.rejects(f.pg.query("update member_registration_messages set delivery_payload=$1::jsonb where id=$2",
    [JSON.stringify(sent.delivery_payload),f.ids.message]),/deleted account cannot retain/);
  assert.equal((await f.pg.query("select count(*)::integer as total from ruined_members where id=$1 and deleted_at is not null",[f.ids.member])).rows[0].total,1,
    "historical member is retained");
});

test("changed verified recipient cannot receive the frozen message",async t=>{
  const f=await fixture(t);f.hooks.push(async()=>{
    await f.pg.query("update ruined_members set email_normalized='changed@example.test'");
    await f.pg.query("update person_email_addresses set email_normalized='changed@example.test'");
  });
  assert.equal((await f.worker.processRegistrationMessageBatch()).manualReview,1);
  assert.equal(f.sends.length,0);
});

test("profile activation supersedes an unsent waiting-room welcome",async t=>{
  const f=await fixture(t);f.hooks.push(f.activate);
  assert.equal((await f.worker.processRegistrationMessageBatch()).cancelled,1);
  assert.equal(f.sends.length,0);
});

test("withdrawn card consent defers the welcome without consuming attempts; restoration can deliver",async t=>{
  const f=await fixture(t);await f.pg.query("update test_registration_readiness set ready=false");
  assert.equal((await f.worker.processRegistrationMessageBatch()).deferred,1);
  assert.equal((await f.row()).status,"pending");assert.equal((await f.row()).attempts,0);
  assert.equal(f.sends.length,0);assert.equal((await f.row()).first_send_attempt_at,null);
  await f.pg.query("update test_registration_readiness set ready=true");await f.due();
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
});

test("profile-ready message requires actual activation, and complimentary copy requires no card",async t=>{
  const f=await fixture(t,{kind:"profile_ready",activated:true,basis:"complimentary"});
  await f.invite();
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  assert.match(f.sends[0].payload.text,/profile is now open/);
  assert.match(f.sends[0].payload.text,/does not start paid billing/);
  assert.doesNotMatch(f.sends[0].payload.text,/card was saved/);
  assert.equal(f.rendered.length,0);assert.equal(f.sends[0].payload.attachments,undefined);
});

test("a premature profile-ready message and an unverified identity cannot send",async t=>{
  const f=await fixture(t,{kind:"profile_ready"});
  assert.equal((await f.worker.processRegistrationMessageBatch()).cancelled,1);assert.equal(f.sends.length,0);
  await f.pg.query("delete from member_registration_messages where id=$1",[f.ids.message]);
  await f.pg.query("insert into member_registration_messages(id,member_id,kind) values($1,$2,'welcome')",[f.ids.message,f.ids.member]);
  await f.pg.query("update person_email_addresses set verification_state='unverified'");
  assert.equal((await f.worker.processRegistrationMessageBatch()).cancelled,1);assert.equal(f.sends.length,0);
});

test("stale lease can recover; attempts stop at manual review",async t=>{
  const f=await fixture(t);await f.pg.query("update member_registration_messages set status='sending',locked_at=now()-interval '10 minutes',lock_token=$1",[crypto.randomUUID()]);
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent,1);
  await f.pg.query("update member_registration_messages set status='failed',attempts=5,sent_at=null,provider_message_id=null,available_at=now()");
  assert.equal((await f.worker.processRegistrationMessageBatch()).manualReview,1);assert.equal(f.sends.length,1);
});

test("email preview is fictional, inert, and not available in production",async()=>{
  let mode="preview";
  const preview=await load("app/api/preview/registration-email/route.ts",{
    "@/lib/platform/config":{getPlatformConfiguration:()=>({mode})},"@/lib/membership/registration-email":email,
  });
  const old=process.env.NODE_ENV;process.env.NODE_ENV="test";
  try{
    const response=preview.GET(new Request("http://localhost/api/preview/registration-email?kind=profile_ready&funding=complimentary"));
    assert.equal(response.status,200);assert.match(await response.text(),/Alex Rivera/);
    assert.match(response.headers.get("Content-Security-Policy"),/default-src 'none'/);
    mode="connected";assert.equal(preview.GET(new Request("http://localhost/api/preview/registration-email")).status,404);
    mode="preview";process.env.NODE_ENV="production";assert.equal(preview.GET(new Request("http://localhost/api/preview/registration-email")).status,404);
  }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});

test("local email preview assets stay same-origin across localhost and 127.0.0.1 aliases",async()=>{
  const preview=await load("app/api/preview/registration-email/route.ts",{
    "@/lib/platform/config":{getPlatformConfiguration:()=>({mode:"preview"})},"@/lib/membership/registration-email":email,
  });
  const old=process.env.NODE_ENV;process.env.NODE_ENV="test";
  try{
    for(const host of ["localhost:3243","127.0.0.1:3243"]){
      for(const kind of ["welcome","profile_ready"]){
        const response=preview.GET(new Request(`http://${host}/api/preview/registration-email?kind=${kind}`));
        const html=await response.text();
        const images=[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]);
        assert.equal(images.length,kind==="welcome" ? 5 : 2);
        assert.ok(images.every(source=>source.startsWith("/")&&!source.startsWith("//")),`${host} ${kind} assets must stay same-origin`);
        if(kind==="welcome") {
          assert.ok(images.includes("/api/preview/registration-email/image?source=direct"));
          assert.match(html,/background="\/membership\/design\/printers-ink.jpg"/);
          assert.ok(html.includes("background-image:url('/membership/design/printers-ink.jpg')"));
        }
        assert.match(response.headers.get("Content-Security-Policy"),/img-src 'self'/);
      }
    }
  }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});

test("preview image is fictional, ignores supplied identity, and cannot render in production or connected mode",async()=>{
  let mode="preview";const rendered=[];
  const preview=await load("app/api/preview/registration-email/image/route.ts",{
    "@/lib/platform/config":{getPlatformConfiguration:()=>({mode})},
    "@/lib/membership/registration-invitation-image":{renderRegistrationInvitationHero:async input=>{
      rendered.push(input);return Buffer.from("fictional-image-bytes");
    }},
  });
  const old=process.env.NODE_ENV;process.env.NODE_ENV="test";
  try{
    const response=await preview.GET(new Request("http://localhost/api/preview/registration-email/image?source=member&recipientName=Private%20Name&inviterName=Injected&token=secret"));
    assert.equal(response.status,200);assert.equal(response.headers.get("Content-Type"),"image/jpeg");
    assert.equal(response.headers.get("Cache-Control"),"private, no-store");
    assert.equal(rendered[0].recipientName,"Alex Rivera");assert.equal(rendered[0].inviterName,"Cade Mangelson");
    assert.equal(rendered[0].inviterTag,"cade");assert.equal(rendered[0].invitationSource,"member");
    assert.equal(rendered[0].expiresAt,null);
    const direct=await preview.GET(new Request("http://localhost/api/preview/registration-email/image"));
    assert.equal(direct.status,200);assert.equal(rendered[1].inviterName,"The Ruined Project");
    assert.equal(rendered[1].inviterTag,null);assert.equal(rendered[1].invitationSource,"ruined_direct");
    mode="connected";
    assert.equal((await preview.GET(new Request("http://localhost/api/preview/registration-email/image"))).status,404);
    mode="preview";process.env.NODE_ENV="production";
    assert.equal((await preview.GET(new Request("http://localhost/api/preview/registration-email/image"))).status,404);
    assert.equal(rendered.length,2,"blocked routes must not render anything");
  }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});

test("registration recovery endpoint requires its bearer secret and does not accept request recipients",async()=>{
  let calls=0;
  const route=await load("app/api/internal/membership/registration-messages/route.ts",{
    "node:crypto":crypto,"next/server":{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}},
    "@/lib/membership/registration-message-delivery":{processRegistrationMessageBatch:async(...args)=>{calls++;assert.deepEqual(args,[10]);return{ready:true,enabled:true};}},
  });
  const old=process.env.CRON_SECRET;process.env.CRON_SECRET="private-test-secret";
  try{
    assert.equal((await route.GET(new Request("https://example.test/api/internal/membership/registration-messages"))).status,401);
    assert.equal(calls,0);
    assert.equal((await route.POST(new Request("https://example.test/api/internal/membership/registration-messages?email=attacker@example.test",{headers:{Authorization:"Bearer private-test-secret"}}))).status,200);
    assert.equal(calls,1);
  }finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
});


test("welcome preserves a non-expiring accepted member invitation without inventing a 1970 deadline", async t => {
  const f = await fixture(t);
  await f.invite({ expires: null });
  assert.equal((await f.worker.processRegistrationMessageBatch()).sent, 1);
  assert.equal(f.rendered.length, 1);
  assert.equal(f.rendered[0].expiresAt, null);
  assert.equal(f.rendered[0].invitationSource, "member");
  assert.equal(f.rendered[0].recipientName, "Alex from invitation");
  assert.equal(f.rendered[0].inviterName, "Original Inviter");
  assert.doesNotMatch(JSON.stringify(f.rendered[0]), /1970/);
});
