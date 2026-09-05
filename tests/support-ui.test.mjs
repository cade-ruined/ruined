import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const modules = new Map();

function load(path, overrides = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in overrides) return overrides[name];
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }) };
    if (name === "server-only") return {};
    if (name.startsWith("@/")) {
      const sourcePath = `src/${name.slice(2)}`;
      const file = [".tsx", ".ts"].map((extension) => `${sourcePath}${extension}`).find((item) => existsSync(new URL(`../${item}`, import.meta.url)));
      if (!file) throw new Error(`Missing UI dependency: ${name}`);
      if (!modules.has(file)) modules.set(file, load(file));
      return modules.get(file);
    }
    return require(name);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const { PREVIEW_SUPPORT_TICKETS } = load("src/lib/support/preview.ts");

test("member support renders every help topic, bounded fields, and a disabled preview submission", () => {
  const MemberSupport = load("src/components/support/MemberSupport.tsx").default;
  const { SUPPORT_CATEGORIES } = load("src/lib/support/model.ts");
  const html = renderToStaticMarkup(React.createElement(MemberSupport, { tickets: PREVIEW_SUPPORT_TICKETS, writable: false }));
  for (const category of SUPPORT_CATEGORIES) assert.ok(html.includes(`value="${category.value}"`));
  assert.match(html, /Preview — requests are not sent/);
  assert.match(html, /maxLength="120"/);
  assert.match(html, /maxLength="5000"/);
  assert.match(html, /disabled="" type="submit"/);
  assert.match(html, /href="\/my\/support\/80000000-0000-4000-8000-000000000001"/);
  assert.doesNotMatch(html, /member@example\.test/);
});

test("operator queue links to operator threads and defaults to unresolved requests", () => {
  const OperatorSupport = load("src/components/support/OperatorSupport.tsx").default;
  const resolved = { ...PREVIEW_SUPPORT_TICKETS[0], id: "resolved-id", subject: "Resolved example", status: "resolved" };
  const html = renderToStaticMarkup(React.createElement(OperatorSupport, { tickets: [...PREVIEW_SUPPORT_TICKETS, resolved], writable: false }));
  assert.match(html, /href="\/ops\/support\/80000000-0000-4000-8000-000000000001"/);
  assert.doesNotMatch(html, /Resolved example/);
  assert.match(html, /Waiting for member/);
  assert.match(html, /member@example\.test/);
  assert.match(html, /2 shown/);
  assert.doesNotMatch(html, /Email notifications to connect@ are not enabled yet/);
});

test("operator support explains unsent email until delivery is enabled", () => {
  const OperatorSupport = load("src/components/support/OperatorSupport.tsx").default;
  const withoutEmail = renderToStaticMarkup(React.createElement(OperatorSupport, { tickets: [], writable: true }));
  assert.match(withoutEmail, /Requests are saved here\. Email notifications to connect@ are not enabled yet\./);
  const withEmail = renderToStaticMarkup(React.createElement(OperatorSupport, { tickets: [], writable: true, emailReady: true }));
  assert.doesNotMatch(withEmail, /Email notifications to connect@ are not enabled yet/);
});

test("support messages are rendered as escaped text and members cannot see operator status controls", () => {
  const SupportThread = load("src/components/support/SupportThread.tsx").default;
  const ticket = { ...PREVIEW_SUPPORT_TICKETS[0], status: "resolved", messages: [{ ...PREVIEW_SUPPORT_TICKETS[0].messages[0], body: '<script>alert("unsafe")</script>' }] };
  const html = renderToStaticMarkup(React.createElement(SupportThread, { initialTicket: ticket, writable: true }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /A new reply reopens this request/);
  assert.doesNotMatch(html, /Save status|member@example\.test/);
});

test("support pages accept a signed-in account without checking paid membership and restrict ops to admins", async () => {
  const viewer = { authUserId: "11111111-1111-4111-8111-111111111111", email: "member@example.test" };
  for (const [role, operator, expected] of [["guide", true, "denied"], ["circle_leader", true, "denied"], ["ops_admin", true, "authenticated"], [null, false, "authenticated"]]) {
    const { getSupportPageContext } = load("src/lib/support/page-context.ts", {
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
      "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
      "@/lib/platform/repository": { getOperatorRole: async () => role },
    });
    assert.equal((await getSupportPageContext(operator)).state, expected);
  }
});

test("support preview never loads an identity and a connected signed-out account must sign in", async () => {
  for (const [mode, expected] of [["preview", "preview"], ["connected", "signed_out"]]) {
    let identityReads = 0;
    const { getSupportPageContext } = load("src/lib/support/page-context.ts", {
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
      "@/lib/auth/session": { getCurrentPlatformViewer: async () => { identityReads += 1; return null; } },
      "@/lib/platform/repository": { getOperatorRole: async () => { throw new Error("Unexpected operator read"); } },
    });
    assert.equal((await getSupportPageContext()).state, expected);
    assert.equal(identityReads, mode === "preview" ? 0 : 1);
  }
});

test("operator delivery status distinguishes safe retry from uncertain delivery and is never shown to members", () => {
  const SupportThread = load("src/components/support/SupportThread.tsx").default;
  const row = { id: "delivery", audience: "member", status: "dead_letter", attempts: 5, first_attempt_at: "2026-01-01T00:00:00Z", last_error: "not_sent:provider_http_429", created_at: "2026-01-01T00:00:00Z", sent_at: null };
  const render = (delivery, operator = true) => renderToStaticMarkup(React.createElement(SupportThread, { initialTicket: { ...PREVIEW_SUPPORT_TICKETS[0], emailDeliveries: [delivery] }, operator, writable: true }));
  assert.match(render(row), /Retry unsent email/);
  const uncertain = { ...row, last_error: "uncertain:provider_timeout" };
  assert.match(render(uncertain), /Review delivery/);
  assert.match(render(uncertain), /Check Resend before contacting/);
  assert.doesNotMatch(render(uncertain), /Retry unsent email/);
  assert.doesNotMatch(render(row, false), /Email notifications|Retry unsent email/);
  assert.match(render({ ...row, status: "sent", last_error: null }), /Accepted by email provider/);
  assert.match(render({ ...row, status: "sent", last_error: null }), /not inbox delivery/);
});
