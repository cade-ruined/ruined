import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function load(path,deps={}){const loaded={exports:{}};const code=ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>{if(name==='server-only')return{};assert.ok(name in deps,name);return deps[name];},loaded,loaded.exports);return loaded.exports;}
function sqlFor(db){const sql=async(strings,...values)=>(await db.query(strings.reduce((s,part,i)=>s+(i?`$${i}`:'')+part,''),values.map(v=>v instanceof Date?v.toISOString():v))).rows;sql.json=value=>JSON.stringify(value);sql.begin=callback=>db.transaction(tx=>callback(sqlFor(tx)));return sql;}
const pricing=await load('src/lib/membership/pricing.ts');
const schedules=await load('src/lib/membership/foundations-schedule.ts');

test('prepaid schedules, paid proofs, activation and full-refund release use the full shipped database guards',async t=>{
  const db=new PGlite(),realNow=Date.now;t.after(async()=>{Date.now=realNow;await db.close();});
  await db.exec('create role anon;create role authenticated;create role service_role;');
  for(const [,path] of (await source('scripts/migrate-platform.mjs')).matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g))await db.exec(await source(path));
  const sql=sqlFor(db),tx=callback=>db.transaction(engine=>callback(sqlFor(engine)));
  const commercial=await load('src/lib/membership/commercial-repository.ts',{'@/lib/database/server':{getApplicationDatabase:()=>sql}});
  const billing=await load('src/lib/stripe/billing-repository.ts',{'@/lib/membership/commercial-repository':commercial,'@/lib/membership/pricing':pricing,'@/lib/stripe/database':{getBillingDatabase:()=>sql},'@/lib/stripe/membership-state':{normalizeEmail:v=>v.trim().toLowerCase()}});
  const schedule=schedules.createFoundationsBillingSchedule(new Date(),'monthly');
  const clock=instant=>{Date.now=()=>Date.parse(instant);};
  async function seed(n,{paidAt=new Date(),persist=true,quoteMinutes=60}={}){
    const member=id(n),auth=id(n+1),agreement=id(2),acceptance=id(n+3),reservationId=id(n+4),email=`prepaid-${n}@example.test`;
    await db.query('insert into ruined_members(id,email,email_normalized) values($1,$2,$2)',[member,email]);
    const person=(await db.query('select person_id from ruined_members where id=$1',[member])).rows[0].person_id;
    await db.query("insert into member_lifecycle(member_id,account_state) values($1,'active')",[member]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')",[auth,member,person,email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[auth]);
    await db.query("update person_email_addresses set verification_state='verified',verified_at=now() where person_id=$1",[person]);
    await db.query("insert into person_profiles(person_id,display_name) values($1,'Synthetic Member') on conflict(person_id) do update set display_name=excluded.display_name",[person]);
    await db.query("insert into person_private_profiles(person_id,birth_date,default_fulfillment_address) values($1,'1990-01-01','{\"countryCode\":\"US\"}') on conflict(person_id) do update set birth_date=excluded.birth_date,default_fulfillment_address=excluded.default_fulfillment_address",[person]);
    await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',$2,'Test paid terms','Test only',$3,'published',now()) on conflict(id) do nothing",[agreement,2,'a'.repeat(64)]);
    const age=(await db.query("insert into member_consents(member_id,consent_type,policy_version,accepted_at,dedupe_key) values($1,'age_attestation','test-age',now(),$2) returning id",[member,`age-${n}`])).rows[0].id;
    await db.query(`insert into membership_agreement_acceptances(id,agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      values($1,$2,$3,$4,$5,$6,'Synthetic Member',$7,'checkbox_and_submit',now(),'ruined_membership',$8,'Test paid terms',$9,'Test only',$10)`,[acceptance,agreement,person,member,auth,age,email,2,'a'.repeat(64),`acceptance-${n}`]);
    const quote=await commercial.reserveCommercialMembership({requestId:reservationId,memberId:member,kind:'individual',plan:'monthly',expiresAt:new Date(Date.now()+quoteMinutes*60000),billingSchedule:schedule});
    await commercial.bindCommercialMembershipPrice({reservationId,stripePriceId:'price_prepaid'});
    const checkout=await billing.reserveMembershipCheckout({acceptanceId:acceptance,attemptId:reservationId,commercialReservationId:reservationId,authUserId:auth,email,plan:'monthly',stripePriceId:'price_prepaid',paidAgreementVersion:"ruined_membership-v2"});
    assert.deepEqual(checkout.billingSchedule,schedule);assert.equal(checkout.firstChargeAt,null);
    const sub=`sub_prepaid_${n}`,invoice=`in_prepaid_${n}`,customer=`cus_prepaid_${n}`;
    await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,price_id,latest_invoice_id,last_event_created) values($1,$2,$3,'trialing','price_prepaid',$4,1)",[sub,member,customer,invoice]);
    await db.query("update stripe_checkout_attempts set status='completed',stripe_session_id=$2,stripe_subscription_id=$3 where id=$1",[reservationId,`cs_prepaid_${n}`,sub]);
    await db.query('update membership_commercial_reservations set stripe_subscription_id=$2 where id=$1',[reservationId,sub]);
    await db.query("insert into stripe_invoices(id,member_id,stripe_customer_id,stripe_subscription_id,purpose,stripe_status,currency,amount_due,amount_paid,paid_at,last_event_created) values($1,$2,$3,$4,'membership','paid','usd',35900,35900,$5,1)",[invoice,member,customer,sub,paidAt]);
    const contract={id:reservationId,memberId:member,subscriptionId:sub,customerId:customer,currency:'usd',billingPlan:'monthly',billingTermsVersion:'membership-billing-v2',startsAt:schedule.serviceStartsAt,initialTermEndsAt:schedule.initialTermEndsAt,installmentDues:34900,billingSchedule:schedule};
    await db.query('insert into stripe_membership_commitments(id,member_id,checkout_attempt_id,agreement_acceptance_id,stripe_subscription_id,stripe_customer_id,livemode,terms_snapshot,terms_sha256) values($1,$2,$1,$3,$4,$5,false,$6,$7)',[reservationId,member,acceptance,sub,customer,JSON.stringify(contract),'b'.repeat(64)]);
    const input={reservationId,contractId:reservationId,memberId:member,subscriptionId:sub,invoiceId:invoice,paymentIntentId:`pi_prepaid_${n}`,chargeId:`ch_prepaid_${n}`,serviceStartsAt:schedule.serviceStartsAt,prepaidThrough:schedule.prepaidThrough,duesAmount:34900,amountPaid:35900,currency:'usd',livemode:false,verifiedAt:new Date(Date.now())};
    if(persist)await tx(sql=>billing.recordMembershipPrepayment(sql,input));
    return {quote,input,member,sub,invoice,reservationId,customer,acceptance};
  }
  for(const [month,finalCall] of [['2026-11','2026-11-30T22:00:00.000Z'],['2026-12','2026-12-30T22:00:00.000Z']]){
    const holiday=schedules.foundationsBillingScheduleForMonth(month,'monthly');
    assert.equal(holiday.callStartsAt[3],finalCall);
    assert.equal((await db.query("select private.ruined_valid_prepaid_schedule($1::jsonb,'monthly') valid",[JSON.stringify(holiday)])).rows[0].valid,true);
    const incorrect={...holiday,callStartsAt:[...holiday.callStartsAt.slice(0,3),new Date(Date.parse(holiday.callStartsAt[2])+7*86400000).toISOString()]};
    assert.equal((await db.query("select private.ruined_valid_prepaid_schedule($1::jsonb,'monthly') valid",[JSON.stringify(incorrect)])).rows[0].valid,false);
  }
  for(const invalid of [{...schedule,version:undefined},{...schedule,callStartsAt:[schedule.callStartsAt[1],...schedule.callStartsAt.slice(1)]},{...schedule,nextChargeAt:schedule.initialTermEndsAt},{...schedule,extra:true}]){
    assert.equal((await db.query("select private.ruined_valid_prepaid_schedule($1::jsonb,'monthly') valid",[JSON.stringify(invalid)])).rows[0].valid,false);
  }
  const active=await seed(10),refunded=await seed(30),late=await seed(50,{persist:false}),missed=await seed(70);
  const consent={memberId:active.member,attemptId:active.reservationId,acceptanceId:active.acceptance,plan:'monthly',priceId:'price_prepaid',subscriptionId:active.sub,billingTermsVersion:'membership-billing-v2',offerId:active.quote.offerId,commercialReservationId:active.reservationId,billingSchedule:schedule};
  assert.equal(await billing.hasMembershipCheckoutConsent(sql,consent),true);
  assert.equal(await billing.hasMembershipCheckoutConsent(sql,{...consent,billingSchedule:null}),false);
  await assert.rejects(db.query("update membership_commercial_reservations set billing_schedule=jsonb_set(billing_schedule,'{cohortMonth}','\"2099-12\"') where id=$1",[active.reservationId]),/immutable/);
  await assert.rejects(db.query('update stripe_checkout_attempts set billing_schedule=null where id=$1',[active.reservationId]),/immutable/);
  await assert.rejects(tx(sql=>billing.recordMembershipPrepayment(sql,{...active.input,chargeId:'ch_foreign'})),error=>error.code==='prepaid_payment_identity_mismatch');
  await assert.rejects(commercial.activateCommercialMembership({reservationId:active.reservationId,stripeSubscriptionId:active.sub}),/required/);
  assert.equal((await commercial.getCommercialMembershipReservation(active.reservationId)).status,'reserved');
  assert.equal((await db.query('select billing_state from member_lifecycle where member_id=$1',[active.member])).rows[0].billing_state,'pending');
  const rls=(await db.query("select relrowsecurity from pg_class where relname='stripe_membership_prepaid_proofs'")).rows[0];assert.equal(rls.relrowsecurity,true);
  assert.equal((await db.query("select has_table_privilege('authenticated','stripe_membership_prepaid_proofs','select') allowed")).rows[0].allowed,false);
  await assert.rejects(db.query('delete from stripe_membership_prepaid_proofs where reservation_id=$1',[active.reservationId]),/cannot be deleted/);
  const cancelId=id(1000),canceledAt=new Date(realNow()-1000);
  await db.query("insert into stripe_membership_cancellations(id,contract_id,requested_by_member_id,intent,quote_snapshot,quote_sha256,ledger_revision,buyout_dues,effective_at,status,provider_idempotency_key,billing_stopped_at,billing_stop_evidence) values($1,$2,$3,'cancel_before_start','{}',$4,0,0,$5,'billing_stopped','prepaid-refund-test',$5,'{}')",[cancelId,refunded.reservationId,refunded.member,'c'.repeat(64),canceledAt]);
  await db.query("update stripe_subscriptions set stripe_status='canceled' where id=$1",[refunded.sub]);
  const refund={reservationId:refunded.reservationId,subscriptionId:refunded.sub,cancellationId:cancelId,invoiceId:refunded.invoice,paymentIntentId:refunded.input.paymentIntentId,chargeId:refunded.input.chargeId,refundId:'re_prepaid_test',status:'pending',amount:35900,currency:'usd',livemode:false,canceledAt,verifiedAt:new Date(realNow())};
  await tx(sql=>billing.recordPrepaidMembershipRefund(sql,refund));
  const release={reservationId:refunded.reservationId,stripeSubscriptionId:refunded.sub,canceledAt};
  await assert.rejects(commercial.releasePrepaidCommercialMembership(release),/refund/);
  await tx(sql=>billing.recordPrepaidMembershipRefund(sql,{...refund,status:'succeeded',amount:34900}));
  await assert.rejects(commercial.releasePrepaidCommercialMembership(release),/refund/,'tax must also be refunded');
  await tx(sql=>billing.recordPrepaidMembershipRefund(sql,{...refund,status:'succeeded'}));
  await commercial.releasePrepaidCommercialMembership(release);await commercial.releasePrepaidCommercialMembership(release);
  assert.equal((await commercial.getCommercialMembershipReservation(refunded.reservationId)).status,'released');
  await tx(sql=>billing.recordMembershipPrepayment(sql,{...refunded.input,verifiedAt:new Date(realNow())}));
  assert.equal((await billing.getMembershipPrepayment(sql,{reservationId:refunded.reservationId})).refundState,'refunded','late paid invoice must never clear refund');
  await assert.rejects(commercial.activateCommercialMembership({reservationId:refunded.reservationId,stripeSubscriptionId:refunded.sub}),/unavailable/);
  clock(new Date(Date.parse(schedule.cutoffAt)-60000).toISOString());
  const nearCutoff=await seed(90,{persist:false,quoteMinutes:0.5,paidAt:new Date(Date.now())});
  const nearExpiry=(await db.query('select expires_at from stripe_checkout_attempts where id=$1',[nearCutoff.reservationId])).rows[0].expires_at;
  assert.ok(new Date(nearExpiry).getTime()>Date.parse(schedule.cutoffAt),'Stripe30-minute Session minimum may extend past cutoff; verified invoice time still enforces cohort assignment');
  clock(schedule.cutoffAt);
  await db.query('update stripe_invoices set paid_at=$2 where id=$1',[late.invoice,schedule.cutoffAt]);
  await tx(sql=>billing.recordMembershipPrepayment(sql,{...late.input,verifiedAt:new Date(Date.now())}));
  const lateProof=await billing.getMembershipPrepayment(sql,{subscriptionId:late.sub});assert.equal(lateProof.refundState,'review_required');assert.equal(lateProof.reviewReason,'cohort_cutoff_missed');
  assert.ok((await billing.listMembershipPrepaymentsDue({now:new Date(Date.now())})).some(p=>p.reservationId===late.reservationId),'late prepayments require immediate refund work before service');
  clock(new Date(Date.parse(schedule.serviceStartsAt)+1000).toISOString());
  await assert.rejects(commercial.activateCommercialMembership({reservationId:active.reservationId,stripeSubscriptionId:active.sub}),/required/,'stale proof cannot activate');
  await tx(sql=>billing.recordMembershipPrepayment(sql,{...active.input,verifiedAt:new Date(Date.now())}));
  await commercial.activateCommercialMembership({reservationId:active.reservationId,stripeSubscriptionId:active.sub});
  assert.equal((await commercial.getCommercialMembershipReservation(active.reservationId)).status,'activated');
  assert.ok((await billing.getMembershipPrepayment(sql,{subscriptionId:active.sub})).activatedAt);
  await assert.rejects(commercial.activateCommercialMembership({reservationId:late.reservationId,stripeSubscriptionId:late.sub}),/required/);
  const lateCancellation=id(1001),lateCanceledAt=new Date(Date.now());
  await db.query("insert into stripe_membership_cancellations(id,contract_id,requested_by_member_id,intent,quote_snapshot,quote_sha256,ledger_revision,buyout_dues,effective_at,status,provider_idempotency_key,billing_stopped_at,billing_stop_evidence) values($1,$2,$3,'cancel_before_start','{}',$4,0,0,$5,'billing_stopped','late-refund-test',$5,'{}')",[lateCancellation,late.reservationId,late.member,'d'.repeat(64),lateCanceledAt]);
  await db.query("update stripe_subscriptions set stripe_status='canceled' where id=$1",[late.sub]);
  const lateRefund={...refund,reservationId:late.reservationId,subscriptionId:late.sub,cancellationId:lateCancellation,invoiceId:late.invoice,paymentIntentId:late.input.paymentIntentId,chargeId:late.input.chargeId,refundId:'re_cutoff_missed',status:'succeeded',canceledAt:lateCanceledAt,verifiedAt:new Date(Date.now())};
  await assert.rejects(tx(sql=>billing.recordPrepaidMembershipRefund(sql,lateRefund)),/After-start cancellation requires/);
  // Replace this unconfirmed test-only execution with the separately authorized
  // invalid-enrollment snapshot. The production executor creates it once.
  await db.query("update stripe_membership_cancellations set status='abandoned' where id=$1",[lateCancellation]);
  const invalidCancellation=id(1002);
  await db.query("insert into stripe_membership_cancellations(id,contract_id,requested_by_member_id,intent,quote_snapshot,quote_sha256,ledger_revision,buyout_dues,effective_at,status,provider_idempotency_key,billing_stopped_at,billing_stop_evidence) values($1,$2,$3,'cancel_before_start',$4,$5,0,0,$6,'billing_stopped','invalid-cohort-refund-test',$6,'{}')",[invalidCancellation,late.reservationId,late.member,JSON.stringify({invalidEnrollmentReason:'cohort_cutoff_missed'}),'e'.repeat(64),lateCanceledAt]);
  await tx(sql=>billing.recordPrepaidMembershipRefund(sql,{...lateRefund,cancellationId:invalidCancellation}));
  assert.ok((await billing.listMembershipPrepaymentsDue({now:new Date(Date.now()),livemode:false})).some(p=>p.reservationId===late.reservationId),'fully refunded pending release remains discoverable');
  await commercial.releasePrepaidCommercialMembership({reservationId:late.reservationId,stripeSubscriptionId:late.sub,canceledAt:lateCanceledAt});
  assert.equal((await commercial.getCommercialMembershipReservation(late.reservationId)).status,'released');
  clock(new Date(Date.parse(schedule.prepaidThrough)+1000).toISOString());
  await tx(sql=>billing.recordMembershipPrepayment(sql,{...missed.input,verifiedAt:new Date(Date.now())}));
  await assert.rejects(commercial.activateCommercialMembership({reservationId:missed.reservationId,stripeSubscriptionId:missed.sub}),/required/,'expired prepaid period needs current recurring payment');
  await db.query("insert into stripe_invoices(id,member_id,stripe_customer_id,stripe_subscription_id,purpose,stripe_status,currency,amount_due,amount_paid,paid_at,last_event_created) values('in_later',$1,$2,$3,'membership','paid','usd',35900,35900,$4,2)",[missed.member,missed.customer,missed.sub,new Date(Date.now())]);
  await db.query("update stripe_subscriptions set stripe_status='active',latest_invoice_id='in_later' where id=$1",[missed.sub]);
  await commercial.activateCommercialMembership({reservationId:missed.reservationId,stripeSubscriptionId:missed.sub});
  assert.equal((await commercial.getCommercialMembershipReservation(missed.reservationId)).status,'activated');
  assert.equal((await billing.getMembershipPrepayment(sql,{subscriptionId:missed.sub})).serviceStartsAt.toISOString(),schedule.serviceStartsAt,'late activation never resets initial term');
  Date.now=realNow;
});
