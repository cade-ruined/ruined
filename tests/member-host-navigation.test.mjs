import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server.js";

import nextConfig from "../next.config.mjs";
import { PRODUCTION_SITE_URL, publicWebsiteHref } from "../src/lib/site.ts";

const MEMBER_ORIGIN = "https://members.theruinedproject.com";

async function configuredResponse(url) {
  return unstable_getResponseFromNextConfig({ url, nextConfig });
}

test("the membership host opens access and preserves entry query parameters", async () => {
  const response = await configuredResponse(`${MEMBER_ORIGIN}/?returnTo=%2Fmy%2Fsupport`);

  assert.equal(response.status, 307);
  assert.equal(getRedirectUrl(response), `${MEMBER_ORIGIN}/access?returnTo=%2Fmy%2Fsupport`);
});

test("membership entry redirect matches only the exact membership host", async () => {
  for (const origin of [
    "https://theruinedproject.com",
    "https://www.theruinedproject.com",
    "http://localhost:3000",
    "https://ruined-members-preview.vercel.app",
    "https://membersXtheruinedprojectXcom",
    "https://members.theruinedproject.com.example.com",
  ]) {
    const response = await configuredResponse(`${origin}/`);
    assert.equal(response.status, 200, origin);
    assert.equal(getRedirectUrl(response), null, origin);
  }
});

test("membership entry redirect leaves access and private deep links unchanged", async () => {
  for (const path of ["/access", "/my", "/my/access", "/my/join", "/ops", "/ops/operators"]) {
    const response = await configuredResponse(`${MEMBER_ORIGIN}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(getRedirectUrl(response), null, path);
  }
});

test("public website destinations escape the membership host without changing other deployments", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  const paths = ["/", "/#top", "/#events", "/contact", "/privacy"];

  try {
    for (const origin of [MEMBER_ORIGIN, `${MEMBER_ORIGIN}/`]) {
      process.env.NEXT_PUBLIC_SITE_URL = origin;
      for (const path of paths) {
        assert.equal(publicWebsiteHref(path), `${PRODUCTION_SITE_URL}${path}`, `${origin}${path}`);
      }
    }

    for (const origin of [
      undefined,
      "",
      "https://theruinedproject.com",
      "https://www.theruinedproject.com",
      "http://localhost:3000",
      "https://ruined-members-preview.vercel.app",
      "https://membersXtheruinedprojectXcom",
      "https://members.theruinedproject.com.example.com",
    ]) {
      if (origin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = origin;

      for (const path of paths) {
        assert.equal(publicWebsiteHref(path), path, `${origin}${path}`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("website exits use public destinations while membership and operator navigation stay local", async () => {
  const [header, footer, platform] = await Promise.all([
    readFile(new URL("../src/components/SiteHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/SiteFooter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/platform/PlatformShell.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(header, /href=\{publicWebsiteHref\("\/#top"\)\}/);
  assert.match(header, /href=\{publicWebsiteHref\(item\.href\)\}/);
  assert.match(header, /href=\{publicWebsiteHref\(SITE_ROUTES\.contact\.href\)\}/);
  assert.match(header, /href=\{SITE_ROUTES\.my\.href\}/);
  assert.match(footer, /href=\{publicWebsiteHref\("\/contact"\)\}/);
  assert.match(footer, /href=\{publicWebsiteHref\(href\)\}/);
  assert.equal(platform.match(/href=\{publicWebsiteHref\("\/"\)\}/g)?.length, 2);
  assert.match(platform, /href="\/access"/);
  assert.match(platform, /href=\{item\.href\}/);
});
