import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/preview/library-video/route.ts", import.meta.url), "utf8");
function fixture({ production = false, mode = "preview", path = "/private/call.mp4" } = {}) {
  const reads = [];
  const dependencies = {
    "node:fs": { createReadStream(file, range) { reads.push({ file, ...range }); return Readable.from(Buffer.alloc(range.end - range.start + 1)); } },
    "node:fs/promises": { stat: async () => ({ size: 1000 }) },
    "node:stream": require("node:stream"),
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(name => dependencies[name], compiledModule, compiledModule.exports, { env: { NODE_ENV: production ? "production" : "development", LIBRARY_PREVIEW_VIDEO_PATH: path } });
  return { get: compiledModule.exports.GET, reads };
}

test("private local video preview cannot be served in production, connected mode, or to a non-loopback host", async () => {
  for (const [options, url] of [
    [{ production: true }, "http://127.0.0.1/api/preview/library-video"],
    [{ mode: "connected" }, "http://127.0.0.1/api/preview/library-video"],
    [{}, "https://members.theruinedproject.com/api/preview/library-video"],
    [{ path: undefined }, "https://example.com/api/preview/library-video"],
  ]) {
    const f = fixture(options);
    assert.equal((await f.get(new Request(url))).status, 404);
    assert.equal(f.reads.length, 0);
  }
});

test("local video review serves bounded byte ranges including late seeking", async () => {
  for (const [range, start, end] of [["bytes=0-99", 0, 99], ["bytes=950-", 950, 999], ["bytes=-25", 975, 999], ["bytes=990-99999", 990, 999]]) {
    const f = fixture();
    const r = await f.get(new Request("http://127.0.0.1/api/preview/library-video", { headers: { range } }));
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), `bytes ${start}-${end}/1000`);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.equal((await r.arrayBuffer()).byteLength, end - start + 1);
    assert.deepEqual(f.reads, [{ file: "/private/call.mp4", start, end }]);
  }
});

test("local video review rejects invalid or unsatisfiable ranges without opening the recording", async () => {
  for (const range of ["bytes=1000-", "bytes=9-1", "bytes=-", "bytes=0-2,4-6", "bytes=abc-def", "bytes=-0"]) {
    const f = fixture();
    const r = await f.get(new Request("http://localhost/api/preview/library-video", { headers: { range } }));
    assert.equal(r.status, 416);
    assert.equal(f.reads.length, 0);
  }
});
