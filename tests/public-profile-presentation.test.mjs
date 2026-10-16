import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { publicJournalFixture, timelineIds, load } from "./helpers/public-journal-fixture.mjs";

const require = createRequire(import.meta.url);
const fileName = "88888888-8888-4888-8888-888888888888.webp";
const avatarUrl = `/api/member-photos/${timelineIds.member}/${fileName}`;
const badge = { key: "early-supporter", label: "I Was Here", description: "Joined the waitlist, then activated a Founders or Originals membership.", earnedAt: "2026-10-10T12:00:00.000Z" };

async function presentationFixture(t) {
  const f = await publicJournalFixture(t);
  await f.db.exec(`
    create table member_directory_preferences(member_id uuid primary key, avatar_visible boolean default true);
    create table member_badge_awards(member_id uuid, badge_key text, earned_at timestamptz, source_invoice_id text,
      public_visible boolean default true, acknowledged_at timestamptz, source_event_id text default 'fixture',rule_version integer default 2);
    create function private.ruined_member_badge_progress(uuid)
      returns table(badge_key text,progress integer,target integer,earned_at timestamptz,source_event_id text)
      language sql stable as 'select null::text,0,1,null::timestamptz,null::text where false';
    create table private.member_number_assignments(member_id uuid, member_number integer);
  `);
  await f.db.query("update person_profiles set avatar_storage_path=$1 where person_id=$2", [avatarUrl, timelineIds.person]);
  await f.db.query("update ruined_members set member_number=17 where id=$1", [timelineIds.member]);
  await f.db.query("insert into private.member_number_assignments values($1,17)", [timelineIds.member]);
  await f.db.query("insert into member_badge_awards(member_id,badge_key,earned_at,source_invoice_id) values($1,'early-supporter',$2,'PRIVATE INVOICE'),($1,'unknown-badge',$2,'PRIVATE INVOICE')", [timelineIds.member, badge.earnedAt]);
  const policy = await load("src/lib/membership/photo-policy.ts");
  const access = await load("src/lib/membership/access-policy.ts");
  const avatars = await load("src/lib/membership/avatar-url.ts", { "./photo-policy": policy });
  let afterDownload = null, afterBadges = null;
  const downloads = [];
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.SUPABASE_SECRET_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage.example.test";
  process.env.SUPABASE_SECRET_KEY = "fixture-only";
  t.after(() => {
    if (env.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
    if (env.secret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = env.secret;
  });
  const photos = await load("src/lib/membership/photos.ts", {
    "server-only": {}, "node:crypto": crypto, sharp: require("sharp"),
    "@/lib/database/server": { getApplicationDatabase: () => f.sql },
    "@/lib/membership/access-policy": access, "@/lib/membership/photo-policy": policy,
    "@/lib/membership/repository": {}, "@/lib/platform/repository": {},
    "./avatar-url": avatars, "./public-card-repository": f.cardRepository,
    "@supabase/supabase-js": { createClient: () => ({ storage: { from: bucket => {
      assert.equal(bucket, "member-portraits");
      return { download: async path => {
        downloads.push(path);
        if (afterDownload) await afterDownload();
        return { data: new Blob(["portrait"], { type: "image/webp" }), error: null };
      } };
    } } }) },
  });
  const badgeModel = await load("src/lib/membership/badge-model.ts", { "./member-number": await load("src/lib/membership/member-number.ts") });
  const badgeRepository = await load("src/lib/membership/badge-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => f.sql }, "./badge-model": badgeModel,
  });
  const presentation = await load("src/lib/membership/public-badge-repository.ts", {
    "server-only": {}, "./public-card-repository": f.cardRepository, "./photos": photos, "./photo-policy": policy,
    "./badge-repository": { getPublicMemberBadges: async memberId => {
      const result = await badgeRepository.getPublicMemberBadges(memberId);
      if (afterBadges) await afterBadges();
      return result;
    } },
  });
  return { ...f, photos, presentation, downloads, afterDownload: fn => { afterDownload = fn; }, afterBadges: fn => { afterBadges = fn; } };
}

test("visitor profile adds only an opaque portrait route and the verified badge display fields", async t => {
  const f = await presentationFixture(t);
  const result = await f.presentation.getPublicMemberTimelineProfile("shared_tag");
  assert.deepEqual(result, { profile: { name: "Shared name", memberTag: "shared_tag", bio: "PUBLIC BIO", memberNumber: 17,
    avatarUrl: "/api/profile/shared_tag/portrait" }, badges: [badge] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|memberId|personId|email|phone|storage_path|source_invoice|\/api\/member-photos/);
  assert.equal(await f.cardRepository.getPublicMemberCardPortrait(f.token), null, "Name-only collectible cards still cannot expose portraits.");
  const portrait = await f.photos.getPublicMemberProfilePortrait("shared_tag");
  assert.equal(await portrait.text(), "portrait");
  assert.deepEqual(f.downloads, [`${timelineIds.member}/${fileName}`]);
  await f.db.query("delete from private.member_number_assignments where member_id=$1", [timelineIds.member]);
  assert.deepEqual((await f.presentation.getPublicMemberTimelineProfile("shared_tag")).badges, [], "Invalidated award evidence cannot appear on public profiles.");
});

test("public portrait projection honors hidden, absent, malformed and foreign-owner photos", async t => {
  const f = await presentationFixture(t);
  await f.db.query("insert into member_directory_preferences values($1,false)", [timelineIds.member]);
  assert.equal((await f.presentation.getPublicMemberTimelineProfile("shared_tag")).profile.avatarUrl, null);
  assert.equal(await f.photos.getPublicMemberProfilePortrait("shared_tag"), null);
  await f.db.query("update member_directory_preferences set avatar_visible=true");
  for (const url of [null, avatarUrl.replace(timelineIds.member, timelineIds.otherMember), "/api/ops/member-photos/private", "javascript:alert(1)", "//evil.test/photo", "/api/member-photos/../../secret"]) {
    await f.db.query("update person_profiles set avatar_storage_path=$1 where person_id=$2", [url, timelineIds.person]);
    assert.equal((await f.presentation.getPublicMemberTimelineProfile("shared_tag")).profile.avatarUrl, null, String(url));
    assert.equal(await f.photos.getPublicMemberProfilePortrait("shared_tag"), null, String(url));
  }
  assert.deepEqual(f.downloads, []);
  for (const url of ["/membership/portrait.webp", "https://cdn.example.test/portrait.webp"]) {
    await f.db.query("update person_profiles set avatar_storage_path=$1 where person_id=$2", [url, timelineIds.person]);
    assert.equal((await f.presentation.getPublicMemberTimelineProfile("shared_tag")).profile.avatarUrl, url);
    assert.equal(await f.photos.getPublicMemberProfilePortrait("shared_tag"), null, "The portrait endpoint never fetches arbitrary URLs.");
  }
});

test("private or suspended membership prevents both badge projection and portrait downloads", async t => {
  const f = await presentationFixture(t);
  for (const mutation of [
    "update member_lifecycle set account_state='suspended'",
    "update member_lifecycle set account_state='active'; insert into member_registration_access(member_id,profile_activated_at) values('11111111-1111-4111-8111-111111111111',null)",
    "delete from member_registration_access; update platform_role_grants set revoked_at=now()",
    "update platform_role_grants set revoked_at=null; update ruined_members set deleted_at=now()",
  ]) {
    await f.db.exec(mutation);
    assert.equal(await f.presentation.getPublicMemberTimelineProfile("shared_tag"), null);
    assert.equal(await f.photos.getPublicMemberProfilePortrait("shared_tag"), null);
  }
  assert.deepEqual(f.downloads, []);
});

test("portrait withdrawal, replacement and lost membership during storage reads discard image bytes", async t => {
  const f = await presentationFixture(t);
  const reset = async () => {
    await f.db.exec("delete from member_directory_preferences; update member_lifecycle set account_state='active'");
    await f.db.query("update person_profiles set avatar_storage_path=$1 where person_id=$2", [avatarUrl, timelineIds.person]);
  };
  for (const mutate of [
    () => f.db.query("insert into member_directory_preferences values($1,false)", [timelineIds.member]),
    () => f.db.query("update person_profiles set avatar_storage_path=null where person_id=$1", [timelineIds.person]),
    () => f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [timelineIds.member]),
  ]) {
    await reset();
    f.afterDownload(mutate);
    assert.equal(await f.photos.getPublicMemberProfilePortrait("shared_tag"), null);
  }
  assert.equal(f.downloads.length, 3);
});

test("membership withdrawn during badge lookup discards the full public profile", async t => {
  const f = await presentationFixture(t);
  f.afterBadges(() => f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [timelineIds.member]));
  assert.equal(await f.presentation.getPublicMemberTimelineProfile("shared_tag"), null);
});

test("public portrait route is anonymous, no-store, and fails closed outside connected mode", async () => {
  let mode = "connected", portrait = new Blob(["photo"]), calls = 0;
  const route = await load("app/api/profile/[memberTag]/portrait/route.ts", {
    "next/server": require("next/server"),
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/public-card-model": await load("src/lib/membership/public-card-model.ts"),
    "@/lib/membership/photos": { getPublicMemberProfilePortrait: async tag => { assert.equal(tag, "shared_tag"); calls++; return portrait; } },
  });
  const request = () => route.GET(new Request("https://example.test/api/profile/shared_tag/portrait"), { params: Promise.resolve({ memberTag: "shared_tag" }) });
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  portrait = null;
  assert.equal((await request()).status, 404);
  mode = "preview";
  assert.equal((await request()).status, 404);
  assert.equal(calls, 2);
});
