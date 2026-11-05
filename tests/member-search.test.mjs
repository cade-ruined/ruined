import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { publicJournalFixture, timelineIds, load } from "./helpers/public-journal-fixture.mjs";

const require = createRequire(import.meta.url);
const model = await load("src/lib/membership/member-search-model.ts");

test("member search normalizes names and @tags and bounds requests without wildcard expansion", () => {
  assert.equal(model.MEMBER_SEARCH_LIMIT, 80);
  assert.equal(model.MEMBER_SEARCH_PAGE_SIZE, 24);
  assert.equal(model.normalizeMemberSearchQuery("  @Shared_Tag \n "), "Shared_Tag");
  assert.equal(model.normalizeMemberSearchQuery("First \t Last"), "First Last");
  assert.equal(model.normalizeMemberSearchQuery("%_\\"), "%_\\");
  assert.equal(model.normalizeMemberSearchQuery("  @  "), "");
  for (const input of ["@@Shared_Tag", " @ @ shared_tag ", "@@@", " First  Last "]) {
    const normalized = model.normalizeMemberSearchQuery(input);
    assert.equal(model.normalizeMemberSearchQuery(normalized), normalized);
  }
  assert.equal(model.normalizeMemberSearchQuery(" @ @ shared_tag "), "shared_tag");
  for (const query of ["x".repeat(81), "bad\0query"]) assert.throws(() => model.normalizeMemberSearchQuery(query), { status: 400 });
  for (const value of [null,undefined,""]) assert.equal(model.parseMemberSearchPage(value),1);
  assert.equal(model.parseMemberSearchPage("1000"),1000);
  for (const value of ["0","-1","01","1.5","2e1","1001","Infinity","NaN","1 "]) {
    assert.throws(() => model.parseMemberSearchPage(value), { status: 400 });
  }
});

test("member discovery uses public fields, complete eligible pages, and current member access", async t => {
  const f = await publicJournalFixture(t);
  await f.db.exec("create table member_directory_preferences(member_id uuid primary key, avatar_visible boolean default true)");
  const search = await load("src/lib/membership/member-search-repository.ts", {
    "server-only": {}, "./repository": f.repository, "./public-card-repository": f.cardRepository, "./member-search-model": model,
  });
  const run = (query="", page=1, auth=timelineIds.auth) => search.getMemberSearch(auth,query,page);
  const add = async (name, tag, hidden=false) => {
    const member=randomUUID(),auth=randomUUID();
    await f.db.query("insert into people(id) values($1)",[member]);
    await f.db.query("insert into ruined_members(id,person_id,email) values($1,$1,'PRIVATE EMAIL')",[member]);
    await f.db.query("insert into platform_users(auth_user_id,member_id,person_id) values($1,$2,$2)",[auth,member]);
    await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')",[auth]);
    await f.db.query("insert into member_lifecycle(member_id,account_state) values($1,$2)",[member,hidden?"suspended":"active"]);
    await f.db.query("insert into person_profiles(person_id,display_name,preferred_name,member_tag,bio) values($1,$2,'PRIVATE ALIAS',$3,'Published bio')",[member,name,tag]);
    return {member,auth};
  };
  await t.test("empty query browses, tag and multiword matching are case-insensitive, and results contain only public projection",async()=>{
    const result=await run();assert.equal(result.results.length,2);assert.equal(result.hasMore,false);
    assert.deepEqual(Object.keys(result.results[0]).sort(),["avatarUrl","bio","href","memberNumber","memberTag","name"]);
    assert.equal((await run(" @SHARED_TAG ")).results[0].href,"/profile/shared_tag");
    assert.equal((await run("name SHARED")).results.length,2);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|email|phone|location|personId|memberId|storage/);
    for(const query of ["PRIVATE","PUBLIC BIO","member@example.test","%","_","\\","%' OR true --"]) {
      if(query==="_") continue; // Real tags contain literal underscores.
      assert.equal((await run(query)).results.length,0,query);
    }
    await f.db.query("update person_profiles set preferred_name='UNPUBLISHED ALIAS' where person_id=$1",[timelineIds.person]);
    assert.equal((await run("UNPUBLISHED ALIAS")).results.length,0);
    await f.db.query("update person_profiles set display_name='  ' where person_id=$1",[timelineIds.person]);
    assert.equal((await run("UNPUBLISHED ALIAS")).results[0].name,"UNPUBLISHED ALIAS","published fallback is searchable");
    await f.db.query("update person_profiles set display_name='Shared name' where person_id=$1",[timelineIds.person]);
  });
  await t.test("portraits match public-profile visibility and expose only gated uploads or validated legacy URLs",async()=>{
    const target=await add("Portrait Fixture","portrait_fixture");
    const fileName="88888888-8888-4888-8888-888888888888.webp";
    const owned=`/api/member-photos/${target.member}/${fileName}`;
    const setAvatar=url=>f.db.query("update person_profiles set avatar_storage_path=$1 where person_id=$2",[url,target.member]);
    const portrait=async()=>{const result=await run("portrait_fixture");assert.equal(result.results.length,1);return result.results[0].avatarUrl;};
    assert.equal(await portrait(),null);
    await setAvatar(owned);
    assert.equal(await portrait(),"/api/profile/portrait_fixture/portrait");
    assert.doesNotMatch(JSON.stringify(await run("portrait_fixture")),/\/api\/member-photos|storage_path|88888888/);
    await f.db.query("insert into member_directory_preferences values($1,false)",[target.member]);
    assert.equal(await portrait(),null,"hidden portraits stay hidden");
    await f.db.query("update member_directory_preferences set avatar_visible=true where member_id=$1",[target.member]);
    for(const url of ["/images/member.webp","https://cdn.example.test/member.webp"]){await setAvatar(url);assert.equal(await portrait(),url);}
    for(const url of [null,"","private-bucket/member.webp","http://cdn.example.test/member.webp","javascript:alert(1)","data:image/png;base64,AA==","//cdn.example.test/member.webp","https://user:password@cdn.example.test/member.webp","https://cdn.example.test/with space.webp","/api/ops/member-photos/private",`/api/member-photos/${timelineIds.member}/${fileName}`,`${owned}?download=1`]){
      await setAvatar(url);assert.equal(await portrait(),null,`Rejected portrait ${url}`);
    }
    await setAvatar(owned);
    await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1",[target.member]);
    assert.equal((await run("portrait_fixture")).results.length,0,"a picture cannot bypass profile eligibility");
    await f.db.query("update member_lifecycle set account_state='active' where member_id=$1",[target.member]);
    await f.db.query("update person_profiles set member_tag=null where person_id=$1",[target.member]);
    assert.equal((await run("Portrait Fixture")).results[0].avatarUrl,`/api/profile/${target.member}/portrait`);
    let withdrew=false;
    f.setAfterQuery(async query=>{if(!withdrew && query.includes("profile.avatar_storage_path")){withdrew=true;await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1",[target.member]);}});
    assert.equal((await run("Portrait Fixture")).results.length,0,"eligibility is checked again after reading portrait metadata");
    f.setAfterQuery(null);
  });
  await t.test("hidden matches cannot consume visible result pages; stable ordering and literal punctuation preserve discoverability",async()=>{
    for(let i=0;i<28;i++) await add(`Browse A Hidden ${i}`,`hidden_${i}`,true);
    for(let i=0;i<27;i++) await add(`Browse ${String(i).padStart(2,"0")}`,`browse_${i}`);
    const first=await run("Browse"), second=await run("Browse",2), repeat=await run("Browse");
    assert.equal(first.results.length,24);assert.equal(first.hasMore,true);
    assert.equal(second.results.length,3);assert.equal(second.hasMore,false);
    assert.deepEqual(first,repeat);assert.equal(new Set([...first.results,...second.results].map(row=>row.href)).size,27);
    assert.equal(first.results[0].name,"Browse 00");assert.equal(second.results[2].name,"Browse 26");
    await add("100% Literal_under\\slash", "literal_name");
    for(const query of ["%","Literal_under","\\"]) assert.equal((await run(query)).results.length,1,query);
    await add("ZZ Exact", "shared");
    assert.equal((await run("shared")).results[0].memberTag,"shared");
  });
  await t.test("targets obey the existing profile gate, including funding, cancellation, registration, and tagless fallback",async()=>{
    const target=await add("Visibility Fixture","visible_fixture");
    for(const mutation of ["account_state='closed'","administrative_onboarding_state='in_progress'","billing_state='pending'","billing_state='attention_required'","billing_state='ended'","program_state='offboarded'","standing_state='pre_active'","standing_state='paused'","standing_state='inactive'","standing_state='alumni'","standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 day'"]){
      await f.db.query(`update member_lifecycle set ${mutation} where member_id=$1`,[target.member]);
      assert.equal((await run("visible_fixture")).results.length,0,mutation);
      assert.equal(await f.cardRepository.getPublicMemberProfile("visible_fixture"),null,mutation);
      await f.db.query("update member_lifecycle set account_state='active',administrative_onboarding_state='completed',billing_state='active',program_state='active',standing_state='active',cancellation_effective_at=null where member_id=$1",[target.member]);
    }
    await f.db.query("update member_lifecycle set billing_state='pending',program_state='onboarding' where member_id=$1",[target.member]);
    await f.db.query("insert into member_complimentary_grants(member_id) values($1)",[target.member]);
    assert.equal((await run("visible_fixture")).results.length,1,"complimentary onboarding remains discoverable");
    await f.db.query("insert into member_registration_access(member_id,profile_activated_at) values($1,null)",[target.member]);
    assert.equal((await run("visible_fixture")).results.length,0);
    await f.db.query("update member_registration_access set profile_activated_at=now() where member_id=$1",[target.member]);
    await f.db.query("delete from member_complimentary_grants where member_id=$1",[target.member]);
    await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')",[target.auth]);
    assert.equal((await run("visible_fixture")).results.length,1,"operator funding remains discoverable");
    await f.db.query("delete from platform_role_grants where auth_user_id=$1 and role_slug='ops_admin'",[target.auth]);
    const reservation=randomUUID();
    await f.db.query("insert into stripe_subscriptions(id,member_id,stripe_status) values('sub_member_search',$1,'active')",[timelineIds.otherMember]);
    await f.db.query("insert into membership_commercial_reservations(id,payer_member_id,kind,status,stripe_subscription_id,created_at) values($1,$2,'couple','activated','sub_member_search',now())",[reservation,timelineIds.otherMember]);
    await f.db.query("insert into membership_commercial_participants(reservation_id,member_id) values($1,$2)",[reservation,target.member]);
    assert.equal((await run("visible_fixture")).results.length,1,"shared paid membership uses the effective billing state");
    await f.db.query("delete from membership_commercial_participants where reservation_id=$1",[reservation]);
    await f.db.query("delete from membership_commercial_reservations where id=$1",[reservation]);
    await f.db.query("delete from stripe_subscriptions where id='sub_member_search'");
    await f.db.query("update member_lifecycle set billing_state='active',standing_state='cancellation_requested',cancellation_effective_at=now()+interval '1 day' where member_id=$1",[target.member]);
    assert.equal((await run("visible_fixture")).results.length,1,"future cancellation remains active");
    await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[target.auth]);
    assert.equal((await run("visible_fixture")).results.length,0);
    await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1",[target.auth]);
    await f.db.query("update platform_users set status='inactive' where auth_user_id=$1",[target.auth]);
    assert.equal((await run("visible_fixture")).results.length,0);
    await f.db.query("update platform_users set status='active' where auth_user_id=$1",[target.auth]);
    await f.db.query("update person_profiles set member_tag=null where person_id=$1",[target.member]);
    assert.equal((await run("Visibility Fixture")).results[0].href,`/profile/${target.member}`);
    await f.db.query("update ruined_members set deleted_at=now() where id=$1",[target.member]);
    assert.equal((await run("Visibility Fixture")).results.length,0);
  });
  await t.test("target withdrawal while results are assembled is discarded",async()=>{
    const target=await add("Withdrawn Fixture","withdrawn_fixture");let reads=0;
    f.setAfterQuery(async query=>{if(query.includes("with candidates") && ++reads===2) await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1",[target.member]);});
    assert.equal((await run("withdrawn_fixture")).results.length,0);f.setAfterQuery(null);
  });
  await t.test("searcher authorization rejects inactive, held, deleted and revoked accounts, including revocation during read",async()=>{
    await assert.rejects(run("",1,randomUUID()),{status:403});
    for(const assignment of ["account_state='suspended'","standing_state='alumni'","billing_state='ended'","administrative_onboarding_state='in_progress'"]){
      await f.db.query(`update member_lifecycle set ${assignment} where member_id=$1`,[timelineIds.member]);
      await assert.rejects(run(),{status:403});
      await f.db.query("update member_lifecycle set account_state='active',standing_state='active',billing_state='active',administrative_onboarding_state='completed' where member_id=$1",[timelineIds.member]);
    }
    await f.db.query("insert into member_registration_access(member_id,profile_activated_at) values($1,null)",[timelineIds.member]);
    await assert.rejects(run(),{status:403});await f.db.query("delete from member_registration_access where member_id=$1",[timelineIds.member]);
    await f.db.query("update ruined_members set deleted_at=now() where id=$1",[timelineIds.member]);
    await assert.rejects(run(),{status:403});await f.db.query("update ruined_members set deleted_at=null where id=$1",[timelineIds.member]);
    let reads=0;
    f.setAfterQuery(async query=>{if(query.includes("with candidates") && ++reads===2) await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[timelineIds.auth]);});
    await assert.rejects(run(),{status:403});f.setAfterQuery(null);
    await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1",[timelineIds.auth]);
    assert.ok(f.executedQueries.filter(q=>q.includes("with candidates")).every(q=>/^\s*with/.test(q)));
  });
});

test("member search API authenticates, validates pages, disables caching and safely reports failures",async()=>{
  let session={status:"authenticated",viewer:{authUserId:timelineIds.auth}},failure=null;
  const calls=[];
  const api=await load("app/api/my/members/route.ts",{
    "next/server":require("next/server"),"@/lib/auth/session":{resolveCurrentPlatformSession:async()=>session},
    "@/lib/membership/member-search-model":model,
    "@/lib/membership/member-search-repository":{getMemberSearch:async(...args)=>{calls.push(args);if(failure)throw failure;return{query:args[1],page:args[2],results:[],hasMore:false};}},
  });
  const get=(suffix="")=>api.GET(new Request(`https://members.example.test/api/my/members${suffix}`));
  let response=await get("?q=%40Test&page=2");assert.equal(response.status,200);assert.deepEqual(calls.at(-1),[timelineIds.auth,"Test",2]);
  assert.match(response.headers.get("cache-control"),/private.*no-store/);
  response=await get("?q=%40%40Test");assert.equal(response.status,200);assert.equal((await response.json()).query,"Test");
  assert.equal(calls.at(-1)[1],model.normalizeMemberSearchQuery("@@Test"));
  for(const suffix of ["?page=0","?page=1001",`?q=${"a".repeat(81)}`]) assert.equal((await get(suffix)).status,400);
  failure=new model.MemberSearchError(403,"Active member access is required.");assert.equal((await get()).status,403);
  failure=new Error("PRIVATE database details");response=await get();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE/);
  failure=null;session={status:"signed_out"};const before=calls.length;assert.equal((await get()).status,401);assert.equal(calls.length,before);
  session={status:"unavailable"};assert.equal((await get()).status,503);
});
