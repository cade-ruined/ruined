import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { loader, read, sqlFor } from "./helpers/member-sms-fixture.mjs";

const migration = "db/migrations/20261106010000_complimentary_registration_onboarding.sql";

test("complimentary registration reconciles real access without fabricating member agreement, billing or work evidence", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const migrations = [...read("scripts/migrate-platform.mjs").matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => match[1]);
  for (const path of migrations.filter(path => path !== migration)) await db.exec(read(path));
  const sql = sqlFor(db), load = loader({
    NODE_ENV: "test", DATABASE_URL: "isolated-pglite-no-network", PLATFORM_MODE: "connected",
    MEMBERSHIP_REGISTRATION_TERMS_VERSION: "ruined_registration-v1", MEMBERSHIP_FOUNDATIONS_LAUNCHED: "true",
  }, { "@/lib/database/server": { getApplicationDatabase: () => sql } });
  const legal = load("src/lib/membership/registration-legal.ts");
  const repository = load("src/lib/membership/repository.ts");
  const policy = load("src/lib/membership/access-policy.ts");
  const row = async (query, values = []) => (await db.query(query, values)).rows[0];
  const scalar = async (query, values = []) => Object.values(await row(query, values))[0];
  const agreementId = randomUUID(), body = "Synthetic registration terms for an isolated regression fixture.";
  await db.query(`insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at)
    values($1,'ruined_registration',1,'Registration fixture',$2,$3,'published',statement_timestamp())`,
  [agreementId, body, createHash("sha256").update(body).digest("hex")]);

  async function member({ admin = false, billing = "pending" } = {}) {
    const m = { id: randomUUID(), auth: randomUUID(), email: `${randomUUID()}@example.test` };
    await db.query("insert into ruined_members(id,email,email_normalized) values($1,$2,$2)", [m.id, m.email]);
    m.person = await scalar("select person_id from ruined_members where id=$1", [m.id]);
    await db.query(`insert into member_lifecycle(member_id,account_state,billing_state,administrative_onboarding_state,standing_state,program_state)
      values($1,'active',$2,'in_progress','pre_active','prospect')`, [m.id, billing]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [m.auth, m.id, m.person, m.email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [m.auth]);
    if (admin) await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [m.auth]);
    await db.query("update person_email_addresses set verification_state='verified',verified_at=clock_timestamp() where person_id=$1", [m.person]);
    await db.query("insert into person_profiles(person_id,display_name) values($1,'Synthetic member') on conflict(person_id) do update set display_name=excluded.display_name", [m.person]);
    await db.query("insert into person_private_profiles(person_id,legal_name,birth_date,default_fulfillment_address) values($1,'Synthetic Member','1990-01-01','{\"countryCode\":\"US\"}')", [m.person]);
    await db.query("update member_onboardings set state='in_progress',profile_completed_at=clock_timestamp() where member_id=$1", [m.id]);
    return m;
  }

  // A real legacy paid acceptance keeps the independent administrator fixture
  // eligible to issue grants, exercising the retained paid completion branch.
  async function legacyComplete(m) {
    const id = randomUUID(), key = `fixture_${id.replaceAll("-", "")}`;
    await db.query(`insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at)
      values($1,$2,1,'Legacy agreement','Agree',$3,'published',statement_timestamp())`, [id, key, "a".repeat(64)]);
    await db.query(`insert into membership_agreement_acceptances(agreement_version_id,person_id,member_id,accepted_by_auth_user_id,
      signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,
      agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      values($1,$2,$3,$4,'Synthetic Member',$5,'checkbox_and_submit',statement_timestamp(),$6,1,'Legacy agreement',$7,'Agree',$8)`,
    [id, m.person, m.id, m.auth, m.email, key, "a".repeat(64), randomUUID()]);
    await db.query("update member_onboardings set billing_confirmed_at=clock_timestamp(),agreement_completed_at=clock_timestamp(),state='completed' where member_id=$1", [m.id]);
    await db.query("update member_lifecycle set administrative_onboarding_state='completed',standing_state='active',program_state='onboarding' where member_id=$1", [m.id]);
  }
  const admin = await member({ admin: true, billing: "active" }); await legacyComplete(admin);

  async function complimentary({ release = true, consent = true, complete = true, foreignActor = false } = {}) {
    const m = await member();
    m.invitation = await scalar(`insert into member_personal_invitations(member_id,request_id,public_token,recipient_name,
      recipient_email_normalized,inviter_name,email_requested,membership_type,complimentary_reason,complimentary_authorized_by_auth_user_id)
      values($1,$2,$3,'Synthetic Member',$4,'Fixture administrator',false,'complimentary','Isolated regression fixture',$5) returning id`,
    [admin.id, randomUUID(), randomBytes(32).toString("base64url"), m.email, admin.auth]);
    await db.query("update member_personal_invitations set accepted_at=clock_timestamp(),accepted_member_id=$2,accepted_by_auth_user_id=$3 where id=$1", [m.invitation, m.id, m.auth]);
    m.grant = await scalar("select private.ruined_redeem_complimentary_invitation($1,$2,$3)", [m.invitation, m.id, m.auth]);
    await db.query("insert into member_registration_access(member_id) values($1)", [m.id]);
    if (consent) await sql.begin(tx => legal.recordRegistrationLegalAcknowledgment(tx, m.id, foreignActor ? admin.auth : m.auth,
      { acknowledged: true, privacyVersion: "privacy-2026-10-08", agreementVersionId: agreementId }));
    if (complete && consent) {
      await db.query("update member_registration_access set registered_at=clock_timestamp(),completion_basis='complimentary' where member_id=$1", [m.id]);
      if (release) await db.query("update member_registration_access set profile_activated_at=clock_timestamp(),profile_complimentary_grant_id=$2 where member_id=$1", [m.id, m.grant]);
    }
    return m;
  }

  async function evidence(m) {
    return {
      checkpoints: await row("select profile_completed_at,agreement_completed_at,billing_confirmed_at,circle_assigned_at,foundations_ready_at from member_onboardings where member_id=$1", [m.id]),
      lifecycle: await row("select billing_state,foundations_state from member_lifecycle where member_id=$1", [m.id]),
      consents: (await db.query("select * from member_consents where member_id=$1 order by id", [m.id])).rows,
      agreements: (await db.query("select * from membership_agreement_acceptances where member_id=$1 order by id", [m.id])).rows,
      grants: (await db.query("select * from member_complimentary_grants where member_id=$1 order by id", [m.id])).rows,
      registration: await row("select * from member_registration_access where member_id=$1", [m.id]),
      work: (await db.query("select * from member_practice_work where member_id=$1", [m.id])).rows,
      attendance: (await db.query("select * from experience_attendance_events where member_id=$1", [m.id])).rows,
      subscriptions: (await db.query("select * from stripe_subscriptions where member_id=$1", [m.id])).rows,
    };
  }
  const access = async m => policy.deriveMemberAccessPolicy(await repository.getMemberIdentity(m.auth));
  const ready = m => scalar("select private.ruined_complimentary_onboarding_ready($1)", [m.id]);
  const reconcile = (m, actor = admin.auth) => scalar("select private.ruined_reconcile_complimentary_onboarding($1,$2)", [m.id, actor]);
  const state = m => row("select administrative_onboarding_state,program_state,standing_state,version from member_lifecycle where member_id=$1", [m.id]);
  const history = async m => ({
    lifecycle: (await db.query("select * from member_state_history where member_id=$1 order by id", [m.id])).rows,
    onboarding: (await db.query("select * from member_onboarding_events where member_id=$1 order by id", [m.id])).rows,
    audit: (await db.query("select * from operator_audit_events where subject_id=$1 order by id", [m.id])).rows,
  });
  const crewLike = await complimentary(), curtisLike = await complimentary();
  const before = await evidence(crewLike), beforeState = await state(crewLike);

  await t.test("installing the migration never repairs historical members implicitly", async () => {
    assert.equal(policy.memberCan(await access(crewLike), "foundations.write"), false);
    await db.exec(read(migration));
    assert.deepEqual(await evidence(crewLike), before);
    assert.deepEqual(await state(crewLike), beforeState);
    assert.equal(await ready(crewLike), true);
    assert.equal(await ready(curtisLike), true);
  });

  await t.test("an authorized repair opens actual membership capability and retains all underlying evidence", async () => {
    const oldHistory = await history(crewLike);
    assert.equal(await reconcile(crewLike), true);
    assert.equal(policy.memberCan(await access(crewLike), "foundations.write"), true);
    assert.deepEqual(await evidence(crewLike), before);
    const current = await state(crewLike);
    assert.equal(current.administrative_onboarding_state, "completed");
    assert.equal(current.program_state, "onboarding");
    assert.equal(current.standing_state, "active");
    assert.equal(Number(current.version), Number(beforeState.version) + 1);
    const changedHistory = await history(crewLike);
    assert.equal(changedHistory.lifecycle.length - oldHistory.lifecycle.length, 3);
    assert.equal(changedHistory.onboarding.length - oldHistory.onboarding.length, 1);
    assert.equal(changedHistory.audit.length - oldHistory.audit.length, 1);
    const transitions = changedHistory.lifecycle.slice(oldHistory.lifecycle.length);
    assert.deepEqual(transitions.map(event => [event.dimension, event.previous_state, event.next_state]).sort(), [
      ["administrative_onboarding", "in_progress", "completed"], ["program", "prospect", "onboarding"], ["standing", "pre_active", "active"],
    ]);
    for (const event of transitions) {
      assert.equal(event.actor_auth_user_id, admin.auth);
      assert.equal(event.source, "ops");
    }
    const audit = changedHistory.audit.at(-1), consent = before.consents.at(-1);
    assert.equal(audit.action, "membership.complimentary_onboarding_reconciled");
    assert.equal(audit.actor_auth_user_id, admin.auth);
    assert.equal(audit.metadata.registrationConsentId, String(consent.id));
    assert.equal(audit.metadata.registrationTerms.id, agreementId);
    assert.deepEqual(audit.metadata.fundingGrantIds, [crewLike.grant]);
    assert.equal(audit.metadata.paidAgreementCreated, false);
    assert.equal(audit.metadata.billingChanged, false);
    assert.equal(changedHistory.onboarding.at(-1).actor_auth_user_id, admin.auth);
    assert.equal(await reconcile(crewLike), false);
    assert.deepEqual(await state(crewLike), current);
    assert.deepEqual(await history(crewLike), changedHistory);
    assert.deepEqual(await evidence(crewLike), before);
  });

  await t.test("normal registration reconciliation performs the same repair with system attribution", async () => {
    const oldEvidence = await evidence(curtisLike), oldHistory = await history(curtisLike);
    await sql.begin(tx => load("src/lib/membership/registration-repository.ts").reconcileMemberRegistration(tx, curtisLike.id));
    assert.equal(policy.memberCan(await access(curtisLike), "foundations.write"), true);
    assert.deepEqual(await evidence(curtisLike), oldEvidence);
    const changes = await history(curtisLike);
    assert.equal(changes.lifecycle.length - oldHistory.lifecycle.length, 3);
    assert.equal(changes.onboarding.length - oldHistory.onboarding.length, 1);
    assert.equal(changes.audit.length - oldHistory.audit.length, 1);
    assert.equal(changes.audit.at(-1).actor_auth_user_id, null);
    for (const event of changes.lifecycle.slice(oldHistory.lifecycle.length)) {
      assert.equal(event.actor_auth_user_id, null);
      assert.equal(event.source, "system");
    }
    await sql.begin(tx => load("src/lib/membership/registration-repository.ts").reconcileMemberRegistration(tx, curtisLike.id));
    assert.deepEqual(await history(curtisLike), changes);
  });

  await t.test("a newly completed registration automatically releases access from the real accepted grant and terms", async () => {
    const target = await complimentary({ complete: false }), original = await evidence(target);
    assert.equal(policy.memberCan(await access(target), "foundations.write"), false);
    await sql.begin(tx => load("src/lib/membership/registration-repository.ts").reconcileMemberRegistration(tx, target.id));
    assert.equal(policy.memberCan(await access(target), "foundations.write"), true);
    const current = await evidence(target);
    assert.ok(current.registration.registered_at);
    assert.ok(current.registration.profile_activated_at);
    assert.equal(current.registration.profile_complimentary_grant_id, target.grant);
    for (const key of Object.keys(original).filter(key => key !== "registration")) assert.deepEqual(current[key], original[key], key);
    assert.deepEqual((await db.query("select kind from member_registration_messages where member_id=$1 order by kind", [target.id])).rows,
      [{ kind: "profile_ready" }, { kind: "welcome" }]);
    const recorded = await history(target);
    await sql.begin(tx => load("src/lib/membership/registration-repository.ts").reconcileMemberRegistration(tx, target.id));
    assert.deepEqual(await evidence(target), current);
    assert.deepEqual(await history(target), recorded);
    assert.equal(await scalar("select count(*)::int from member_registration_messages where member_id=$1", [target.id]), 2);
  });

  await t.test("invalid administrators cannot reconcile even an otherwise eligible member", async () => {
    const target = await complimentary(), original = await state(target);
    await assert.rejects(reconcile(target, target.auth), /administrator|admin/i);
    assert.deepEqual(await state(target), original);
    await db.exec("begin");
    await db.query("update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1 and role_slug='ops_admin'", [admin.auth]);
    await assert.rejects(reconcile(target), /administrator|admin/i);
    await db.exec("rollback");
  });

  await t.test("the audited operator wrapper changes exactly two selected members and rejects invalid selections", async () => {
    const selected = [await complimentary(), await complimentary()], unrelated = await complimentary();
    const reconcileSelected = load("src/lib/membership/registration-repository.ts").reconcileSelectedComplimentaryMemberOnboardings;
    const untouched = { state: await state(unrelated), history: await history(unrelated), evidence: await evidence(unrelated) };
    const originals = await Promise.all(selected.map(evidence));
    for (const ids of [[], [selected[0].id, selected[0].id], ["not-a-member-id"], Array.from({ length: 26 }, randomUUID)]) {
      await assert.rejects(reconcileSelected(admin.auth, ids), error => error.status === 400);
    }
    await assert.rejects(reconcileSelected(selected[0].auth, selected.map(m => m.id)), error => error.status === 403);
    for (const m of selected) assert.equal(policy.memberCan(await access(m), "foundations.write"), false);
    const results = await reconcileSelected(admin.auth, selected.map(m => m.id).reverse());
    assert.deepEqual(results, selected.map(m => ({ memberId: m.id, reconciled: true })).sort((a, b) => a.memberId.localeCompare(b.memberId)));
    for (const [index, m] of selected.entries()) {
      assert.equal(policy.memberCan(await access(m), "foundations.write"), true);
      assert.deepEqual(await evidence(m), originals[index]);
      assert.equal((await history(m)).audit.at(-1).actor_auth_user_id, admin.auth);
    }
    assert.deepEqual({ state: await state(unrelated), history: await history(unrelated), evidence: await evidence(unrelated) }, untouched);
    const after = await Promise.all(selected.map(history));
    assert.deepEqual(await reconcileSelected(admin.auth, selected.map(m => m.id)), results.map(result => ({ ...result, reconciled: false })));
    assert.deepEqual(await Promise.all(selected.map(history)), after);
  });

  await t.test("a failure during the second selected repair rolls back both members and all audit evidence", async () => {
    const selected = [await complimentary(), await complimentary()].sort((a, b) => a.id.localeCompare(b.id));
    const fullSnapshot = async m => ({ state: await state(m), history: await history(m), evidence: await evidence(m),
      onboarding: await row("select * from member_onboardings where member_id=$1", [m.id]) });
    const before = await Promise.all(selected.map(fullSnapshot));
    // Fault injection is confined to this isolated database. Both reconciliation
    // calls, authorization checks and evidence writes remain the real code.
    await db.exec(`create function private.test_fail_second_reconciliation() returns trigger language plpgsql as $$
      begin raise exception 'Injected second repair failure'; end $$;
      create trigger test_fail_second_reconciliation before insert on operator_audit_events for each row
        when (new.action='membership.complimentary_onboarding_reconciled' and new.subject_id='${selected[1].id}')
        execute function private.test_fail_second_reconciliation();`);
    try {
      await assert.rejects(load("src/lib/membership/registration-repository.ts").reconcileSelectedComplimentaryMemberOnboardings(
        admin.auth, selected.map(m => m.id)), /Injected second repair failure/);
      assert.deepEqual(await Promise.all(selected.map(fullSnapshot)), before);
      for (const m of selected) assert.equal(policy.memberCan(await access(m), "foundations.write"), false);
    } finally {
      await db.exec("drop trigger test_fail_second_reconciliation on operator_audit_events; drop function private.test_fail_second_reconciliation();");
    }
  });

  await t.test("the latest decision must retain authentic, matching registration-only legal evidence", async t => {
    const target = await complimentary();
    const original = (await evidence(target)).consents.at(-1);
    const cases = [
      ["withdrawn terms", { decision: "withdrawn" }],
      ["operator-authored consent", { source: "ops" }],
      ["missing actor", { actor: null }],
      ["different actor", { actor: admin.auth }],
      ["missing affirmative action", { evidence: { affirmativeAction: "imported" } }],
      ["registration not accepted", { evidence: { registrationTermsAccepted: false } }],
      ["paid-agreement flag substituted", { evidence: { paidAgreementAccepted: true } }],
      ["charge authorization substituted", { evidence: { chargeAuthorized: true } }],
      ["unknown document", { terms: { id: randomUUID() } }],
      ["different version", { terms: { version: 999 } }],
      ["wrong document hash", { terms: { sha256: "b".repeat(64) } }],
      ["wrong document body", { terms: { body: "A different document." } }],
    ];
    for (const [name, change] of cases) await t.test(name, async () => {
      await db.exec("begin");
      try {
        const nextEvidence = { ...original.evidence, ...change.evidence,
          membershipTerms: { ...original.evidence.membershipTerms, ...change.terms } };
        await db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
          values($1,'privacy',$2,$3,clock_timestamp(),$4,$5,$6,$7)`, [target.id, original.policy_version,
          change.decision ?? "accepted", change.source ?? "member", Object.hasOwn(change, "actor") ? change.actor : target.auth,
          JSON.stringify(nextEvidence), randomUUID()]);
        const priorState = await state(target), priorHistory = await history(target);
        assert.equal(await ready(target), false);
        assert.equal(await reconcile(target), false);
        assert.deepEqual(await state(target), priorState);
        assert.deepEqual(await history(target), priorHistory);
      } finally { await db.exec("rollback"); }
    });
  });

  await t.test("accepted historical terms remain valid after retirement, while unpublished or later-published terms do not", async t => {
    const target = await complimentary(), original = (await evidence(target)).consents.at(-1);
    await t.test("historically published now-retired terms", async () => {
      await db.exec("begin");
      try {
        await db.query("update membership_agreement_versions set status='retired',retired_at=clock_timestamp() where id=$1", [agreementId]);
        assert.equal(await ready(target), true);
        assert.equal(await reconcile(target), true);
        assert.equal(policy.memberCan(await access(target), "foundations.write"), true);
      } finally { await db.exec("rollback"); }
    });
    for (const [name, status, publishedAt] of [["unpublished terms", "draft", null], ["publication after acceptance", "retired", "2099-01-01T00:00:00Z"]]) {
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          const termsId = randomUUID();
          await db.query(`insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at)
            values($1,'ruined_registration',2,'Synthetic future terms',$2,$3,$4,$5)`,
          [termsId, body, createHash("sha256").update(body).digest("hex"), status, publishedAt]);
          const nextEvidence = { ...original.evidence, membershipTerms: { ...original.evidence.membershipTerms, id: termsId, version: 2 } };
          await db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
            values($1,'privacy',$2,'accepted',clock_timestamp(),'member',$3,$4,$5)`,
          [target.id, original.policy_version, target.auth, JSON.stringify(nextEvidence), randomUUID()]);
          const prior = await state(target), priorHistory = await history(target);
          assert.equal(await ready(target), false);
          assert.equal(await reconcile(target), false);
          assert.deepEqual(await state(target), prior);
          assert.deepEqual(await history(target), priorHistory);
        } finally { await db.exec("rollback"); }
      });
    }
  });

  await t.test("readiness and repair helpers remain inaccessible to anonymous or authenticated clients", async () => {
    for (const fn of ["private.ruined_complimentary_onboarding_ready(uuid)", "private.ruined_reconcile_complimentary_onboarding(uuid,uuid)"]) {
      for (const role of ["anon", "authenticated"]) assert.equal(await scalar("select has_function_privilege($1,$2,'execute')", [role, fn]), false);
      assert.equal(await scalar("select has_function_privilege('service_role',$1,'execute')", [fn]), true);
    }
  });

  await t.test("restricted or incomplete members cannot gain participation", async t => {
    const target = await complimentary();
    const cases = [
      ["revoked grant", "update member_complimentary_grants set revoked_at=clock_timestamp(),revoked_by_auth_user_id=$2 where member_id=$1", [target.id, admin.auth]],
      ["paused program", "update member_lifecycle set program_state='paused' where member_id=$1", [target.id]],
      ["paused standing", "update member_lifecycle set standing_state='paused' where member_id=$1", [target.id]],
      ["suspended account", "update member_lifecycle set account_state='suspended' where member_id=$1", [target.id]],
      ["closed account", "update member_lifecycle set account_state='closed' where member_id=$1", [target.id]],
      ["withdrawn program", "update member_lifecycle set program_state='withdrawn' where member_id=$1", [target.id]],
      ["unverified email", "update person_email_addresses set verification_state='unverified',verified_at=null where person_id=$1", [target.person]],
      ["suspended login", "update platform_users set status='suspended' where auth_user_id=$1", [target.auth]],
      ["revoked member role", "update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1 and role_slug='member'", [target.auth]],
    ];
    for (const [name, mutation, values] of cases) await t.test(name, async () => {
      await db.exec("begin");
      try {
        await db.query(mutation, values);
        const original = await state(target), priorHistory = await history(target);
        assert.equal(await ready(target), false);
        assert.equal(await reconcile(target), false);
        assert.deepEqual(await state(target), original);
        assert.deepEqual(await history(target), priorHistory);
      } finally { await db.exec("rollback"); }
    });
    for (const [name, target] of [
      ["missing registration terms", await complimentary({ consent: false })],
      ["unreleased profile", await complimentary({ release: false })],
      ["incomplete registration", await complimentary({ complete: false })],
      ["another actor's registration acknowledgment", await complimentary({ foreignActor: true })],
      ["unfunded member", await member()],
      ["legacy paid member", await member({ billing: "active" })],
    ]) await t.test(name, async () => {
      const original = await state(target), priorHistory = await history(target);
      assert.equal(await ready(target), false);
      assert.equal(await reconcile(target), false);
      assert.deepEqual(await state(target), original);
      assert.deepEqual(await history(target), priorHistory);
      assert.equal(policy.memberCan(await access(target), "foundations.write"), false);
    });
  });

  await t.test("paid onboarding still requires its real paid agreement and checkpoint evidence", async () => {
    const paid = await member({ billing: "active" });
    await db.query("update member_onboardings set billing_confirmed_at=clock_timestamp() where member_id=$1", [paid.id]);
    await assert.rejects(db.query("update member_onboardings set state='completed' where member_id=$1", [paid.id]), /agreement|checkpoint/i);
    await legacyComplete(paid);
    assert.equal(policy.memberCan(await access(paid), "foundations.write"), true);
    assert.equal(await reconcile(paid), false);
  });

  await t.test("fixing entry does not release future assignments or mark them complete", async () => {
    const practice = load("src/lib/practice/repository.ts");
    assert.equal(await practice.isPracticeCourseReleased("f1", crewLike.auth), true);
    for (const course of ["f2", "f3", "f4", "time"]) assert.equal(await practice.isPracticeCourseReleased(course, crewLike.auth), false);
    await assert.rejects(practice.saveMemberPractice(crewLike.auth, {
      action: "save_letter", ownerId: crewLike.auth, expectedRevision: "0", fields: { body: "A draft for a future course." },
    }), error => error.code === "course_locked" && error.status === 403);
    assert.deepEqual(await evidence(crewLike), before);
  });
});
