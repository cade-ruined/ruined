import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const id = "4a5cb31c-65a9-4e23-b069-0bb88ee3a441";
class RepositoryError extends Error {
  constructor(code) { super("Private record details must not be exposed"); this.code = code; }
}
class NavigationSignal extends Error {
  constructor(kind, path) { super(kind); this.kind = kind; this.path = path; }
}

function fixture(options = {}) {
  const calls = [];
  const errors = [];
  const context = { state: "authenticated", dashboard: {}, viewer: { authUserId: "verified-operator" }, ...options.context };
  const experience = options.experience === undefined ? { id, title: "Saved meeting" } : options.experience;
  const directory = { blocks: [{ id: "block" }], circles: [{ id: "circle" }], privateInternalField: "not passed" };
  const Record = (props) => React.createElement("div", { "data-record": props.experience.id }, props.experience.title);
  const Unavailable = (props) => React.createElement("div", { "data-unavailable": props.reason ?? "connection" });
  const dependencies = {
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": {
      notFound() { throw new NavigationSignal("notFound"); },
      redirect(path) { throw new NavigationSignal("redirect", path); },
    },
    "@/components/platform/OperatorExperienceRecord": { __esModule: true, default: Record },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: Unavailable },
    "@/components/platform/operatorStyles": { OPERATOR_BUTTON_CLASS: "operator-button" },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => context },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError },
    "@/lib/platform/ops-experience-preview": { getPreviewOpsExperienceRecord: () => experience, PREVIEW_OPS_EXPERIENCE_DIRECTORY: directory },
    "@/lib/platform/ops-experience-repository": {
      async getOpsExperienceRecord(actor, experienceId) {
        calls.push(["record", actor, experienceId]);
        if (options.recordError) throw options.recordError;
        return experience;
      },
      async getOpsExperienceManagementDirectory(actor) {
        calls.push(["directory", actor]);
        if (options.directoryError) throw options.directoryError;
        return directory;
      },
    },
  };
  const output = ts.transpileModule(readFileSync(new URL("../app/ops/experiences/[experienceId]/page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "console", "fetch", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, loadedModule, loadedModule.exports, { error: (...args) => errors.push(args) }, () => { throw new Error("Network calls are forbidden"); });
  return { calls, errors, Record, Unavailable, run: () => loadedModule.exports.default({ params: Promise.resolve({ experienceId: id }) }) };
}

test("Experience page keeps its verified actor and exact event, and returns only the intended directory fields", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.type, f.Record);
  assert.equal(result.props.experience.id, id);
  assert.deepEqual(Object.keys(result.props.directory).sort(), ["blocks", "circles"]);
  assert.deepEqual(f.calls, [["record", "verified-operator", id], ["directory", "verified-operator"]]);
  assert.deepEqual(f.errors, []);
});

test("missing and invalid Experience records remain 404s instead of claiming a connection or login failure", async () => {
  for (const options of [{ experience: null }, { recordError: new RepositoryError("not_found") }, { recordError: new RepositoryError("invalid_request") }]) {
    const f = fixture(options);
    await assert.rejects(f.run, (error) => error instanceof NavigationSignal && error.kind === "notFound");
    assert.deepEqual(f.errors, []);
  }
});

test("record or directory failures show recovery actions and log only a safe database code, not private error details", async () => {
  for (const failedLoader of ["recordError", "directoryError"]) {
    const error = Object.assign(new Error("secret connection string and member details"), { code: "25006", detail: "private payload" });
    const f = fixture({ [failedLoader]: error });
    const html = renderToStaticMarkup(await f.run());
    assert.match(html, /This Experience couldn’t load/);
    assert.match(html, new RegExp(`href="/ops/experiences/${id}"`));
    assert.match(html, /Try again/);
    assert.match(html, /Back to Experiences/);
    assert.doesNotMatch(html, /Connection required|passwordless|\/ops\/access|secret|private payload/);
    assert.deepEqual(f.errors, [["Operations Experience record could not be loaded", { errorCode: "25006", errorType: "Error" }]]);
  }
  const f = fixture({ recordError: { code: "private arbitrary message", detail: "private" } });
  await f.run();
  assert.deepEqual(f.errors[0][1], { errorCode: null, errorType: "UnknownError" });
});

test("access loss remains denied and missing sign-in redirects before any Experience read", async () => {
  const denied = fixture({ recordError: new RepositoryError("forbidden") });
  assert.equal((await denied.run()).props.reason, "operator_access");
  assert.deepEqual(denied.errors, []);
  const signedOut = fixture({ context: { state: "signed_out", dashboard: null, viewer: null } });
  await assert.rejects(signedOut.run, (error) => error.kind === "redirect" && error.path === "/ops/access");
  assert.deepEqual(signedOut.calls, []);
  for (const context of [{ state: "denied" }, { dashboard: null }, { viewer: null }]) {
    const f = fixture({ context });
    assert.equal((await f.run()).type, f.Unavailable);
    assert.deepEqual(f.calls, []);
  }
});

test("preview remains isolated and a nonexistent preview also reaches the normal 404", async () => {
  const f = fixture({ context: { state: "preview", viewer: null } });
  assert.equal((await f.run()).props.preview, true);
  assert.deepEqual(f.calls, []);
  const missing = fixture({ context: { state: "preview", viewer: null }, experience: null });
  await assert.rejects(missing.run, (error) => error.kind === "notFound");
  assert.deepEqual(missing.calls, []);
});
