import assert from "node:assert/strict";
import test from "node:test";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server.js";
import { membershipEmbedDestination, membershipEmbedNavigationMessage, membershipEmbedParentOrigin } from "../src/lib/membership/landing-embed.ts";

test("embed handoff sends only a safe member path, never query or account data", () => {
  for (const path of ["/my", "/my/join", "/my/activate", "/my/registered", "/ops", "/ops/work", "/access", "/membership#your-invitation"]) {
    assert.deepEqual(membershipEmbedNavigationMessage(path), { type: "ruined:membership:navigate", path });
  }
  assert.equal(membershipEmbedDestination("/my/account?view=profile&email=private@example.test&token=secret"), "/my/account");
  assert.equal(membershipEmbedDestination("/my/join#private-value"), "/my/join");
  for (const value of [undefined, {}, "https://members.theruinedproject.com/my", "https://evil.test/my", "//evil.test/my", "/my/../ops", "/my/%2e%2e/ops", "/my\\evil", "/my\n/evil", "/my-other", "/api/auth/otp/verify", "/membership/embed", "/membership/embed?email=private@example.test"]) {
    assert.equal(membershipEmbedNavigationMessage(value), null, String(value));
  }
});

test("embed messages target only a main-site parent, with fixed local origins in development", () => {
  for (const origin of ["https://theruinedproject.com", "https://www.theruinedproject.com"]) {
    assert.equal(membershipEmbedParentOrigin(`${origin}/#members`), origin);
  }
  for (const origin of ["http://localhost:3300", "http://127.0.0.1:3300"]) {
    assert.equal(membershipEmbedParentOrigin(origin), null);
    assert.equal(membershipEmbedParentOrigin(origin, true), origin);
  }
  for (const origin of ["", "null", "https://evil.test", "https://theruinedproject.com.evil.test", "http://theruinedproject.com", "http://localhost:3302", "http://127.0.0.1:3301"]) {
    assert.equal(membershipEmbedParentOrigin(origin, true), null, origin);
  }
});

test("production framing exception is exact and never opens auth, operator, API, or payment routes", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { default: config } = await import("../next.config.mjs?membership-embed-production");
  if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  const response = (path: string) => unstable_getResponseFromNextConfig({ url: `https://members.theruinedproject.com${path}`, nextConfig: config });
  const embed = await response("/membership/embed");
  assert.equal(embed.headers.get("X-Frame-Options"), null);
  assert.match(embed.headers.get("Content-Security-Policy")!, /frame-ancestors https:\/\/theruinedproject\.com https:\/\/www\.theruinedproject\.com(?:;|$)/);
  assert.doesNotMatch(embed.headers.get("Content-Security-Policy")!, /localhost|127\.0\.0\.1/);
  assert.equal(embed.headers.get("X-Robots-Tag"), "noindex, nofollow");
  for (const path of ["/membership", "/membership/embedded", "/membership/embed/other", "/membership/embed.json", "/signup", "/access", "/my", "/my/activate", "/ops", "/ops/emails", "/api/auth/otp/verify", "/api/stripe/checkout", "/invitation/example"]) {
    const protectedResponse = await response(path);
    assert.equal(protectedResponse.headers.get("X-Frame-Options"), "DENY", path);
    assert.match(protectedResponse.headers.get("Content-Security-Policy")!, /frame-ancestors 'none'/, path);
  }
});
