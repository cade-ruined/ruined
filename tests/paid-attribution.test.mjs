import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const output = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, output, output.exports);
  return output.exports;
}
const consent = load("src/lib/marketing/consent.ts");
const tracking = load("src/lib/marketing/attribution.ts", { "./consent": consent });
const now = Date.parse("2026-11-02T12:00:00.000Z");
const query = "utm_source=ig&utm_medium=paid_social&utm_campaign=120252930805990325&utm_term=120252930805980325&utm_content=120252930805970325";
const visit = (at = now, search = query) => tracking.paidVisitFromLocation(search, "/store/ruined-hoodie", at);

// Exercise data arriving from an actual tagged URL, then the browser-storage and
// server-attribute validators; avoid a fixture that assumes these boundaries agree.
test("paid URL becomes exact first/latest advertising IDs without click identifiers, full URLs or customer data", () => {
  const first = visit(now, query + "&fbclid=unique-click-id&email=private@example.com");
  assert.deepEqual(first, { at: "2026-11-02T12:00:00.000Z", source: "ig", medium: "paid_social", campaignId: "120252930805990325", adsetId: "120252930805980325", adId: "120252930805970325", landingPath: "/store/ruined-hoodie" });
  const saved = tracking.mergePaidAttribution(null, first, now);
  const attributes = tracking.paidAttributionAttributes(saved, { marketing: true, analytics: true }, now);
  assert.equal(attributes.find(item => item.key === "ruined_attribution_first_campaignId").value, first.campaignId);
  assert.equal(attributes.find(item => item.key === "ruined_attribution_latest_adId").value, first.adId);
  assert.doesNotMatch(JSON.stringify(attributes), /unique-click-id|private@example|https?:|fbclid|email/);
});

test("direct and organic visits preserve paid history; a different ad updates latest and repeat view does not refresh its timestamp", () => {
  const first = visit();
  const saved = tracking.mergePaidAttribution(null, first, now);
  for (const search of ["", "utm_source=instagram&utm_medium=social&utm_campaign=120252930805990325", "utm_source=google&utm_medium=organic"]) {
    assert.deepEqual(tracking.mergePaidAttribution(saved, visit(now + 5000, search), now + 5000), saved);
  }
  assert.deepEqual(tracking.mergePaidAttribution(saved, visit(now + 1000), now + 1000), saved);
  const nextVisit = visit(now + 1000, query.replace("970325", "970326"));
  const next = tracking.mergePaidAttribution(saved, nextVisit, now + 1000);
  assert.deepEqual(next.first, first);
  assert.deepEqual(next.latest, nextVisit);
  const laterSameAd = visit(now + 31 * 60 * 1000);
  assert.deepEqual(tracking.mergePaidAttribution(saved, laterSameAd, now + 31 * 60 * 1000).latest, laterSameAd);
});

test("30-day expiry prunes old history, rejects future or reversed timestamps, and does not create a visit on direct navigation", () => {
  const first = visit();
  const saved = tracking.mergePaidAttribution(null, first, now);
  const expires = now + tracking.PAID_ATTRIBUTION_TTL_MS;
  assert.equal(tracking.readPaidAttribution(saved, expires), null);
  assert.equal(tracking.mergePaidAttribution(saved, null, expires), null);
  assert.ok(tracking.readPaidAttribution(saved, expires - 1));
  assert.equal(tracking.readPaidAttribution(saved, now - 6 * 60 * 1000), null);
  const latest = visit(now + 1000, query.replace("970325", "970326"));
  assert.deepEqual(tracking.readPaidAttribution({ version: 1, first, latest }, expires), { version: 1, first: latest, latest });
  assert.equal(tracking.readPaidAttribution({ version: 1, first: latest, latest: first }, now + 1000), null);
});

test("unexpanded macros, campaign names, duplicate keys and private landing routes never become an order attribution record", () => {
  for (const search of [
    query.replace("120252930805990325", "{{campaign.id}}"), query.replace("120252930805990325", "Fall sale"),
    query.replace("utm_source=ig", "utm_source=customer@example.com"), query.replace("paid_social", "organic"),
    query + "&utm_campaign=123", query + "&utm_content=123", query.replace("970325", "970325\n"),
  ]) assert.equal(visit(now, search), null, search);
  for (const path of ["/my", "/login", "/store/hoodie?email=private", "/store/hoodie#secret", "/api/store/cart"]) {
    assert.equal(tracking.paidVisitFromLocation(query, path, now), null);
  }
  assert.equal(visit(now, "a".repeat(4097)), null);
  const saved = tracking.mergePaidAttribution(null, visit(), now);
  assert.equal(tracking.readPaidAttribution({ ...saved, email: "private@example.com" }, now), null);
  assert.equal(tracking.readPaidAttribution({ ...saved, latest: { ...saved.latest, fbclid: "private-click" } }, now), null);
});

test("unknown, denied or partially allowed consent never exports saved history; clearing only removes our namespace", () => {
  const saved = tracking.mergePaidAttribution(null, visit(), now);
  for (const choice of [undefined, {}, { marketing: true }, { analytics: true }, { marketing: false, analytics: true }, { marketing: true, analytics: false }, { marketing: true, analytics: true, saleOfData: false }]) {
    assert.deepEqual(tracking.paidAttributionAttributes(saved, choice, now), []);
  }
  const unrelated = [{ key: "gift_note", value: "Keep this note" }, { key: "third_party", value: "opaque" }];
  const managed = tracking.paidAttributionAttributes(saved, { marketing: true, analytics: true, saleOfData: true }, now);
  assert.deepEqual(tracking.replaceAttributionAttributes([...unrelated, ...managed], []), unrelated);
  assert.deepEqual(tracking.replaceAttributionAttributes([...unrelated, ...managed], managed), [...unrelated, ...managed]);
});
