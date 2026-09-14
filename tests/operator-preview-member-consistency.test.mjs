import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Preview tests must not load a live dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
const preview = load("src/lib/platform/ops-preview.ts");
const { PREVIEW_OPERATOR_DASHBOARD: dashboard } = load("src/lib/platform/model.ts");

test("the invited unassigned sample does not inflate the ready-for-Circle overview count", () => {
  const eligible = dashboard.members.filter((member) => !member.circleName && member.accountState === "active" && member.billingState === "active" && member.programState === "active");
  assert.equal(eligible.length, 0);
  assert.equal(preview.PREVIEW_OPS_OVERVIEW.counts.eligibleWithoutCircle, eligible.length);
});

test("all four operator samples retain the directory identity, states and current Circle throughout their record", () => {
  for (const member of dashboard.members) {
    const record = preview.getPreviewOpsMemberRecord(member.memberId);
    const profile = preview.getPreviewOpsMemberProfileSupport(member.memberId);
    assert.equal(record.header.memberId, member.memberId);
    assert.equal(record.header.primaryEmail, member.email);
    assert.equal(record.membership.contact.email, member.email);
    for (const name of [record.header.preferredName, record.membership.contact.preferredName, profile.preferredName, profile.displayName]) assert.equal(name, member.name);
    assert.equal(record.membership.contact.legalName, profile.legalName);
    assert.equal(record.membership.contact.phone, profile.mobile);
    for (const key of ["account", "billing", "foundations", "artifact"]) assert.equal(record.header.states[key], member[`${key}State`]);
    assert.equal(record.journey.foundations.progressPercent, member.foundationsProgress);
    assert.equal(record.journey.foundations.state, member.foundationsState);
    const stages = record.journey.foundations.stages;
    assert.equal(stages.reduce((sum, stage) => sum + stage.completed, 0) / stages.reduce((sum, stage) => sum + stage.total, 0) * 100, member.foundationsProgress);
    assert.equal(record.header.circleName, member.circleName);
    assert.equal(record.community.circle?.name ?? null, member.circleName);
    assert.equal(record.community.circle?.state ?? null, member.circleStatus);
    assert.equal(record.community.block?.name ?? null, member.blockName);
    assert.equal(record.community.block?.state ?? null, member.blockStatus);
    if (record.community.circle) {
      const expectedMembers = dashboard.members.filter((item) => item.circleName === member.circleName).map((item) => item.memberId).sort();
      assert.deepEqual(record.community.circle.members.map((item) => item.memberId).sort(), expectedMembers);
      assert.ok(record.community.circle.members.some((item) => item.memberId === member.memberId));
    }
    assert.equal(record.header.openWorkCount, record.operational.tasks.filter((task) => task.state === "open").length);
  }
});

test("the invited sample has no invented verification, profile, acceptance, payment or Circle history", () => {
  const record = preview.getPreviewOpsMemberRecord("preview-03");
  const profile = preview.getPreviewOpsMemberProfileSupport("preview-03");
  assert.equal(record.header.states.administrativeOnboarding, "not_started");
  assert.equal(record.membership.onboarding.state, "not_started");
  assert.equal(record.membership.onboarding.completedAt, null);
  assert.deepEqual(record.membership.onboarding.requirements.map((item) => item.key), ["verified_email", "private_profile", "agreement", "billing"]);
  for (const requirement of record.membership.onboarding.requirements) {
    assert.equal(requirement.required, true);
    assert.equal(requirement.state, "missing");
    assert.equal(requirement.completedAt, null);
  }
  assert.equal(record.membership.agreement.acceptedAt, null);
  assert.equal(record.membership.agreement.receiptId, null);
  assert.equal(record.membership.billing, null);
  assert.equal(record.community.circle, null);
  assert.equal(record.community.block, null);
  assert.deepEqual(record.journey.artifacts, []);
  assert.deepEqual(record.journey.experiences, []);
  assert.deepEqual(record.operational.notes, []);
  assert.equal(record.operational.history.length, 1);
  assert.equal(record.operational.history[0].source, "invitation");
  assert.match(record.operational.history[0].summary, /Waiting for the member to sign in/);
  assert.equal(record.operational.tasks[0].title, "Share sign-in instructions");
  for (const key of ["legalName", "mobile", "address", "bio", "buildingNow", "accessibilityNotes", "location", "timezone", "apparelTopSize", "avatarStoragePath"]) assert.equal(profile[key], null, key);
  assert.equal(profile.directoryStatus, "hidden");
  assert.equal(profile.version, "none|none");
});

test("preview member Circle identities and resource links resolve to the canonical Circle workspace", () => {
  for (const member of dashboard.members) {
    const record = preview.getPreviewOpsMemberRecord(member.memberId);
    if (!member.circleName) {
      assert.equal(record.community.circle, null);
      assert.deepEqual(record.community.resources, []);
      continue;
    }
    const circle = preview.PREVIEW_OPS_CIRCLES.find((item) => item.name === member.circleName);
    assert.ok(circle, `${member.name} must point to an existing preview Circle`);
    assert.equal(record.community.circle.circleId, circle.id);
    assert.equal(record.community.circle.name, circle.name);
    for (const resource of record.community.resources) {
      assert.equal(resource.url, `/ops/circles#circle-${circle.id}`);
    }
    assert.doesNotMatch(JSON.stringify(record.community), /preview-circle-0[12]/);
  }
});

test("completed joining evidence, payment attention and historical Circle transfer stay coherent", () => {
  for (const memberId of ["preview-01", "preview-02", "preview-04"]) {
    const record = preview.getPreviewOpsMemberRecord(memberId);
    for (const requirement of record.membership.onboarding.requirements) {
      assert.equal(requirement.state, "complete");
      assert.ok(Date.parse(requirement.completedAt) <= Date.parse(record.membership.onboarding.completedAt));
    }
    assert.equal(record.membership.onboarding.requirements.find((item) => item.key === "agreement").completedAt, record.membership.agreement.acceptedAt);
  }
  const attention = preview.getPreviewOpsMemberRecord("preview-02");
  assert.equal(attention.membership.billing.latestInvoiceState, "open");
  assert.equal(attention.membership.billing.latestInvoiceAmountPaid, 0);
  assert.deepEqual(attention.journey.artifacts, []);
  const completed = preview.getPreviewOpsMemberRecord("preview-04");
  assert.equal(completed.community.circle.name, "Circle 02");
  assert.match(completed.operational.history.at(-1).summary, /Moved to Circle 02/);
  assert.ok(Date.parse(completed.journey.foundations.completedAt) < Date.parse(completed.operational.history.at(-1).occurredAt));
});

test("unknown preview IDs never silently manufacture another member's record or profile", () => {
  for (const id of ["preview-05", "preview-99", "member-03", "PREVIEW-03", "preview-03-extra"]) {
    assert.throws(() => preview.getPreviewOpsMemberRecord(id), /Unknown preview member/);
    assert.throws(() => preview.getPreviewOpsMemberProfileSupport(id), /Unknown preview member/);
  }
});

function routeHarness(context) {
  const calls = [];
  const Page = load("app/ops/members/[memberId]/page.tsx", {
    "next/navigation": { notFound: () => { throw new Error("not_found"); }, redirect: () => { throw new Error("redirect"); } },
    "@/components/platform/OperatorMemberRecord": { __esModule: true, default: "operator-member-record" },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: "platform-unavailable" },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => context },
    "@/lib/platform/ops-operating-repository": { getOpsMemberOperatingRecord: async () => { throw new Error("Unexpected live record lookup"); } },
    "@/lib/platform/ops-profile-repository": { getOpsMemberProfileSupport: async () => { throw new Error("Unexpected live profile lookup"); } },
    "@/lib/platform/ops-preview": {
      getPreviewOpsMemberRecord: (id) => { calls.push(["record", id]); return preview.getPreviewOpsMemberRecord(id); },
      getPreviewOpsMemberProfileSupport: (id) => { calls.push(["profile", id]); return preview.getPreviewOpsMemberProfileSupport(id); },
    },
  }).default;
  return { Page, calls };
}

test("the preview route presents the selected sample and rejects unknown IDs before creating any fixture", async () => {
  const { Page, calls } = routeHarness({ state: "preview", dashboard, role: "ops_admin" });
  const rendered = await Page({ params: Promise.resolve({ memberId: "preview-03" }) });
  assert.equal(rendered.type, "operator-member-record");
  assert.equal(rendered.props.preview, true);
  assert.equal(rendered.props.record.header.primaryEmail, "member03@ruined.local");
  assert.equal(rendered.props.profileSupport.preferredName, "Member 03");
  assert.equal(rendered.props.profileSupport.legalName, null);
  assert.deepEqual(calls, [["profile", "preview-03"], ["record", "preview-03"]]);
  calls.length = 0;
  await assert.rejects(Page({ params: Promise.resolve({ memberId: "preview-99" }) }), /not_found/);
  assert.deepEqual(calls, []);
});

test("preview identity safeguards do not bypass signed-out or denied route checks", async () => {
  const signedOut = routeHarness({ state: "signed_out", dashboard });
  await assert.rejects(signedOut.Page({ params: Promise.resolve({ memberId: "preview-03" }) }), /redirect/);
  assert.deepEqual(signedOut.calls, []);
  const denied = routeHarness({ state: "denied", dashboard });
  const rendered = await denied.Page({ params: Promise.resolve({ memberId: "preview-03" }) });
  assert.equal(rendered.type, "platform-unavailable");
  assert.deepEqual(denied.calls, []);
});
