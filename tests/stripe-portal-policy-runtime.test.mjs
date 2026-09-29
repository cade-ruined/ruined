import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

async function load(path, dependencies = {}, env = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", output)(name => {
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { env });
  return loaded.exports;
}

const policy = await load("src/lib/stripe/portal-policy.ts");
function configuration() {
  return { id: "bpc_reviewed", active: true, livemode: false, features: {
    invoice_history: { enabled: true }, payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
    subscription_update: { enabled: false },
  } };
}

test("only the explicit matching-mode portal with the approved cancellation policy is accepted", () => {
  assert.equal(policy.matchesMembershipPortalPolicy(configuration(), "bpc_reviewed", false), true);
  for (const mutation of [
    c => c.id = "bpc_default", c => c.active = false, c => c.livemode = true,
    c => c.features.invoice_history.enabled = false, c => c.features.payment_method_update.enabled = false,
    c => c.features.subscription_cancel.enabled = false, c => c.features.subscription_cancel.mode = "immediately",
    c => c.features.subscription_cancel.proration_behavior = "create_prorations", c => c.features.subscription_update.enabled = true,
  ]) {
    const changed = configuration(); mutation(changed);
    assert.equal(policy.matchesMembershipPortalPolicy(changed, "bpc_reviewed", false), false, String(mutation));
  }
});

test("authenticated portal sessions pin reviewed configuration and fail before creation on policy drift", async () => {
  for (const scenario of ["valid", "missing", "wrong_mode", "immediate_cancel", "untrusted_return", "no_customer"]) {
    const calls = [];
    const config = configuration();
    if (scenario === "wrong_mode") config.livemode = true;
    if (scenario === "immediate_cancel") config.features.subscription_cancel.mode = "immediately";
    const portal = await load("src/lib/stripe/portal.ts", {
      "@/lib/stripe/portal-policy": policy,
      "@/lib/stripe/commitment-account": { getMemberBillingCommitment: async () => null },
      "@/lib/stripe/billing-repository": { findBillingMemberById: async id => {
        assert.equal(id, "member_verified"); return scenario === "no_customer" ? null : { stripeCustomerId: "cus_verified" };
      } },
      "@/lib/stripe/server": { getStripeLivemode: () => false, getStripe: () => ({ subscriptions: { list: () => ({ async *[Symbol.asyncIterator]() { yield* []; } }) }, billingPortal: {
        configurations: { retrieve: async id => { assert.equal(id, "bpc_reviewed"); return config; } },
        sessions: { create: async value => { calls.push(value); return { url: "https://billing.stripe.com/p/session/test" }; } },
      } }) },
    }, { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://members.example.test", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: scenario === "missing" ? "" : "bpc_reviewed" });
    const create = () => portal.createBillingPortalSessionForMember({ memberId: "member_verified", returnUrl: scenario === "untrusted_return" ? "https://other.example.test/my/account" : "https://members.example.test/my/account" });
    if (scenario === "valid") {
      assert.equal(await create(), "https://billing.stripe.com/p/session/test");
      assert.deepEqual(calls, [{ configuration: "bpc_reviewed", customer: "cus_verified", return_url: "https://members.example.test/my/account" }]);
    } else { await assert.rejects(create); assert.equal(calls.length, 0, scenario); }
  }
});

test("public terms select only the requested effective published membership version and expose no member data", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create table membership_agreement_versions (agreement_key text, version integer, title text, body_text text, status text, effective_at timestamptz, internal_note text, published_at timestamptz default now());
    insert into membership_agreement_versions(agreement_key,version,title,body_text,status,effective_at,internal_note) values
    ('ruined_membership',1,'Pilot','Pilot body','published',null,'private'),
    ('ruined_membership',2,'Paid','Exact published text','published',now()-interval '1 day','private'),
    ('ruined_membership',3,'Draft','Secret draft','draft',null,'private'),
    ('ruined_membership',4,'Future','Future text','published',now()+interval '1 day','private'),
    ('store',5,'Store','Store text','published',null,'private');`);
  const sql = async (strings, ...values) => (await db.query(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), values)).rows;
  const published = await load("src/lib/membership/published-agreement.ts", { "@/lib/database/server": { getApplicationDatabase: () => sql } }, { DATABASE_URL: "offline" });
  assert.deepEqual(await published.getPublishedMembershipAgreement("ruined_membership-v2"), { title: "Paid", body: "Exact published text", version: 2 });
  for (const version of ["ruined_membership-v3", "ruined_membership-v4", "ruined_membership-v5", "ruined_membership-v99", "store-v5", "ruined_membership-v02", "2 or 1=1"])
    assert.equal(await published.getPublishedMembershipAgreement(version), null, version);
  await db.exec("update membership_agreement_versions set status='retired' where version=2; update membership_agreement_versions set status='published' where version=3;");
  assert.equal(await published.getPublishedMembershipAgreement("ruined_membership-v2"), null, "retired terms cannot start new Checkout");
  assert.deepEqual(await published.getPublicMembershipAgreement("ruined_membership-v2"), { title: "Paid", body: "Exact published text", version: 2 });
  assert.equal((await published.getPublishedMembershipAgreement("ruined_membership-v3")).version, 3);
  await db.exec("update membership_agreement_versions set status='retired', published_at=null where version=1;");
  assert.equal(await published.getPublicMembershipAgreement("ruined_membership-v1"), null, "retired status alone cannot expose an unpublished draft");
  assert.equal(await published.getPublicMembershipAgreement("ruined_membership-v4"), null, "future terms stay private");
});

test("account distinguishes a scheduled cancellation from a renewal, ended billing and complimentary access", async () => {
  const Link = ({ children, href, ...props }) => jsxRuntime.jsx("a", { href, ...props, children });
  const MemberAccount = (await load("src/components/membership/MemberAccount.tsx", {
    "next/link": Link,
    "@/components/membership/MemberSettingsHeader": () => null,
    "@/components/membership/MembershipCancellation": () => null,
    "@/components/support/supportStyles": { SUPPORT_ACTION_CLASS: "", SUPPORT_LINK_CLASS: "" },
  })).default;
  const account = { access: { mode: "full" }, standingState: "active", email: "member@example.test", billingState: "active", agreement: {}, subscription: { status: "active", currentPeriodEnd: "2026-10-28T12:00:00.000Z", cancelAtPeriodEnd: false, cancelAt: null } };
  const render = changes => renderToStaticMarkup(jsxRuntime.jsx(MemberAccount, { account: { ...account, ...changes }, billingConnected: true }));
  assert.match(render({}), /Next billing date:/);
  const canceled = render({ subscription: { ...account.subscription, cancelAtPeriodEnd: true } });
  assert.match(canceled, /Renewal canceled/); assert.match(canceled, /It will not renew/); assert.doesNotMatch(canceled, /Next billing date:/);
  assert.match(canceled, /October 28, 2026/); assert.match(canceled, /reviewed individually/);
  assert.doesNotMatch(render({ subscription: { ...account.subscription, status: "canceled" }, billingState: "ended" }), /Next billing date:|Your subscription is scheduled to end/);
  assert.doesNotMatch(render({ membershipFunding: "complimentary", subscription: null, billingState: "pending" }), /Cancel before renewal|Next billing date:/);
  const flexible = render({ subscription: { ...account.subscription, cancelAt: "2026-10-15T16:30:00.000Z" } });
  assert.match(flexible, /Renewal canceled/); assert.match(flexible, /October 15, 2026/); assert.match(flexible, /4:30 PM UTC/);
  assert.doesNotMatch(flexible, /Next billing date:|October 28, 2026/);
  const later = render({ subscription: { ...account.subscription, cancelAt: "2026-11-28T12:00:00.000Z" } });
  assert.match(later, /Cancellation scheduled/); assert.match(later, /November 28, 2026/); assert.match(later, /Next billing date:/); assert.match(later, /October 28, 2026/);
  assert.doesNotMatch(later, /It will not renew/);
  for (const mode of ["limited", "suspended"]) {
    const restricted = render({ access: { mode, reason: "Access is restricted." }, subscription: { ...account.subscription, cancelAt: account.subscription.currentPeriodEnd } });
    assert.match(restricted, /Access is restricted/); assert.match(restricted, /Renewal canceled/);
    assert.doesNotMatch(restricted, /Paid access continues|access continues through/);
  }
});


test("paid v2 subscriptions use the commitment portal before their invoice webhook creates a contract", async () => {
  for (const scenario of ["pending_contract", "legacy", "provider_failure", "wrong_member"]) {
    const calls = [], retrieved = [], config = configuration();
    const subscription = { id: "sub_pending", customer: "cus_verified", livemode: false, status: "active", metadata: {
      billing_terms_version: scenario === "legacy" ? "membership-billing-v1" : "membership-billing-v2",
      ruined_member_id: scenario === "wrong_member" ? "member_other" : "member_verified",
    } };
    const stripe = {
      subscriptions: { list: params => {
        assert.equal(params.customer, "cus_verified");
        return { async *[Symbol.asyncIterator]() { if (scenario === "provider_failure") throw Error("Provider unavailable"); yield subscription; } };
      } },
      billingPortal: {
        configurations: { retrieve: async id => {
          retrieved.push(id);
          return id === "bpc_commitment" ? { ...config, id, features: { ...config.features, subscription_cancel: { enabled: false } } } : config;
        } },
        sessions: { create: async input => { calls.push(input); return { url: "https://billing.stripe.com/p/session/test" }; } },
      },
    };
    const portal = await load("src/lib/stripe/portal.ts", {
      "@/lib/stripe/portal-policy": policy, "@/lib/stripe/commitment-account": { getMemberBillingCommitment: async () => null },
      "@/lib/stripe/billing-repository": { findBillingMemberById: async () => ({ stripeCustomerId: "cus_verified" }) },
      "@/lib/stripe/server": { getStripe: () => stripe, getStripeLivemode: () => false },
    }, { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://members.example.test", STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_reviewed", STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID: "bpc_commitment" });
    const create = () => portal.createBillingPortalSessionForMember({ memberId: "member_verified", returnUrl: "https://members.example.test/my/account" });
    if (["provider_failure", "wrong_member"].includes(scenario)) {
      await assert.rejects(create); assert.equal(calls.length, 0);
    } else {
      await create(); assert.equal(calls[0].configuration, scenario === "legacy" ? "bpc_reviewed" : "bpc_commitment");
      assert.deepEqual(retrieved, [calls[0].configuration]);
    }
  }
});
