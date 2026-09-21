import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("member installation launches /my on the current host with sign-in inside standalone scope", async () => {
  const route = await load("app/my/manifest.webmanifest/route.ts");
  assert.equal(route.dynamic, "force-static");
  const response = route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/manifest+json");
  assert.match(response.headers.get("cache-control"), /^public,/);
  assert.equal(response.headers.get("set-cookie"), null);
  const manifest = await response.json();
  assert.equal(manifest.id, "/my");
  assert.equal(manifest.start_url, "/my");
  assert.equal(manifest.display, "standalone");
  for (const origin of ["https://members.theruinedproject.com", "https://preview.example.test", "http://localhost:3000"]) {
    const url = `${origin}/my/manifest.webmanifest`;
    const scope = new URL(manifest.scope, url);
    assert.equal(scope.href, `${origin}/`);
    assert.equal(new URL(manifest.start_url, url).href, `${origin}/my`);
    for (const path of ["/my", "/my/card", "/access", "/api/auth/callback"]) assert.ok(new URL(path, origin).href.startsWith(scope.href));
    for (const icon of manifest.icons) assert.equal(new URL(icon.src, url).origin, origin);
  }
  assert.equal(JSON.stringify(manifest).includes("theruinedproject.com"), false, "canonical public metadata must not send installed members to another origin");
});

test("member app icons retain the approved artwork at truthful 192px and 512px sizes", async () => {
  const { GET } = await load("app/my/manifest.webmanifest/route.ts");
  const manifest = await GET().json();
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
  for (const icon of manifest.icons) {
    const data = await readFile(new URL(`../public${icon.src}`, import.meta.url));
    const metadata = await sharp(data).metadata();
    assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes);
    assert.equal(icon.type, `image/${metadata.format}`);
  }
  const original = await readFile(new URL("../public/favicon-ruined-mark-v2.png", import.meta.url));
  const member = await readFile(new URL("../public/member-app-icon-192.png", import.meta.url));
  assert.deepEqual(member, await sharp(original).resize(192, 192).png().toBuffer(), "192px export changes only size, retaining the exact mark and its framing");
});

test("the public manifest retains its public landing and scene presentation", async () => {
  const { default: publicManifest } = await load("app/manifest.ts", { "@/data/sequences": { SEQUENCE_OPENING_FRAME: "/scene-opening.webp" } });
  const manifest = publicManifest();
  assert.equal(manifest.name, "Ruined — After the Fear");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.description, "Artifacts, projects, and the Ruined studio.");
  assert.deepEqual(manifest.icons, [{ src: "/favicon-ruined-mark-v2.png", sizes: "512x512", type: "image/png" }]);
  assert.equal(manifest.screenshots[0].src, "/scene-opening.webp");
});
