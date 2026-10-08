import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { membershipWebsiteHref, PRODUCTION_MEMBERSHIP_SITE_URL } from "../src/lib/site.ts";

const path = "/my/foundations/timeline/part-1";

test("the worksheet defaults to the member host and permits an explicit local member origin", () => {
  const previous = process.env.NEXT_PUBLIC_MEMBERSHIP_SITE_URL;
  try {
    delete process.env.NEXT_PUBLIC_MEMBERSHIP_SITE_URL;
    assert.equal(membershipWebsiteHref(path), `${PRODUCTION_MEMBERSHIP_SITE_URL}${path}`);
    for (const origin of ["http://localhost:3130", "http://localhost:3130/", "https://member-preview.example.com"]) {
      process.env.NEXT_PUBLIC_MEMBERSHIP_SITE_URL = origin;
      assert.equal(membershipWebsiteHref(path), `${new URL(origin).origin}${path}`);
    }
    for (const invalid of ["javascript:alert(1)", "not a URL", "https://member.example/path", "https://member.example?next=/ops", "https://user:secret@member.example", "//other.example"]) {
      process.env.NEXT_PUBLIC_MEMBERSHIP_SITE_URL = invalid;
      assert.equal(membershipWebsiteHref(path), `${PRODUCTION_MEMBERSHIP_SITE_URL}${path}`);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_MEMBERSHIP_SITE_URL;
    else process.env.NEXT_PUBLIC_MEMBERSHIP_SITE_URL = previous;
  }
});

test("the public worksheet route renders no editor and redirects directly to authenticated Part I", () => {
  const code = ts.transpileModule(readFileSync(new URL("../app/foundations/01/timeline/page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "next/navigation": { redirect: (href) => { throw Object.assign(Error("Redirect"), { href }); } },
    "@/lib/sharing": { privateSharingMetadata: {} },
    "@/lib/site": { membershipWebsiteHref: (destination) => { assert.equal(destination, path); return `http://localhost:3130${destination}`; } },
  };
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  assert.equal(cjsModule.exports.dynamic, "force-dynamic");
  assert.throws(() => cjsModule.exports.default(), { href: `http://localhost:3130${path}` });
});
