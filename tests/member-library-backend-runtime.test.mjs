import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("Library includes funded Foundations members while preserving account, registration and billing holds", async () => {
  const { deriveMemberAccessPolicy, memberCan } = await load("src/lib/membership/access-policy.ts");
  const base = { accountState: "active", administrativeOnboardingState: "completed", billingState: "active",
    membershipFunding: "self", standingState: "active", programState: "onboarding", cancellationEffectiveAt: null };
  for (const member of [base, { ...base, membershipFunding: "complimentary", billingState: "pending" },
    { ...base, membershipFunding: "operator", billingState: "pending" }, { ...base, programState: "active" }]) {
    const access = deriveMemberAccessPolicy(member);
    assert.equal(memberCan(access, "learn.read"), true);
    assert.equal(access.capabilities.filter(item => item === "learn.read").length, 1);
  }
  for (const overrides of [{ accountState: "suspended" }, { accountState: "closed" }, { registrationHeld: true },
    { billingState: "pending" }, { billingState: "attention_required" }, { billingState: "ended" },
    { administrativeOnboardingState: "in_progress" }, { standingState: "pre_active" },
    { standingState: "paused" }, { standingState: "inactive" }, { standingState: "cancellation_requested" }]) {
    assert.equal(memberCan(deriveMemberAccessPolicy({ ...base, ...overrides }), "learn.read"), false, JSON.stringify(overrides));
  }
});

test("private video streams fail closed and allow a whole recording plus pauses and seeking", async () => {
  class MembershipAccessDeniedError extends Error {}
  let connected = true, viewer = { authUserId: "member-one" }, entitled = true, failure = false;
  const calls = [];
  let reads = 0;
  const route = await load("app/api/my/learn/[slug]/stream/route.ts", {
    "next/server": { NextResponse: { json: (data, init) => Response.json(data, init),
      redirect: (url, init) => new Response(null, { ...init, headers: { ...init.headers, Location: url } }) } },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: connected ? "connected" : "preview" }) },
    "@/lib/membership/repository": { MembershipAccessDeniedError,
      getMemberLearningResource: async (auth, slug) => {
        reads++;
        assert.equal(auth, "member-one"); assert.equal(slug, "foundations-01");
        if (entitled === "no-member") throw new MembershipAccessDeniedError();
        return entitled ? { resourceType: "video", storageBucket: "member-library", storagePath: "foundations-01/v1.mp4" } : null;
      } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ storage: { from: bucket => ({
      createSignedUrl: async (path, lifetime) => {
        calls.push({ bucket, path, lifetime });
        return failure ? { data: null, error: Error("Unavailable") } : { data: { signedUrl: "https://storage.example.test/signed-video" }, error: null };
      },
    }) } }) },
  });
  const get = () => route.GET(new Request("https://members.example.test/api/my/learn/foundations-01/stream", {
    headers: { Range: "bytes=24000000-" },
  }), { params: Promise.resolve({ slug: "foundations-01" }) });
  connected = false;
  assert.equal((await get()).status, 503);
  connected = true; viewer = null;
  const signedOut = await get();
  assert.equal(signedOut.status, 401); assert.equal(reads, 0);
  viewer = { authUserId: "member-one" }; entitled = false;
  assert.equal((await get()).status, 404);
  entitled = "no-member";
  assert.equal((await get()).status, 404);
  assert.equal(calls.length, 0, "no object may be signed without member entitlement");
  entitled = true;
  const playback = await get();
  assert.equal(playback.status, 307, "preserve GET and range semantics on storage redirect");
  assert.equal(playback.headers.get("Location"), "https://storage.example.test/signed-video");
  assert.match(playback.headers.get("Cache-Control"), /private.*no-store/);
  assert.deepEqual(calls[0], { bucket: "member-library", path: "foundations-01/v1.mp4", lifetime: 14400 });
  failure = true;
  const unavailable = await get();
  assert.equal(unavailable.status, 502); assert.match(unavailable.headers.get("Cache-Control"), /no-store/);
});

const actorId = "11111111-1111-4111-8111-111111111111";
const resourceId = "22222222-2222-4222-8222-222222222222";
const initialVersion = "33333333-3333-4333-8333-333333333333";
const sha = "a".repeat(64);
const input = { audiences: [{ kind: "all_members", id: null }], bodyText: "", captionsUrl: "", collectionId: "", contentType: "video",
  durationLabel: "43:28", expectedRevision: 1, externalUrl: "", featured: true, position: 1, presenter: "Ruined", resourceId,
  slug: "foundations-01", summary: "The first call", thumbnailUrl: "", title: "Foundations 01", videoUrl: "" };

function sqlWrapper(db) {
  const sql = async (strings, ...values) => {
    const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
    return (await db.query(query, values)).rows;
  };
  sql.json = value => JSON.stringify(value);
  sql.begin = fn => db.transaction(tx => fn(sqlWrapper(tx)));
  return sql;
}

async function academyFixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create table platform_users(auth_user_id uuid primary key,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table learning_collections(id uuid primary key,status text,name text);
    create table learning_resources(id uuid primary key,collection_id uuid,slug text,title text,summary text,content_type text,
      position integer,status text,current_version_id uuid,published_at timestamptz,revision integer,updated_at timestamptz default now());
    create table learning_resource_versions(id uuid primary key default gen_random_uuid(),learning_resource_id uuid,version integer,body_text text,
      external_url text,storage_bucket text,storage_path text,content_sha256 text,metadata jsonb,created_by_auth_user_id uuid,published_at timestamptz);
    create table learning_resource_targets(learning_resource_id uuid,audience_type text,circle_id uuid,block_id uuid,created_by_auth_user_id uuid);
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id uuid,
      before_snapshot jsonb,after_snapshot jsonb,metadata jsonb,dedupe_key uuid);
  `);
  await db.query("insert into platform_users values($1,'active')", [actorId]);
  await db.query("insert into platform_role_grants values($1,'ops_admin',null)", [actorId]);
  await db.query("insert into learning_resources values($1,null,'foundations-01','Foundations 01','The first call','video',1,'published',$2,now(),1,now())", [resourceId, initialVersion]);
  const metadata = { academyDraft: { audiences: input.audiences, collectionId: null, contentType: "video", position: 1,
    slug: input.slug, title: input.title, summary: input.summary }, durationLabel: "43:28", featured: true };
  await db.query("insert into learning_resource_versions values($1,$2,1,null,null,'member-library','foundations-01/v1.mp4',$3,$4,$5,now())",
    [initialVersion, resourceId, sha, JSON.stringify(metadata), actorId]);
  class OpsOperatingRepositoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const repository = await load("src/lib/platform/ops-academy-repository.ts", {
    "server-only": {}, "node:crypto": { randomUUID }, "@/lib/database/server": { getApplicationDatabase: () => sqlWrapper(db) },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError },
  });
  return { db, repository };
}

test("editing a storage-only recording and publishing its draft preserves the private video and checksum", async t => {
  const { db, repository } = await academyFixture(t);
  const saved = await repository.saveOpsAcademyResource(actorId, { ...input, title: "Foundations 01 — Golden Cut" });
  assert.equal(saved.version, 2);
  let versions = (await db.query("select * from learning_resource_versions order by version")).rows;
  assert.equal(versions[1].storage_bucket, "member-library");
  assert.equal(versions[1].storage_path, "foundations-01/v1.mp4");
  assert.equal(versions[1].content_sha256, sha);
  assert.equal(versions[1].body_text, null, "storage-only lessons remain valid without invented notes");
  assert.equal((await db.query("select current_version_id from learning_resources")).rows[0].current_version_id, initialVersion);
  const published = await repository.changeOpsAcademyResourceState(actorId, { action: "publish", resourceId, expectedRevision: 2 });
  assert.equal(published.status, "published");
  versions = (await db.query("select * from learning_resource_versions order by version")).rows;
  assert.equal(versions[2].storage_path, versions[0].storage_path);
  assert.equal(versions[2].content_sha256, sha);
  assert.equal((await db.query("select current_version_id from learning_resources")).rows[0].current_version_id, versions[2].id);
});

test("changing media source or format deliberately detaches the stored video, without resurrecting it later", async t => {
  const { db, repository } = await academyFixture(t);
  await repository.saveOpsAcademyResource(actorId, { ...input, videoUrl: "https://media.example.test/replacement.mp4" });
  let version = (await db.query("select * from learning_resource_versions order by version desc limit 1")).rows[0];
  assert.equal(version.storage_path, null); assert.equal(version.storage_bucket, null); assert.equal(version.content_sha256, null);
  await assert.rejects(repository.saveOpsAcademyResource(actorId, { ...input, expectedRevision: 2 }), /Add lesson copy/);
  await repository.saveOpsAcademyResource(actorId, { ...input, expectedRevision: 2, contentType: "article", bodyText: "Read this instead." });
  version = (await db.query("select * from learning_resource_versions order by version desc limit 1")).rows[0];
  assert.equal(version.storage_path, null); assert.equal(version.metadata.academyDraft.contentType, "article");
});

test("a format-only change drops stored video, and a source link explicitly replaces it", async t => {
  const { db, repository } = await academyFixture(t);
  await repository.saveOpsAcademyResource(actorId, { ...input, contentType: "article", bodyText: "Lesson notes." });
  assert.equal((await db.query("select storage_path from learning_resource_versions order by version desc limit 1")).rows[0].storage_path, null);
  await db.exec("delete from learning_resource_versions where version > 1; update learning_resources set revision=1");
  await repository.saveOpsAcademyResource(actorId, { ...input, externalUrl: "https://video.example.test/watch" });
  assert.equal((await db.query("select storage_path from learning_resource_versions order by version desc limit 1")).rows[0].storage_path, null);
});
