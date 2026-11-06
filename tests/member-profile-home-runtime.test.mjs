import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/membership/repository.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("repository.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["getMemberHome", "getMemberProfileHome"]);
const code = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map(node => node.getText(ast)).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(mode = "full", { failUnused = false } = {}) {
  const reads = [], identities = [];
  const identity = { authUserId: "owner", memberId: "member", foundationsState: "in_progress", billingState: "active", membershipFunding: "self" };
  const access = { mode, capabilities: ["home.read", "profile.read", "foundations.summary"] };
  const profile = {
    directory: { avatarUrl: "/portrait.webp", displayName: "Full Name", fullName: "Full Name", bio: "A biography", memberTag: "member_tag", preferredName: "  First  ", buildingNow: "A project", location: "Salt Lake City", timezone: "America/Denver" },
    preferences: { directoryStatus: "circle_visible" }, privateProfile: { mobile: "PRIVATE", fulfillmentAddress: "PRIVATE" },
  };
  const read = (name, value, unused = false) => { reads.push(name); if (unused && failUnused) throw Error(`Unavailable ${name}`); return Promise.resolve(value); };
  const sql = (strings, ...values) => {
    assert.equal(values[0], identity.memberId);
    return strings.join("").includes("membership_activated_at")
      ? read("member-since", [{ member_since: new Date("2024-01-01T00:00:00Z"), member_number: 23 }])
      : read("foundations-summary", [{ completed_units: 2, progress_percent: 10, total_units: 22 }], true);
  };
  const deps = {
    requireMemberIdentity: async owner => { identities.push(owner); assert.equal(owner, identity.authUserId); return identity; },
    requireMemberCapability: (given, capability) => { assert.equal(given, identity); assert.equal(capability, "home.read"); return access; },
    getApplicationDatabase: () => sql,
    memberCan: (policy, capability) => policy.capabilities.includes(capability),
    toIso: value => value == null ? null : new Date(value).toISOString(),
    getMemberProfile: async (owner, connection, knownIdentity) => {
      assert.equal(owner, identity.authUserId);
      if (connection !== undefined) { assert.equal(connection, sql); assert.equal(knownIdentity, identity); }
      return read("profile", profile);
    },
    getMemberBadges: memberId => { assert.equal(memberId, identity.memberId); return read("badges", [{ key: "first-words" }]); },
    getMemberCircle: () => read("circle", { circle: null, meetings: [], members: [] }, true),
    getMemberExperiences: () => read("experiences", { upcoming: [] }, true),
    getMemberArtifacts: () => read("artifacts", { awards: [] }, true),
    getMemberUpdates: () => read("updates", { items: [], unreadCount: 0 }, true),
    getMemberFoundationRequirements: () => read("foundation-requirements", { futureLetter: { completed: false }, timeline: { completed: false } }, true),
    getMemberRecord: () => read("record", { totals: {} }, true),
  };
  const mod = { exports: {} };
  new Function("module", "exports", ...Object.keys(deps), code)(mod, mod.exports, ...Object.values(deps));
  return { ...mod.exports, reads, identities, profile };
}

test("lean profile preserves every rendered field with three read branches instead of ten", async () => {
  for (const mode of ["full", "onboarding", "entry", "limited", "suspended"]) {
    const old = fixture(mode), current = fixture(mode);
    const [wide, lean] = await Promise.all([old.getMemberHome("owner"), current.getMemberProfileHome("owner")]);
    const expected = Object.fromEntries(Object.keys(lean).map(key => [key, wide[key]]));
    assert.deepEqual(lean, expected);
    assert.deepEqual(current.reads.sort(), ["badges", "member-since", "profile"]);
    assert.equal(old.reads.length, 10, "counts loader read branches, not internal SQL inside the repositories");
    assert.equal(current.reads.length, 3);
    assert.deepEqual(current.identities, ["owner"]);
    assert.doesNotMatch(JSON.stringify(lean), /PRIVATE/);
    for (const key of ["artifacts", "circleMembers", "record", "nextAction", "upcomingExperiences", "foundations", "unreadUpdates"]) assert.equal(key in lean, false);
  }
});

test("unavailable unrelated member sections cannot prevent the lean profile from rendering", async () => {
  const f = fixture("full", { failUnused: true });
  const home = await f.getMemberProfileHome("owner");
  assert.equal(home.profile.fullName, "Full Name");
  assert.equal(home.memberNumber, 23);
  assert.deepEqual(home.badges, [{ key: "first-words" }]);
  assert.equal(f.reads.length, 3);
});
