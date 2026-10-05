import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixture as invitationFixture, first, second, newcomer, uuid, person, load } from "./helpers/personal-invitation-fixture.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const model = await load("src/lib/platform/circle-placement-model.ts");
const circleA = uuid(900), circleB = uuid(901);
async function fixture(t, { bind = true } = {}) {
  const f = await invitationFixture(t);
  await f.db.exec(`
    alter table person_profiles add column timezone text;
    create table circles(id uuid primary key, name text, status text default 'active');
    create table circle_member_assignments(member_id uuid references ruined_members, circle_id uuid references circles,
      assigned_at timestamptz default statement_timestamp(), ended_at timestamptz);
    create table circle_staff_assignments(auth_user_id uuid, circle_id uuid references circles, role_slug text,
      assigned_at timestamptz default statement_timestamp(), ended_at timestamptz);
    create table member_circle_preferences(member_id uuid primary key, timezone text, availability text[], preferred_connection_id uuid, updated_at timestamptz);
    create table test_couple_pairs(member_id uuid, partner_id uuid);
    create function private.ruined_circle_couple_partner(uuid) returns uuid language sql stable as
      'select partner_id from test_couple_pairs where member_id=$1';
  `);
  const migration = await source("db/migrations/20260930101000_circle_placement.sql");
  const countFunction = migration.match(/create or replace function private\.ruined_circle_participant_count\([\s\S]*?\n\$\$;/)[0];
  await f.db.exec(countFunction);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [first.auth]);
  await f.db.query("insert into circles(id,name) values($1,'First Circle'),($2,'Second Circle')", [circleA,circleB]);
  await f.db.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2),($3,$4)", [first.member,circleA,second.member,circleB]);
  await f.db.query("update person_profiles set display_name='Alex Inviter' where person_id=$1", [first.person]);
  const link = await f.enable();
  await f.submit(newcomer, link.url.split("/").pop());
  await f.addMember(newcomer, false, bind);
  const repository = await load("src/lib/platform/circle-placement-repository.ts", {
    "server-only": {}, "@/lib/stripe/database": { getBillingDatabase: () => f.sql },
    "@/lib/platform/ops-repository": f.ops, "@/lib/platform/leadership-repository": {},
    "@/lib/platform/circle-placement-model": model,
  });
  const snapshot = () => repository.getCircleRecommendationSnapshot(first.auth, newcomer.member);
  const state = async () => (await f.db.query(`select jsonb_build_object(
    'placements',(select jsonb_agg(to_jsonb(p) order by member_id,circle_id) from circle_member_assignments p),
    'referrals',(select jsonb_agg(to_jsonb(r) order by waitlist_id) from member_referrals r),
    'preferences',(select jsonb_agg(to_jsonb(p) order by member_id) from member_circle_preferences p)) as state`)).rows[0].state;
  return { ...f, recommendationsRepository: repository, snapshot, state };
}

test("bound first inviter stays explicit with absent or null preference and before completed joining; suggestions never write", async t => {
  const f = await fixture(t);
  const referral = (await f.db.query("select * from member_referrals")).rows[0];
  assert.ok(referral.bound_at);
  assert.equal(referral.joined_at, null);
  const before = await f.state();
  const result = await f.snapshot();
  assert.deepEqual(await f.state(), before);
  assert.equal(result.context.inviter.memberId, first.member);
  assert.equal(result.context.inviter.name, "Alex Inviter");
  assert.equal(result.context.inviter.circleId, circleA);
  assert.equal(result.context.inviter.status, "available");
  assert.equal(result.context.inviter.boundAt, referral.bound_at.toISOString());
  assert.equal(result.context.inviter.joinedAt, null);
  assert.equal(result.context.preferredConnection, null);
  assert.equal(result.recommendations[0].circleId, circleA);
  assert.equal(result.recommendations[0].inviterPresent, true);
  assert.match(result.recommendations[0].reasons.join(" "), /Alex Inviter invited this member/);
  await f.db.query("insert into member_circle_preferences values($1,'UTC','{}',null,now())", [newcomer.member]);
  const withPreferences = await f.snapshot();
  assert.equal(withPreferences.context.inviter.memberId, first.member);
  assert.equal(withPreferences.recommendations.find(item => item.circleId === circleA).inviterPresent, true);
  assert.deepEqual(await f.recommendationsRepository.getCircleRecommendations(first.auth,newcomer.member), withPreferences.recommendations);
});

test("unbound email matches do not create inviter attribution, and unrelated records have no inviter", async t => {
  const f = await fixture(t, { bind: false });
  assert.equal((await f.snapshot()).context.inviter, null);
  assert.ok((await f.snapshot()).recommendations.every(item => !item.inviterPresent));
  await f.db.query("update person_email_addresses set verification_state='verified' where person_id=$1", [newcomer.person]);
  assert.equal((await f.snapshot()).context.inviter.memberId, first.member);
  const unrelated = await f.recommendationsRepository.getCircleRecommendationSnapshot(first.auth, second.member);
  assert.equal(unrelated.context.inviter, null);
  await f.db.query("update ruined_members set person_id=$2 where id=$1", [newcomer.member,second.person]);
  assert.equal((await f.snapshot()).context.inviter, null, "canonical person mismatch never attributes the old referral to a different person");
});

test("preferred connections stay separate from inviter and selecting the inviter does not double its ranking", async t => {
  const f = await fixture(t);
  await f.db.query("insert into member_circle_preferences values($1,'UTC','{}',$2,now())", [newcomer.member,first.member]);
  let result = await f.snapshot();
  const inviterOnlyScore = result.recommendations.find(item => item.circleId === circleA).score;
  assert.equal(result.context.preferredConnection.memberId, first.member);
  assert.equal(result.recommendations[0].preferredConnectionPresent, true);
  assert.match(result.recommendations[0].reasons.join(" "), /preferred connection/);
  await f.db.query("update member_circle_preferences set preferred_connection_id=null where member_id=$1", [newcomer.member]);
  assert.equal((await f.snapshot()).recommendations.find(item => item.circleId === circleA).score, inviterOnlyScore);
  // Build the second relationship through shipped invitation capture/binding.
  await f.activate(newcomer);
  const friend = person(4), invitation = await f.enable(newcomer);
  await f.submit(friend, invitation.url.split("/").pop());
  await f.addMember(friend, true, true);
  await f.db.query("update person_profiles set display_name='Sam Connection' where person_id=$1", [friend.person]);
  await f.db.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)", [friend.member,circleB]);
  await f.db.query("update member_circle_preferences set preferred_connection_id=$2 where member_id=$1", [newcomer.member,friend.member]);
  result = await f.snapshot();
  assert.equal(result.context.inviter.memberId, first.member);
  assert.equal(result.context.preferredConnection.memberId, friend.member);
  const own = result.recommendations.find(item => item.circleId === circleA), preferred = result.recommendations.find(item => item.circleId === circleB);
  assert.equal(own.inviterPresent, true); assert.equal(own.preferredConnectionPresent, false);
  assert.equal(preferred.inviterPresent, false); assert.equal(preferred.preferredConnectionPresent, true);
  assert.match(preferred.reasons.join(" "), /Sam Connection is this member's preferred connection/);
  await f.db.query("update member_circle_preferences set preferred_connection_id=$2 where member_id=$1", [newcomer.member,second.member]);
  assert.equal((await f.snapshot()).context.preferredConnection, null, "a stale unrelated preference cannot fabricate connection evidence");
});

test("inactive, deleted, unplaced and unavailable inviters retain attribution without a misleading placement boost", async t => {
  const f = await fixture(t);
  await f.db.query("update member_lifecycle set standing_state='paused' where member_id=$1", [first.member]);
  let result = await f.snapshot();
  assert.equal(result.context.inviter.status, "inactive");
  assert.equal(result.context.inviter.circleId, null);
  assert.ok(result.recommendations.every(item => !item.inviterPresent));
  await f.db.query("update member_lifecycle set standing_state='active' where member_id=$1", [first.member]);
  await f.db.query("update circles set status='archived' where id=$1", [circleA]);
  result = await f.snapshot();
  assert.equal(result.context.inviter.status, "circle_unavailable");
  assert.ok(result.recommendations.every(item => item.circleId !== circleA));
  await f.db.query("update circle_member_assignments set ended_at=now() where member_id=$1", [first.member]);
  assert.equal((await f.snapshot()).context.inviter.status, "no_circle");
  await f.db.query("update ruined_members set deleted_at=now() where id=$1", [first.member]);
  result = await f.snapshot();
  assert.equal(result.context.inviter.status, "inactive");
  assert.equal(result.context.inviter.name, "Former member");
  assert.equal(result.context.inviter.memberId, first.member);
});

test("Supporter participation is deduplicated, multiple current Circles stay explicit, and ended or revoked service is ignored", async t => {
  const f = await fixture(t);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'circle_leader')", [first.auth]);
  await f.db.query("insert into circle_staff_assignments(auth_user_id,circle_id,role_slug) values($1,$2,'circle_leader'),($1,$3,'circle_leader')", [first.auth,circleA,circleB]);
  let result = await f.snapshot();
  assert.equal(result.context.inviter.status, "multiple_circles");
  assert.equal(result.context.inviter.circleId, null);
  assert.deepEqual(result.context.inviter.circles.map(item => [item.circleId,item.relationship]), [[circleA,"member"],[circleB,"supporter"]]);
  assert.equal(result.recommendations.find(item => item.circleId === circleA).activeMembers, 1, "same member/Supporter consumes one seat");
  assert.match(result.recommendations.find(item => item.circleId === circleB).reasons.join(" "), /Alex Inviter.*Circle Supporter/);
  await f.db.query("update circle_member_assignments set ended_at=now() where member_id=$1", [first.member]);
  await f.db.query("update circle_staff_assignments set ended_at=now() where circle_id=$1", [circleA]);
  assert.equal((await f.snapshot()).context.inviter.circleId, circleB);
  await f.db.query("update circle_staff_assignments set assigned_at=now()+interval '1 day' where circle_id=$1", [circleB]);
  assert.equal((await f.snapshot()).context.inviter.status, "no_circle");
  await f.db.query("update circle_staff_assignments set assigned_at=now() where circle_id=$1", [circleB]);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug in ('circle_leader','ops_admin')", [first.auth]);
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [second.auth]);
  result = await f.recommendationsRepository.getCircleRecommendationSnapshot(second.auth,newcomer.member);
  assert.equal(result.context.inviter.status, "no_circle");
  assert.ok(result.recommendations.every(item => !item.inviterPresent));
});

test("inviter context never overrides partner co-placement or capacity exceptions", async t => {
  const f = await fixture(t);
  await f.db.query("insert into test_couple_pairs values($1,$2)", [newcomer.member,second.member]);
  for (let n = 20; n < 30; n++) {
    const filler = person(n);
    await f.db.query("insert into people(id) values($1)", [filler.person]);
    await f.db.query("insert into ruined_members(id,person_id,email_normalized) values($1,$2,$3)", [filler.member,filler.person,filler.email]);
    await f.db.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)", [filler.member,circleB]);
  }
  const before = await f.state();
  let result = await f.snapshot();
  assert.deepEqual(result.recommendations.map(item => item.circleId), [circleB]);
  assert.deepEqual(result.context.requiredPartnerCircle, { circleId: circleB, name: "Second Circle" });
  assert.equal(result.context.inviter.circleId, circleA);
  assert.equal(result.recommendations[0].activeMembers, 11);
  assert.equal(result.recommendations[0].exceptionRequired, false);
  assert.deepEqual(await f.state(), before);
  await f.db.query("update circle_member_assignments set ended_at=now() where member_id=$1", [second.member]);
  result = await f.snapshot();
  assert.equal(result.context.requiredPartnerCircle, null);
  assert.equal(result.recommendations.find(item => item.circleId === circleB).exceptionRequired, false, "10 plus two partners fits the normal maximum");
  await f.db.query("insert into circle_staff_assignments(auth_user_id,circle_id,role_slug) values($1,$2,'circle_leader')", [first.auth,circleB]);
  result = await f.snapshot();
  assert.equal(result.recommendations.find(item => item.circleId === circleB).exceptionRequired, true, "11 plus both incoming partners requires review");
});

test("recommendation API retains the array and exposes context only after a live administrator check", async t => {
  const f = await fixture(t);
  let viewer = null;
  const route = await load("app/api/ops/circle-recommendations/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/circle-placement-repository": f.recommendationsRepository,
    "@/lib/platform/ops-repository": f.ops,
  });
  const request = memberId => new Request(`https://members.example.com/api/ops/circle-recommendations?memberId=${memberId}`);
  assert.equal((await route.GET(request(newcomer.member))).status, 401);
  viewer = { authUserId: second.auth };
  assert.equal((await route.GET(request(newcomer.member))).status, 403);
  viewer = { authUserId: first.auth };
  assert.equal((await route.GET(request("invalid"))).status, 400);
  assert.equal((await route.GET(request(uuid(9999)))).status, 404);
  const response = await route.GET(request(newcomer.member));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.ok(Array.isArray(data.recommendations));
  assert.equal(data.context.inviter.memberId, first.member);
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE BIO|PRIVATE PHOTO|example.test/);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='ops_admin'", [first.auth]);
  assert.equal((await route.GET(request(newcomer.member))).status, 403);
});
