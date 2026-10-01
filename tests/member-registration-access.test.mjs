import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import Stripe from "stripe";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const requirePackage = createRequire(new URL("../package.json", import.meta.url));
const read = path => readFileSync(resolve(root, path), "utf8");
const origin = "https://signup.example.test";
// Deliberately synthetic, isolated from process.env and any local environment file.
const environment = {
  NODE_ENV: "test", PLATFORM_MODE: "connected", NEXT_PUBLIC_SITE_URL: origin,
  DATABASE_URL: "local-test-no-network", NEXT_PUBLIC_SUPABASE_URL: "https://supabase.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-test-no-network",
  STRIPE_SECRET_KEY: "sk_test_local_journey_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_local_journey_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_local_journey_fixture", STRIPE_MEMBERSHIP_MONTHLY_PRICE_ID: "price_monthly",
  STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID: "price_annual", STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION: "ruined_membership-v2", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_reviewed_test",
  STRIPE_MEMBERSHIP_FOUNDING_INDIVIDUAL_ANNUAL_PRICE_ID: "price_founding_annual",
  STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID: "bpc_commitment_test",
  STRIPE_TAX_ENABLED: "false", STRIPE_MEMBERSHIP_COMMERCIAL_READY: "true",
  MEMBERSHIP_REGISTRATION_ONLY_ENABLED: "true", STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED: "true",
  STRIPE_MEMBERSHIP_PAYMENT_SETUP_SIGNUP_ENABLED: "true", STRIPE_PAYMENT_SETUP_ACCOUNT_ID: "acct_RegistrationTest",
};
const denyNetwork = async () => { throw new Error("Network calls are forbidden in the signup journey test."); };
class OfflineStripe extends Stripe {
  constructor(key, options) {
    super(key, { ...options, maxNetworkRetries: 0, httpClient: Stripe.createFetchHttpClient(denyNetwork) });
  }
}

function sqlFor(engine) {
  const sql = async (strings, ...values) => {
    const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
    return (await engine.query(text, values.map(value => value instanceof Date ? value.toISOString() : value))).rows;
  };
  sql.json = value => JSON.stringify(value);
  sql.begin = callback => engine.transaction(transaction => callback(sqlFor(transaction)));
  return sql;
}

function sourceLoader(overrides) {
  const cache = new Map();
  const localGlobals = { fetch: denyNetwork };
  function load(path) {
    const absolute = resolve(root, path);
    assert.ok(absolute.startsWith(root), "Source dependency escaped the repository.");
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loaded = { exports: {} };
    cache.set(absolute, loaded);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
      fileName: absolute,
    }).outputText;
    const requireSource = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === "server-only") return {};
      if (name === "stripe") return OfflineStripe;
      if (name === "postgres") throw new Error("Network database access is forbidden in this test.");
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(absolute), name);
        const match = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`]
          .find(candidate => extname(candidate) && existsSync(candidate));
        assert.ok(match, `Unresolved source dependency: ${name}`);
        return extname(match) === ".json" ? JSON.parse(readFileSync(match, "utf8")) : load(match);
      }
      return requirePackage(name);
    };
    new Function("require", "module", "exports", "process", "globalThis", "fetch", code)(
      requireSource, loaded, loaded.exports, { env: environment }, localGlobals, denyNetwork,
    );
    return loaded.exports;
  }
  return load;
}

test("registration holds survive launch changes and release profiles only after explicit administrator activation", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const migrations = [...read("scripts/migrate-platform.mjs").matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)];
  assert.ok(migrations.some(match => match[1].endsWith("20260930140000_member_registration_access.sql")));
  for (const migration of migrations) await db.exec(read(migration[1]));
  const sql = sqlFor(db), load = sourceLoader({ "@/lib/database/server": { getApplicationDatabase: () => sql } });
  const registration = load("src/lib/membership/registration-repository.ts");
  const admission = load("src/lib/membership/public-signup-admission.ts");
  const memberRepository = load("src/lib/membership/repository.ts");
  const policy = load("src/lib/membership/access-policy.ts");
  const config = load("src/lib/platform/config.ts");
  const row = async (query, values=[]) => (await db.query(query, values)).rows[0];
  async function member(email) {
    const viewer = { authUserId: randomUUID(), email };
    await sql.begin(tx => admission.claimPublicMembershipSignupInTransaction(tx,viewer,"monthly"));
    return { ...viewer, ...(await row("select id as member_id,person_id from ruined_members where email_normalized=$1", [email])) };
  }
  async function profile(viewer, changes = {}) {
    return memberRepository.saveMemberOnboardingProfile(viewer.authUserId, {
      apparelTopSize: "M", birthDate: "1990-01-01", legalName: "Registration Test", mobile: "+12025550123",
      memberTag: `member${viewer.member_id.replaceAll("-", "").slice(0,14)}`,
      shippingAddress: { addressLine1: "123 Test Street", addressLine2: null, city: "Denver", countryCode: "US", postalCode: "80202", region: "CO" },
      ...changes,
    });
  }
  async function savedCard(viewer,{livemode=false,accountId="acct_RegistrationTest"}={}) {
    const id = randomUUID(), token = id.replaceAll("-", "");
    await db.query(`insert into member_payment_method_accounts(member_id,stripe_account_id,livemode,stripe_customer_id)
      values($1,$2,$3,$4)`,[viewer.member_id,accountId,livemode,`cus_${token}`]);
    await db.query(`insert into member_payment_method_setup_attempts(id,member_id,stripe_account_id,livemode,consent_auth_user_id,
      consent_version,consent_text,return_origin,expires_at,status,stripe_setup_intent_id)
      values($1,$2,$3,$4,$5,'save-payment-method-v1','TEST ONLY storage consent','https://registration.example.test',now()+interval '1 day','saved',$6)`,
      [id,viewer.member_id,accountId,livemode,viewer.authUserId,`seti_${token}`]);
    await db.query(`update member_payment_method_accounts set consent_attempt_id=$1,stripe_payment_method_id=$2,
      payment_method_display='{"type":"card","last4":"4242"}',saved_at=now() where member_id=$3 and stripe_account_id=$4 and livemode=$5`,
      [id,`pm_${token}`,viewer.member_id,accountId,livemode]);
    return id;
  }
  environment.MEMBERSHIP_REGISTRATION_ONLY_ENABLED="false";
  const existing = await member("existing@example.test");
  const admin = await member("admin@example.test");
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[admin.authUserId]);
  environment.MEMBERSHIP_REGISTRATION_ONLY_ENABLED="true";
  const fresh = await member("new@example.test");

  await t.test("registration eligibility includes the eighteenth birthday and rejects younger, missing, and non-US details", async () => {
    const check = async (birthDate, country, today = "2026-09-30") => (await row(
      "select private.ruined_registration_intake_eligibility_error($1::date,$2,$3::date) as error", [birthDate, country, today])).error;
    assert.equal(await check("2008-09-30", "US"), null);
    assert.equal(await check("2008-09-29", "US"), null);
    assert.match(await check("2008-10-01", "US"), /18 and over/);
    assert.match(await check(null, "US"), /18 and over/);
    assert.match(await check("1990-01-01", "US", null), /18 and over/);
    assert.match(await check("2030-01-01", "US"), /18 and over/);
    assert.match(await check("2008-02-29", "US", "2026-02-28"), /18 and over/);
    assert.equal(await check("2008-02-29", "US", "2026-03-01"), null);
    for (const country of ["CA", "GB", "", null]) assert.match(await check("1990-01-01", country), /United States/);
    assert.equal(await check("1990-01-01", "us"), null);
  });

  await t.test("new held intake rejects ineligible details before saving them", async () => {
    await assert.rejects(() => profile(fresh, { birthDate: "2018-01-01" }), { name: "MembershipInputError", message: "Membership registration is for adults 18 and over." });
    await assert.rejects(() => profile(fresh, { shippingAddress: { addressLine1: "1 Test Street", addressLine2: null, city: "Toronto", countryCode: "CA", postalCode: "M5V 1A1", region: "ON" } }), { name: "MembershipInputError", message: "Membership registration is currently available in the United States." });
    assert.equal((await row("select count(*)::int as count from person_private_profiles where person_id=$1", [fresh.person_id])).count, 0);
    assert.equal((await registration.getMemberRegistration(fresh.authUserId)).profileComplete, false);
  });

  await t.test("existing profiles remain accessible and are never backfilled on return", async()=>{
    assert.equal(await registration.getMemberRegistration(existing.authUserId),null);
    await sql.begin(tx => admission.claimPublicMembershipSignupInTransaction(tx,existing,"monthly"));
    assert.equal(await registration.getMemberRegistration(existing.authUserId),null);
    assert.ok(policy.memberCan(policy.deriveMemberAccessPolicy(await memberRepository.getMemberIdentity(existing.authUserId)),"profile.read"));
    await profile(existing, { birthDate: "2018-01-01", shippingAddress: { addressLine1: "1 Test Street", addressLine2: null, city: "Toronto", countryCode: "CA", postalCode: "M5V 1A1", region: "ON" } });
    assert.equal((await row("select default_fulfillment_address->>'countryCode' as country from person_private_profiles where person_id=$1", [existing.person_id])).country, "CA");
  });
  await t.test("new pending account can edit intake but cannot read or write profile, journal, or badges",async()=>{
    const access = policy.deriveMemberAccessPolicy(await memberRepository.getMemberIdentity(fresh.authUserId));
    assert.ok(policy.memberCan(access,"onboarding.write"));
    for(const capability of ["home.read","profile.read","profile.write","circle.read","foundations.write"]) assert.equal(policy.memberCan(access,capability),false,capability);
    await assert.rejects(()=>memberRepository.getMemberProfile(fresh.authUserId),{name:"MembershipAccessDeniedError"});
    await assert.rejects(()=>load("src/lib/membership/badge-notification-repository.ts").getUnacknowledgedMemberBadges(fresh.authUserId),{status:403});
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId),"/my/join");
    assert.equal((await row("select private.ruined_member_profile_released($1) as released",[fresh.member_id])).released,false);
  });
  await t.test("registration-only release disables paid Checkout independently of configured prices",async()=>{
    assert.equal(config.getPlatformConfiguration().stripeCheckoutReady,false);
    assert.equal(config.getPlatformConfiguration().membershipSignupReady,true);
    environment.MEMBERSHIP_REGISTRATION_ONLY_ENABLED="false";
    assert.equal(config.getPlatformConfiguration().stripeCheckoutReady,true);
    assert.equal((await registration.getMemberRegistration(fresh.authUserId)).state,"collecting");
    environment.MEMBERSHIP_REGISTRATION_ONLY_ENABLED="true";
  });
  await t.test("personal information alone does not complete registration or send welcome",async()=>{
    await profile(fresh);
    const before = await registration.getMemberRegistration(fresh.authUserId);
    assert.equal(before.profileComplete,true);assert.equal(before.requiresPaymentMethod,true);assert.equal(before.ready,false);
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId),"/my/payment-method");
    assert.equal((await row("select count(*)::int as count from member_registration_messages")).count,0);
    await assert.rejects(()=>registration.activateMemberRegistration(admin.authUserId,fresh.member_id,before.version),{status:409});
  });
  await t.test("wrong Stripe mode cannot satisfy registration and reads never reconcile state",async()=>{
    await savedCard(fresh,{livemode:true});
    assert.equal((await registration.completeMemberRegistration(fresh.authUserId)).state,"collecting");
    await savedCard(fresh);
    assert.equal((await registration.getMemberRegistration(fresh.authUserId)).state,"collecting");
    assert.equal((await row("select count(*)::int as count from member_registration_messages")).count,0);
  });
  await t.test("confirmed saved card completes only registration and atomically queues one welcome",async()=>{
    const result = await registration.completeMemberRegistration(fresh.authUserId);
    assert.equal(result.state,"registered");assert.ok(result.registeredAt);assert.equal(result.profileActivatedAt,null);
    await registration.completeMemberRegistration(fresh.authUserId);
    assert.equal((await row("select count(*)::int as count from member_registration_messages where member_id=$1 and kind='welcome'",[fresh.member_id])).count,1);
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId),"/my/registered");
    const lifecycle=await row("select * from member_lifecycle where member_id=$1",[fresh.member_id]);
    assert.equal(lifecycle.billing_state,"pending");assert.notEqual(lifecycle.administrative_onboarding_state,"completed");
    for(const table of ["stripe_checkout_attempts","stripe_subscriptions","membership_agreement_acceptances"]) assert.equal((await row(`select count(*)::int as count from ${table}`)).count,0,table);
  });
  await t.test("card withdrawal retains registration history but blocks release until readiness is restored",async()=>{
    await db.query("update member_payment_method_accounts set consent_revoked_at=now() where member_id=$1 and livemode=false",[fresh.member_id]);
    const snapshot=await registration.getMemberRegistration(fresh.authUserId);
    assert.equal(snapshot.state,"registered");assert.equal(snapshot.ready,false);
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId),"/my/payment-method");
    await assert.rejects(()=>registration.activateMemberRegistration(admin.authUserId,fresh.member_id,snapshot.version),{status:409});
    await db.query("update member_payment_method_accounts set consent_revoked_at=null where member_id=$1 and livemode=false",[fresh.member_id]);
  });
  await t.test("Data API identity and person-profile policies cannot bypass the registration hold",async()=>{
    await db.exec(`set request.jwt.claim.sub='${fresh.authUserId}'; set role authenticated;`);
    const identity=await row("select private.ruined_current_membership_id() as id,private.ruined_current_member_id() as active_id");
    assert.equal(identity.id,null);assert.equal(identity.active_id,null);
    assert.equal((await row("select count(*)::int as count from person_profiles")).count,0);
    await assert.rejects(()=>db.query("select * from member_registration_access"),error=>error.code==='42501');
    await db.exec("reset role;");
  });
  await t.test("only an administrator can activate, stale updates fail, and activation never bills",async()=>{
    const before=await registration.getMemberRegistration(fresh.authUserId);
    await assert.rejects(()=>registration.activateMemberRegistration(fresh.authUserId,fresh.member_id,before.version),{status:403});
    await assert.rejects(()=>registration.activateMemberRegistration(admin.authUserId,fresh.member_id,before.version+1),{status:409});
    const result=await registration.activateMemberRegistration(admin.authUserId,fresh.member_id,before.version);
    assert.equal(result.state,"activated");assert.ok(result.profileActivatedAt);assert.equal(result.version,before.version+1);
    await registration.activateMemberRegistration(admin.authUserId,fresh.member_id,before.version);
    assert.equal((await row("select count(*)::int as count from member_registration_messages where member_id=$1 and kind='profile_ready'",[fresh.member_id])).count,1);
    assert.equal((await row("select count(*)::int as count from operator_audit_events where action='member.profile_activated'")).count,1);
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId),null);
    const access=policy.deriveMemberAccessPolicy(await memberRepository.getMemberIdentity(fresh.authUserId));
    assert.ok(policy.memberCan(access,"profile.read"));assert.equal(policy.memberCan(access,"circle.read"),false);
    assert.equal((await row("select billing_state from member_lifecycle where member_id=$1",[fresh.member_id])).billing_state,"pending");
    assert.equal((await registration.getOpsMemberRegistrations(admin.authUserId))[0].memberId,fresh.member_id);
  });
  await t.test("released registrations retain historical profile editing without losing readiness", async () => {
    await profile(fresh, { birthDate: "2018-01-01", shippingAddress: { addressLine1: "1 Test Street", addressLine2: null, city: "Toronto", countryCode: "CA", postalCode: "M5V 1A1", region: "ON" } });
    assert.equal((await registration.getMemberRegistration(fresh.authUserId)).ready, true);
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId), null);
  });
  await t.test("the real setup webhook completes registration atomically and never opens paid checkout",async()=>{
    const pending = await member("webhook-registered@example.test");
    await profile(pending);
    await assert.rejects(()=>db.query(`insert into stripe_checkout_attempts(id,member_id,email_normalized,agreement_version,agreement_accepted_at,age_attested_at,expires_at)
      values($1,$2,$3,'test',now(),now(),now()+interval '1 hour')`,[randomUUID(),pending.member_id,pending.email]),error=>error.code==='P4201');
    const attemptId = await savedCard(pending), token = attemptId.replaceAll("-", "");
    await db.query("update member_payment_method_setup_attempts set status='open' where id=$1",[attemptId]);
    await db.query("update member_payment_method_accounts set stripe_payment_method_id=null,payment_method_display=null,saved_at=null where member_id=$1",[pending.member_id]);
    const metadata = {ruined_context:"ruined_payment_method_setup",ruined_member_id:pending.member_id,
      ruined_setup_attempt_id:attemptId,ruined_stripe_account_id:"acct_RegistrationTest",ruined_storage_consent:"save-payment-method-v1"};
    const session={id:`cs_${token}`,mode:"setup",livemode:false,status:"complete",customer:`cus_${token}`,
      client_reference_id:attemptId,metadata,setup_intent:`seti_${token}`};
    const stripe={accounts:{retrieve:async()=>({id:"acct_RegistrationTest"})},checkout:{sessions:{retrieve:async()=>session}},
      setupIntents:{retrieve:async()=>({id:`seti_${token}`,status:"succeeded",livemode:false,customer:`cus_${token}`,metadata,payment_method:`pm_${token}`})},
      paymentMethods:{retrieve:async()=>({id:`pm_${token}`,livemode:false,customer:`cus_${token}`,type:"card",allow_redisplay:"always",card:{brand:"visa",last4:"4242",exp_month:12,exp_year:2035}})}};
    const webhookLoad=sourceLoader({"@/lib/database/server":{getApplicationDatabase:()=>sql},
      "@/lib/stripe/server":{getStripe:()=>stripe,getStripeLivemode:()=>false}});
    const service=webhookLoad("src/lib/stripe/payment-method-service.ts");
    const event={id:`evt_${token}`,type:"checkout.session.completed",livemode:false,data:{object:session}};
    await sql.begin(tx=>service.handlePaymentMethodSetupEvent(tx,event));
    await sql.begin(tx=>service.handlePaymentMethodSetupEvent(tx,event));
    assert.equal((await registration.getMemberRegistration(pending.authUserId)).state,"registered");
    assert.equal((await row("select count(*)::int as count from member_registration_messages where member_id=$1",[pending.member_id])).count,1);
    assert.equal((await row("select billing_state from member_lifecycle where member_id=$1",[pending.member_id])).billing_state,"pending");
    assert.equal((await row("select private.ruined_member_profile_released($1) as released",[pending.member_id])).released,false);
  });
  await t.test("complimentary funding completes without a card but still holds the profile",async()=>{
    const complimentary={authUserId:randomUUID(),email:"complimentary@example.test"};
    await profile(admin);
    const agreementId = randomUUID(), terms = "TEST ONLY operator onboarding agreement.";
    await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',2,'Test operator agreement',$2,$3,'published',now())",
      [agreementId, terms, createHash("sha256").update(terms).digest("hex")]);
    await memberRepository.acceptPublishedMembershipAgreement(admin.authUserId, {
      affirmativeAction:"checkbox_and_submit",ageConfirmed:true,agreementVersionId:agreementId,
      evidence:{origin:"https://signup.example.test",userAgent:"offline-test"},minimumAge:18,signerName:"Registration Test",attemptId:randomUUID(),
    });
    await memberRepository.completeMemberAdministrativeOnboarding(admin.authUserId);
    const invitationId = randomUUID();
    await db.query(`insert into member_personal_invitations(id,member_id,request_id,public_token,recipient_name,recipient_email_normalized,
      inviter_name,email_requested,membership_type,complimentary_reason,complimentary_authorized_by_auth_user_id)
      values($1,$2,$3,$4,'Complimentary Member',$5,'Test Admin',false,'complimentary','TEST ONLY complimentary registration',$6)`,
      [invitationId,admin.member_id,randomUUID(),randomUUID().replaceAll("-", "")+"abc12345678",complimentary.email,admin.authUserId]);
    const invitation = await row("select public_token from member_personal_invitations where id=$1",[invitationId]);
    await load("src/lib/auth/platform-access.ts").completePlatformSignIn(complimentary,{invitationToken:invitation.public_token});
    Object.assign(complimentary,await row("select id as member_id,person_id from ruined_members where email_normalized=$1",[complimentary.email]));
    // Simulate stale/imported details predating the intake guard. Complimentary
    // funding must not allow these records to complete or activate registration.
    await db.query("insert into person_private_profiles(person_id,birth_date,default_fulfillment_address) values($1,'2018-01-01','{\"countryCode\":\"US\"}')", [complimentary.person_id]);
    await db.query("update member_onboardings set profile_completed_at=now() where member_id=$1", [complimentary.member_id]);
    assert.equal((await registration.completeMemberRegistration(complimentary.authUserId)).state, "collecting");
    assert.equal((await registration.getMemberRegistration(complimentary.authUserId)).ready, false);
    assert.equal((await registration.getMemberRegistration(complimentary.authUserId)).profileComplete, false);
    assert.equal(await registration.getMemberRegistrationDestination(complimentary.authUserId), "/my/join");
    assert.equal((await row("select count(*)::int as count from member_registration_messages where member_id=$1", [complimentary.member_id])).count, 0);
    await assert.rejects(() => db.query("update member_registration_access set registered_at=now(),completion_basis='complimentary' where member_id=$1", [complimentary.member_id]), error => error.code === "P4301");
    await db.query("update person_private_profiles set birth_date='1990-01-01',default_fulfillment_address='{\"countryCode\":\"CA\"}' where person_id=$1", [complimentary.person_id]);
    assert.equal((await registration.completeMemberRegistration(complimentary.authUserId)).state, "collecting");
    assert.equal(await registration.getMemberRegistrationDestination(complimentary.authUserId), "/my/join");
    await assert.rejects(() => db.query("update member_registration_access set registered_at=now(),completion_basis='complimentary',profile_activated_at=now(),activated_by_auth_user_id=$2 where member_id=$1", [complimentary.member_id, admin.authUserId]), error => error.code === "P4301");
    await profile(complimentary);
    const result=await registration.getMemberRegistration(complimentary.authUserId);
    assert.equal(result.requiresPaymentMethod,false);assert.equal(result.ready,true);assert.equal(result.state,"registered");
    assert.equal((await row("select completion_basis from member_registration_access where member_id=$1",[complimentary.member_id])).completion_basis,"complimentary");
    assert.equal((await row("select count(*)::int as count from member_payment_method_accounts where member_id=$1",[complimentary.member_id])).count,0);
  });
});
