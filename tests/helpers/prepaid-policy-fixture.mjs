// Real browser-safe schedule and pure provider-policy dependencies for isolated source loaders.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
const { createHash } = crypto;
import { readFile } from "node:fs/promises";
import ts from "typescript";
async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected pure-policy dependency: ${name}`);
    return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
export const foundationsScheduleFixture = await load("src/lib/membership/foundations-schedule.ts");
const pricing = await load("src/lib/membership/pricing.ts");
export const prepaidPolicyFixture = await load("src/lib/stripe/prepaid-policy.ts", {
  "node:crypto": { createHash }, "@/lib/membership/foundations-schedule": foundationsScheduleFixture,
  "@/lib/membership/pricing": pricing,
});
export const prepaidFixtureDependencies = {
  "node:crypto": crypto,
  "@/lib/membership/foundations-schedule": foundationsScheduleFixture,
  "@/lib/stripe/prepaid-policy": prepaidPolicyFixture,
  "./prepaid-policy": prepaidPolicyFixture,
  "@/lib/membership/cohort-prepayment": { isMembershipCohortPrepaymentEnabled: () => false },
};
