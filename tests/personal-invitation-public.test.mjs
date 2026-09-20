import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

async function loadPage(read) {
  const source = await readFile(new URL("../app/invitation/[token]/page.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  const dependencies = {
    react: { cache: fn => fn }, "react/jsx-runtime": jsxRuntime,
    "next/navigation": { notFound: () => { throw new Error("Unavailable"); } },
    "@/components/membership/MemberInvitation": { InvitationLanding: () => null },
    "@/lib/membership/invitation-repository": { getPublicMemberInvitation: read },
    "@/lib/membership/invitation-model": { MEMBER_INVITATION_TOKEN: /^[A-Za-z0-9_-]{43}$/ },
    "@/lib/membership/public-card-model": { publicMemberCardIdentity: card => card.name },
  };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("personal invitation page shares the greeting but never recipient email, delivery details or owner counts", async () => {
  const token = "P".repeat(43), card = { name: "Inviter", memberTag: "inviter" };
  const route = await loadPage(async () => ({ card, recipientName: "Taylor <Test>", recipientEmail: "PRIVATE@example.test", complimentaryReason: "PRIVATE NOTE", membershipType: "complimentary", complimentaryEndsAt: null, expiresAt: "2099-01-01T00:00:00Z", deliveryStatus: "PRIVATE DELIVERY", joinedCount: 91023 }));
  const props = { params: Promise.resolve({ token }) };
  const page = await route.default(props);
  assert.deepEqual(page.props, { card, recipientName: "Taylor <Test>", token, expiresAt: "2099-01-01T00:00:00Z", membershipType: "complimentary", complimentaryEndsAt: null });
  assert.doesNotMatch(JSON.stringify(page.props), /PRIVATE|recipientEmail|91023/);
  const metadata = await route.generateMetadata(props);
  assert.doesNotMatch(JSON.stringify(metadata), /Taylor|PRIVATE|recipientEmail|deliveryStatus|91023/,
    "recipient identity must not be retained by messaging-app metadata caches");
  assert.match(metadata.openGraph.videos[0].url, /invitation-spin-v1\.mp4$/);
});

test("withdrawn personal invitations expose neither the greeting nor media", async () => {
  const route = await loadPage(async () => null), props = { params: Promise.resolve({ token: "P".repeat(43) }) };
  await assert.rejects(route.default(props), /Unavailable/);
  const metadata = await route.generateMetadata(props);
  assert.equal(metadata.title, "Invitation unavailable");
  assert.deepEqual(metadata.openGraph.videos, []); assert.deepEqual(metadata.openGraph.images, []);
});
