import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function contextPages(relativeDirectory, contextCall) {
  const directory = new URL(`../${relativeDirectory}/`, import.meta.url);
  const entries = await readdir(directory, { recursive: true });
  const pages = [];

  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.endsWith("page.tsx")) continue;
    const contents = await readFile(new URL(entry, directory), "utf8");
    if (contents.includes(contextCall)) pages.push({ contents, entry });
  }

  return pages.sort((left, right) => left.entry.localeCompare(right.entry));
}

test("permission and connection fallbacks use distinct plain-language copy", async () => {
  const component = await readFile(
    new URL("../src/components/platform/PlatformUnavailable.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /reason\?: "connection" \| "member_access" \| "operator_access"/);
  assert.match(component, /title: "Member access required\."/);
  assert.match(component, /does not have member access/);
  assert.match(component, /email tied to your Ruined Membership/);
  assert.match(component, /title: "Operator access required\."/);
  assert.match(component, /does not have an active operator role/);
  assert.match(component, /title: "We couldn’t load this page\."/);
  assert.match(component, /Please try again/);
  assert.match(component, /window\.location\.reload\(\)/);
  assert.match(component, /mailto:connect@theruinedproject\.com/);
  assert.match(component, /var\(--member-muted,var\(--operator-muted,currentColor\)\)/);
  assert.match(component, /var\(--member-ink,var\(--operator-ink,currentColor\)\)/);
  assert.doesNotMatch(component, /text-black|border-black|text-white|Connection required|being imitated/);
});

test("every member page context handles denied before its unavailable fallback", async () => {
  const modernPages = await contextPages("app/my", "getMembershipPageContext");
  const legacyPages = await contextPages("app/my", "getMemberPageContext(");
  const sharedTimeline = {
    entry: "GuidedTimelinePage.tsx",
    contents: await readFile(new URL("../src/components/membership/GuidedTimelinePage.tsx", import.meta.url), "utf8"),
  };
  const pages = [...modernPages, ...legacyPages, sharedTimeline];

  assert.equal(modernPages.length, 17);
  assert.ok(modernPages.some(page => page.entry === "badges/page.tsx"));
  assert.ok(modernPages.some(page => page.entry === "activate/page.tsx"));
  assert.equal(legacyPages.length, 1);
  for (const { contents, entry } of pages) {
    const denied = contents.indexOf('context.state === "denied"');
    const deniedFallback = contents.indexOf('reason="member_access"');
    assert.ok(denied >= 0, `${entry} must recognize an authenticated non-member`);
    assert.ok(deniedFallback > denied, `${entry} must show the member permission fallback`);
    if (entry === "GuidedTimelinePage.tsx") {
      assert.match(contents, /getSupportAccessUrl\(startNew \? "\/my\/timeline\/new" : "\/my\/timeline"\)/);
      assert.match(contents, /context\.state === "signed_out"[\s\S]*redirect\(accessHref\)/);
    } else {
      assert.match(contents, /context\.state === "signed_out"[\s\S]*redirect\("\/my\/access"\)/);
    }
  }
});

test("every operator page context uses operator permission copy for denied accounts", async () => {
  const pages = [
    ...await contextPages("app/ops", "getOperatorPageContext("),
    ...await contextPages("app/ops", "getOperatorAccessContext("),
  ];
  const overview = await readFile(new URL("../app/ops/page.tsx", import.meta.url), "utf8");

  assert.equal(pages.length, 25);
  assert.ok(pages.some(page => page.entry === "emails/page.tsx"));
  assert.ok(pages.some(page => page.entry === "email-automations/page.tsx"));
  for (const { contents, entry } of pages) {
    const denied = contents.indexOf('context.state === "denied"');
    const deniedFallback = contents.indexOf('reason="operator_access"');
    assert.ok(denied >= 0, `${entry} must recognize an authenticated non-operator`);
    assert.ok(deniedFallback > denied, `${entry} must show the operator permission fallback`);
    assert.doesNotMatch(contents, /title="Operator access required\."/);
  }

  assert.match(overview, /OpsOperatingRepositoryError/);
  assert.match(overview, /error\.code === "forbidden"[\s\S]*reason="operator_access"/);
  assert.match(overview, /if \(!viewer\) redirect\("\/ops\/access"\)/);
});


test("the guided Timeline enforces authentication and profile access before owner-scoped reads", async () => {
  const timeline = await readFile(new URL("../src/components/membership/GuidedTimelinePage.tsx", import.meta.url), "utf8");
  assert.match(timeline, /getMembershipPageContext\(/);
  assert.match(timeline, /if \(context\.state === "signed_out"\) redirect\(accessHref\)/);
  assert.match(timeline, /if \(context\.state === "denied"\) return <PlatformUnavailable reason="member_access"/);
  assert.match(timeline, /if \(!memberCan\(access, "profile\.read"\)\) return <MemberAccessNotice/);
  assert.match(timeline, /await getJournal\(context\.viewer\.authUserId/);
  assert.match(timeline, /await getJournalEntry\(context\.viewer\.authUserId, moment\)/);
  assert.match(timeline, /<GuidedTimeline key=\{key\} initialJournal=\{journal\} ownerId=\{context\.viewer\.authUserId\}/);
  assert.doesNotMatch(timeline, /isFoundationsAvailableToMember|foundations\.revisit|foundations\.write|<MemberJournal/);
  const privateRead = timeline.indexOf("await getJournal(");
  for (const guard of ['context.state === "signed_out"', 'context.state === "denied"', '!memberCan(access, "profile.read")', '!context.viewer']) {
    assert.ok(timeline.indexOf(guard) >= 0 && timeline.indexOf(guard) < privateRead, `${guard} must precede the owner Timeline read`);
  }
});
