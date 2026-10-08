import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
export const read = path => readFileSync(resolve(root, path), "utf8");
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const sid = n => `SM${String(n).padStart(32, "0")}`;
export const configuration = () => ({
  TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`, TWILIO_AUTH_TOKEN: "local_sms_signature_fixture",
  TWILIO_PHONE_NUMBER: "+12025550100", TWILIO_MESSAGING_SERVICE_SID: `MG${"2".repeat(32)}`,
  TWILIO_WEBHOOK_BASE_URL: "https://members.theruinedproject.com",
});
export function loader(env = {}, overrides = {}) {
  const cache = new Map();
  function load(path) {
    const absolute = resolve(root, path);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loaded = { exports: {} }; cache.set(absolute, loaded);
    const output = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", "process", "console", "fetch", output)(name => {
      if (name === "server-only") return {};
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith(".")) return load(`${resolve(dirname(absolute), name)}.ts`);
      assert.notEqual(name, "postgres", "No external database connection is allowed");
      return require(name);
    }, loaded, loaded.exports, { env }, { error: () => assert.fail("SMS must not log secrets or provider errors") },
    () => assert.fail("Live network requests are forbidden"));
    return loaded.exports;
  }
  return load;
}
export function sqlFor(db) {
  const sql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
  sql.json = JSON.stringify;
  sql.begin = run => db.transaction(tx => run(sqlFor(tx)));
  return sql;
}
