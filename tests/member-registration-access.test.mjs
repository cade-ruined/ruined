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
  MEMBERSHIP_REGISTRATION_TERMS_VERSION: "ruined_registration-v1",
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
  const legalMigration = "db/migrations/20260930220000_registration_legal_acknowledgment.sql";
  const pricingMigration = "db/migrations/20261002140000_registration_founding_pricing.sql";
  const paymentMigration = "db/migrations/20261006220000_registration_initial_payment.sql";
  for (const migration of migrations) if (![legalMigration, pricingMigration, paymentMigration].includes(migration[1])) await db.exec(read(migration[1]));
  const sql = sqlFor(db), load = sourceLoader({ "@/lib/database/server": { getApplicationDatabase: () => sql } });
  const registration = load("src/lib/membership/registration-repository.ts");
  const admission = load("src/lib/membership/public-signup-admission.ts");
  // The three pre-migration fixtures intentionally use the old enrollment shape.
  const oldAdmission = sourceLoader({ "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/membership/registration-repository": { enrollNewMemberRegistration: async (tx, memberId) => {
      await tx`insert into member_registration_access(member_id,payment_setup_account_id,payment_setup_livemode)
        values(${memberId}::uuid,'acct_RegistrationTest',false)`;
    } },
  })("src/lib/membership/public-signup-admission.ts");
  let paymentSchemaReady = false;
  const memberRepository = load("src/lib/membership/repository.ts");
  const legal = load("src/lib/membership/registration-legal.ts");
  const published = load("src/lib/membership/published-agreement.ts");
  const registrationAgreementId = randomUUID();
  let currentRegistrationAgreementId = registrationAgreementId;
  const registrationTerms = "Synthetic registration terms for offline regression testing only. No real member agreement is being published.";
  await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_registration',1,'Test registration terms',$2,$3,'draft',null)",
    [registrationAgreementId,registrationTerms,createHash("sha256").update(registrationTerms).digest("hex")]);
  const policy = load("src/lib/membership/access-policy.ts");
  const config = load("src/lib/platform/config.ts");
  const row = async (query, values=[]) => (await db.query(query, values)).rows[0];
  async function member(email) {
    const viewer = { authUserId: randomUUID(), email };
    await sql.begin(tx => (paymentSchemaReady ? admission : oldAdmission).claimPublicMembershipSignupInTransaction(tx,viewer,"monthly"));
    return { ...viewer, ...(await row("select id as member_id,person_id from ruined_members where email_normalized=$1", [email])) };
  }
  async function profile(viewer, changes = {}) {
    return memberRepository.saveMemberOnboardingProfile(viewer.authUserId, {
      legalAcknowledgment: { acknowledged: true, privacyVersion: "privacy-2026-08-19", agreementVersionId: currentRegistrationAgreementId },
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
  // Real migration fixture: preserve earlier completed and activated records,
  // while requiring the new notice for an unfinished registration.
  const priorRegistered = await member("prior-registered@example.test");
  const priorActivated = await member("prior-activated@example.test");
  const priorIncomplete = await member("prior-incomplete@example.test");
  for (const prior of [priorRegistered, priorActivated]) {
    await db.query("insert into person_private_profiles(person_id,legal_name,birth_date,default_fulfillment_address) values($1,'Prior Registration','1990-01-01','{\"countryCode\":\"US\"}')", [prior.person_id]);
    await db.query("update member_onboardings set profile_completed_at=now() where member_id=$1", [prior.member_id]);
    await db.query("update member_registration_access set registered_at=now(),completion_basis='complimentary' where member_id=$1", [prior.member_id]);
  }
  await db.query("update member_registration_access set profile_activated_at=now(),activated_by_auth_user_id=$2 where member_id=$1", [priorActivated.member_id, priorActivated.authUserId]);
  await db.exec(read(legalMigration));
  await db.exec(read(pricingMigration));
  await db.exec(read(paymentMigration));
  paymentSchemaReady = true;
  environment.MEMBERSHIP_REGISTRATION_ONLY_ENABLED="false";
  const existing = await member("existing@example.test");
  const admin = await member("admin@example.test");
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[admin.authUserId]);
  environment.MEMBERSHIP_REGISTRATION_ONLY_ENABLED="true";
  const fresh = await member("new@example.test");

  await t.test("migration exempts completed registrations and preserves prior member access", async () => {
    for (const prior of [priorRegistered, priorActivated]) {
      assert.equal((await row("select legal_acknowledgment_required as required from member_registration_access where member_id=$1", [prior.member_id])).required, false);
      assert.equal(await legal.getMemberRegistrationLegalNotice(prior.authUserId), null);
      assert.equal((await registration.getMemberRegistration(prior.authUserId)).profileComplete, true);
      await profile(prior, { legalAcknowledgment: undefined });
    }
    assert.equal((await row("select legal_acknowledgment_required as required from member_registration_access where member_id=$1", [priorIncomplete.member_id])).required, true);
    assert.equal((await legal.getMemberRegistrationLegalNotice(priorIncomplete.authUserId)).state, "unavailable");
  });
  await t.test("registration documents must be published, effective, and independently pinned", async () => {
    const configured = environment.MEMBERSHIP_REGISTRATION_TERMS_VERSION;
    delete environment.MEMBERSHIP_REGISTRATION_TERMS_VERSION;
    assert.equal((await legal.getCurrentRegistrationLegalNotice()).state, "unavailable");
    environment.MEMBERSHIP_REGISTRATION_TERMS_VERSION = configured;
    assert.equal((await legal.getCurrentRegistrationLegalNotice()).state, "unavailable");
    await assert.rejects(() => profile(fresh), { name: "RegistrationLegalError", status: 503 });
    await db.query("update membership_agreement_versions set status='published',published_at=now(),effective_at=now()+interval '1 day' where id=$1", [registrationAgreementId]);
    assert.equal((await legal.getCurrentRegistrationLegalNotice()).state, "unavailable");
    // Publication fields are immutable; use a clock-unrestricted original draft
    // for the effective fixture rather than mutating any published document.
    await db.query("update membership_agreement_versions set status='retired',retired_at=now() where id=$1", [registrationAgreementId]);
    const effectiveId = randomUUID();
    await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_registration',2,'Test effective registration terms',$2,$3,'published',now())", [effectiveId,registrationTerms,createHash("sha256").update(registrationTerms).digest("hex")]);
    environment.MEMBERSHIP_REGISTRATION_TERMS_VERSION = "ruined_registration-v2";
    currentRegistrationAgreementId = effectiveId;
    const terms = await legal.getCurrentRegistrationLegalNotice();
    assert.equal(terms.state, "required");
    assert.equal(terms.agreementHref, "/membership/agreement/ruined_registration-v2");
    assert.equal((await published.getPublicMembershipAgreement("ruined_registration-v2")).body, registrationTerms);
    assert.equal(await published.getPublishedMembershipAgreement("ruined_registration-v2"), null, "Registration terms cannot satisfy paid Checkout's agreement resolver");
    environment.MEMBERSHIP_REGISTRATION_TERMS_VERSION = "ruined_membership-v2";
    assert.equal((await legal.getCurrentRegistrationLegalNotice()).state, "unavailable");
    environment.MEMBERSHIP_REGISTRATION_TERMS_VERSION = "ruined_registration-v2";
  });
  await t.test("new details reject missing, false, and stale review before any profile write", async () => {
    await assert.rejects(() => profile(fresh, { legalAcknowledgment: undefined }), { name: "RegistrationLegalError", status: 400 });
    await assert.rejects(() => profile(fresh, { legalAcknowledgment: { acknowledged: false } }), { name: "RegistrationLegalError", status: 400 });
    await assert.rejects(() => profile(fresh, { legalAcknowledgment: { acknowledged: true, privacyVersion: "privacy-2026-08-19", agreementVersionId: registrationAgreementId } }), { status: 409, code: "registration_documents_changed" });
    await assert.rejects(() => profile(fresh, { legalAcknowledgment: { acknowledged: true, privacyVersion: "old", agreementVersionId: currentRegistrationAgreementId } }), { status: 409 });
    assert.equal((await row("select count(*)::int as count from person_private_profiles where person_id=$1", [fresh.person_id])).count, 0);
    assert.equal((await row("select count(*)::int as count from member_consents where member_id=$1", [fresh.member_id])).count, 0);
    assert.equal((await legal.getMemberRegistrationLegalNotice(fresh.authUserId)).state, "required");
    await db.query("update platform_users set member_id=null where auth_user_id=$1", [fresh.authUserId]);
    assert.equal((await legal.getMemberRegistrationLegalNotice(fresh.authUserId)).state, "required", "Legacy canonical-person identities receive the same notice");
    await db.query("update platform_users set member_id=$1 where auth_user_id=$2", [fresh.member_id,fresh.authUserId]);
  });
  await t.test("stale profile timestamps cannot bypass legal review or start card setup", async () => {
    const stale = await member("stale-documents@example.test");
    await db.query("insert into person_private_profiles(person_id,legal_name,birth_date,default_fulfillment_address) values($1,'Stale Fixture','1990-01-01','{\"countryCode\":\"US\"}')", [stale.person_id]);
    await db.query("update member_onboardings set profile_completed_at=now() where member_id=$1", [stale.member_id]);
    assert.equal((await registration.getMemberRegistration(stale.authUserId)).profileComplete, false);
    assert.equal(await registration.getMemberRegistrationDestination(stale.authUserId), "/my/join");
    const setup = await load("src/lib/stripe/payment-method-repository.ts").findSetupMember(sql, stale.authUserId, 18);
    assert.match(setup.reason, /Privacy Policy and Membership Terms/);
    await assert.rejects(() => db.query("update member_registration_access set registered_at=now(),completion_basis='complimentary' where member_id=$1", [stale.member_id]), error => error.code === "P4302");
    await assert.rejects(() => db.query("update member_registration_access set legal_acknowledgment_required=false where member_id=$1", [stale.member_id]), /immutable/);
    await assert.rejects(() => db.query("insert into member_registration_access(member_id,legal_acknowledgment_required) values($1,false)", [existing.member_id]), /require document acknowledgment/);
    await db.query("insert into person_private_profiles(person_id,legal_name,birth_date,default_fulfillment_address) values($1,'Existing Fixture','1990-01-01','{\"countryCode\":\"US\"}')", [existing.person_id]);
    await assert.rejects(() => db.query("insert into member_registration_access(member_id,registered_at,completion_basis) values($1,now(),'complimentary')", [existing.member_id]), error => error.code === "P4302");
  });

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
    await profile(existing, { legalAcknowledgment: undefined, birthDate: "2018-01-01", shippingAddress: { addressLine1: "1 Test Street", addressLine2: null, city: "Toronto", countryCode: "CA", postalCode: "M5V 1A1", region: "ON" } });
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
    await profile(fresh, { legalAcknowledgment: undefined });
    assert.equal(await legal.getMemberRegistrationLegalNotice(fresh.authUserId), null);
    const legalEvidence = await row("select * from member_consents where member_id=$1 and consent_type='privacy'", [fresh.member_id]);
    assert.equal(legalEvidence.actor_auth_user_id, fresh.authUserId);
    assert.equal(legalEvidence.evidence.membershipTerms.id, currentRegistrationAgreementId);
    assert.equal(legalEvidence.evidence.membershipTerms.body, registrationTerms);
    assert.equal(legalEvidence.evidence.registrationTermsAccepted, true);
    assert.equal(legalEvidence.evidence.paidAgreementAccepted, false);
    assert.equal(legalEvidence.evidence.chargeAuthorized, false);
    assert.equal((await row("select count(*)::int as count from member_consents where member_id=$1 and consent_type='privacy'", [fresh.member_id])).count, 1);
    assert.equal((await row("select agreement_completed_at from member_onboardings where member_id=$1", [fresh.member_id])).agreement_completed_at, null);
    await assert.rejects(() => db.query("delete from member_consents where id=$1", [legalEvidence.id]), /append-only/);
    const before = await registration.getMemberRegistration(fresh.authUserId);
    assert.equal(before.profileComplete,true);assert.equal(before.requiresPaymentMethod,true);assert.equal(before.ready,false);
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId),"/my/payment-method");
    assert.equal((await row("select count(*)::int as count from member_registration_messages")).count,0);
    await assert.rejects(()=>registration.activateMemberRegistration(admin.authUserId,fresh.member_id,before.version),{status:409});
  });
  await t.test("a failed details transaction rolls back its legal evidence", async () => {
    const other = await member("tag-conflict@example.test");
    const tag = (await row("select member_tag from person_profiles where person_id=$1", [fresh.person_id])).member_tag;
    await assert.rejects(() => profile(other, { memberTag: tag }), { name: "MembershipConflictError" });
    assert.equal((await row("select count(*)::int as count from member_consents where member_id=$1", [other.member_id])).count, 0);
    assert.equal((await legal.getMemberRegistrationLegalNotice(other.authUserId)).state, "required");
  });
  await t.test("wrong Stripe mode cannot satisfy registration and reads never reconcile state",async()=>{
    await savedCard(fresh,{livemode:true});
    assert.equal((await registration.completeMemberRegistration(fresh.authUserId)).state,"collecting");
    assert.equal((await row("select count(*)::int as count from member_registration_pricing_decisions where member_id=$1", [fresh.member_id])).count, 0);
    await savedCard(fresh);
    assert.equal((await registration.getMemberRegistration(fresh.authUserId)).state,"collecting");
    assert.equal((await row("select count(*)::int as count from member_registration_messages")).count,0);
  });
  await t.test("confirmed saved card completes only registration and atomically queues one welcome",async()=>{
    const result = await registration.completeMemberRegistration(fresh.authUserId);
    assert.equal(result.state,"registered");assert.ok(result.registeredAt);assert.equal(result.profileActivatedAt,null);
    assert.deepEqual({ ...result.foundingPricing, awardedAt: undefined }, {
      confirmed: true, awardedAt: undefined, monthlyAmountCents: 34900, annualAmountCents: 349000, currency: "usd",
    });
    assert.ok(result.foundingPricing.awardedAt);
    const decision = await row("select * from member_registration_pricing_decisions where member_id=$1", [fresh.member_id]);
    assert.equal(decision.founding_eligible, true);
    assert.equal(decision.completion_basis, "saved_card");
    await assert.rejects(() => db.query("update member_registration_pricing_decisions set founding_eligible=false where member_id=$1", [fresh.member_id]), /append-only|immutable|cannot|not permitted/i);
    await assert.rejects(() => db.query("update member_registration_access set registered_at=null,completion_basis=null where member_id=$1", [fresh.member_id]), /immutable/);
    await registration.completeMemberRegistration(fresh.authUserId);
    assert.equal((await row("select count(*)::int as count from member_registration_messages where member_id=$1 and kind='welcome'",[fresh.member_id])).count,1);
    assert.equal(await registration.getMemberRegistrationDestination(fresh.authUserId),"/my/registered");
    assert.equal((await row("select private.ruined_member_paid_activation_ready($1) as ready,private.ruined_member_profile_released($1) as released",[fresh.member_id])).ready,true,"completed current registration may separately authorize billing");
    assert.equal((await row("select private.ruined_member_profile_released($1) as released",[fresh.member_id])).released,false,"billing eligibility never opens the held profile");
    const lifecycle=await row("select * from member_lifecycle where member_id=$1",[fresh.member_id]);
    assert.equal(lifecycle.billing_state,"pending");assert.notEqual(lifecycle.administrative_onboarding_state,"completed");
    for(const table of ["stripe_checkout_attempts","stripe_subscriptions","membership_agreement_acceptances"]) assert.equal((await row(`select count(*)::int as count from ${table}`)).count,0,table);
  });
  await t.test("card withdrawal retains registration history but blocks release until readiness is restored",async()=>{
    await db.query("update member_payment_method_accounts set consent_revoked_at=now() where member_id=$1 and livemode=false",[fresh.member_id]);
    const snapshot=await registration.getMemberRegistration(fresh.authUserId);
    assert.equal(snapshot.state,"registered");assert.equal(snapshot.ready,false);
    assert.equal((await row("select private.ruined_member_paid_activation_ready($1) as ready",[fresh.member_id])).ready,false,"withdrawn storage consent closes held billing eligibility");
    assert.equal(snapshot.foundingPricing.confirmed, true, "Withdrawing card storage does not cancel the earned rate");
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
    assert.equal((await registration.getOpsMemberRegistrations(admin.authUserId)).find(item => item.memberId === fresh.member_id)?.state, "activated");
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
    await db.query("update person_private_profiles set birth_date='1990-01-01',default_fulfillment_address='{\"countryCode\":\"US\"}' where person_id=$1", [complimentary.person_id]);
    assert.equal((await registration.completeMemberRegistration(complimentary.authUserId)).state, "collecting");
    await assert.rejects(() => profile(complimentary, { legalAcknowledgment: undefined }), { status: 400 });
    await profile(complimentary);
    const result=await registration.getMemberRegistration(complimentary.authUserId);
    assert.equal(result.requiresPaymentMethod,false);assert.equal(result.ready,true);assert.equal(result.state,"registered");
    assert.equal(result.foundingPricing, null, "Complimentary registrants receive no paid-price confirmation");
    assert.equal((await row("select count(*)::int as count from private.ruined_commercial_registered_people() where person_id=$1", [complimentary.person_id])).count, 1);
    assert.equal((await row("select completion_basis from member_registration_access where member_id=$1",[complimentary.member_id])).completion_basis,"complimentary");
    assert.equal((await row("select count(*)::int as count from member_payment_method_accounts where member_id=$1",[complimentary.member_id])).count,0);
  });
  await t.test("paid agreement acceptance requires the activation gate and complete registration without opening held profiles", async () => {
    const target = await member("paid-agreement-held@example.test");
    await profile(target); await savedCard(target); await registration.completeMemberRegistration(target.authUserId);
    const agreementId = randomUUID(), agreementBody = "Offline paid membership agreement fixture.";
    await db.query("update membership_agreement_versions set status='retired' where agreement_key='ruined_membership' and status='published'");
    await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'ruined_membership',3,'Test paid agreement',$2,$3,'published',now())",
      [agreementId, agreementBody, createHash("sha256").update(agreementBody).digest("hex")]);
    const input = () => ({ affirmativeAction: "checkbox_and_submit", ageConfirmed: true, agreementVersionId: agreementId,
      evidence: { origin, userAgent: "offline-test" }, minimumAge: 18, signerName: "Registration Test", attemptId: randomUUID() });
    try {
      environment.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = "ruined_membership-v3";
      await assert.rejects(() => memberRepository.acceptPublishedMembershipAgreement(target.authUserId, input()), { name: "MembershipAccessDeniedError" });
      environment.STRIPE_MEMBERSHIP_ACTIVATION_ENABLED = "true";
      environment.STRIPE_MEMBERSHIP_BUYOUT_READY = "true";
      await db.query("update member_payment_method_accounts set consent_revoked_at=now() where member_id=$1", [target.member_id]);
      await assert.rejects(() => memberRepository.acceptPublishedMembershipAgreement(target.authUserId, input()), /Complete your registration/);
      await db.query("update member_payment_method_accounts set consent_revoked_at=null where member_id=$1", [target.member_id]);
      environment.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = "ruined_membership-v4";
      await assert.rejects(() => memberRepository.acceptPublishedMembershipAgreement(target.authUserId, input()), /no longer current/);
      environment.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = "ruined_membership-v3";
      const accepted = await memberRepository.acceptPublishedMembershipAgreement(target.authUserId, input());
      assert.ok(accepted.acceptance.id);
      assert.equal((await registration.getMemberRegistration(target.authUserId)).state, "registered");
      const access = policy.deriveMemberAccessPolicy(await memberRepository.getMemberIdentity(target.authUserId));
      assert.equal(policy.memberCan(access, "profile.write"), false);
      assert.equal(policy.memberCan(access, "profile.read"), false);
      assert.equal((await row("select billing_state from member_lifecycle where member_id=$1", [target.member_id])).billing_state, "pending");
      for (const table of ["stripe_checkout_attempts", "stripe_subscriptions"]) assert.equal((await row(`select count(*)::int as count from ${table} where member_id=$1`, [target.member_id])).count, 0);
    } finally {
      delete environment.STRIPE_MEMBERSHIP_ACTIVATION_ENABLED;
      delete environment.STRIPE_MEMBERSHIP_BUYOUT_READY;
      environment.STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION = "ruined_membership-v2";
    }
  });

  await t.test("new prepayment requirement is pinned and card-saving cannot finish paid intake", async () => {
    const preserved = await registration.getMemberRegistration(fresh.authUserId);
    try {
      environment.MEMBERSHIP_REGISTRATION_PREPAYMENT_REQUIRED = "true";
      environment.STRIPE_MEMBERSHIP_ACTIVATION_ENABLED = "true";
      environment.STRIPE_MEMBERSHIP_BUYOUT_READY = "true";
      environment.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED = "true";
      assert.equal(config.getPlatformConfiguration().membershipPrepaymentRequired, true);
      assert.equal(config.getPlatformConfiguration().membershipSignupReady, true);
      environment.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED = "false";
      assert.equal(config.getPlatformConfiguration().membershipPrepaymentRequired, true);
      assert.equal(config.getPlatformConfiguration().membershipSignupReady, false, "missing payment prerequisite must fail closed");
      environment.STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED = "true";
      const target = await member("prepaid-required@example.test");
      assert.equal((await registration.getMemberRegistration(target.authUserId)).requiresInitialPayment, true);
      await profile(target);
      assert.equal(await registration.getMemberRegistrationDestination(target.authUserId), "/my/activate");
      assert.equal((await row("select private.ruined_member_paid_activation_ready($1) as ready", [target.member_id])).ready, true);
      await savedCard(target);
      const pending = await registration.completeMemberRegistration(target.authUserId);
      assert.equal(pending.state, "collecting");assert.equal(pending.ready, false);assert.equal(pending.requiresPaymentMethod, false);
      assert.equal((await row("select count(*)::int as count from member_registration_messages where member_id=$1", [target.member_id])).count, 0);
      await assert.rejects(() => db.query("update member_registration_access set registered_at=now(),completion_basis='saved_card' where member_id=$1", [target.member_id]), /saved card does not complete/);
      await assert.rejects(() => db.query("update member_registration_access set requires_initial_payment=false where member_id=$1", [target.member_id]), /immutable/);
      await assert.rejects(() => db.query("update member_registration_access set payment_setup_livemode=true where member_id=$1", [target.member_id]), /immutable/);
      environment.MEMBERSHIP_REGISTRATION_PREPAYMENT_REQUIRED = "false";
      assert.equal((await registration.getMemberRegistration(target.authUserId)).requiresInitialPayment, true, "turning off new enrollment cannot rewrite an enrolled requirement");
      assert.deepEqual(await registration.getMemberRegistration(fresh.authUserId), preserved, "completed legacy registration is unchanged");
    } finally {
      for (const key of ["MEMBERSHIP_REGISTRATION_PREPAYMENT_REQUIRED", "STRIPE_MEMBERSHIP_ACTIVATION_ENABLED", "STRIPE_MEMBERSHIP_BUYOUT_READY", "STRIPE_MEMBERSHIP_COHORT_PREPAYMENT_ENABLED"]) delete environment[key];
    }
  });

});
