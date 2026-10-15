import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const viewer = { authUserId: "verified-circle-member", email: "member@example.test" };
class MembershipAccessDeniedError extends Error {}
class NavigationSignal extends Error {
  constructor(kind, href) { super(kind); this.kind = kind; this.href = href; }
}
const navigation = {
  redirect: href => { throw new NavigationSignal("redirect", href); },
  notFound: () => { throw new NavigationSignal("notFound"); },
};

function load(path, dependencies) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "console", "fetch", output)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected dependency: ${name}`);
  }, loaded, loaded.exports, { error() {} }, () => { throw Error("Network calls are forbidden"); });
  return loaded.exports;
}

function fixture({ session = "authenticated", denied = false, missingMembership = false, publicProfileHref = null, includeTarget = true, supporter = false } = {}) {
  const calls = [];
  const person = { id: supporter ? "shaper:12" : "member:6", displayName: "Circle Person", publicProfileHref };
  const circle = {
    circle: { id: "approved-circle", name: "Founders Circle" },
    members: includeTarget && !supporter ? [person] : [],
    shaper: includeTarget && supporter ? person : null,
    revealStatus: "revealed",
  };
  const getMemberCircle = async actor => {
    assert.equal(actor, viewer.authUserId);
    calls.push("circle");
    if (denied) throw new MembershipAccessDeniedError();
    return missingMembership ? null : circle;
  };
  // Use the actual shared context: its null-loader result means denied. This
  // catches regressions that resolve a missing target before authorizing its viewer.
  const context = load("src/lib/membership/page-context.ts", {
    "next/headers": {},
    "next/navigation": navigation,
    "./registration-repository": { getMemberRegistrationDestination: async actor => {
      assert.equal(actor, viewer.authUserId); calls.push("registration"); return null;
    } },
    "@/lib/membership/preview-scenarios": {},
    "@/lib/auth/session": { resolveCurrentPlatformSession: async () => ({ status: session, viewer }) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/membership/repository": { MembershipAccessDeniedError },
    "@/lib/platform/experience-member-access": {},
  });
  const Profile = () => null;
  const Unavailable = () => null;
  const Page = load("app/my/circle/people/[personId]/page.tsx", {
    "next/navigation": navigation,
    "@/components/membership/CirclePersonProfile": Profile,
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/membership/page-context": context,
    "@/lib/membership/preview": { PREVIEW_MEMBER_CIRCLE: circle },
    "@/lib/membership/repository": { getMemberCircle },
  }).default;
  return { calls, person, Profile, Unavailable, run: (personId = person.id) => Page({ params: Promise.resolve({ personId }) }) };
}

test("legacy Circle profile redirects signed-out viewers before any membership read", async () => {
  const f = fixture({ session: "signed_out" });
  await assert.rejects(f.run(), error => error.kind === "redirect" && error.href === "/my/access");
  assert.deepEqual(f.calls, []);
});

test("legacy Circle profile preserves genuine membership denial", async () => {
  for (const options of [{ denied: true }, { missingMembership: true }]) {
    const f = fixture(options);
    const result = await f.run();
    assert.equal(result.type, f.Unavailable);
    assert.equal(result.props.reason, "member_access");
    assert.deepEqual(f.calls, ["registration", "circle"]);
  }
});

test("authorized missing or stale Circle targets return to the current roster", async () => {
  for (const options of [{ includeTarget: false }, {}]) {
    const f = fixture(options);
    await assert.rejects(f.run("member:removed"), error => error.kind === "redirect" && error.href === "/my/circle");
    assert.deepEqual(f.calls, ["registration", "circle"]);
  }
});

test("legacy Circle profile redirects only an authorized roster target to its public profile", async () => {
  for (const supporter of [false, true]) {
    const f = fixture({ publicProfileHref: "/profile/circle-person", supporter });
    await assert.rejects(f.run(), error => error.kind === "redirect" && error.href === "/profile/circle-person");
    assert.deepEqual(f.calls, ["registration", "circle"]);
  }
  const outsider = fixture({ publicProfileHref: "/profile/circle-person", includeTarget: false });
  await assert.rejects(outsider.run(), error => error.kind === "redirect" && error.href === "/my/circle");
});

test("members without a public profile retain their authorized private Circle dossier", async () => {
  for (const supporter of [false, true]) {
    const f = fixture({ supporter });
    const result = await f.run();
    assert.equal(result.type, f.Profile);
    assert.deepEqual(result.props, { circleName: "Founders Circle", person: f.person, role: supporter ? "shaper" : "member" });
    assert.deepEqual(f.calls, ["registration", "circle"]);
  }
});

test("session outages stay connection failures instead of 404s or access denial", async () => {
  const f = fixture({ session: "unavailable" });
  const result = await f.run();
  assert.equal(result.type, f.Unavailable);
  assert.equal(result.props.reason, undefined);
  assert.equal(result.props.accessHref, "/my/access");
  assert.deepEqual(f.calls, []);
});
