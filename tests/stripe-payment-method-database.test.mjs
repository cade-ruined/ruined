import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function load(path, dependencies={}) {
  const out=ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}}; new Function("require","module","exports",out)(name=>{if(name==="server-only")return {};assert.ok(name in dependencies,`Unexpected ${name}`);return dependencies[name];},mod,mod.exports);return mod.exports;
}
function wrap(engine) {
  const sql=async (strings,...values)=>(await engine.query(strings.reduce((out,part,i)=>out+(i?`$${i}`:"")+part,""),values.map(v=>v instanceof Date?v.toISOString():v))).rows;
  sql.json=v=>JSON.stringify(v);sql.begin=fn=>engine.transaction(tx=>fn(wrap(tx)));return sql;
}

test("storage-only Checkout binds consent, mode and method without activating membership",async t=>{
  const PGlite=await loadPGliteForSchemaChecks();const db=new PGlite();t.after(()=>db.close());
  await db.exec("create role anon;create role authenticated;create role service_role;");
  const paths=[...new Set(Array.from((await source("scripts/migrate-platform.mjs")).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g),m=>m[1]).concat("db/migrations/20260930110000_member_payment_methods.sql"))];
  const consentMigration="db/migrations/20261002150000_payment_setup_consent_v2.sql";
  for(const path of paths.filter(path=>path!==consentMigration))await db.exec(await source(path));
  await db.query("insert into ruined_members(id,email,email_normalized) values($1,'save@example.test','save@example.test')",[id(1)]);
  const person=(await db.query("select person_id from ruined_members where id=$1",[id(1)])).rows[0].person_id;
  await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')",[id(1)]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,'save@example.test','active')",[id(2),id(1),person]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[id(2)]);
  await db.query("insert into person_private_profiles(person_id,birth_date) values($1,'1990-01-01') on conflict(person_id) do update set birth_date=excluded.birth_date",[person]);
  await db.query("update member_onboardings set profile_completed_at=now() where member_id=$1",[id(1)]);
  await db.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1",[person]);
  const sql=wrap(db), model=await load("src/lib/stripe/payment-method-model.ts");
  assert.equal(model.PAYMENT_SETUP_CONSENTS["save-payment-method-v1"],"Save my payment method securely with Stripe for a future checkout I choose to complete. This does not start a membership or subscription, authorize a charge, or reserve an offer. I can remove it before starting checkout.","historical signed wording must remain exact");
  // A real pre-release v1 attempt must survive the additive migration byte for
  // byte, including retries after Stripe created a session but lost the reply.
  await db.query("insert into member_payment_method_accounts(member_id,stripe_account_id,livemode) values($1,'acct_test',false)",[id(1)]);
  await db.query("insert into member_payment_method_setup_attempts(id,member_id,stripe_account_id,livemode,consent_auth_user_id,consent_version,consent_text,return_origin,expires_at) values($1,$2,'acct_test',false,$3,'save-payment-method-v1',$4,'https://members.example.test',now()+interval '2 hours')",[id(10),id(1),id(2),model.PAYMENT_SETUP_CONSENTS["save-payment-method-v1"]]);
  await db.query("update member_payment_method_accounts set consent_attempt_id=$1 where member_id=$2",[id(10),id(1)]);
  const originalConsent=(await db.query("select to_jsonb(attempt) evidence from member_payment_method_setup_attempts attempt")).rows;
  await db.exec(await source(consentMigration));
  assert.deepEqual((await db.query("select to_jsonb(attempt) evidence from member_payment_method_setup_attempts attempt")).rows,originalConsent);
  const repository=await load("src/lib/stripe/payment-method-repository.ts",{"@/lib/stripe/payment-method-model":model});
  const sessions=new Map(),intents=new Map(),methods=new Map(),idempotency=new Map(),requests=[];
  let mode=false,setupEnabled=true,failCreateAfterRemote=false,failDetach=false,customerDefault=null;
  process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID="acct_test";
  t.after(()=>delete process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID);
  const stripe={
    accounts:{retrieve:async()=>({id:"acct_test"})},
    customers:{create:async()=>({id:"cus_setup",livemode:false}),retrieve:async()=>({id:"cus_setup",livemode:false,invoice_settings:{default_payment_method:customerDefault}})},
    subscriptions:{list:async()=>({data:[],has_more:false})},
    checkout:{sessions:{
      create:async(params,options)=>{
        requests.push(structuredClone(params));const old=idempotency.get(options.idempotencyKey);
        if(old){assert.deepEqual(params,old.params,"provider retries must have identical arguments");return old.session;}
        const session={id:`cs_${sessions.size+1}`,url:"https://checkout.stripe.com/c/pay/test",status:"open",livemode:false,...params};
        sessions.set(session.id,session);idempotency.set(options.idempotencyKey,{params:structuredClone(params),session});
        if(failCreateAfterRemote){failCreateAfterRemote=false;throw new Error("provider timeout after create");}return session;
      },list:async()=>({data:[...sessions.values()].map(value=>structuredClone(value)),has_more:false}),retrieve:async sessionId=>structuredClone(sessions.get(sessionId)),expire:async sessionId=>{const session=sessions.get(sessionId);session.status="expired";return structuredClone(session);},
    }},
    setupIntents:{retrieve:async intentId=>structuredClone(intents.get(intentId))},
    paymentMethods:{retrieve:async methodId=>structuredClone(methods.get(methodId)),update:async(methodId,params)=>Object.assign(methods.get(methodId),params),detach:async methodId=>{if(failDetach)throw new Error("provider unavailable");methods.get(methodId).customer=null;return structuredClone(methods.get(methodId));}},
  };
  const registration = await load("src/lib/membership/registration-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ membershipRegistrationOnly: false }) },
  });
  const service=await load("src/lib/stripe/payment-method-service.ts",{
    "@/lib/membership/registration-repository": registration,
    "@/lib/stripe/database":{getBillingDatabase:()=>sql},"@/lib/platform/config":{getPlatformConfiguration:()=>({mode:"connected",minimumAge:18,stripePaymentSetupReady:setupEnabled})},
    "@/lib/stripe/server":{getStripe:()=>stripe,getStripeLivemode:()=>mode},"@/lib/stripe/membership-state":{isUuid:value=>typeof value==="string"&&/^[0-9a-f-]{36}$/.test(value)},
    "@/lib/stripe/payment-method-model":model,"@/lib/stripe/payment-method-repository":repository,
  });
  const input=attemptId=>({authUserId:id(2),attemptId,consentAccepted:true,consentVersion:model.PAYMENT_SETUP_CONSENT_VERSION,applicationOrigin:"https://members.example.test"});
  const complete=sessionId=>{
    const session=sessions.get(sessionId);session.status="complete";session.setup_intent=`seti_${sessionId}`;
    const method={id:`pm_${sessionId.replaceAll("_","")}`,type:"card",livemode:false,customer:"cus_setup",allow_redisplay:"always",card:{brand:"visa",last4:"4242",exp_month:12,exp_year:2035}};
    methods.set(method.id,method);intents.set(session.setup_intent,{id:session.setup_intent,status:"succeeded",livemode:false,customer:"cus_setup",metadata:session.metadata,payment_method:method.id});
    return {id:`evt_${sessionId}`,type:"checkout.session.completed",livemode:false,data:{object:structuredClone(session)}};
  };
  const event=evt=>sql.begin(tx=>service.handlePaymentMethodSetupEvent(tx,evt));
  const insertPaid=async n=>db.query("insert into stripe_checkout_attempts(id,member_id,email_normalized,agreement_version,agreement_accepted_at,age_attested_at,expires_at) values($1,$2,'save@example.test','test',now(),now(),now()+interval '1 hour')",[id(n),id(1)]);
  const chosen=async n=>{await insertPaid(n);const value=await service.getSavedPaymentMethodForCheckout(id(1),id(n));await db.query("delete from stripe_checkout_attempts where id=$1",[id(n)]);return value;};
  await t.test("verified completed profile and age required, no paid agreement needed",async()=>{
    assert.equal((await service.getMemberPaymentMethodStatus(id(2))).eligible,true);
    await db.query("update person_email_addresses set verification_state='unverified',verified_at=null where person_id=$1",[person]);
    await assert.rejects(service.startMemberPaymentMethodSetup(input(id(10))),/Verify/);
    await db.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1",[person]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[id(2)]);
    await assert.rejects(service.startMemberPaymentMethodSetup(input(id(10))),/does not require/);
    await db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='ops_admin'",[id(2)]);
    await db.query("update person_private_profiles set birth_date=current_date-interval '16 years' where person_id=$1",[person]);
    await assert.rejects(service.startMemberPaymentMethodSetup(input(id(10))),/age/);
    await db.query("update person_private_profiles set birth_date='1990-01-01' where person_id=$1",[person]);
    await assert.rejects(service.startMemberPaymentMethodSetup({...input(id(10)),consentAccepted:false}),/Confirm/);
  });
  await t.test("v1 timeout retries preserve original provider arguments and current tabs reuse the unchanged consent",async()=>{
    failCreateAfterRemote=true;
    await assert.rejects(service.startMemberPaymentMethodSetup({...input(id(10)),consentVersion:"save-payment-method-v1"}),/timeout/);
    const pending=(await db.query("select * from member_payment_method_setup_attempts")).rows;
    assert.equal(pending.length,1);assert.equal(pending[0].status,"creating");
    await Promise.all([service.startMemberPaymentMethodSetup(input(id(10))),service.startMemberPaymentMethodSetup(input(id(11)))]);
    assert.equal(sessions.size,1);assert.equal((await service.getMemberPaymentMethodStatus(id(2))).state,"pending");
    const params=requests.at(-1);assert.equal(params.mode,"setup");assert.equal(params.currency,"usd");
    assert.equal(params.metadata.ruined_storage_consent,"save-payment-method-v1");
    assert.equal(params.setup_intent_data.description,model.PAYMENT_SETUP_CONSENTS["save-payment-method-v1"]);
    assert.equal((await db.query("select consent_version from member_payment_method_setup_attempts where id=$1",[id(10)])).rows[0].consent_version,"save-payment-method-v1");
    for(const field of ["line_items","automatic_tax","subscription_data","payment_intent_data","payment_method_types"])assert.equal(params[field],undefined);
    assert.equal(params.billing_address_collection,"required");assert.equal(params.customer_update.address,"auto");assert.equal(params.payment_method_data.allow_redisplay,"always");
    assert.match(params.success_url,/\/my\/payment-method\?setup=returned$/);
  });
  await t.test("authoritative matching webhook saves display only; replay and expiry cannot erase it",async()=>{
    const completed=complete("cs_1");
    await event(completed);await event(completed);
    const status=await service.getMemberPaymentMethodStatus(id(2));assert.equal(status.state,"saved");assert.equal(status.paymentMethod.last4,"4242");
    assert.equal((await chosen(80)).customerId,"cus_setup");
    setupEnabled=false;assert.equal((await chosen(81)).customerId,"cus_setup");setupEnabled=true;
    const malicious=structuredClone(completed);malicious.data.object.metadata.ruined_member_id=id(99);await assert.rejects(event(malicious),/metadata/);
    mode=true;assert.equal((await service.getMemberPaymentMethodStatus(id(2))).state,"not_saved");mode=false;
    assert.equal((await db.query("select membership_state,stripe_customer_id from ruined_members")).rows[0].membership_state,"pending");
    assert.equal((await db.query("select count(*)::int n from stripe_subscriptions")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int n from membership_commercial_reservations")).rows[0].n,0);
    await assert.rejects(db.query("update member_payment_method_setup_attempts set consent_text='charge later'"),/immutable/);
  });
  await t.test("active paid reservation and billing default block withdrawal",async()=>{
    customerDefault="pm_cs1";await assert.rejects(service.withdrawMemberPaymentMethod(id(2)),/used for billing/);customerDefault=null;
    // The reservation check is shared with both setup and withdrawal and includes creating.
    await db.query("insert into stripe_checkout_attempts(id,member_id,email_normalized,agreement_version,agreement_accepted_at,age_attested_at,expires_at) values($1,$2,'save@example.test','test',now(),now(),now()+interval '1 hour')",[id(90),id(1)]);
    await assert.rejects(service.withdrawMemberPaymentMethod(id(2)),/checkout or subscription/);
    await db.query("delete from stripe_checkout_attempts where id=$1",[id(90)]);
  });
  await t.test("failed removal keeps withdrawn consent and supports reload/retry; replay never restores",async()=>{
    failDetach=true;await assert.rejects(service.withdrawMemberPaymentMethod(id(2)),/withdrawn/);
    const status=await service.getMemberPaymentMethodStatus(id(2));assert.equal(status.removalPending,true);assert.equal(status.canRemove,true);assert.equal(status.paymentMethod,null);
    assert.equal(await chosen(82),null);
    failDetach=false;assert.equal((await service.withdrawMemberPaymentMethod(id(2))).state,"not_saved");
    await event(complete("cs_1"));assert.equal((await service.getMemberPaymentMethodStatus(id(2))).state,"not_saved");
  });
  await t.test("detach before delayed success cannot resurrect a method",async()=>{
    await assert.rejects(service.startMemberPaymentMethodSetup({...input(id(20)),consentVersion:"save-payment-method-v1"}),/Reload this page/);
    await service.startMemberPaymentMethodSetup(input(id(20)));const completed=complete("cs_2");
    assert.equal(requests.at(-1).metadata.ruined_storage_consent,"save-payment-method-v2");
    assert.equal(requests.at(-1).setup_intent_data.description,model.PAYMENT_SETUP_CONSENT_TEXT);
    const evidence=(await db.query("select consent_version,consent_text from member_payment_method_setup_attempts where id=$1",[id(20)])).rows[0];
    assert.deepEqual(evidence,{consent_version:"save-payment-method-v2",consent_text:model.PAYMENT_SETUP_CONSENT_TEXT});
    await event({id:"evt_detach",type:"payment_method.detached",livemode:false,data:{object:{id:"pm_cs2",livemode:false,customer:null}}});
    await event(completed);assert.equal((await service.getMemberPaymentMethodStatus(id(2))).state,"not_saved");
    assert.equal((await db.query("select stripe_payment_method_id from member_payment_method_accounts")).rows[0].stripe_payment_method_id,null);
  });
  await t.test("paid customer choice freezes saved and none across delayed events and detach",async()=>{
    await service.startMemberPaymentMethodSetup(input(id(30)));await event(complete("cs_3"));
    await insertPaid(91);assert.equal((await service.getSavedPaymentMethodForCheckout(id(1),id(91))).customerId,"cus_setup");
    methods.get("pm_cs3").customer=null;
    await event({id:"evt_detach3",type:"payment_method.detached",livemode:false,data:{object:{id:"pm_cs3",livemode:false}}});
    assert.equal((await service.getSavedPaymentMethodForCheckout(id(1),id(91))).customerId,"cus_setup");
    await assert.rejects(db.query("update stripe_checkout_attempts set payment_setup_customer_id=null where id=$1",[id(91)]),/immutable/);
    await db.query("delete from stripe_checkout_attempts where id=$1",[id(91)]);
    await service.startMemberPaymentMethodSetup(input(id(40)));
    await insertPaid(92);assert.equal(await service.getSavedPaymentMethodForCheckout(id(1),id(92)),null);
    await event(complete("cs_4"));assert.equal(await service.getSavedPaymentMethodForCheckout(id(1),id(92)),null);
    await db.query("delete from stripe_checkout_attempts where id=$1",[id(92)]);
    await service.withdrawMemberPaymentMethod(id(2));
  });
  await t.test("withdrawal recovers and expires a provider session whose create response was lost",async()=>{
    failCreateAfterRemote=true;await assert.rejects(service.startMemberPaymentMethodSetup(input(id(50))),/timeout/);
    assert.equal((await db.query("select stripe_session_id from member_payment_method_setup_attempts where id=$1",[id(50)])).rows[0].stripe_session_id,null);
    assert.equal((await db.query("select stripe_customer_id from member_payment_method_accounts")).rows[0].stripe_customer_id,"cus_setup");
    await service.withdrawMemberPaymentMethod(id(2));assert.equal(sessions.get("cs_5").status,"expired");
  });
  await t.test("closing an account withdraws consent and queues bounded provider cleanup",async()=>{
    await service.startMemberPaymentMethodSetup(input(id(60)));
    await db.query("update member_lifecycle set account_state='closed' where member_id=$1",[id(1)]);
    let account=(await db.query("select consent_revoked_at,cleanup_pending from member_payment_method_accounts")).rows[0];
    assert.ok(account.consent_revoked_at);assert.equal(account.cleanup_pending,true);
    await assert.rejects(service.startMemberPaymentMethodSetup(input(id(61))),/not available/);
    await assert.rejects(service.cleanupWithdrawnMemberPaymentMethods({memberId:id(1),deadline:Date.now()-1}),/deadline/);
    assert.deepEqual(await service.cleanupWithdrawnMemberPaymentMethods({memberId:id(1),deadline:Date.now()+2000}),{processed:1,pending:0});
    assert.equal(sessions.get("cs_6").status,"expired");
    account=(await db.query("select cleanup_pending from member_payment_method_accounts")).rows[0];assert.equal(account.cleanup_pending,false);
    await event(complete("cs_6"));
    assert.equal(methods.get("pm_cs6").customer,null,"a late provider success after closure is detached, never saved");
    assert.equal((await db.query("select stripe_payment_method_id from member_payment_method_accounts")).rows[0].stripe_payment_method_id,null);
  });

});
