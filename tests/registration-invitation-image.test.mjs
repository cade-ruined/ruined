import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";

const require = createRequire(import.meta.url);
const native = require("@napi-rs/canvas"), printed = [];
const nativeTracked = { ...native, createCanvas(width, height) {
  const canvas = native.createCanvas(width, height), context = canvas.getContext("2d"), fillText = context.fillText.bind(context);
  context.fillText = (text, ...args) => { printed.push(text); return fillText(text, ...args); };
  return canvas;
} };
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", code)(mod, mod.exports, name => {
    if (name === "server-only") return {};
    if (name === "@napi-rs/canvas") return nativeTracked;
    if (name.startsWith("@/")) return load(resolve("src", `${name.slice(2)}.ts`));
    if (name.startsWith(".")) return load(resolve(dirname(file), `${name}.ts`));
    return require(name);
  });
  cache.set(file, mod.exports); return mod.exports;
}
const renderer = load(resolve("src/lib/membership/registration-invitation-image.ts"));
const member = { recipientName: "Alex Rivera", inviterName: "Cade Mangelson", inviterTag: "cade", invitationSource: "member", issuedAt: "2026-09-30T19:00:00.000Z", expiresAt: "2026-10-02T19:00:00.000Z", wearSeed: "recipient-original-member-invitation" };

test("welcome artwork preserves the actual recipient, inviter, deadline and supplied print art", async () => {
  const documentBefore = globalThis.document, windowBefore = globalThis.window, imageBefore = globalThis.Image;
  printed.length = 0;
  const image = await renderer.renderRegistrationInvitationHero(member);
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1200); assert.equal(metadata.height, 1060);
  assert.ok(image.byteLength > 100_000 && image.byteLength < 1_200_000, "private inline image remains email sized");
  assert.match(printed.join(" "), /This is for Alex Rivera\./);
  assert.ok(printed.includes("A personal invitation from"));
  assert.ok(printed.includes("Cade Mangelson @cade"));
  assert.ok(printed.includes("VALID UNTIL OCT. 2 1:00PM MDT"));
  assert.ok(printed.includes("20") && printed.includes("26"));
  assert.equal(globalThis.document, documentBefore); assert.equal(globalThis.window, windowBefore); assert.equal(globalThis.Image, imageBefore);
  const pixel = await sharp(image).extract({ left: 600, top: 1058, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(pixel[0] < 25 && pixel[1] < 25 && pixel[2] < 25, "room fades into the ink email body");
  if (process.env.REGISTRATION_EMAIL_PROOF_DIR) {
    await mkdir(process.env.REGISTRATION_EMAIL_PROOF_DIR, { recursive: true });
    await writeFile(resolve(process.env.REGISTRATION_EMAIL_PROOF_DIR, "invitation-member.jpg"), image);
  }
});

test("direct-invite rendering is deterministic, recipient-specific, and not tied to the send date", async () => {
  const direct = { ...member, invitationSource: "ruined_direct", recipientName: "Cherry Hill", inviterName: "Private operator name", inviterTag: "private_operator", issuedAt: "2025-12-31T22:00:00.000Z", expiresAt: "2026-01-02T22:00:00.000Z" };
  printed.length = 0;
  const first = await renderer.renderRegistrationInvitationHero(direct);
  assert.ok(printed.includes("The Ruined Project"));
  assert.ok(printed.includes("An invitation from"));
  assert.ok(printed.includes("25"));
  assert.ok(printed.includes("This is for Cherry Hill."));
  assert.ok(!printed.some(value => value.includes("Private operator") || value.includes("private_operator")));
  const repeat = await renderer.renderRegistrationInvitationHero(direct);
  assert.deepEqual(first, repeat, "the immutable invitation snapshot always reproduces the same bytes");
  const second = await renderer.renderRegistrationInvitationHero({ ...direct, recipientName: "Taylor Morgan" });
  assert.notDeepEqual(first, second, "one recipient cannot receive another recipient's cached card");
  if (process.env.REGISTRATION_EMAIL_PROOF_DIR) { await mkdir(process.env.REGISTRATION_EMAIL_PROOF_DIR, { recursive: true }); await writeFile(resolve(process.env.REGISTRATION_EMAIL_PROOF_DIR, "invitation-direct.jpg"), first); }
});

test("rendering rejects incomplete invitation snapshots before decoding assets", async () => {
  for (const invalid of [{ ...member, recipientName: "" }, { ...member, expiresAt: "not-a-date" }, { ...member, issuedAt: "" }, { ...member, invitationSource: "untrusted" }, { ...member, wearSeed: "x".repeat(257) }]) {
    await assert.rejects(renderer.renderRegistrationInvitationHero(invalid), /complete issued invitation/);
  }
});


test("non-expiring member keepsakes render without a deadline or synthetic date", async () => {
  printed.length = 0;
  const image = await renderer.renderRegistrationInvitationHero({ ...member, expiresAt: null });
  assert.equal((await sharp(image).metadata()).format, "jpeg");
  assert.match(printed.join(" "), /This is for Alex Rivera\./);
  assert.ok(printed.includes("Cade Mangelson @cade"));
  assert.doesNotMatch(printed.join(" "), /VALID UNTIL|1970|INVALID DATE|NO EXPIRATION/i);
  await assert.rejects(renderer.renderRegistrationInvitationHero({ ...member, invitationSource: "ruined_direct", expiresAt: null }), /complete issued invitation/);
  if (process.env.REGISTRATION_EMAIL_PROOF_DIR) {
    await mkdir(process.env.REGISTRATION_EMAIL_PROOF_DIR, { recursive: true });
    await writeFile(resolve(process.env.REGISTRATION_EMAIL_PROOF_DIR, "invitation-member-no-expiry.jpg"), image);
  }
});
