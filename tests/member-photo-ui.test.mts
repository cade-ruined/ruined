import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

async function load(path: string, dependencies: Record<string, unknown> = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => {
    if (name in dependencies) return dependencies[name];
    if (["react", "react/jsx-runtime"].includes(name)) return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports as Record<string, (...args: never[]) => unknown>;
}

const policy = await load("src/lib/membership/photo-policy.ts");
const { safeMemberAvatarUrl } = await load("src/lib/membership/avatar-url.ts", { "./photo-policy": policy }) as unknown as { safeMemberAvatarUrl: (value: string | null) => string | null };
const privateUrl = "/api/member-photos/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";

test("avatar mapping preserves real portraits but rejects ambiguous and malformed private URLs", () => {
  for (const value of [privateUrl, "/membership/portrait.webp", "https://images.example.test/photo.webp"]) {
    assert.equal(safeMemberAvatarUrl(value), value);
  }
  for (const value of [null, "//evil.example/photo", "/\\evil.example/photo", "javascript:alert(1)", "data:image/png;base64,x", "https://user:password@example.test/photo", `${privateUrl}?bypass=true`, "/api/member-photos/not-a-member/photo.webp", "\nhttps://example.test/photo"]) {
    assert.equal(safeMemberAvatarUrl(value), null);
  }
});

const { default: PhotoUpload } = await load("src/components/membership/MemberPhotoUpload.tsx", {
  "@/lib/membership/photo-policy": policy,
  "next/image": ({ src, alt, unoptimized }: { src: string; alt: string; unoptimized: boolean }) => React.createElement("img", { src, alt, "data-unoptimized": String(unoptimized) }),
});

test("photo control renders accessible, square, independent upload controls without nested forms", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoUpload, { avatarUrl: null, enabled: true, onChange: () => {} }));
  assert.match(html, /aspect-square/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /aria-label="Choose profile photo"/);
  assert.match(html, /type="file"/);
  assert.match(html, /type="button"/);
  assert.match(html, /Choose photo/);
  assert.doesNotMatch(html, /<form|Remove photo|disabled=""/);
});

test("existing photo bypasses shared image optimization and exposes replace and remove actions", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoUpload, { avatarUrl: privateUrl, enabled: true, onChange: () => {} }));
  assert.match(html, /data-unoptimized="true"/);
  assert.ok(html.includes(`src="${privateUrl}"`));
  assert.match(html, /Change photo/);
  assert.match(html, /Remove photo/);
});

test("unconfigured storage disables upload without blocking the independent profile form", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoUpload, { avatarUrl: null, enabled: true, available: false, onChange: () => {} }));
  assert.match(html, /disabled=""/);
  assert.match(html, /You can save your details without a photo/);
  assert.doesNotMatch(html, /Photo upload will open when/);
});
