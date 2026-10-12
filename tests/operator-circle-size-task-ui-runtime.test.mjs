import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { taggedDatabase } from "../scripts/check-support-repository.mjs";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function loadModule(path, dependencies) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "module", "exports", "fetch", compiled)(dependencies, mod, mod.exports, () => {
    throw new Error("UI fixtures may not make live requests");
  });
  return mod.exports;
}
const uiCache = new Map();
function loadUi(path) {
  if (uiCache.has(path)) return uiCache.get(path);
  const value = loadModule(path, name => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    if (name === "@/components/platform/OperatorPageFrame") return { __esModule: true, default: ({ children }) => React.createElement("main", null, children) };
    if (name.startsWith("@/")) {
      const target = [".ts", ".tsx"].map(extension => `src/${name.slice(2)}${extension}`).find(candidate => existsSync(new URL(`../${candidate}`, import.meta.url)));
      assert.ok(target, `Known UI dependency ${name}`);
      assert.doesNotMatch(target, /repository|database|identity/);
      return loadUi(target);
    }
    throw new Error(`Unexpected UI dependency ${name}`);
  });
  uiCache.set(path, value);
  return value;
}
const preview = loadUi("src/lib/platform/ops-preview.ts");
const Queue = loadUi("src/components/platform/OperatorWorkQueue.tsx").default;
const Overview = loadUi("src/components/platform/OpsOverview.tsx").default;
const elements = node => [node, ...(node.childNodes ?? []).flatMap(elements)].filter(item => item.tagName);
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const render = (Component, props) => parseFragment(renderToStaticMarkup(React.createElement(Component, props)));
const circleTask = preview.PREVIEW_OPS_WORK_QUEUE.items.find(item => item.taskType === "circle.size_low");

test("Circle size tasks show the actual Circle, context, and assignee without granting another operator controls", () => {
  assert.ok(circleTask);
  const href = `/ops/circles?circleId=${circleTask.circleId}#circle-${circleTask.circleId}`;
  for (const taskType of ["circle.size_low", "circle.size_high"]) {
    const item = { ...circleTask, taskType };
    const queue = { items: [item], totals: { artifacts: 0, failures: 0, tasks: 1 } };
    const tree = render(Queue, { queue, preview: true });
    assert.match(text(tree), /Assigned to Libby Zaritsky/);
    assert.ok(text(tree).includes(item.description));
    assert.doesNotMatch(text(tree), /System work|Claimed by|Unclaimed/);
    assert.ok(elements(tree).some(node => node.tagName === "a" && attr(node, "href") === href && text(node) === item.circleName));
    assert.equal(elements(tree).some(node => node.tagName === "button" && /^(Claim|Complete|Unclaim)$/.test(text(node))), false);
    const owned = render(Queue, { queue: { ...queue, items: [{ ...item, claimedByCurrentOperator: true }] }, preview: true });
    assert.ok(elements(owned).some(node => node.tagName === "button" && text(node) === "Complete"));
    assert.ok(elements(owned).some(node => node.tagName === "button" && text(node) === "Unclaim"));
    const overview = render(Overview, { data: { ...preview.PREVIEW_OPS_OVERVIEW, priorityWork: [item] } });
    const linked = elements(overview).find(node => node.tagName === "a" && attr(node, "href") === href);
    assert.ok(linked);
    assert.match(text(linked), /Circle 01.*Assigned to Libby Zaritsky/);
  }
});

test("unassigned Circle work exposes its routing caveat and regular tasks retain claimed wording", () => {
  const description = "Circle 01 has 3 current participants. Libby is not an active administrator; assign this task after restoring access.";
  const tree = render(Queue, { queue: { items: [{ ...circleTask, claimedByName: null, description }], totals: { tasks: 1, failures: 0, artifacts: 0 } }, preview: true });
  assert.ok(text(tree).includes(description));
  assert.match(text(tree), /Unclaimed/);
  assert.doesNotMatch(text(tree), /Assigned to Libby/);
  assert.ok(elements(tree).some(node => node.tagName === "button" && text(node) === "Claim"));
  const regular = preview.PREVIEW_OPS_WORK_QUEUE.items.find(item => item.kind === "task" && item.claimedByName && !item.taskType);
  const regularTree = render(Queue, { queue: { items: [regular], totals: { tasks: 1, failures: 0, artifacts: 0 } }, preview: true });
  assert.match(text(regularTree), /Claimed by Libby Zaritsky/);
  assert.ok(elements(regularTree).some(node => node.tagName === "a" && attr(node, "href") === `/ops/members/${regular.memberId}#record`));
});

test("work queue and overview carry Circle identity, context, and owner from the shipped schema", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role;");
  const registry = read("scripts/migrate-platform.mjs");
  for (const match of registry.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)) await db.exec(read(match[1]));
  const sql = taggedDatabase(db);
  const dependencies = {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/google/calendar": {}, "@/lib/google/communications": {}, "@/lib/support/delivery": {},
    "@/lib/platform/ops-delivery-health": { readOpsDeliveryAttention: async () => [] },
  };
  const repository = loadModule("src/lib/platform/ops-operating-repository.ts", name => {
    assert.ok(Object.hasOwn(dependencies, name), `Known repository dependency ${name}`);
    return dependencies[name];
  });
  const person = crypto.randomUUID(), owner = crypto.randomUUID(), circle = crypto.randomUUID(), task = crypto.randomUUID();
  await db.query("insert into people(id) values($1)", [person]);
  await db.query("insert into platform_users(auth_user_id,person_id,email_normalized,status,user_type) values($1,$2,'circle-owner@example.test','active','staff')", [owner, person]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [owner]);
  await db.query("insert into person_profiles(person_id,display_name) values($1,'Libby Zaritsky')", [person]);
  await db.query("insert into circles(id,name,slug,status) values($1,'Circle Boundary','circle-boundary-fixture','forming')", [circle]);
  await db.query("insert into operator_tasks(id,circle_id,task_type,title,description,assigned_to_auth_user_id,created_by_type) values($1,$2,'circle.size_low','Review Circle Boundary','There are 6 current participants. Review placement.',$3,'system')", [task, circle, owner]);
  const queue = await repository.getOpsWorkQueue(owner);
  const overview = await repository.getOpsOverviewData(owner);
  for (const item of [queue.items.find(item => item.workId === task), overview.priorityWork.find(item => item.workId === task)]) {
    assert.ok(item);
    assert.equal(item.circleId, circle);
    assert.equal(item.circleName, "Circle Boundary");
    assert.equal(item.taskType, "circle.size_low");
    assert.equal(item.description, "There are 6 current participants. Review placement.");
    assert.equal(item.memberId, null);
    assert.equal(item.claimedByName, "Libby Zaritsky");
    assert.equal(item.claimedByCurrentOperator, true);
    assert.equal(item.version, 1);
  }
});
