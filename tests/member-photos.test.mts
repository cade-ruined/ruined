import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function load<T>(path: string, dependencies: Record<string, unknown> = {}): Promise<T> {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => {
    if (name === "server-only") return {};
    if (name in dependencies) return dependencies[name];
    if (["node:crypto", "sharp", "next/server"].includes(name)) return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports as T;
}

const policy = await load<typeof import("../src/lib/membership/photo-policy")>("src/lib/membership/photo-policy.ts");
const access = await load<typeof import("../src/lib/membership/access-policy")>("src/lib/membership/access-policy.ts");
const memberId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const fileName = "33333333-3333-4333-8333-333333333333.webp";
const avatarUrl = policy.memberPhotoUrl(memberId, fileName)!;
const identity = {
  memberId, personId: otherId, authUserId: memberId, email: "member@example.com",
  accountState: "active", administrativeOnboardingState: "in_progress", billingState: "pending",
  cancellationEffectiveAt: null, foundationsState: "not_started", programState: "prospect", standingState: "pre_active",
};

async function photoModule(options: {
  identity?: object | null;
  role?: string | null;
  circle?: object | null;
  currentUrl?: string | null;
  databaseFails?: boolean;
  commitAckLost?: boolean;
  recoveryReadFails?: boolean;
} = {}) {
  const calls: Array<{ name: string; value?: unknown }> = [];
  let current = options.currentUrl === undefined ? avatarUrl : options.currentUrl;
  let transactionFinished = false;
  let transactionCount = 0;
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("pg_advisory_xact_lock")) {
      calls.push({ name: "lock", value: values[0] });
      return [];
    }
    if (query.includes("select")) {
      if (transactionFinished && options.recoveryReadFails) throw new Error("Database outcome unknown");
      return [{ avatar_storage_path: current }];
    }
    calls.push({ name: "persist" });
    if (options.databaseFails) throw new Error("Database write failed");
    current = query.includes("insert into person_profiles") ? values[1] as string : null;
    return [];
  };
  const database = Object.assign(sql, { begin: async (callback: (transaction: typeof sql) => Promise<unknown>) => {
    const transactionNumber = ++transactionCount;
    try {
      const result = await callback(sql);
      calls.push({ name: "commit" });
      if (options.commitAckLost && transactionNumber === 1) throw new Error("Commit acknowledgement lost");
      return result;
    } finally {
      transactionFinished = true;
    }
  } });
  const photos = await load<typeof import("../src/lib/membership/photos")>("src/lib/membership/photos.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => database },
    "@/lib/membership/access-policy": access,
    "@/lib/membership/photo-policy": policy,
    "@/lib/membership/repository": {
      getMemberIdentity: async () => options.identity === undefined ? identity : options.identity,
      getMemberCircle: async () => options.circle ?? null,
    },
    "@/lib/platform/repository": { getOperatorRole: async () => options.role ?? null },
    "@supabase/supabase-js": { createClient: () => ({ storage: { from: (bucket: string) => {
      assert.equal(bucket, "member-portraits");
      return {
        upload: async (path: string, bytes: Buffer, uploadOptions: object) => {
          calls.push({ name: "upload", value: { path, uploadOptions } });
          assert.equal((await sharp(bytes).metadata()).format, "webp");
          return { error: null };
        },
        remove: async (paths: string[]) => { calls.push({ name: "remove", value: paths }); return { error: null }; },
        download: async (path: string) => { calls.push({ name: "download", value: path }); return { data: new Blob(["private"]), error: null }; },
      };
    } } }) },
  });
  return { photos, calls, current: () => current };
}

function uploadRequest(form: FormData): Request {
  return new Request("https://members.example.com/api/my/profile/photo", { method: "POST", body: form });
}

test("photo keys reject traversal, foreign owners, remote addresses, and extra URL components", () => {
  assert.equal(policy.ownedMemberPhotoPath(memberId, avatarUrl), `${memberId}/${fileName}`);
  for (const value of [avatarUrl.replace(memberId, otherId), `${avatarUrl}?x=1`, `${avatarUrl}/more`, `https://evil.example${avatarUrl}`, "//evil.example/photo", `/api/member-photos/${memberId}/../bad.webp`]) {
    assert.equal(policy.ownedMemberPhotoPath(memberId, value), null);
  }
  assert.equal(policy.memberPhotoUrl("../member", fileName), null);
  assert.equal(policy.memberPhotoUrl(memberId, "../../photo.webp"), null);
});

test("photo permission requires the current URL, owner read or admin access, or a visible active Circle photo", () => {
  const input = { requestedUrl: avatarUrl, currentUrl: avatarUrl, ownerCanRead: false, isOpsAdmin: false, circleCanRead: false, activeCircle: false, visibleCircleAvatarUrls: [] as string[] };
  assert.equal(policy.canViewMemberPhoto(input), false);
  assert.equal(policy.canViewMemberPhoto({ ...input, ownerCanRead: true }), true);
  assert.equal(policy.canViewMemberPhoto({ ...input, isOpsAdmin: true }), true);
  const circleInput = { ...input, circleCanRead: true, activeCircle: true, visibleCircleAvatarUrls: [avatarUrl] };
  assert.equal(policy.canViewMemberPhoto(circleInput), true);
  assert.equal(policy.canViewMemberPhoto({ ...circleInput, activeCircle: false }), false);
  assert.equal(policy.canViewMemberPhoto({ ...circleInput, visibleCircleAvatarUrls: [] }), false);
  assert.equal(policy.canViewMemberPhoto({ ...circleInput, circleCanRead: false }), false);
  assert.equal(policy.canViewMemberPhoto({ ...input, isOpsAdmin: true, currentUrl: null }), false);
});

test("multipart accepts one photo and refuses extra fields, fake MIME and oversized files", async () => {
  const form = new FormData();
  form.set("photo", new File(["small"], "test.png", { type: "image/png" }));
  assert.equal((await policy.readMemberPhotoFile(uploadRequest(form))).name, "test.png");
  form.set("memberId", otherId);
  await assert.rejects(policy.readMemberPhotoFile(uploadRequest(form)), { status: 400 });
  assert.throws(() => policy.validateMemberPhotoFile(3, "image/svg+xml"), { status: 415 });
  assert.throws(() => policy.validateMemberPhotoFile(policy.MEMBER_PHOTO_MAX_BYTES + 1, "image/png"), { status: 413 });
  assert.throws(() => policy.validateMemberPhotoFile(0, "image/png"), { status: 400 });
});

test("multipart limits chunked streams even when Content-Length is absent or lying", async () => {
  for (const declaredLength of [null, "1"]) {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(policy.MEMBER_PHOTO_MAX_BODY_BYTES + 1)); },
      cancel() { canceled = true; },
    });
    const headers = new Headers({ "Content-Type": "multipart/form-data; boundary=photo" });
    if (declaredLength) headers.set("Content-Length", declaredLength);
    const request = new Request("https://members.example.com/photo", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit);
    await assert.rejects(policy.readMemberPhotoFile(request), { status: 413 });
    assert.equal(canceled, true);
  }
});

test("actual image processing rotates, resizes and strips EXIF before WebP storage", async () => {
  const { photos } = await photoModule();
  const input = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const output = await photos.normalizeMemberPhoto(new File([input], "portrait.jpg", { type: "image/jpeg" }));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 1600);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.icc, undefined);
});

test("actual image decoder rejects spoofed bytes, mismatched MIME, and decompression-sized input", async () => {
  const { photos } = await photoModule();
  await assert.rejects(photos.normalizeMemberPhoto(new File(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], "bad.png", { type: "image/png" })), { status: 400 });
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(photos.normalizeMemberPhoto(new File([png], "not-jpeg.jpg", { type: "image/jpeg" })), { status: 415 });
  const enormous = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: "white" } }).png().toBuffer();
  assert.ok(enormous.byteLength < policy.MEMBER_PHOTO_MAX_BYTES);
  await assert.rejects(photos.normalizeMemberPhoto(new File([enormous], "too-many-pixels.png", { type: "image/png" })), { status: 400 });
});

test("storage swaps only after an owner-scoped transaction and removes only the superseded object", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-only-not-a-real-key";
  const { photos, calls, current } = await photoModule();
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  const result = await photos.saveMemberPhoto(memberId, new File([bytes], "photo.png", { type: "image/png" }));
  assert.deepEqual(calls.map((call) => call.name), ["upload", "lock", "persist", "commit", "remove"]);
  assert.equal(calls[1].value, memberId);
  assert.deepEqual(calls[4].value, [`${memberId}/${fileName}`]);
  assert.equal(current(), result.avatarUrl);
  assert.ok(policy.ownedMemberPhotoPath(memberId, result.avatarUrl));
});

test("failed persistence cleans the new object without touching the prior photo", async () => {
  const { photos, calls, current } = await photoModule({ databaseFails: true });
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(photos.saveMemberPhoto(memberId, new File([bytes], "photo.png", { type: "image/png" })), /Database write failed/);
  assert.deepEqual(calls.map((call) => call.name), ["upload", "lock", "persist", "lock", "commit", "remove"]);
  assert.equal(current(), avatarUrl);
  assert.notDeepEqual(calls[5].value, [`${memberId}/${fileName}`]);
  assert.equal(calls[1].value, calls[3].value);
});

test("a committed upload survives a lost commit acknowledgement and returns its current URL", async () => {
  const { photos, calls, current } = await photoModule({ commitAckLost: true });
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  const result = await photos.saveMemberPhoto(memberId, new File([bytes], "photo.png", { type: "image/png" }));
  assert.equal(result.avatarUrl, current());
  assert.notEqual(result.avatarUrl, avatarUrl);
  assert.ok(policy.ownedMemberPhotoPath(memberId, result.avatarUrl));
  assert.equal(calls.some((call) => call.name === "remove"), false);
  assert.deepEqual(calls.map((call) => call.name), ["upload", "lock", "persist", "commit", "lock", "commit"]);
  assert.equal(calls[1].value, calls[4].value);
});

test("an unknown commit outcome preserves the private upload rather than deleting potentially committed data", async () => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  for (const options of [
    { databaseFails: true, recoveryReadFails: true },
    { commitAckLost: true, recoveryReadFails: true },
  ]) {
    const { photos, calls, current } = await photoModule(options);
    await assert.rejects(photos.saveMemberPhoto(memberId, new File([bytes], "photo.png", { type: "image/png" })), /Database write failed|Commit acknowledgement lost/);
    assert.equal(calls.some((call) => call.name === "remove"), false);
    if (options.commitAckLost) {
      assert.notEqual(current(), avatarUrl);
      assert.ok(policy.ownedMemberPhotoPath(memberId, current()));
    } else {
      assert.equal(current(), avatarUrl);
    }
  }
});

test("deleting clears the own pointer without ever deleting an arbitrary or another member's object", async () => {
  const foreignUrl = policy.memberPhotoUrl(otherId, fileName)!;
  for (const value of [foreignUrl, "https://example.com/avatar.png"]) {
    const { photos, calls, current } = await photoModule({ currentUrl: value });
    assert.deepEqual(await photos.deleteMemberPhoto(memberId), { avatarUrl: null });
    assert.equal(current(), null);
    assert.equal(calls.some((call) => call.name === "remove"), false);
  }
  const { photos, calls } = await photoModule();
  await photos.deleteMemberPhoto(memberId);
  assert.deepEqual(calls.map((call) => call.name), ["lock", "persist", "commit", "remove"]);
});

test("suspended and revoked accounts cannot upload or delete, while basic unpaid profiles can", async () => {
  for (const value of [null, { ...identity, accountState: "suspended" }]) {
    const { photos, calls } = await photoModule({ identity: value });
    await assert.rejects(photos.deleteMemberPhoto(memberId), { status: 403 });
    await assert.rejects(photos.saveMemberPhoto(memberId, new File(["x"], "x.png", { type: "image/png" })), { status: 403 });
    assert.equal(calls.length, 0);
  }
});

test("private fetch uses actual member capability and current Circle filtering, never URL possession", async () => {
  const fullIdentity = { ...identity, memberId: otherId, billingState: "current", administrativeOnboardingState: "completed", standingState: "active", programState: "active" };
  const visibleCircle = { circle: { status: "active" }, members: [{ avatarUrl }] };
  const cases = [
    { identity, allowed: true },
    { identity: { ...identity, accountState: "suspended" }, allowed: false },
    { identity: null, role: "ops_admin", allowed: true },
    { identity: null, role: "circle_leader", allowed: false },
    { identity: fullIdentity, circle: visibleCircle, allowed: true },
    { identity: fullIdentity, circle: { circle: { status: "active" }, members: [], shaper: { avatarUrl } }, allowed: true },
    { identity: fullIdentity, circle: { circle: { status: "active" }, members: [], shaper: { avatarUrl: null } }, allowed: false },
    { identity: fullIdentity, circle: { circle: { status: "active" }, members: [], shaper: { avatarUrl: policy.memberPhotoUrl(otherId, fileName) } }, allowed: false },
    { identity: fullIdentity, circle: { circle: { status: "archived" }, members: [], shaper: { avatarUrl } }, allowed: false },
    { identity: fullIdentity, circle: { ...visibleCircle, members: [{ avatarUrl: null }] }, allowed: false },
    { identity: fullIdentity, circle: { ...visibleCircle, circle: { status: "archived" } }, allowed: false },
    { identity: { ...fullIdentity, billingState: "pending" }, circle: visibleCircle, allowed: false },
  ];
  for (const fixture of cases) {
    const { photos, calls } = await photoModule(fixture);
    assert.equal(!!await photos.getAuthorizedMemberPhoto(memberId, memberId, fileName), fixture.allowed);
    assert.equal(calls.some((call) => call.name === "download"), fixture.allowed);
  }
  const { photos, calls } = await photoModule({ role: "ops_admin", currentUrl: null });
  assert.equal(await photos.getAuthorizedMemberPhoto(memberId, memberId, fileName), null);
  assert.equal(calls.length, 0);
});

test("photo mutation routes reject foreign origins and anonymous requests before parsing or storage", async () => {
  for (const fixture of [{ trusted: false, signedIn: true, status: 403 }, { trusted: true, signedIn: false, status: 401 }]) {
    const route = await load<typeof import("../app/api/my/profile/photo/route")>("app/api/my/profile/photo/route.ts", {
      "@/lib/auth/request": { isTrustedPlatformOrigin: () => fixture.trusted },
      "@/lib/auth/session": { getCurrentPlatformViewer: async () => fixture.signedIn ? { authUserId: memberId } : null },
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
      "@/lib/membership/photo-policy": policy,
      "@/lib/membership/photos": { saveMemberPhoto: () => assert.fail("storage must not run"), deleteMemberPhoto: () => assert.fail("storage must not run") },
    });
    for (const method of [route.POST, route.DELETE]) {
      const response = await method(new Request("https://members.example.com/photo", { method: "POST" }));
      assert.equal(response.status, fixture.status);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("vary"), "Cookie");
    }
  }
});

test("private photo responses expose bytes only after authorization and never permit shared caching", async () => {
  for (const fixture of [{ signedIn: false, found: true, status: 401 }, { signedIn: true, found: false, status: 404 }, { signedIn: true, found: true, status: 200 }]) {
    let reads = 0;
    const route = await load<typeof import("../app/api/member-photos/[memberId]/[fileName]/route")>("app/api/member-photos/[memberId]/[fileName]/route.ts", {
      "@/lib/auth/session": { getCurrentPlatformViewer: async () => fixture.signedIn ? { authUserId: memberId } : null },
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
      "@/lib/membership/photo-policy": policy,
      "@/lib/membership/photos": { getAuthorizedMemberPhoto: async (actor: string, target: string, file: string) => {
        reads += 1;
        assert.equal(actor, memberId);
        assert.equal(target, memberId);
        assert.equal(file, fileName);
        return fixture.found ? new Blob(["image-bytes"]) : null;
      } },
    });
    const response = await route.GET(new Request(`https://members.example.com${avatarUrl}`), { params: Promise.resolve({ memberId, fileName }) });
    assert.equal(response.status, fixture.status);
    assert.equal(reads, fixture.signedIn ? 1 : 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("location"), null);
    if (fixture.status === 200) {
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.equal(await response.text(), "image-bytes");
    }
  }
});
