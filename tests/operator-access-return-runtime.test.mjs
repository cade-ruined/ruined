import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, logger = { error() {} }) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    throw Error(`Unexpected access/return dependency: ${name}`);
  }, cjsModule, cjsModule.exports, logger);
  return cjsModule.exports;
}
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const { operatorMemberReturnLocation } = load("src/lib/platform/operator-return-location.ts");

test("member return locations reject external, nested, encoded and malformed destinations", () => {
  for (const value of [undefined, null, [], {}, 12, "https://evil.test/ops/members", "//evil.test/ops/members", "javascript:alert(1)", "/ops/members/123", "/ops/members/../system", "/ops/members%3Fq=member", "/ops/members\\evil", "/ops/members#other", `/ops/members?q=${"a".repeat(1601)}`]) {
    assert.equal(operatorMemberReturnLocation(value), "/ops/members", String(value));
  }
  assert.equal(operatorMemberReturnLocation("/ops/members?redirectTo=https://evil.test&filter=admin&page=-3#private"), "/ops/members");
  assert.equal(operatorMemberReturnLocation("/ops/members?q=A%26filter%3Dadmin&filter=attention&page=0002"), "/ops/members?q=A%26filter%3Dadmin&filter=attention&page=2");
  assert.equal(operatorMemberReturnLocation(`/ops/members?q=${"x".repeat(130)}&page=Infinity`), `/ops/members?q=${"x".repeat(120)}`);
});

test("member directory records and pagination retain the canonical query, filter and page", () => {
  const stub = { __esModule: true, default: () => null };
  const Directory = load("src/components/platform/OperatorMemberDirectory.tsx", {
    "@/components/platform/OperatorProgress": stub,
    "@/components/platform/StateLabel": stub,
    "@/components/platform/operatorStyles": {},
    "@/lib/platform/operator-member-guidance": { guidanceForMemberSummary: () => ({ status: "Ready", actor: "Operator", title: "Review" }) },
  }).default;
  const directory = { query: "A & B / Circle", filter: "unassigned", page: 3, pageSize: 25, pageCount: 5, totalResults: 101, members: [{ memberId: "member-one", name: "Example", billingState: "active", foundationsProgress: 10 }] };
  const links = nodes(Directory({ directory })).filter((node) => node.props?.href);
  const record = new URL(links.find((node) => node.props["aria-label"] === "Open Example’s member record").props.href, "https://operator.invalid");
  const returned = new URL(operatorMemberReturnLocation(record.searchParams.get("returnTo")), record.origin);
  assert.equal(returned.pathname, "/ops/members");
  assert.deepEqual([...returned.searchParams], [["q", directory.query], ["filter", "unassigned"], ["page", "3"]]);
  const pagination = links.map((node) => new URL(node.props.href, record.origin)).filter((url) => url.pathname === "/ops/members" && url.searchParams.has("page"));
  assert.deepEqual(pagination.map((url) => url.searchParams.get("page")), ["2", "4"]);
  assert.ok(pagination.every((url) => url.searchParams.get("q") === directory.query && url.searchParams.get("filter") === "unassigned"));
});

function accessFixture({ mode = "connected", viewer = { authUserId: "admin", email: "operator@example.test" }, role = "ops_admin", sessionFailure = false, roleFailure = false } = {}) {
  const calls = [];
  const logs = [];
  const context = load("src/lib/platform/page-data.ts", {
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/platform/model": {},
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => { calls.push("viewer"); if (sessionFailure) throw Error("Sensitive session failure"); return viewer; } },
    "@/lib/platform/repository": {
      getOperatorRole: async (id) => { calls.push(["role", id]); if (roleFailure) throw Error("Sensitive role failure"); return role; },
      getOperatorDashboard: () => { throw Error("System must not depend on the member dashboard"); },
      getMemberPlatformSnapshot: () => { throw Error("System must not read a member profile"); },
    },
  }, { error: (...args) => logs.push(args) });
  return { read: context.getOperatorAccessContext, calls, logs };
}

test("minimal System access loads no dashboard and denies missing identities or roles", async () => {
  for (const mode of ["preview", "unavailable"]) {
    const fixture = accessFixture({ mode });
    assert.equal((await fixture.read()).state, mode);
    assert.deepEqual(fixture.calls, []);
  }
  const signedOut = accessFixture({ viewer: null });
  assert.equal((await signedOut.read()).state, "signed_out");
  assert.deepEqual(signedOut.calls, ["viewer"]);
  const denied = accessFixture({ role: null });
  assert.equal((await denied.read()).state, "denied");
  const connected = accessFixture();
  const context = await connected.read();
  assert.equal(context.state, "authenticated");
  assert.equal(context.role, "ops_admin");
  assert.equal("dashboard" in context, false);
  assert.deepEqual(connected.calls, ["viewer", ["role", "admin"]]);
});

test("System access reports safe unavailable states for both session construction and role lookup failures", async () => {
  for (const failure of ["sessionFailure", "roleFailure"]) {
    const fixture = accessFixture({ [failure]: true });
    const context = await fixture.read();
    assert.equal(context.state, "unavailable");
    assert.equal(context.role, null);
    assert.equal(context.viewer === null, failure === "sessionFailure");
    assert.equal(fixture.logs.length, 1);
    assert.doesNotMatch(JSON.stringify(fixture.logs), /Sensitive|operator@example/);
  }
});

test("System route uses minimal context, authorizes before health reads, and recovers from health failure", async () => {
  for (const scenario of ["signed_out", "denied", "unavailable", "guide", "circle_leader", "missing-viewer", "preview", "admin", "health-failure"]) {
    const reads = [];
    const Unavailable = () => null;
    const Health = () => null;
    const state = ["guide", "circle_leader", "admin", "health-failure", "missing-viewer"].includes(scenario) ? "authenticated" : scenario;
    const role = ["guide", "circle_leader"].includes(scenario) ? scenario : "ops_admin";
    const Page = load("app/ops/system/page.tsx", {
      "next/navigation": { redirect: (href) => { throw Error(`redirect:${href}`); } },
      "@/components/platform/PlatformUnavailable": { __esModule: true, default: Unavailable },
      "@/components/platform/OperatorSystemHealth": { __esModule: true, default: Health },
      "@/lib/platform/page-data": { getOperatorAccessContext: async () => ({ state, role, viewer: scenario === "missing-viewer" ? null : { authUserId: "admin" }, configuration: { mode: "connected" } }) },
      "@/lib/platform/ops-preview": { PREVIEW_OPS_SYSTEM: { preview: true } },
      "@/lib/platform/ops-operating-repository": { getOpsSystemHealth: async (...args) => { reads.push(args); if (scenario === "health-failure") throw Error("private failure"); return { health: {}, canRetry: true }; } },
    }).default;
    if (scenario === "signed_out") await assert.rejects(Page(), /redirect:\/ops\/access/);
    else {
      const tree = await Page();
      assert.equal(tree.type, ["admin", "preview"].includes(scenario) ? Health : Unavailable, scenario);
      if (scenario === "preview") assert.equal(tree.props.preview, true);
    }
    assert.equal(reads.length, ["admin", "health-failure"].includes(scenario) ? 1 : 0, scenario);
  }
});
