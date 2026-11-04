import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { directoryModel, directoryTestDependencies } from "./helpers/member-directory-fixture.mjs";

const { sortOperatorMembers, completedMemberCheckpoints, normalizeOperatorMemberSort, normalizeOperatorMemberArchive } = directoryModel;
const progress = patch => ({ state: "collecting", registeredAt: null, profileComplete: false, ready: false,
  requiresInitialPayment: true, requiresPaymentMethod: true, completionBasis: null, paymentMethodState: "missing",
  paymentConfirmed: false, billingArranged: false, billingState: "pending", serviceStartsAt: null, ...patch });
const member = (id, name, createdAt, registration) => ({ memberId: id, name, createdAt, registration });

test("the four sort modes use displayed names, genuine dates and completed checkpoint count", () => {
  const list = [
    member("a", "Zoe", "2026-11-03T00:00:00Z", progress({ emailVerified: true, profileComplete: true })),
    member("b", "aaron", "2026-09-01T00:00:00Z", progress({ emailVerified: true })),
    member("c", "Claire", "2026-10-01T00:00:00Z", progress({ emailVerified: true, profileComplete: true, paymentConfirmed: true, profileGranted: true })),
    member("d", "Bea", null),
  ];
  const ids = mode => sortOperatorMembers(list, mode).map(item => item.memberId);
  assert.deepEqual(ids("alphabetical"), ["b", "d", "c", "a"]);
  assert.deepEqual(ids("status"), ["c", "a", "b", "d"]);
  assert.deepEqual(ids("newest"), ["a", "c", "b", "d"]);
  assert.deepEqual(ids("oldest"), ["b", "c", "a", "d"]);
  assert.deepEqual(list.map(item => item.memberId), ["a", "b", "c", "d"], "sorting does not mutate shared input");
  assert.equal(normalizeOperatorMemberSort("invalid"), "alphabetical");
  assert.equal(normalizeOperatorMemberArchive("invalid"), "current");
});

test("status counts payment exemptions and partner handling exactly as filled boxes; reviews are unfinished", () => {
  const complimentary = member("a", "Complimentary", null, progress({ emailVerified: true, profileComplete: true, paymentExempt: true, profileGranted: true }));
  const partner = member("b", "Partner", null, progress({ emailVerified: true, profileComplete: true, paymentByPartner: true, paymentConfirmed: true, profileGranted: true }));
  const review = member("c", "Review", null, progress({ emailVerified: true, profileComplete: true, paymentMethodState: "saved", paymentNeedsReview: true }));
  assert.equal(completedMemberCheckpoints(complimentary), 5);
  assert.equal(completedMemberCheckpoints(partner), 5);
  assert.equal(completedMemberCheckpoints(review), 3);
  assert.deepEqual(sortOperatorMembers([review, partner, complimentary], "status").map(item => item.name), ["Complimentary", "Partner", "Review"]);
});

function loadRepository(dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/platform/repository.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (Object.hasOwn(directoryTestDependencies, name)) return directoryTestDependencies[name];
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected repository dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

test("205 matches all appear and sort globally, including checkpoint evidence in the second bounded batch", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ member_id: `member-${index}`, display_name: `Member ${index}`, email: `member${index}@example.test`,
    created_at: new Date(Date.UTC(2026, 0, index + 1)), account_state: "active", billing_state: "pending", foundations_progress: 0 }));
  const batches = [];
  const sql = async parts => parts.join("?").includes("from platform_role_grants") ? [{ role_slug: "ops_admin" }] : rows;
  sql.begin = async (_mode, callback) => callback(sql);
  const repository = loadRepository({
    "server-only": {}, "@/lib/platform/model": { nextMemberAction: () => "Review" },
    "@/lib/membership/personal-invitation-admission": {}, "@/lib/membership/public-signup-admission": {},
    "@/lib/identity/repository": {}, "@/lib/platform/calendar-audience-invalidation": {}, "@/lib/stripe/membership-state": {},
    "@/lib/stripe/database": { getBillingDatabase: () => sql },
    "@/lib/membership/registration-repository": { readOperatorRegistrationProgress: async (_tx, _actor, ids) => {
      assert.ok(ids.length <= 200); batches.push(ids);
      return new Map(ids.map(id => [id, progress(id === "member-204" ? { emailVerified: true, profileComplete: true, paymentConfirmed: true, profileGranted: true } : { emailVerified: true })]));
    } },
  });
  const result = await repository.getOperatorMemberDirectoryPage("admin", { sort: "status", page: 999 });
  assert.deepEqual(batches.map(batch => batch.length), [200, 5]);
  assert.equal(result.members.length, 205);
  assert.equal(result.totalResults, 205);
  assert.equal(result.page, 1);
  assert.equal(result.pageCount, 1);
  assert.equal(result.members[0].memberId, "member-204", "highest progress is first even when it came from the last evidence batch");
  assert.ok(result.members.every(item => item.createdAt));
});

const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
test("selectors submit immediately while keeping query, filter, sort and archive in the same GET form", () => {
  const Controls = directoryTestDependencies["@/components/platform/OperatorMemberDirectoryControls"].default;
  const tree = Controls({ directory: { query: "Taelor", filter: "attention", sort: "status", archive: "archived", canViewArchived: true } });
  assert.equal(tree.type, "form");
  assert.equal(tree.props.method, "get");
  const fields = nodes(tree).filter(node => node.props?.name);
  assert.deepEqual(fields.map(node => [node.props.name, node.props.defaultValue]), [["q", "Taelor"], ["filter", "attention"], ["sort", "status"], ["archive", "archived"]]);
  let submissions = 0;
  for (const field of fields.filter(node => node.type === "select")) field.props.onChange({ currentTarget: { form: { requestSubmit() { submissions++; } } } });
  assert.equal(submissions, 3);
  const scoped = Controls({ directory: { query: "", filter: "all", canViewArchived: false } });
  assert.equal(nodes(scoped).some(node => node.props?.name === "archive"), false);
});
