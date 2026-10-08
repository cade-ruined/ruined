import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import * as canvas from "@napi-rs/canvas";
import sharp from "sharp";
import * as parse5 from "parse5";
import ts from "typescript";

async function load(file, dependencies = {}) {
  const output = ts.transpileModule(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = await load("src/lib/communications/admin-email-model.ts");
const templates = await load("src/lib/communications/resend-email-templates.ts", { parse5, "./admin-email-model": model });
const layout = await load("src/lib/communications/email-sign-off-layout.ts");
const uploads = [];
const renderer = await load("src/lib/communications/admin-email-sign-off.ts", {
  "server-only": {}, "node:path": path, "@napi-rs/canvas": canvas,
  "./admin-email-model": model, "./email-sign-off-layout": layout, "./resend-email-templates": templates,
  "./admin-email-images": { uploadAdminEmailImage: async (actor, file) => {
    uploads.push({ actor, file }); return { url: "https://images.example.com/immutable-sign-off.png" };
  } },
});

test("actual CadeHandy2 lettering has transparent safety padding, brand yellow, and restrained dimensions", async () => {
  const result = await renderer.renderAdminEmailSignOff("All the love");
  const { data, info } = await sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, result.width * 3);
  assert.equal(info.height, result.height * 3);
  assert.ok(result.width <= 280 && result.width > 40);
  assert.ok(result.height <= 56 && result.height > 16);
  let opaque = 0;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] > 0) {
      assert.ok(x >= 24 && y >= 24 && x < info.width - 23 && y < info.height - 23, "ink must not touch any edge");
      if (data[i + 3] === 255) { opaque += 1; assert.deepEqual([...data.slice(i, i + 3)], [255, 202, 44]); }
    }
  }
  assert.ok(opaque > 100, "the actual font must produce substantial visible lettering");
  const short = await renderer.renderAdminEmailSignOff("Cade");
  assert.ok(short.width < result.width, "short phrases must not stretch to fill the line");
  await assert.rejects(renderer.renderAdminEmailSignOff("W".repeat(80)), /Shorten/);
  await assert.rejects(renderer.renderAdminEmailSignOff("\ninvalid"), /one line|sign-off|control/i);
});

test("preview never uploads; persistent artwork keeps the same PNG and display dimensions", async () => {
  const preview = await renderer.prepareAdminEmailSignOff("actor-one", "All the love", false);
  assert.equal(uploads.length, 0);
  assert.match(preview.url, /^data:image\/png;base64,/);
  const stored = await renderer.prepareAdminEmailSignOff("actor-one", "All the love", true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].actor, "actor-one");
  assert.equal(uploads[0].file.type, "image/png");
  assert.deepEqual(Buffer.from(await uploads[0].file.arrayBuffer()), Buffer.from(preview.url.split(",")[1], "base64"));
  assert.deepEqual(stored, { url: "https://images.example.com/immutable-sign-off.png", width: preview.width, height: preview.height });
});
