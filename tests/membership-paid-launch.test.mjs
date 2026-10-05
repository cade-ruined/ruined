import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const code=ts.transpileModule(await readFile(new URL("../src/lib/membership/paid-launch.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function configured(value){const loaded={exports:{}};new Function("require","module","exports","process",code)(()=>({}),loaded,loaded.exports,{env:{STRIPE_MEMBERSHIP_FIRST_CHARGE_AT:value}});return loaded.exports;}
test("first charge uses an explicit UTC instant, preserving Denver midnight across the DST change",()=>{
  const h=configured("2026-11-01T06:00:00Z");
  assert.equal(h.getMembershipFirstChargeAt(new Date("2026-10-05T00:00:00Z")).toISOString(),"2026-11-01T06:00:00.000Z");
  assert.equal(h.membershipFirstChargeDisclosure(new Date("2026-11-01T06:00:00Z")),"November 1, 2026");
  assert.equal(h.getMembershipFirstChargeAt(new Date("2026-11-01T06:00:00Z")),null);
  assert.equal(h.getMembershipFirstChargeAt(new Date("2026-12-01T06:00:00Z")),null);
  assert.equal(configured(undefined).getMembershipFirstChargeAt(),null);
  for(const value of ["tomorrow","2026-11-01","2026-11-01T00:00:00","2026-02-30T06:00:00Z","2026-11-01T06:00:00.123Z"]) {
    assert.throws(()=>configured(value).getMembershipFirstChargeAt(),/configuration is invalid/);
  }
});
