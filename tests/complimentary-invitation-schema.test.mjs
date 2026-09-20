import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const registry = await source("scripts/migrate-platform.mjs");
const migrations = await Promise.all([...registry.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => source(match[1])));

test("complimentary invitation funding executes against every registered migration", async t => {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const migration of migrations) await db.exec(migration);

  async function member({ admin = false, active = false, verified = true } = {}) {
    const id = randomUUID(), auth = randomUUID(), email = `${id}@example.test`;
    await db.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)", [id,email]);
    const person = (await db.query("select person_id from ruined_members where id=$1", [id])).rows[0].person_id;
    await db.query("insert into member_lifecycle(member_id,account_state,billing_state,administrative_onboarding_state,standing_state,program_state) values($1,'active',$2,$3,$4,$5)", [id,active ? "active" : "pending","in_progress","pre_active","onboarding"]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [auth,id,person,email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [auth]);
    if (admin) await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [auth]);
    if (verified) await db.query("update person_email_addresses set verification_state='verified',verified_at=clock_timestamp() where person_id=$1", [person]);
    const result = { id,auth,person,email };
    if (active) await complete(result);
    return result;
  }
  async function complete(recipient, existing = false) {
    if (!existing) await db.query("insert into member_onboardings(member_id,state,form_version) values($1,'in_progress','membership-entry-v1') on conflict(member_id) do update set state='in_progress',form_version='membership-entry-v1'",[recipient.id]);
    await db.query("update member_onboardings set billing_confirmed_at=case when (select billing_state from member_lifecycle where member_id=$1)='active' then clock_timestamp() else null end where member_id=$1",[recipient.id]);
    await db.query("insert into person_profiles(person_id,display_name) values($1,'Founding Recipient') on conflict(person_id) do update set display_name=excluded.display_name",[recipient.person]);
    const agreement = randomUUID(), key = `fixture_${agreement.replaceAll("-", "")}`;
    await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,$3,1,'Agreement','Agree',$2,'published',statement_timestamp())",[agreement,"a".repeat(64),key]);
    await db.query(`insert into membership_agreement_acceptances(agreement_version_id,person_id,member_id,accepted_by_auth_user_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      values($1,$2,$3,$4,'Recipient',$5,'checkbox_and_submit',statement_timestamp(),$8,1,'Agreement',$6,'Agree',$7)`,[agreement,recipient.person,recipient.id,recipient.auth,recipient.email,"a".repeat(64),randomUUID(),key]);
    await db.query("update member_onboardings set profile_completed_at=clock_timestamp(),agreement_completed_at=clock_timestamp(),state='completed' where member_id=$1",[recipient.id]);
    await db.query("update member_lifecycle set administrative_onboarding_state='completed',standing_state='active',access_started_at=clock_timestamp() where member_id=$1",[recipient.id]);
  }
  const owner = await member({ admin:true,active:true });
  async function issue(recipient, { issuer = owner, type = "complimentary", ends = null, reason = "Founding member" } = {}) {
    const { rows:[row] } = await db.query(`insert into member_personal_invitations(member_id,request_id,public_token,recipient_name,recipient_email_normalized,inviter_name,email_requested,membership_type,complimentary_reason,complimentary_ends_at,complimentary_authorized_by_auth_user_id)
      values($1,$2,$3,'Recipient',$4,'Inviter',false,$5,$6,$7,$8) returning id`,
    [issuer.id,randomUUID(),randomBytes(32).toString("base64url"),recipient.email,type,type === "complimentary" ? reason : null,ends,type === "complimentary" ? issuer.auth : null]);
    return row.id;
  }
  async function accept(invitation, recipient) {
    return db.transaction(async tx => {
      await tx.query("update member_personal_invitations set accepted_at=clock_timestamp(),accepted_member_id=$2,accepted_by_auth_user_id=$3 where id=$1 and accepted_at is null", [invitation,recipient.id,recipient.auth]);
      return (await tx.query("select private.ruined_redeem_complimentary_invitation($1,$2,$3) as id", [invitation,recipient.id,recipient.auth])).rows[0].id;
    });
  }
  const funded = async recipient => (await db.query("select private.ruined_member_has_complimentary_funding($1) as funded", [recipient.id])).rows[0].funded;
  const scalar = async (query, args=[]) => Object.values((await db.query(query,args)).rows[0])[0];

  await t.test("only canonical active admins may issue the benefit; issue writes no member funding", async () => {
    const ordinary = await member({active:true}), recipient = await member();
    assert.equal(await scalar("select private.ruined_can_authorize_complimentary_invitation($1,$2)",[owner.id,owner.auth]),true);
    await assert.rejects(issue(recipient,{issuer:ordinary}), error => error.code === "P4101");
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'guide')",[ordinary.auth]);
    await assert.rejects(issue(recipient,{issuer:ordinary}), error => error.code === "P4101");
    for (const alteration of [
      ["update platform_users set status='suspended' where auth_user_id=$1",owner.auth],
      ["update member_lifecycle set account_state='suspended' where member_id=$1",owner.id],
      ["update people set status='erased' where id=$1",owner.person],
      ["update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1 and role_slug='member'",owner.auth],
    ]) {
      await db.exec("begin");
      await db.query(alteration[0],[alteration[1]]);
      assert.equal(await scalar("select private.ruined_can_authorize_complimentary_invitation($1,$2)",[owner.id,owner.auth]),false);
      await db.exec("rollback");
    }
    const invitation = await issue(recipient);
    assert.equal(await funded(recipient),false);
    assert.equal(await scalar("select count(*)::int from member_complimentary_grants"),0);
    await assert.rejects(db.query("update member_personal_invitations set membership_type='standard',complimentary_reason=null,complimentary_authorized_by_auth_user_id=null where id=$1",[invitation]),/new invitation/);
    await assert.rejects(issue(recipient,{reason:"x".repeat(501)}),error=>error.code === "23514");
    await assert.rejects(issue(recipient,{ends:"2000-01-01T00:00:00Z"}),error=>error.code === "P4101");
  });

  await t.test("verified exact recipient acceptance grants payment funding only, with immutable idempotency", async () => {
    const recipient = await member(), wrong = await member(), invitation = await issue(recipient);
    await assert.rejects(accept(invitation,wrong),error=>error.code === "P4100");
    assert.equal(await scalar("select accepted_at from member_personal_invitations where id=$1",[invitation]),null);
    const grant = await accept(invitation,recipient);
    assert.equal(typeof grant,"string"); assert.equal(await funded(recipient),true);
    assert.equal(await accept(invitation,recipient),grant);
    assert.equal(await scalar("select count(*)::int from member_complimentary_grants where source_invitation_id=$1",[invitation]),1);
    assert.deepEqual((await db.query("select role_slug from platform_role_grants where auth_user_id=$1 order by role_slug",[recipient.auth])).rows,[{role_slug:"member"}]);
    assert.equal(await scalar("select billing_state from member_lifecycle where member_id=$1",[recipient.id]),"pending");
    assert.equal(await scalar("select member_number from ruined_members where id=$1",[recipient.id]),null);
    await assert.rejects(db.query("update member_complimentary_grants set ends_at=clock_timestamp()+interval '1 year' where id=$1",[grant]),/immutable/);
    await assert.rejects(db.query("update member_complimentary_grants set revoked_at=clock_timestamp(),revoked_by_auth_user_id=$2 where id=$1",[grant,recipient.auth]),error=>error.code === "P4101");
    await db.query("update member_complimentary_grants set revoked_at=clock_timestamp(),revoked_by_auth_user_id=$2 where id=$1",[grant,owner.auth]);
    assert.equal(await funded(recipient),false);
    assert.equal(await accept(invitation,recipient),grant,"Replay retains revoked history without restoring funding");
    assert.equal(await funded(recipient),false);
    await assert.rejects(db.query("update member_complimentary_grants set revoked_at=null,revoked_by_auth_user_id=null where id=$1",[grant]),/immutable/);
    await assert.rejects(db.query("delete from member_complimentary_grants where id=$1",[grant]),/retained/);
  });

  await t.test("revoked issuer, unverified email and ended funding cannot be redeemed", async () => {
    const recipient = await member(), invitation = await issue(recipient);
    await db.exec("begin");
    await db.query("update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1 and role_slug='ops_admin'",[owner.auth]);
    await db.query("update member_personal_invitations set accepted_at=clock_timestamp(),accepted_member_id=$2,accepted_by_auth_user_id=$3 where id=$1",[invitation,recipient.id,recipient.auth]);
    await assert.rejects(db.query("select private.ruined_redeem_complimentary_invitation($1,$2,$3)",[invitation,recipient.id,recipient.auth]),error=>error.code === "P4100");
    await db.exec("rollback");
    assert.equal(await scalar("select accepted_at from member_personal_invitations where id=$1",[invitation]),null);
    const unverified = await member({verified:false}), unverifiedInvite = await issue(unverified);
    await assert.rejects(accept(unverifiedInvite,unverified),error=>error.code === "P4100");
    assert.equal(await funded(unverified),false);
    const standard = await issue(recipient,{type:"standard"});
    assert.equal(await accept(standard,recipient),null); assert.equal(await funded(recipient),false);
  });

  await t.test("fixed complimentary end dates expire naturally and invitation replay cannot renew them", async () => {
    const recipient = await member();
    const end = await scalar("select clock_timestamp() + interval '2 seconds'");
    const invitation = await issue(recipient,{ends:end});
    const grant = await accept(invitation,recipient);
    assert.equal(await funded(recipient),true);
    assert.equal(await scalar("select private.ruined_personal_invitation_benefit_available($1)",[invitation]),true);
    await new Promise(resolve => setTimeout(resolve,Math.max(0,new Date(end).getTime()-Date.now())+30));
    assert.equal(await funded(recipient),false);
    assert.equal(await scalar("select private.ruined_lock_member_complimentary_funding($1)",[recipient.id]),false);
    assert.equal(await scalar("select private.ruined_personal_invitation_benefit_available($1)",[invitation]),false);
    assert.equal(await accept(invitation,recipient),grant);
    assert.equal(await funded(recipient),false);
  });

  await t.test("current paid billing and nonterminal subscriptions block new complimentary redemption atomically", async () => {
    for (const stripeStatus of [null,"active","trialing","past_due","unpaid","incomplete"]) {
      const recipient = await member(), invitation = await issue(recipient);
      if (stripeStatus) await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,last_event_created) values($1,$2,'cus_fixture',$3,1)",[randomUUID(),recipient.id,stripeStatus]);
      else await db.query("update member_lifecycle set billing_state='active' where member_id=$1",[recipient.id]);
      await assert.rejects(accept(invitation,recipient),error=>error.code === "P4102");
      assert.equal(await scalar("select accepted_at from member_personal_invitations where id=$1",[invitation]),null);
      assert.equal(await funded(recipient),false);
    }
    const recipient = await member(), invitation = await issue(recipient);
    await db.query("insert into stripe_subscriptions(id,member_id,stripe_customer_id,stripe_status,last_event_created) values($1,$2,'cus_fixture','canceled',1)",[randomUUID(),recipient.id]);
    await accept(invitation,recipient);
    assert.equal(await funded(recipient),true,"Terminal billing history does not block legitimate complimentary entry");
  });

  await t.test("in-flight and open checkouts cannot survive a complimentary acceptance", async () => {
    for (const attemptStatus of ["creating","open"]) {
      const recipient = await member(), invitation = await issue(recipient);
      await db.query(`insert into stripe_checkout_attempts(id,member_id,email_normalized,status,agreement_version,agreement_accepted_at,age_attested_at,expires_at)
        values($1,$2,$3,$4,'fixture',statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '1 hour')`,
      [randomUUID(),recipient.id,recipient.email,attemptStatus]);
      await assert.rejects(accept(invitation,recipient),error=>error.code === "P4102");
      assert.equal(await scalar("select accepted_at from member_personal_invitations where id=$1",[invitation]),null);
      assert.equal(await funded(recipient),false);
    }
    for (const sessionStatus of [null,"open"]) {
      const recipient = await member(), invitation = await issue(recipient);
      await db.query("insert into stripe_checkout_sessions(id,member_id,session_status,livemode,last_event_created) values($1,$2,$3,true,1)",[randomUUID(),recipient.id,sessionStatus]);
      await assert.rejects(accept(invitation,recipient),error=>error.code === "P4102");
      assert.equal(await scalar("select accepted_at from member_personal_invitations where id=$1",[invitation]),null);
      assert.equal(await funded(recipient),false);
    }
    const recipient = await member(), invitation = await issue(recipient);
    for (const attemptStatus of ["completed","expired","failed"]) await db.query(`insert into stripe_checkout_attempts(id,member_id,email_normalized,status,agreement_version,agreement_accepted_at,age_attested_at,expires_at)
      values($1,$2,$3,$4,'fixture',statement_timestamp(),statement_timestamp(),statement_timestamp())`,[randomUUID(),recipient.id,recipient.email,attemptStatus]);
    for (const sessionStatus of ["complete","expired"]) await db.query("insert into stripe_checkout_sessions(id,member_id,session_status,livemode,last_event_created) values($1,$2,$3,true,1)",[randomUUID(),recipient.id,sessionStatus]);
    await accept(invitation,recipient);
    assert.equal(await funded(recipient),true,"Terminal checkout history does not block legitimate funding");
  });

  await t.test("complete profile and agreement activate complimentary entry and allocate one normal permanent number", async () => {
    const recipient = await member(), invitation = await issue(recipient);
    await accept(invitation,recipient);
    const waitlist = randomUUID();
    await db.query("insert into membership_waitlist(id,name,email_normalized) values($1,'Recipient',$2)",[waitlist,recipient.email]);
    await db.query("select private.ruined_capture_member_referral($1,(select public_token from member_personal_invitations where id=$2))",[waitlist,invitation]);
    await db.query("select private.ruined_bind_member_referral($1,$2)",[recipient.person,recipient.email]);
    await db.query("insert into member_onboardings(member_id,state,form_version) values($1,'in_progress','membership-entry-v1') on conflict(member_id) do update set state='in_progress',form_version='membership-entry-v1'",[recipient.id]);
    await assert.rejects(db.query("update member_onboardings set state='completed' where member_id=$1",[recipient.id]),/checkpoints/);
    const expectedNumber = await scalar("select last_number + 1 from private.member_number_counter");
    await complete(recipient, true);
    const number = await scalar("select member_number from ruined_members where id=$1",[recipient.id]);
    assert.equal(number,expectedNumber);
    assert.equal(await scalar("select billing_confirmed_at from member_onboardings where member_id=$1",[recipient.id]),null);
    assert.equal(await scalar("select private.ruined_member_can_share_invitation($1)",[recipient.id]),true);
    assert.ok(await scalar("select joined_at from member_referrals where waitlist_id=$1",[waitlist]),"Complimentary completion counts as a real joined referral");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[recipient.auth]);
    assert.equal(await scalar("select private.ruined_current_active_access_member_id()"),recipient.id);
    await db.query("select private.ruined_allocate_member_number($1)",[recipient.id]);
    assert.equal(await scalar("select member_number from ruined_members where id=$1",[recipient.id]),number);
    await db.query("update member_complimentary_grants set revoked_at=clock_timestamp(),revoked_by_auth_user_id=$2 where member_id=$1",[recipient.id,owner.auth]);
    assert.equal(await scalar("select private.ruined_current_active_access_member_id()"),null);
    assert.equal(await scalar("select member_number from ruined_members where id=$1",[recipient.id]),number);
    await db.query("update member_lifecycle set billing_state='active' where member_id=$1",[recipient.id]);
    assert.equal(await scalar("select private.ruined_current_active_access_member_id()"),recipient.id,"Paid access survives complimentary revocation");
  });

  await t.test("account deletion remains historical and issuer invitation erasure does not remove recipient funding", async () => {
    const issuer = await member({admin:true,active:true}), recipient = await member(), invitation = await issue(recipient,{issuer});
    const grant = await accept(invitation,recipient);
    // The existing erasure trigger deletes these rows. Operator identities
    // themselves remain protected by the existing account-deletion policy.
    await db.query("delete from member_personal_invitations where id=$1",[invitation]);
    assert.equal(await scalar("select count(*)::int from member_personal_invitations where id=$1",[invitation]),0);
    assert.equal(await scalar("select source_invitation_id from member_complimentary_grants where id=$1",[grant]),null);
    assert.equal(await funded(recipient),true,"The durable approved benefit survives issuer erasure");
    const deletion = await scalar("select private.ruined_delete_member($1,$2,1,$3,'account_removal')",[owner.auth,recipient.id,recipient.email]);
    assert.equal(deletion.deleted,true);
    assert.equal(await funded(recipient),false);
    assert.equal(await scalar("select count(*)::int from member_complimentary_grants where id=$1",[grant]),1);
    assert.equal(await scalar("select count(*)::int from private.member_deletion_records where member_id=$1",[recipient.id]),1);
    assert.equal(await scalar("select count(*)::int from pg_constraint where conrelid='public.member_complimentary_grants'::regclass and contype='f' and confrelid='public.platform_users'::regclass"),0);
  });

  await t.test("client roles cannot read grants, issue waivers, or invoke redemption and funding helpers", async () => {
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.member_complimentary_grants'::regclass"),true);
    for (const role of ["anon","authenticated"]) {
      assert.equal(await scalar("select has_table_privilege($1,'public.member_complimentary_grants','select,insert,update,delete')",[role]),false);
      for (const fn of ["ruined_can_authorize_complimentary_invitation(uuid,uuid)","ruined_personal_invitation_benefit_available(uuid)","ruined_member_has_complimentary_funding(uuid)","ruined_lock_member_complimentary_funding(uuid)","ruined_redeem_complimentary_invitation(uuid,uuid,uuid)"])
        assert.equal(await scalar("select has_function_privilege($1,$2,'execute')",[role,`private.${fn}`]),false,fn);
    }
  });
});
