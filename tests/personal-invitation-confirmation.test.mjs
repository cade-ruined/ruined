import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as confirmation from "../src/lib/auth/email-confirmation.ts";

const token = "P".repeat(43);

async function load(relativePath, dependencies) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object") return [];
  return [node, ...elements(node.props?.children)];
}

function content(node) {
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (node && typeof node === "object") return content(node.props?.children);
  return typeof node === "string" ? node : "";
}

test("confirmation page forwards only the validated navigation cookie and never callback credentials", async () => {
  const Status = () => null;
  let cookieValue;
  const route = await load("../app/my/confirmed/page.tsx", {
    "next/headers": { cookies: async () => ({ get: name => {
      assert.equal(name, "ruined-invitation-context");
      return cookieValue === undefined ? undefined : { value: cookieValue };
    } }) },
    "@/components/platform/MemberEmailConfirmationStatus": { default: Status },
    "@/lib/auth/request": { MEMBER_INVITATION_CONTEXT_COOKIE: "ruined-invitation-context" },
    "@/lib/membership/invitation-model": { MEMBER_INVITATION_TOKEN: /^[A-Za-z0-9_-]{43}$/ },
    "@/lib/sharing": { privateSharingMetadata: { robots: { index: false, follow: false } } },
  });
  for (const invitation of [token, undefined, [token, token], "https://attacker.example", "P".repeat(42), `${token}/../access`]) {
    cookieValue = invitation;
    const tree = await route.default({ searchParams: Promise.resolve({ invitation: "Q".repeat(43), code: "SECRET-CODE", access_token: "SECRET-ACCESS", email: "PRIVATE@example.test", next: "https://attacker.example" }) });
    const status = elements(tree).find(element => element.type === Status);
    assert.deepEqual(status.props, { invitationToken: invitation === token ? token : undefined });
    assert.doesNotMatch(JSON.stringify(tree), /SECRET|PRIVATE|attacker|Q{43}/);
  }
  assert.equal(route.metadata.referrer, "no-referrer");
  assert.equal(route.metadata.robots.index, false);
});

async function statusFixture() {
  let status = "neutral";
  const consumed = { current: false };
  let effect;
  const Link = () => null;
  const loaded = await load("../src/components/platform/MemberEmailConfirmationStatus.tsx", {
    "next/link": { default: Link },
    react: {
      useState: () => [status, value => { status = value; }],
      useRef: () => consumed,
      useLayoutEffect: callback => { effect = callback; },
    },
    "@/lib/auth/email-confirmation": confirmation,
  });
  return {
    render: invitationToken => loaded.default({ invitationToken }),
    consume: () => effect(),
    link: tree => elements(tree).find(element => element.type === Link),
  };
}

test("personal confirmation keeps its invitation after scrubbing callback credentials and does not claim membership", async () => {
  const fixture = await statusFixture();
  const originalWindow = globalThis.window;
  const replacements = [];
  const historyState = { preserved: true };
  globalThis.window = {
    history: { state: historyState, replaceState: (state, _, url) => replacements.push({ state, url }) },
    location: { search: "?code=SECRET-CODE", hash: "#access_token=SECRET-ACCESS&type=signup&refresh_token=SECRET-REFRESH" },
  };
  try {
    const neutral = fixture.render(token);
    assert.match(content(neutral), /Visiting this page by itself does not confirm an email or grant access/);
    fixture.consume();
    const confirmed = fixture.render(token);
    fixture.consume();
    assert.deepEqual(replacements, [{ state: historyState, url: "/my/confirmed" }]);
    assert.equal(fixture.link(confirmed).props.href, `/invitation/${token}#accept-invitation`);
    assert.equal(fixture.link(confirmed).props.referrerPolicy, "no-referrer");
    assert.match(content(confirmed), /Continue to invitation/);
    assert.match(content(confirmed), /sign in with a one-time code and accept it/);
    assert.doesNotMatch(content(confirmed), /SECRET|signed in|membership complete/i);
    const withoutContext = fixture.render(undefined);
    assert.equal(fixture.link(withoutContext).props.href, "/access");
    assert.match(content(withoutContext), /If you were invited by a member, reopen your invitation to continue joining/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("failed personal confirmations return to the invitation while ordinary and malformed visits retain access", async () => {
  const fixture = await statusFixture();
  const originalWindow = globalThis.window;
  globalThis.window = {
    history: { state: null, replaceState: () => {} },
    location: { search: "?error_code=otp_expired", hash: "" },
  };
  try {
    fixture.render(token);
    fixture.consume();
    const failed = fixture.render(token);
    assert.match(content(failed), /Return to your invitation to request another email/);
    assert.equal(fixture.link(failed).props.href, `/invitation/${token}#accept-invitation`);
    for (const value of [undefined, "", "https://attacker.example", `${token}/../other`]) {
      const tree = fixture.render(value);
      assert.equal(fixture.link(tree).props.href, "/access");
      assert.match(content(tree), /Return to access/);
    }
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
