import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

async function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

const model = await load("src/lib/communications/admin-email-model.ts");
const policy = await load("src/lib/communications/admin-email-image-policy.ts", { "./admin-email-model": model });
const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#65746b" } }).jpeg().toBuffer();
const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } } }).png().toBuffer();
const uploadFile = (data = jpeg, type = "image/jpeg", name = "private-device-name.jpg") => new File([data], name, { type });
const multipart = (files = [uploadFile()], extras = {}) => {
  const form = new FormData();
  for (const file of files) form.append("file", file);
  for (const [key, value] of Object.entries(extras)) form.append(key, value);
  return new Request("https://members.example.com/api/ops/emails/resend/banner-upload", { method: "POST", body: form });
};
function pngChunk(kind, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); out.write(kind, 4, "ascii"); data.copy(out, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, out.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
function pngPixels(bytes) {
  const data = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  return Buffer.concat(data);
}

async function fixture(t, options = {}) {
  const PGlite = await loadPGliteForSchemaChecks(), pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema storage;
    create table platform_users(auth_user_id uuid primary key,status text not null);
    create table platform_role_grants(auth_user_id uuid references platform_users,role_slug text,revoked_at timestamptz);
    create table operator_audit_events(id bigint generated always as identity,actor_auth_user_id uuid,action text,subject_type text,subject_id text,metadata jsonb);
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    create policy broad_existing_storage_access on storage.objects for all to anon,authenticated using(true) with check(true);
  `);
  if (options.existingBucketPublic !== undefined) {
    await pg.query("insert into storage.buckets(id,name,public) values($1,$1,$2)", [policy.ADMIN_EMAIL_IMAGE_BUCKET, options.existingBucketPublic]);
  }
  const migration = await readFile(new URL("../db/migrations/20261008210000_admin_email_images.sql", import.meta.url), "utf8");
  await pg.exec(migration);
  const admin = crypto.randomUUID(), guide = crypto.randomUUID();
  await pg.query("insert into platform_users values($1,'active'),($2,'active')", [admin, guide]);
  await pg.query("insert into platform_role_grants values($1,'ops_admin',null),($2,'guide',null)", [admin, guide]);
  function wrap(client) {
    const sql = async (strings, ...params) => {
      const query = strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
      return (await client.query(query, params)).rows;
    };
    sql.begin = callback => client.transaction(tx => callback(wrap(tx)));
    return sql;
  }
  const db = wrap(pg);
  const repository = await load("src/lib/communications/admin-email-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => db }, "./admin-email-model": model,
  });
  const state = { clients: [], uploads: [], removals: [], publicUrls: [], logs: [], bucketPublic: true, bucketError: null, uploadError: null,
    throwUpload: false, beforeBucket: null, mode: "connected" };
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret" };
  const createClient = (url, key, options) => {
    state.clients.push({ url, key, options });
    return { storage: {
      async getBucket(bucket) {
        assert.equal(bucket, policy.ADMIN_EMAIL_IMAGE_BUCKET);
        if (state.beforeBucket) await state.beforeBucket();
        return { data: state.bucketError ? null : { id: bucket, name: bucket, public: state.bucketPublic }, error: state.bucketError };
      },
      from(bucket) {
        assert.equal(bucket, policy.ADMIN_EMAIL_IMAGE_BUCKET);
        return {
          async upload(path, data, options) {
            state.uploads.push({ path, data: Buffer.from(data), options });
            if (state.throwUpload) throw Error("VERY_PRIVATE_SECRET: private-device-name.jpg in secret-object-path");
            return { data: state.uploadError ? null : { path }, error: state.uploadError };
          },
          getPublicUrl(path) {
            state.publicUrls.push(path);
            return { data: { publicUrl: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` } };
          },
          async remove(paths) { state.removals.push(paths); return { data: [], error: null }; },
        };
      },
    } };
  };
  const service = await load("src/lib/communications/admin-email-images.ts", {
    "server-only": {}, "node:crypto": crypto, sharp, "@supabase/supabase-js": { createClient },
    "@/lib/database/server": { getApplicationDatabase: () => db }, "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: state.mode }) },
    "./admin-email-repository": repository, "./admin-email-model": model, "./admin-email-image-policy": policy,
  }, { process: { env }, console: { error: (...items) => state.logs.push(items) }, fetch: () => { throw Error("Unexpected real network call"); } });
  return { pg, db, repository, migration, admin, guide, service, state, env };
}

test("multipart reader accepts exactly one image file and rejects malformed or extra fields", async () => {
  const file = await policy.readAdminEmailImageUpload(multipart());
  assert.equal(file.type, "image/jpeg");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), jpeg);
  for (const request of [multipart([]), multipart([uploadFile(), uploadFile()]), multipart([uploadFile()], { extra: "unexpected" }), multipart(["not a file"])]) {
    await assert.rejects(policy.readAdminEmailImageUpload(request), error => error.status === 400);
  }
  await assert.rejects(policy.readAdminEmailImageUpload(new Request("https://example.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })), error => error.status === 415);
  await assert.rejects(policy.readAdminEmailImageUpload(new Request("https://example.com", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=broken" }, body: "not multipart" })), error => error.status === 400);
});

test("multipart reader bounds actual bytes and cancels an oversized stream even with a false length", async () => {
  for (const length of [undefined, "1"]) {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(policy.ADMIN_EMAIL_IMAGE_MAX_REQUEST_BYTES + 1)); }, cancel() { cancelled = true; } });
    const headers = { "Content-Type": "multipart/form-data; boundary=test", ...(length ? { "Content-Length": length } : {}) };
    await assert.rejects(policy.readAdminEmailImageUpload(new Request("https://example.com", { method: "POST", headers, body: stream, duplex: "half" })), error => error.status === 413);
    assert.equal(cancelled, true);
  }
  const oversizedHeader = multipart();
  oversizedHeader.headers.set("Content-Length", String(policy.ADMIN_EMAIL_IMAGE_MAX_REQUEST_BYTES + 1));
  await assert.rejects(policy.readAdminEmailImageUpload(oversizedHeader), error => error.status === 413);
  assert.equal(oversizedHeader.bodyUsed, false);
});

test("image policy rejects empty, oversized, and SVG files before decoding", () => {
  assert.throws(() => policy.validateAdminEmailImageFile(uploadFile(Buffer.alloc(0))), error => error.status === 400);
  assert.throws(() => policy.validateAdminEmailImageFile(uploadFile(Buffer.alloc(policy.ADMIN_EMAIL_IMAGE_MAX_BYTES + 1))), error => error.status === 413);
  assert.throws(() => policy.validateAdminEmailImageFile(uploadFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml")), error => error.status === 415);
});

test("image normalization genuinely decodes, rotates, resizes, and removes camera metadata", async t => {
  const f = await fixture(t);
  const tagged = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#65746b" } })
    .withExif({ IFD0: { Artist: "PrivateCameraOwner" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  assert.ok((await sharp(tagged).metadata()).exif);
  const result = await f.service.normalizeAdminEmailImage(uploadFile(tagged));
  const actual = await sharp(result.data).metadata();
  assert.equal(actual.format, "jpeg");
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.bytes, result.data.length);
  assert.deepEqual([result.width, result.height], [800, 1600]);
  assert.deepEqual([actual.width, actual.height], [800, 1600]);
  assert.equal(actual.exif, undefined);
  assert.equal(actual.icc, undefined);
  assert.equal(actual.xmp, undefined);
  assert.equal(actual.orientation, undefined);
  assert.doesNotMatch(result.data.toString("latin1"), /PrivateCameraOwner/);
  assert.equal(f.state.clients.length, 0);
});

test("transparent images retain alpha and WebP is converted to an email-safe format", async t => {
  const f = await fixture(t);
  const transparent = await f.service.normalizeAdminEmailImage(uploadFile(png, "image/png"));
  assert.equal(transparent.contentType, "image/png");
  assert.equal((await sharp(transparent.data).metadata()).hasAlpha, true);
  const webp = await sharp(jpeg).webp().toBuffer();
  const converted = await f.service.normalizeAdminEmailImage(uploadFile(webp, "image/webp"));
  assert.equal(converted.contentType, "image/jpeg");
  assert.equal((await sharp(converted.data).metadata()).format, "jpeg");
});

test("spoofed, corrupt, SVG, and animated images never reach storage", async t => {
  const f = await fixture(t);
  const frames = Buffer.alloc(8 * 16 * 4);
  for (let index = 0; index < frames.length; index += 4) { frames[index] = index < frames.length / 2 ? 255 : 0; frames[index + 2] = index >= frames.length / 2 ? 255 : 0; frames[index + 3] = 255; }
  const animated = await sharp(frames, { raw: { width: 8, height: 16, channels: 4, pageHeight: 8 } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  const invalid = [uploadFile(png), uploadFile(Buffer.from("not an image")), uploadFile(jpeg.subarray(0, 100)),
    uploadFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), "image/png"), uploadFile(animated, "image/webp")];
  for (const file of invalid) await assert.rejects(f.service.uploadAdminEmailImage(f.admin, file), error => [400, 415].includes(error.status));
  assert.equal(f.state.clients.length, 0);
  assert.equal(f.state.uploads.length, 0);
});

test("APNG animation and highly compressed images exceeding the pixel limit are rejected", async t => {
  const f = await fixture(t);
  const second = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 250, g: 0, b: 0, alpha: 0.4 } } }).png().toBuffer();
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2);
  const frame = sequence => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence); data.writeUInt32BE(40, 4); data.writeUInt32BE(20, 8);
    data.writeUInt16BE(100, 20); data.writeUInt16BE(1000, 22);
    return pngChunk("fcTL", data);
  };
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  const apng = Buffer.concat([png.subarray(0, 33), pngChunk("acTL", animation), frame(0), pngChunk("IDAT", pngPixels(png)),
    frame(1), pngChunk("fdAT", Buffer.concat([sequence, pngPixels(second)])), pngChunk("IEND", Buffer.alloc(0))]);
  assert.equal((await sharp(apng).metadata()).format, "png", "the APNG has a genuine decodable default image");
  await assert.rejects(f.service.normalizeAdminEmailImage(uploadFile(apng, "image/png")), error => error.status === 415);
  const tooManyPixels = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "#ffffff" } }).png().toBuffer();
  assert.ok(tooManyPixels.length < policy.ADMIN_EMAIL_IMAGE_MAX_BYTES, "the pixel bomb fits below the byte-size limit");
  await assert.rejects(f.service.normalizeAdminEmailImage(uploadFile(tooManyPixels, "image/png")), error => [413, 415].includes(error.status));
  assert.equal(f.state.clients.length, 0);
});

test("uploads require current admin access before decoding or accessing storage", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.uploadAdminEmailImage(f.guide, uploadFile()), error => error.status === 403);
  await f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.admin]);
  await assert.rejects(f.service.uploadAdminEmailImage(f.admin, uploadFile()), error => error.status === 403);
  assert.equal(f.state.clients.length, 0);
  assert.equal(f.state.uploads.length, 0);
  assert.equal((await f.pg.query("select count(*)::int as count from admin_email_image_upload_limits")).rows[0].count, 0);
});

test("successful uploads use immutable random object names and stable public URLs with a server credential", async t => {
  const f = await fixture(t);
  const first = await f.service.uploadAdminEmailImage(f.admin, uploadFile());
  const second = await f.service.uploadAdminEmailImage(f.admin, uploadFile());
  assert.equal(f.state.uploads.length, 2);
  assert.notEqual(f.state.uploads[0].path, f.state.uploads[1].path);
  for (const [index, result] of [first, second].entries()) {
    const uploaded = f.state.uploads[index];
    assert.equal(uploaded.options.upsert, false);
    assert.equal(uploaded.options.cacheControl, "31536000");
    assert.equal(uploaded.options.contentType, "image/jpeg");
    assert.match(uploaded.path, /[0-9a-f]{8}-[0-9a-f-]{27,}\.(?:jpg|jpeg)$/);
    assert.doesNotMatch(uploaded.path, /private-device-name/);
    assert.equal(result.url, `https://project.supabase.co/storage/v1/object/public/${policy.ADMIN_EMAIL_IMAGE_BUCKET}/${uploaded.path}`);
    assert.equal(result.bytes, uploaded.data.length);
    assert.equal(result.contentType, "image/jpeg");
    assert.equal(f.state.clients[index].key, "server-only-test-secret");
    assert.equal(f.state.clients[index].options.auth.persistSession, false);
  }
  assert.equal((await f.pg.query("select attempts from admin_email_image_upload_limits where actor_auth_user_id=$1", [f.admin])).rows[0].attempts, 2);
  const actions = (await f.pg.query("select action from operator_audit_events order by id")).rows.map(row => row.action);
  assert.deepEqual(actions, ["admin_email.image_upload_requested", "admin_email.image_uploaded", "admin_email.image_upload_requested", "admin_email.image_uploaded"]);
});

test("a private bucket or revoked access during bucket lookup prevents an upload", async t => {
  const f = await fixture(t);
  f.state.bucketPublic = false;
  await assert.rejects(f.service.uploadAdminEmailImage(f.admin, uploadFile()), error => error.status === 503);
  assert.equal(f.state.uploads.length, 0);
  f.state.bucketPublic = true;
  f.state.beforeBucket = () => f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [f.admin]);
  await assert.rejects(f.service.uploadAdminEmailImage(f.admin, uploadFile()), error => error.status === 403);
  assert.equal(f.state.uploads.length, 0);
});

test("storage failures keep the attempted quota and expose only a safe error", async t => {
  const f = await fixture(t);
  f.state.throwUpload = true;
  await assert.rejects(f.service.uploadAdminEmailImage(f.admin, uploadFile()), error => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /VERY_PRIVATE_SECRET|private-device-name|secret-object-path/);
    return true;
  });
  assert.equal((await f.pg.query("select attempts from admin_email_image_upload_limits where actor_auth_user_id=$1", [f.admin])).rows[0].attempts, 1);
  assert.doesNotMatch(JSON.stringify(f.state.logs), /VERY_PRIVATE_SECRET|private-device-name|secret-object-path/);
  assert.equal(f.state.removals.length, 0);
  assert.equal((await f.pg.query("select action from operator_audit_events order by id desc limit 1")).rows[0].action, "admin_email.image_upload_failed");
  await f.pg.query("update admin_email_image_upload_limits set attempts=30 where actor_auth_user_id=$1", [f.admin]);
  const clientsBefore = f.state.clients.length;
  await assert.rejects(f.service.uploadAdminEmailImage(f.admin, uploadFile()), error => error.status === 429);
  assert.equal(f.state.clients.length, clientsBefore);
  assert.equal(f.state.uploads.length, 1);
  assert.equal((await f.pg.query("select attempts from admin_email_image_upload_limits where actor_auth_user_id=$1", [f.admin])).rows[0].attempts, 30);
});

test("anonymous and member database roles cannot read or reset image upload quotas", async t => {
  const f = await fixture(t);
  const table = (await f.pg.query("select relrowsecurity from pg_class where oid='public.admin_email_image_upload_limits'::regclass")).rows[0];
  assert.equal(table.relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    await f.pg.exec(`set role ${role}`);
    try {
      await assert.rejects(f.pg.query("select * from public.admin_email_image_upload_limits"), /permission denied/);
      await assert.rejects(f.pg.query("delete from public.admin_email_image_upload_limits"), /permission denied/);
    } finally { await f.pg.exec("reset role"); }
  }
});

test("storage migration blocks client writes to banner images without changing access to other buckets", async t => {
  const f = await fixture(t);
  await f.pg.query("insert into storage.objects(bucket_id,name) values($1,'server-created.jpg')", [policy.ADMIN_EMAIL_IMAGE_BUCKET]);
  for (const role of ["anon", "authenticated"]) {
    await f.pg.exec(`set role ${role}`);
    try {
      await assert.rejects(f.pg.query("insert into storage.objects(bucket_id,name) values($1,'client-created.jpg')", [policy.ADMIN_EMAIL_IMAGE_BUCKET]), /row-level security/);
      assert.equal((await f.pg.query("update storage.objects set name='replaced.jpg' where bucket_id=$1 returning id", [policy.ADMIN_EMAIL_IMAGE_BUCKET])).rows.length, 0);
      assert.equal((await f.pg.query("delete from storage.objects where bucket_id=$1 returning id", [policy.ADMIN_EMAIL_IMAGE_BUCKET])).rows.length, 0);
      const other = (await f.pg.query("insert into storage.objects(bucket_id,name) values('existing-bucket','unchanged.jpg') returning id")).rows[0];
      await assert.rejects(f.pg.query("update storage.objects set bucket_id=$1 where id=$2", [policy.ADMIN_EMAIL_IMAGE_BUCKET, other.id]), /row-level security/);
      assert.equal((await f.pg.query("update storage.objects set name='allowed.jpg' where id=$1 returning id", [other.id])).rows.length, 1);
      assert.equal((await f.pg.query("delete from storage.objects where id=$1 returning id", [other.id])).rows.length, 1);
    } finally { await f.pg.exec("reset role"); }
  }
  assert.equal((await f.pg.query("select name from storage.objects where bucket_id=$1", [policy.ADMIN_EMAIL_IMAGE_BUCKET])).rows[0].name, "server-created.jpg");
  await f.pg.exec("set role service_role");
  try {
    assert.equal((await f.pg.query("insert into storage.objects(bucket_id,name) values($1,'authorized.jpg') returning id", [policy.ADMIN_EMAIL_IMAGE_BUCKET])).rows.length, 1);
  } finally { await f.pg.exec("reset role"); }
});

test("migration provisions a public image bucket but preserves an existing private bucket", async t => {
  const fresh = await fixture(t);
  const created = (await fresh.pg.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id=$1", [policy.ADMIN_EMAIL_IMAGE_BUCKET])).rows[0];
  assert.equal(created.public, true);
  assert.equal(Number(created.file_size_limit), policy.ADMIN_EMAIL_IMAGE_MAX_BYTES);
  assert.deepEqual(created.allowed_mime_types.slice().sort(), ["image/jpeg", "image/png"]);
  const existing = await fixture(t, { existingBucketPublic: false });
  assert.equal((await existing.pg.query("select public from storage.buckets where id=$1", [policy.ADMIN_EMAIL_IMAGE_BUCKET])).rows[0].public, false);
});

test("upload configuration refuses client-only credentials and preview mode", async t => {
  const f = await fixture(t);
  assert.equal(f.service.adminEmailImagesConfigured(), true);
  delete f.env.SUPABASE_SERVICE_ROLE_KEY;
  f.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key-cannot-upload";
  assert.equal(f.service.adminEmailImagesConfigured(), false);
  f.env.SUPABASE_SECRET_KEY = "server-secret";
  f.state.mode = "preview";
  assert.equal(f.service.adminEmailImagesConfigured(), false);
  await assert.rejects(f.service.uploadAdminEmailImage(f.admin, uploadFile()), error => error.status === 503);
  assert.equal(f.state.clients.length, 0);
});

test("actual multipart upload route enforces origin, connected mode, and admin access before parsing", async t => {
  const f = await fixture(t);
  let viewer = null, viewerCalls = 0;
  const session = { getCurrentPlatformViewer: async () => { viewerCalls++; return viewer; } };
  const origin = await load("src/lib/auth/request.ts", {}, { process: { env: { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://members.example.com" } } });
  const repositoryErrors = { OpsOperatingRepositoryError: class extends Error {} };
  const ops = await load("src/lib/platform/ops-api.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/auth/request": origin, "@/lib/auth/session": session, "@/lib/platform/ops-operating-repository": repositoryErrors,
  });
  const api = await load("src/lib/communications/admin-email-api.ts", {
    "server-only": {}, "@/lib/communications/admin-email-model": model,
    "@/lib/communications/admin-email-ai": await load("src/lib/communications/admin-email-ai.ts"),
    "@/lib/communications/admin-email-repository": f.repository, "@/lib/platform/ops-api": ops,
    "@/lib/platform/ops-operating-repository": repositoryErrors,
  }, { console: { error: (...items) => f.state.logs.push(items) } });
  const route = await load("app/api/ops/emails/resend/banner-upload/route.ts", {
    "@/lib/auth/request": origin, "@/lib/auth/session": session, "@/lib/communications/admin-email-api": api,
    "@/lib/communications/admin-email-image-policy": policy, "@/lib/communications/admin-email-images": f.service,
    "@/lib/communications/admin-email-repository": f.repository,
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: f.state.mode }) }, "@/lib/platform/ops-api": ops,
  });
  const trusted = request => { request.headers.set("Origin", "https://members.example.com"); return request; };
  const blocked = multipart();
  blocked.headers.set("Origin", "https://untrusted.example.com");
  assert.equal((await route.POST(blocked)).status, 403);
  assert.equal(blocked.bodyUsed, false);
  assert.equal(viewerCalls, 0);
  f.state.mode = "preview";
  const preview = trusted(multipart());
  assert.equal((await route.POST(preview)).status, 503);
  assert.equal(preview.bodyUsed, false);
  assert.equal(viewerCalls, 0);
  f.state.mode = "connected";
  const signedOut = trusted(multipart());
  assert.equal((await route.POST(signedOut)).status, 401);
  assert.equal(signedOut.bodyUsed, false);
  viewer = { authUserId: f.guide };
  const member = trusted(multipart());
  assert.equal((await route.POST(member)).status, 403);
  assert.equal(member.bodyUsed, false);
  assert.equal(f.state.clients.length, 0);
  viewer = { authUserId: f.admin };
  const uploaded = await route.POST(trusted(multipart()));
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.headers.get("Cache-Control"), "no-store");
  const body = await uploaded.json();
  assert.match(body.image.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/admin-email-images\//);
  assert.equal(f.state.uploads.length, 1);
  const invalid = await route.POST(trusted(multipart(["not a file"])));
  assert.equal(invalid.status, 400);
  const wrongType = new Request("https://members.example.com/api/ops/emails/resend/banner-upload", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  assert.equal((await route.POST(trusted(wrongType))).status, 415);
  assert.equal(f.state.uploads.length, 1);
  f.state.throwUpload = true;
  const failed = await route.POST(trusted(multipart()));
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /server-only-test-secret|VERY_PRIVATE_SECRET|private-device-name|secret-object-path/);
  assert.equal(f.state.removals.length, 0);
});
