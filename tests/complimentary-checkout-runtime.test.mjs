import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const output = ts.transpileModule(await readFile(new URL("../app/api/stripe/checkout/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const uuid = "11111111-1111-4111-8111-111111111111";

for (const funding of ["operator", "complimentary", "self"]) test(`checkout checks current ${funding} funding before creating any provider session`, async () => {
  let providerCalls = 0;
  let configurationReads = 0;
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: uuid }) },
    "@/lib/membership/repository": { getMemberIdentity: async () => ({ membershipFunding: funding }) },
    "@/lib/platform/config": { getPlatformConfiguration: () => { configurationReads++; return { stripeCheckoutReady: false }; } },
    "@/lib/platform/repository": { PlatformAccessDeniedError: class extends Error {} },
    "@/lib/stripe/billing-repository": { MembershipCheckoutConflictError: class extends Error {} },
    "@/lib/stripe/membership-state": { isUuid: value => value === uuid },
    "@/lib/stripe/server": { isTrustedCheckoutOrigin: () => true, getStripe: () => { providerCalls++; throw Error("Live provider call prohibited"); } },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  const response = await loaded.exports.POST(new Request("https://members.example.test/api/stripe/checkout", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceptanceId: uuid, attemptId: uuid }),
  }));
  assert.equal(response.status, funding === "self" ? 503 : 409);
  assert.equal(configurationReads, funding === "self" ? 1 : 0);
  assert.equal(providerCalls, 0);
  if (funding !== "self") assert.match((await response.json()).error, /complimentary/);
});
