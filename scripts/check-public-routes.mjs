import assert from "node:assert/strict";

// Run against a built preview as well as development: a root loading boundary
// can flush HTTP 200 before Next discovers a missing page or catalogue slug.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3317");
const missing = ["/zz-nothing-here", "/about/zz", "/store/zz-nothing-here", "/community/zz-nothing-here"];
const agents = [
  "Mozilla/5.0 (compatible; RuinedRouteCheck/1.0)",
  "Googlebot",
];

for (const userAgent of agents) {
  for (const path of missing) {
    const response = await fetch(new URL(path, base), {
      headers: { "User-Agent": userAgent },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    const html = await response.text();
    assert.equal(response.status, 404, `${path}: expected a real 404 for ${userAgent}`);
    assert.match(html, /Nothing lives here\./, `${path}: branded recovery screen missing`);
    assert.match(html, /<title>Page not found(?: — Ruined)?<\/title>/, `${path}: incorrect title`);
    assert.match(html, /<meta name="robots" content="[^"]*noindex/, `${path}: missing noindex`);
    assert.doesNotMatch(html, /<link rel="canonical"/, `${path}: missing pages must not claim a canonical destination`);
    console.log(`PASS ${path}: 404, noindex, correct title (${userAgent === "Googlebot" ? "crawler" : "browser"})`);
  }
}

for (const [path, canonical] of [["/", "https://theruinedproject.com"], ["/community", "https://theruinedproject.com/community"]]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000) });
  const html = await response.text();
  assert.equal(response.status, 200, `${path}: public page unavailable`);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), `${path}: incorrect canonical`);
  assert.ok(html.includes('href="https://members.theruinedproject.com/membership"'), `${path}: public membership link missing`);
  console.log(`PASS ${path}: public page and membership link`);
}
