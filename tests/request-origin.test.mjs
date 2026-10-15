import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/request-origin.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const output = { exports: {} };
new Function("module", "exports", code)(output, output.exports);
const { isSameOriginRequest } = output.exports;
const check = (origin, host, url = "https://theruinedproject.com/api/store/cart", extra = {}) => {
  const headers = new Headers(extra);
  if (origin !== undefined) headers.set("origin", origin);
  if (host !== undefined) headers.set("host", host);
  return isSameOriginRequest(new Request(url, { headers }));
};

test("same-origin uses actual Host across internal Next hostname and TLS termination", () => {
  assert.equal(check("http://127.0.0.1:3327", "127.0.0.1:3327", "http://localhost:3327/api/store/cart"), true);
  assert.equal(check("https://theruinedproject.com", "theruinedproject.com", "http://localhost:3000/api/store/cart"), true);
  assert.equal(check("https://theruinedproject.com", "THERUINEDPROJECT.COM"), true);
  assert.equal(check("https://theruinedproject.com:444", "theruinedproject.com:444"), true);
  assert.equal(check("http://localhost:3327", "localhost:3327"), true);
  assert.equal(check("http://[::1]:3327", "[::1]:3327"), true);
});

test("only serialized HTTPS or explicit loopback HTTP origins are accepted", () => {
  for (const origin of [undefined, "null", "https://theruinedproject.com/", "https://theruinedproject.com/path", "https://user@theruinedproject.com", "https://user:password@theruinedproject.com", "https://theruinedproject.com?query", "https://theruinedproject.com#fragment", "https://theruinedproject.com:443", "http://theruinedproject.com", "ftp://theruinedproject.com", "http://localhost.attacker.example", "http://127.0.0.2", "http://127.1", "http://2130706433", "https://theruinedproject.com https://attacker.example"]) {
    assert.equal(check(origin, "theruinedproject.com"), false, origin);
  }
});

test("Host must match exactly, and forwarded hosts cannot override or repair it", () => {
  for (const host of ["", "members.theruinedproject.com", "theruinedproject.com:444", "theruinedproject.com:443", "theruinedproject.com.", "theruinedproject.com/path", "theruinedproject.com?query", "theruinedproject.com#fragment", "user@theruinedproject.com", "theruinedproject.com,attacker.example", "theruinedproject.com\\attacker.example", "https://theruinedproject.com"]) {
    assert.equal(check("https://theruinedproject.com", host, undefined, { "x-forwarded-host": "theruinedproject.com" }), false, host);
  }
  assert.equal(check("https://theruinedproject.com", "theruinedproject.com", undefined, { "x-forwarded-host": "attacker.example" }), true);
  assert.equal(check("http://127.0.0.1:3327", "localhost:3327", "http://localhost:3327/cart"), false);
  assert.equal(check("http://127.0.0.1:3327", "127.0.0.1:3328", "http://localhost:3327/cart"), false);
});

test("missing Host falls back to request URL and still ignores forwarded hosts", () => {
  assert.equal(check("https://theruinedproject.com"), true);
  assert.equal(check("https://members.theruinedproject.com"), false);
  assert.equal(check("https://theruinedproject.com", undefined, "https://attacker.example/cart", { "x-forwarded-host": "theruinedproject.com" }), false);
  assert.equal(check("http://127.0.0.1:3327", undefined, "http://localhost:3327/cart"), false);
});
