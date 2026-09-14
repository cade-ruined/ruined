import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    throw new Error(`Guidance must remain presentation-only: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
const helper = load("src/lib/platform/operator-member-guidance.ts");
const { guidanceForMemberSummary, guidanceForMemberRecord, memberGuidanceAction } = helper;
const preview = load("src/lib/platform/ops-preview.ts");
const guidanceDeps = { "@/lib/platform/operator-member-guidance": helper };
const Setup = load("src/components/platform/OperatorMemberSetup.tsx", guidanceDeps).default;
const empty = { __esModule: true, default: () => null };
const stateLabel = { __esModule: true, default: ({ state }) => React.createElement("span", null, state) };
const Directory = load("src/components/platform/OperatorMemberDirectory.tsx", {
  ...guidanceDeps,
  "@/components/platform/OperatorProgress": empty,
  "@/components/platform/StateLabel": stateLabel,
  "@/components/platform/operatorStyles": {},
}).default;
const Record = load("src/components/platform/OperatorMemberRecord.tsx", {
  "@/lib/platform/operator-return-location": load("src/lib/platform/operator-return-location.ts"),
  ...guidanceDeps,
  "@/components/platform/OperatorMemberSetup": { __esModule: true, default: Setup },
  "@/components/platform/OperatorPageFrame": { __esModule: true, default: ({ children }) => React.createElement("main", null, children) },
  "@/components/platform/OperatorMemberActions": { OperatorNoteAction: () => null, OperatorTaskCreateAction: () => null, OperatorOverrideAction: () => null },
  "@/components/platform/OperatorProfileSupport": empty,
  "@/components/platform/OperatorProgress": empty,
  "@/components/platform/StateLabel": stateLabel,
}).default;

const summary = (patch = {}) => ({ memberId: "member-one", name: "Example Member", email: "example@ruined.test",
  accountState: "active", billingState: "active", programState: "active", membershipState: "active",
  foundationsState: "in_progress", foundationsProgress: 50, artifactState: "not_started",
  circleName: "Circle 01", circleStatus: "active", blockName: null, blockStatus: null,
  nextAction: "FAKE SERVER COPY MUST NOT DRIVE GUIDANCE", ...patch });
function record({ states = {}, circle, requirements, roles, capabilities, latestInvoiceState = null } = {}) {
  const value = structuredClone(preview.getPreviewOpsMemberRecord("preview-01"));
  Object.assign(value.header.states, states);
  if (circle !== undefined) {
    value.community.circle = circle;
    value.header.circleName = circle?.name ?? null;
  }
  if (requirements) value.membership.onboarding.requirements = requirements;
  value.membership.billing = { ...value.membership.billing, latestInvoiceState };
  if (roles) value.access.roles = roles;
  if (capabilities) value.access.capabilities = capabilities;
  return value;
}
const required = (key, state = "missing") => ({ key, state, required: true, completedAt: null, label: key });
const circle = (state = "forming") => ({ circleId: "circle-one", name: "Circle 01", state, members: [], guides: [], shaperName: null });
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)].filter((item) => item.tagName);
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const render = (Component, props) => parseFragment(renderToStaticMarkup(React.createElement(Component, props)));
const nextPanel = (tree) => nodes(tree).find((node) => attr(node, "aria-label") === "Next member step");

test("an absent billing record is not described as a permission problem for an authorized operator", () => {
  const member = record();
  member.membership.billing = null;
  assert.match(text(render(Record, { record: member })), /No billing record yet/);
  const restricted = { ...member, access: { ...member.access, roles: ["guide"], capabilities: [] } };
  const markup = text(render(Record, { record: restricted }));
  assert.match(markup, /Financial detail is restricted for this operator role/);
  assert.doesNotMatch(markup, /No billing record yet/);
});

test("suspended and closed accounts take precedence over billing, joining and saved Circles", () => {
  for (const account of ["suspended", "closed"]) {
    const next = guidanceForMemberRecord(record({ states: { account, billing: "pending", administrativeOnboarding: "in_progress" }, circle: circle() }));
    assert.equal(next.key, account);
    assert.equal(next.actor, "Support");
    assert.equal(next.status, "Blocked");
    assert.equal(next.placement, "blocked");
    assert.equal(memberGuidanceAction(next, "member-one", true).href, "#membership");
    assert.equal(guidanceForMemberSummary(summary({ accountState: account, billingState: "pending" })).key, account);
  }
});

test("paused, ended, withdrawn and unknown states never advertise Circle readiness", () => {
  for (const states of [{ standing: "paused" }, { standing: "inactive" }, { billing: "ended" }, { admission: "declined" }, { admission: "withdrawn" }, { account: "new_future_state" }]) {
    const next = guidanceForMemberRecord(record({ states, circle: null }));
    assert.equal(next.actor, "Support");
    assert.equal(next.status, "Blocked");
    assert.equal(next.placement, "blocked");
  }
  for (const programState of ["paused", "withdrawn", "unknown", "prospect"]) {
    assert.equal(guidanceForMemberSummary(summary({ programState, circleName: null, circleStatus: null })).placement, "blocked");
  }
  assert.equal(guidanceForMemberSummary(summary({ membershipState: "pending", circleName: null, circleStatus: null })).key, "setup-review");
});

test("sign-in and each joining requirement belong to the member, not an operator", () => {
  assert.equal(guidanceForMemberRecord(record({ states: { account: "invited" } })).key, "sign-in");
  assert.equal(guidanceForMemberSummary(summary({ accountState: "provisional", billingState: "pending" })).actor, "Member");
  for (const [key, expected] of [["verified_email", /verifies their email/], ["private_profile", /completes their profile/], ["agreement", /accepts the agreement themselves/], ["billing", /completes payment/]]) {
    const next = guidanceForMemberRecord(record({ states: { administrativeOnboarding: "in_progress", billing: "pending", standing: "pre_active" }, requirements: [required(key)] }));
    assert.equal(next.key, "joining");
    assert.equal(next.actor, "Member");
    assert.equal(next.status, "Waiting");
    assert.match(next.detail, expected);
    assert.match(next.detail, /cannot accept the agreement or pay/);
    assert.match(memberGuidanceAction(next, "member-one", true).label, /^Review/);
  }
});

test("payment attention is member-owned; already-recorded confirmation goes to Support without a second payment", () => {
  const attention = guidanceForMemberRecord(record({ states: { billing: "attention_required" } }));
  assert.equal(attention.actor, "Member");
  assert.equal(attention.key, "payment-attention");
  for (const value of [
    record({ states: { billing: "pending" } }),
    record({ states: { billing: "pending", administrativeOnboarding: "in_progress" }, requirements: [required("billing", "complete")] }),
  ]) {
    const next = guidanceForMemberRecord(value);
    assert.equal(next.key, "payment-confirmation");
    assert.equal(next.actor, "Support");
    assert.match(next.detail, /do not ask the member to pay again/);
  }
  const joining = guidanceForMemberRecord(record({ states: { administrativeOnboarding: "in_progress" }, requirements: [required("agreement", "complete"), required("billing", "complete")] }));
  assert.equal(joining.key, "joining-confirmation");
  assert.equal(joining.actor, "Support");
});

test("active billing with a missing payment checkpoint asks Support to reconcile, not the member to pay again", () => {
  for (const administrativeOnboarding of ["in_progress", "completed"]) {
    const value = record({ circle: null, states: { billing: "active", administrativeOnboarding, standing: "pre_active" },
      requirements: [required("verified_email", "complete"), required("private_profile", "complete"), required("agreement", "complete"), required("billing")] });
    const next = guidanceForMemberRecord(value);
    assert.equal(next.key, "payment-confirmation");
    assert.equal(next.actor, "Support");
    assert.equal(next.status, "Waiting");
    assert.equal(next.placement, "blocked");
    assert.match(next.detail, /do not ask the member to pay again/);
    assert.doesNotMatch(next.detail, /member completes payment/);
    const tree = render(Record, { record: value });
    assert.match(text(nextPanel(tree)), /Waiting · SupportCheck payment confirmation/);
    assert.deepEqual(nodes(nextPanel(tree)).filter((node) => node.tagName === "a").map((node) => attr(node, "href")), ["#membership"]);
    assert.equal(nodes(tree).some((node) => attr(node, "href")?.includes("#assign-member")), false);
  }
});

test("a latest paid invoice with pending billing is confirmation evidence even when the joining payment checkpoint is missing", () => {
  const value = record({ states: { billing: "pending", administrativeOnboarding: "in_progress", standing: "pre_active" },
    latestInvoiceState: "paid", requirements: [required("billing")] });
  const next = guidanceForMemberRecord(value);
  assert.equal(next.key, "payment-confirmation");
  assert.equal(next.actor, "Support");
  assert.match(next.detail, /do not ask the member to pay again/);
  assert.doesNotMatch(next.detail, /member completes payment/);
  assert.equal(next.placement, "blocked");
});

test("a completed joining payment checkpoint does not dismiss a later recurring-payment problem", () => {
  for (const latestInvoiceState of [null, "open", "uncollectible", "draft"]) {
    const next = guidanceForMemberRecord(record({ states: { billing: "attention_required" }, latestInvoiceState,
      requirements: [required("billing", "complete")] }));
    assert.equal(next.key, "payment-attention");
    assert.equal(next.actor, "Member");
    assert.equal(next.placement, "blocked");
  }
  const conflict = guidanceForMemberRecord(record({ states: { billing: "attention_required" }, latestInvoiceState: "paid" }));
  assert.equal(conflict.key, "payment-confirmation");
  assert.equal(conflict.actor, "Support");
});

test("paid joining still directs genuinely missing non-payment work to the member without asking them to pay again", () => {
  for (const [key, phrase] of [["verified_email", /verifies their email/], ["private_profile", /completes their profile/], ["agreement", /accepts the agreement themselves/]]) {
    const next = guidanceForMemberRecord(record({ states: { billing: "active", administrativeOnboarding: "in_progress" },
      latestInvoiceState: "paid", requirements: [required(key), required("billing")] }));
    assert.equal(next.key, "joining");
    assert.equal(next.actor, "Member");
    assert.match(next.detail, phrase);
    assert.doesNotMatch(next.detail, /member completes payment|profile, agreement, and payment steps/);
  }
  const partial = guidanceForMemberRecord(record({ states: { billing: "active", administrativeOnboarding: "in_progress" }, requirements: [] }));
  assert.match(partial.detail, /Payment is already recorded/);
  assert.doesNotMatch(partial.detail, /profile, agreement, and payment steps/);
});

test("known eligible directory entries are ready for review; partial detail projection never invents program eligibility", () => {
  const next = guidanceForMemberSummary(summary({ circleName: null, circleStatus: null, programState: "onboarding" }));
  assert.equal(next.key, "circle-placement");
  assert.equal(next.actor, "Operator");
  assert.equal(next.status, "Ready");
  assert.equal(next.placement, "ready");
  const detail = guidanceForMemberRecord(record({ circle: null }));
  assert.equal(detail.title, next.title);
  assert.equal(detail.placement, "review");
  assert.equal(detail.status, "Waiting");
  assert.match(detail.detail, /checks membership access, completed entry, program, and capacity/);
});

test("directory rows missing membership or program state request review instead of advertising guaranteed readiness", () => {
  for (const patch of [{ membershipState: undefined }, { programState: undefined }, { membershipState: undefined, programState: "completed" }]) {
    for (const circleName of [null, "Circle 01"]) {
      const next = guidanceForMemberSummary(summary({ ...patch, circleName, foundationsState: "completed", artifactState: "fulfilled" }));
      assert.equal(next.key, "readiness-review");
      assert.equal(next.status, "Waiting");
      assert.equal(next.placement, "review");
      assert.equal(next.actor, "Operator");
      assert.equal(memberGuidanceAction(next, "member-one", true).href, "#membership");
    }
  }
});

test("forming Circle is saved placement, requires Administrator activation, and never claims Foundations completion", () => {
  const next = guidanceForMemberRecord(record({ circle: circle() }));
  assert.equal(next.key, "circle-activation");
  assert.equal(next.placement, "assigned");
  assert.equal(next.actor, "Operator");
  assert.match(next.detail, /active Circle is required to finish Foundations/);
  assert.equal(memberGuidanceAction(next, "member-one", true).href, "/ops/circles?memberId=member-one#activate-circle");
  assert.deepEqual(memberGuidanceAction(next, "member-one", false), { href: "#community", label: "View Circle placement" });
  assert.equal(guidanceForMemberSummary(summary({ circleStatus: "forming" })).key, next.key);
});

test("active Circle moves the member to Foundations; completed work and alumni do not restart joining", () => {
  assert.equal(guidanceForMemberRecord(record()).key, "foundations");
  assert.equal(guidanceForMemberSummary(summary()).actor, "Member");
  for (const [artifact, key] of [["collecting", "artifact-inputs"], ["in_production", "artifact-production"], ["fulfilled", "ready"]]) {
    assert.equal(guidanceForMemberRecord(record({ states: { foundations: "completed", artifact } })).key, key);
  }
  assert.equal(guidanceForMemberRecord(record({ states: { standing: "alumni" }, circle: null })).key, "ongoing-review");
  const cancellation = guidanceForMemberRecord(record({ states: { standing: "cancellation_requested" } }));
  assert.equal(cancellation.key, "cancellation");
  assert.match(cancellation.detail, /does not by itself mean access has already ended/);
});

test("alumni setup points to participation history, not joining, activation, or a new Circle assignment", () => {
  for (const currentCircle of [null, circle("forming"), circle("active")]) {
    const value = record({ states: { standing: "alumni", foundations: "completed" }, circle: currentCircle });
    const next = guidanceForMemberRecord(value);
    assert.equal(next.key, "ongoing-review");
    assert.equal(next.placement, "blocked", "presentation cannot make alumni eligible for placement");
    for (const canManageSetup of [true, false]) {
      assert.deepEqual(memberGuidanceAction(next, "member-one", canManageSetup), { href: "#journey", label: "Review ongoing participation" });
    }
    const tree = render(Setup, { record: value });
    assert.match(text(tree), /Joining is no longer the next step/);
    assert.doesNotMatch(text(tree), /Review joining and billing|Review joining & billing|activate when ready|Review Circle activation/);
    const hrefs = nodes(tree).filter((node) => node.tagName === "a").map((node) => attr(node, "href"));
    assert.deepEqual(hrefs, ["#journey", "/ops/operators?memberId=preview-01"]);
    assert.equal(nodes(tree).some((node) => ["form", "input", "button"].includes(node.tagName)), false);
  }
});

test("an alumni record's empty Community Circle points to ongoing participation, not back to joining", () => {
  const tree = render(Record, { record: record({ states: { standing: "alumni", foundations: "completed" }, circle: null }) });
  const community = nodes(tree).find((node) => attr(node, "id") === "community");
  const action = nodes(community).find((node) => node.tagName === "a" && /Review ongoing participation/.test(text(node)));
  assert.ok(action);
  assert.equal(attr(action, "href"), "#journey");
  assert.equal(nodes(community).some((node) => node.tagName === "a" && (attr(node, "href") === "#membership" || attr(node, "href")?.includes("#assign-member"))), false);
  assert.doesNotMatch(text(community), /Review joining & billing|Review Circle placement/);
});

test("directory uses actual states, explicitly names Billing, and has a single non-nested record link per member", () => {
  const tree = render(Directory, { members: [summary({ billingState: "pending" }), summary({ memberId: "member-two", circleName: null, circleStatus: null })] });
  assert.match(text(tree), /Billingpending/);
  assert.match(text(tree), /Waiting · MemberComplete joining/);
  assert.match(text(tree), /Ready · OperatorReview Circle placement/);
  assert.doesNotMatch(text(tree), /FAKE SERVER COPY/);
  const links = nodes(tree).filter((node) => node.tagName === "a" && attr(node, "href")?.startsWith("/ops/members/"));
  assert.equal(links.length, 2);
  assert.equal(links.every((link) => nodes(link).filter((node) => node.tagName === "a").length === 1), true);
});

test("record foregrounds one owned next step, keeps seven technical states lower, and shares only the generic sign-in address", () => {
  const tree = render(Record, { record: record({ states: { administrativeOnboarding: "in_progress", billing: "pending", standing: "pre_active" }, requirements: [required("agreement")], circle: null }) });
  const next = nextPanel(tree);
  assert.match(text(next), /Waiting · MemberComplete joining/);
  assert.match(text(next), /accepts the agreement themselves/);
  assert.deepEqual(nodes(next).filter((node) => node.tagName === "a").map((node) => attr(node, "href")), ["#membership"]);
  const stateSection = nodes(tree).find((node) => attr(node, "aria-labelledby") === "member-state-details");
  assert.equal(nodes(stateSection).filter((node) => node.tagName === "dt").length, 7);
  assert.ok(nodes(tree).findIndex((node) => attr(node, "id") === "membership") < nodes(tree).indexOf(stateSection));
  assert.ok(nodes(tree).some((node) => attr(node, "href") === "https://members.theruinedproject.com/access"));
  assert.equal(nodes(tree).some((node) => attr(node, "href")?.includes("#assign-member")), false);
  assert.equal(nodes(tree).filter((node) => attr(node, "aria-label") === "Next member step").length, 1);
  const ids = nodes(tree).map((node) => attr(node, "id")).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test("setup blockers do not offer placement; operator-access review stays separate and permission-gated", () => {
  const blocked = record({ states: { account: "suspended" }, circle: null });
  const tree = render(Setup, { record: blocked });
  const links = nodes(tree).filter((node) => node.tagName === "a").map((node) => attr(node, "href"));
  assert.deepEqual(links, ["#membership", "/ops/operators?memberId=preview-01"]);
  assert.match(text(tree), /Support: Review the account suspension/);
  assert.match(text(tree), /Administrator access does not require a Circle/);
  assert.equal(nodes(tree).some((node) => ["button", "form", "input"].includes(node.tagName)), false);
  for (const roles of [["guide"], ["circle_leader"], []]) {
    assert.equal(nodes(render(Setup, { record: { ...blocked, access: { ...blocked.access, roles } } })).length, 0);
    const restricted = render(Record, { record: record({ circle: null, roles, capabilities: [] }) });
    assert.equal(nodes(restricted).some((node) => attr(node, "href")?.startsWith("/ops/operators") || attr(node, "href")?.includes("?memberId=")), false);
    assert.match(text(nextPanel(restricted)), /View Circle placement/);
  }
});

test("guidance navigation encodes only member ID and never transports grants or personal email", () => {
  const next = guidanceForMemberRecord(record({ circle: null }));
  const id = "id&role=ops_admin&email=private@example.test#activate";
  const url = new URL(memberGuidanceAction(next, id, true).href, "https://members.theruinedproject.com");
  assert.deepEqual([...url.searchParams.keys()], ["memberId"]);
  assert.equal(url.searchParams.get("memberId"), id);
  assert.equal(url.hash, "#assign-member");
});
