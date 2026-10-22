import assert from 'node:assert/strict';
import test from 'node:test';
import {badgeCollectionFixture,badgeId as id,readBadgeSource} from './helpers/badge-collection-fixture.mjs';
const earned = collection => collection.badges.filter(x=>x.earnedAt).map(x=>x.key);
const item = (collection,key)=>collection.badges.find(x=>x.key===key);
const credit=(track,stage=null,month=null)=>({track,stage,month});

test('eleven collection goals are owner scoped; explicit Continue is durable, idempotent and released-account gated',async t=>{
  const f=await badgeCollectionFixture(t);
  const first=await f.getMemberBadgeCollection(id(1));
  assert.equal(first.ownerId,id(1));assert.equal(first.badges.length,11);assert.deepEqual(earned(first),[]);assert.equal(first.seenAt,null);
  assert.equal(await f.shouldIntroduceMemberBadges(id(1)),true);
  await f.markMemberBadgeCollectionSeen(id(1));const seen=(await f.getMemberBadgeCollection(id(1))).seenAt;
  await f.markMemberBadgeCollectionSeen(id(1));assert.equal((await f.getMemberBadgeCollection(id(1))).seenAt,seen);
  assert.equal(await f.shouldIntroduceMemberBadges(id(1)),false);assert.equal(await f.shouldIntroduceMemberBadges(id(2)),true);
  await f.db.query('update ruined_members set released=false where id=$1',[id(102)]);
  await assert.rejects(()=>f.getMemberBadgeCollection(id(2)),{status:403});
  await assert.rejects(()=>f.markMemberBadgeCollectionSeen(id(2)),{status:403});
  assert.equal(await f.shouldIntroduceMemberBadges(id(2)),false);
  for(const role of ['anon','authenticated']) for(const table of ['member_badge_awards','member_badge_collections'])
    assert.equal((await f.db.query('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') allowed',[role,table])).rows[0].allowed,false);
});

test('profile, journal, timeline, Foundations and joined referral backfill once without reading body text',async t=>{
  const f=await badgeCollectionFixture(t);
  await f.db.query("insert into person_profiles(person_id,bio,member_tag) values($1,'A bio','member')",[id(201)]);
  assert.equal(item(await f.getMemberBadgeCollection(id(1)),'make-it-yours').progress,2);
  await f.db.query("update person_profiles set avatar_storage_path='/api/member-photos/photo.webp' where person_id=$1",[id(201)]);
  await f.db.query("insert into member_journal_entries(member_id,visibility) values($1,'private')",[id(101)]);
  await f.db.query("insert into member_journal_entries(member_id,visibility,include_on_timeline) values($1,'public',true)",[id(101)]);
  await f.db.query("insert into foundation_enrollments(id,member_id,status,progress_percent,completed_at) values($1,$2,'completed',100,now())",[id(501),id(101)]);
  await f.db.query("insert into member_foundation_requirement_completions(member_id,foundation_enrollment_id,requirement_slug) values($1,$2,'timeline'),($1,$2,'future_letter')",[id(101),id(501)]);
  await f.db.query('insert into member_referrals(inviter_member_id,joined_at) values($1,now())',[id(101)]);
  const collection=await f.getMemberBadgeCollection(id(1));
  assert.deepEqual(earned(collection),['make-it-yours','first-words','your-story','on-the-record','groundwork','open-door']);
  const before=(await f.db.query('select * from member_badge_awards order by badge_key')).rows;
  await f.getMemberBadgeCollection(id(1));await f.getUnacknowledgedMemberBadges(id(1));
  assert.deepEqual((await f.db.query('select * from member_badge_awards order by badge_key')).rows,before);
  assert.deepEqual(earned(await f.getMemberBadgeCollection(id(2))),[]);
  assert.equal(item(collection,'first-words').privateByDefault,true);assert.equal(item(collection,'first-words').publicVisible,false);
  assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(x=>x.key==='first-words'),false);
  await f.setMemberBadgeVisibility(id(1),'first-words',true);
  assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(x=>x.key==='first-words'),true);
  await f.setMemberBadgeVisibility(id(1),'first-words',false);
  await f.setMemberBadgeVisibility(id(1),'make-it-yours',false);
  assert.deepEqual((await f.repository.getPublicMemberBadges(id(101))).map(x=>x.key).sort(),['groundwork','on-the-record','open-door','your-story']);
  await assert.rejects(()=>f.setMemberBadgeVisibility(id(2),'first-words',true),{status:404});
  await assert.rejects(()=>f.setMemberBadgeVisibility(id(1),'unknown',true),{status:400});
  const source=await readBadgeSource('db/migrations/20261015230000_member_badge_collection.sql');
  assert.doesNotMatch(source,/\b(?:entry|completion|submission)\.(?:body|title|text|foundations_meaning)\b/);
});

test('confirmed calls count distinct stages within one month and Circle; latest correction hides awards everywhere',async t=>{
  const f=await badgeCollectionFixture(t);
  for(const [i,stage] of ['see','face','cut','grow'].entries()) await f.event(i+1,credit('membership',stage,'2026-01'));
  await f.event(5,credit('membership','see','2026-01'));
  await f.db.query('insert into circle_member_assignments values($1,$2,\'2025-01-01\',null)',[id(900),id(101)]);
  await f.event(10,credit('circle','why','2026-01'),{kind:'circle_meeting',circle:id(900)});
  await f.event(11,credit('circle','implementation','2026-01'),{kind:'circle_meeting',circle:id(900)});
  await f.event(20,credit('in_person'),{kind:'member_event',location:'Ruined studio'});
  assert.deepEqual(earned(await f.getMemberBadgeCollection(id(1))),['in-the-room','full-circle','the-whole-month','in-real-life']);
  await f.db.query("insert into experience_attendance_events(experience_id,person_id,member_id,event_type) values($1,$2,$3,'revoked')",[id(1004),id(201),id(101)]);
  assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(x=>x.key==='the-whole-month'),false,'public path validates correction before next owner reconciliation');
  const after=await f.getMemberBadgeCollection(id(1));assert.equal(item(after,'the-whole-month').earnedAt,null);assert.equal(item(after,'the-whole-month').progress,3);
  assert.equal((await f.getUnacknowledgedMemberBadges(id(1))).some(x=>x.key==='the-whole-month'),false);
  await assert.rejects(()=>f.acknowledgeMemberBadge(id(1),'the-whole-month'),{status:404});
  assert.equal((await f.db.query("select count(*) from member_badge_awards where badge_key='the-whole-month'")).rows[0].count,1,'audit history remains');
  await f.db.query("update experiences set status='cancelled' where id=$1",[id(1011)]);
  assert.equal(item(await f.getMemberBadgeCollection(id(1)),'full-circle').progress,1);
});

test('future, cancelled, untagged, credited, clicked or mismatched events never manufacture attendance awards',async t=>{
  const f=await badgeCollectionFixture(t);
  await f.event(1,credit('membership','see','2026-01'),{date:'2099-01-01'});
  await f.event(2,credit('membership','see','2026-01'),{status:'cancelled'});
  await f.event(3,credit('membership','see','2026-01'),{attended:false});
  await f.event(30,credit('membership','see','2026-01'),{status:'archived'});
  await f.db.query('update experiences set cancelled_at=now() where id=$1',[id(1030)]);
  await f.event(31,{...credit('membership','see','2026-01'),extra:'not allowed'});
  await f.event(32,credit('in_person'),{kind:'member_event',location:'Online with members'});
  await f.event(4,credit('none'));
  await f.event(5,credit('membership','see','2026-01'),{source:'member'});
  await f.event(6,credit('membership',null,null));
  await f.event(7,credit('membership','see','2026-13'));
  await f.event(8,credit('membership','see','2026-01'));
  await f.db.query("insert into experience_attendance_events(experience_id,person_id,member_id,event_type) values($1,$2,$3,'credited')",[id(1008),id(201),id(101)]);
  await f.event(9,credit('circle','why','2026-01'),{kind:'circle_meeting',circle:id(900)});
  await f.event(10,credit('circle','implementation','2026-01'),{kind:'circle_meeting',circle:id(900)});
  await f.event(11,credit('in_person'),{kind:'member_event',location:'Online'});
  await f.event(12,credit('in_person'),{kind:'member_event',location:'Studio'});
  await f.db.query("insert into integration_entity_links values('google','experience',$1,'meet_space',$2)",[id(1012),{meetingUri:'https://meet.google.com/test'}]);
  await f.db.query('insert into member_referrals(inviter_member_id) values($1)',[id(101)]);
  assert.deepEqual(earned(await f.getMemberBadgeCollection(id(1))),[]);
});

test('month completion cannot combine different Circles or topic months, and unknown keys never leak',async t=>{
  const f=await badgeCollectionFixture(t);
  await f.db.query('insert into circle_member_assignments values($1,$3,\'2025-01-01\',null),($2,$3,\'2025-01-01\',null)',[id(900),id(901),id(101)]);
  await f.event(1,credit('circle','why','2026-01'),{kind:'circle_meeting',circle:id(900)});
  await f.event(2,credit('circle','implementation','2026-01'),{kind:'circle_meeting',circle:id(901)});
  for(const [i,stage] of ['see','face','cut','grow'].entries())await f.event(10+i,credit('membership',stage,i<2?'2026-01':'2026-02'));
  const collection=await f.getMemberBadgeCollection(id(1));assert.equal(item(collection,'full-circle').progress,1);assert.equal(item(collection,'the-whole-month').progress,2);
  await f.db.query("insert into member_badge_awards(member_id,badge_key,earned_at,source_event_id,rule_version,public_visible) values($1,'unknown',now(),'forged',1,true)",[id(101)]);
  assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(x=>x.key==='unknown'),false);
  assert.equal((await f.getUnacknowledgedMemberBadges(id(1))).some(x=>x.key==='unknown'),false);
});


test('Groundwork revalidates required markers even when enrollment remains completed', async t => {
  const f = await badgeCollectionFixture(t);
  await f.db.query("insert into foundation_enrollments(id,member_id,status,progress_percent,completed_at) values($1,$2,'completed',100,now())", [id(501), id(101)]);
  await f.db.query("insert into member_foundation_requirement_completions(id,member_id,foundation_enrollment_id,requirement_slug) values($1,$3,$4,'timeline'),($2,$3,$4,'future_letter')", [id(601), id(602), id(101), id(501)]);
  assert.ok(item(await f.getMemberBadgeCollection(id(1)), 'groundwork').earnedAt);
  const originalAward = (await f.db.query("select * from member_badge_awards where badge_key='groundwork'")).rows[0];
  await f.db.query("insert into member_foundation_requirement_completions(member_id,foundation_enrollment_id,requirement_slug,completion_version,state,supersedes_completion_id) values($1,$2,'future_letter',2,'revoked',$3)", [id(101), id(501), id(602)]);
  assert.equal((await f.db.query('select status from foundation_enrollments where id=$1', [id(501)])).rows[0].status, 'completed');
  assert.equal((await f.repository.getPublicMemberBadges(id(101))).some(badge => badge.key === 'groundwork'), false);
  const collection = await f.getMemberBadgeCollection(id(1));
  assert.equal(item(collection, 'groundwork').earnedAt, null);
  assert.equal(item(collection, 'groundwork').progress, 99);
  assert.ok(item(collection, 'your-story').earnedAt, 'Only the revoked required marker invalidates Groundwork');
  assert.equal((await f.getUnacknowledgedMemberBadges(id(1))).some(badge => badge.key === 'groundwork'), false);
  assert.deepEqual((await f.db.query("select * from member_badge_awards where badge_key='groundwork'")).rows[0], originalAward);
  await f.db.query("insert into member_foundation_requirement_completions(member_id,foundation_enrollment_id,requirement_slug,completion_version) values($1,$2,'future_letter',3)", [id(101), id(501)]);
  assert.equal(item(await f.getMemberBadgeCollection(id(1)), 'groundwork').earnedAt, new Date(originalAward.earned_at).toISOString());
  // An explicit version configuration is authoritative; do not invent extra requirements.
  await f.db.exec(`update foundation_versions set configuration='{"required_member_requirements":["timeline"]}'`);
  await f.db.query("insert into member_foundation_requirement_completions(member_id,foundation_enrollment_id,requirement_slug,completion_version,state,supersedes_completion_id) select member_id,foundation_enrollment_id,requirement_slug,4,'revoked',id from member_foundation_requirement_completions where requirement_slug='future_letter' and completion_version=3");
  assert.ok(item(await f.getMemberBadgeCollection(id(1)), 'groundwork').earnedAt);
});
