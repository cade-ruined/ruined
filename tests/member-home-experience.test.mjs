import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";
import * as memberNumber from "../src/lib/membership/member-number.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/platform/MemberHome.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
} }).outputText;
function JournalStub({ writable, sharingEnabled = false, view = "journal", renderLayout }) {
  const content = React.createElement("section", { "data-journal-writable": String(writable), "data-journal-content": "true", "data-journal-sharing": String(sharingEnabled) });
  const action = writable && view === "journal" ? React.createElement("button", { type: "button", "data-add-entry": "true" }, "+ Add entry") : null;
  return renderLayout ? renderLayout(content, action) : content;
}
function WelcomeStub({ initialWelcome }) {
  return React.createElement("section", { "data-member-welcome": "true", "data-welcome-snapshot": initialWelcome ? "ready" : "missing" });
}
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "react/jsx-runtime" || name === "react") return require(name);
  if (name === "@/components/membership/MemberBadges") return { __esModule: true, default: ({badges}) => React.createElement("div", {"data-earned-badges": true}, badges.map(badge => React.createElement("span", {key:badge.key}, badge.label))) };
  if (name === "@/components/membership/InstallRuined") return { __esModule: true, default: ({variant}) => React.createElement("section", {"data-profile-install": variant}, "Install Ruined") };
  if (name === "@/components/membership/MemberJournal") return { __esModule: true, default: JournalStub };
  if (name === "@/components/membership/MemberWelcome") return { __esModule: true, default: WelcomeStub };
  if (name === "@/components/membership/MemberPortraitState") return { useMemberPortrait: avatarUrl => ({ avatarUrl }) };
  if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
  if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name === "next/image") return { __esModule: true, default: ({ src, alt }) => React.createElement("img", { src, alt }) };
  if (name === "@/components/membership/CircleMemberPortrait") return { __esModule: true, default: ({ person }) => React.createElement("span", null, person.displayName) };
  if (name === "@/lib/membership/member-number") return memberNumber;
  if (name === "@/lib/membership/access-policy") return { memberCan: (access, capability) => access.capabilities.includes(capability) };
  if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  throw new Error(`Unexpected MemberHome dependency: ${name}`);
}, mod, mod.exports);
const MemberHome = mod.exports.default;

const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const attr = (node, name) => node?.attrs?.find((item) => item.name === name)?.value;
const text = (node) => !node ? "" : node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const region = (tree, marker) => elements(tree).find((node) => attr(node, marker) !== undefined);
const fullCapabilities = ["home.read", "profile.read", "profile.write", "account.read", "circle.read", "foundations.summary", "foundations.write", "artifacts.read", "experiences.member", "learn.read", "updates.read"];

function memberFixture() {
  const futureMeeting = { id: "future-room", title: "Future Circle room", startsAt: "2100-09-04T01:00:00.000Z", endsAt: "2100-09-04T02:30:00.000Z", timezone: "America/Denver", kind: "circle_meeting", audienceLabel: "Our Circle", locationLabel: "Studio", meetingUrl: "https://meet.example/private-room", detailHref: "/my/circle", registrationHref: null, registrationState: "registered", summary: "Bring your work." };
  const artifact = { awardId: "award-1", name: "First artifact", acquisitionType: "earned", artifactState: "fulfilled", earnedAt: "2026-01-10T12:00:00.000Z", earnedReason: "Work completed", description: null, imageUrl: null, product: null };
  return {
    access: { mode: "full", reason: null, capabilities: fullCapabilities },
    announcement: { id: "announcement-1", title: "A note for your Circle", body: "Private announcement body", href: "/my/updates", publishedAt: "2026-01-12T12:00:00.000Z" },
    artifact, artifacts: [artifact], avatarUrl: null, blockName: "Our Block", circleMembers: [{ id: "person-2", displayName: "Circle person", avatarUrl: null }], circleName: "Our Circle", displayName: "Alex",
    foundations: { state: "completed", progressPercent: 100, requirements: { activeCircle: { completed: true, name: "Our Circle" }, futureLetter: { completed: true, completedAt: "2026-01-09T12:00:00.000Z" }, timeline: { completed: true, completedAt: "2026-01-08T12:00:00.000Z", entryCount: 4 }, moments: { completed: 5, total: 5 } } },
    memberNumber: null, identity: { authUserId: "22222222-2222-4222-8222-222222222222", memberId: "11111111-1111-4111-8111-111111111111", standingState: "active", email: "alex@example.com" }, memberSince: "2026-01-01T12:00:00.000Z",
    nextAction: { kind: "circle", title: "Meet your Circle", body: "", href: "/my/circle" }, nextExperience: futureMeeting, nextMeeting: futureMeeting,
    profile: { preferredName: "Alex", fullName: "Alex Member", displayName: "Alex", bio: null, buildingNow: null, directoryStatus: "hidden", location: null, timezone: "America/Denver" },
    record: {
      totals: { milestones: 12, attendedExperiences: 7, creditedExperiences: 2, artifacts: 9 },
      milestones: [{ id: "milestone-1", type: "artifact.awarded", title: "First artifact", occurredAt: artifact.earnedAt }, { id: "milestone-2", type: "foundations.completed", title: "Ruined Foundations complete", occurredAt: "2026-01-11T12:00:00.000Z" }],
      attendedExperiences: [
        { id: "attended-1", title: "The attended gathering", kind: "circle_meeting", startsAt: "2026-01-05T01:00:00.000Z", timezone: "America/Denver", locationLabel: "Studio", attendanceState: "attended", recordedAt: "2026-01-06T12:00:00.000Z" },
        { id: "credited-1", title: "The credited experience", kind: "circle_meeting", startsAt: "2026-01-03T01:00:00.000Z", timezone: "America/Denver", locationLabel: null, attendanceState: "credited", recordedAt: "2026-01-04T12:00:00.000Z" },
      ],
    },
    unreadUpdates: 2, upcomingExperiences: [{ ...futureMeeting, id: "expired-room", title: "An expired gathering", startsAt: "2000-01-01T12:00:00.000Z", endsAt: "2000-01-01T13:00:00.000Z" }, futureMeeting],
  };
}
const render = (member, props = {}) => parseFragment(renderToStaticMarkup(React.createElement(MemberHome, { member, ...props })));


test("profile uses the actual name, portrait, and full editor link",()=>{
 const member=memberFixture();member.profile.bio="A biography.";
 const tree=render(member);assert.match(text(tree),/Alex/);assert.match(text(tree),/A biography/);
 assert.ok(elements(tree).some(node=>attr(node,"src")==="/membership/polaroid-frame.png"));
 assert.ok(elements(tree).some(node=>attr(node,"href")==="/my/profile"));
 assert.doesNotMatch(text(tree),/Founding member|@alex/);
});
test("both profile tabs point to the shared accessible panel",()=>{
 const tree=render(memberFixture());const nodes=elements(tree);const tabs=nodes.filter(node=>attr(node,"role")==="tab");
 assert.deepEqual(tabs.map(text),["Timeline","Journal"]);
 assert.ok(elements(tabs[1]).some(node=>node.tagName==="svg"&&attr(node,"aria-label")==="Private"));
 assert.equal(nodes.filter(node=>attr(node,"role")==="tabpanel").length,1);
 const tablist=nodes.find(node=>attr(node,"role")==="tablist");
 assert.equal(nodes.filter(node=>attr(node,"data-add-entry")==="true").length,1);
 assert.equal(elements(tablist).some(node=>attr(node,"data-add-entry")==="true"),false,"entry creation is an action outside the tablist");
 for(const tab of tabs)assert.ok(nodes.some(node=>attr(node,"role")==="tabpanel"&&attr(node,"id")===attr(tab,"aria-controls")));
 assert.equal(tabs.filter(node=>attr(node,"aria-selected")==="true").length,1);
});
test("profile removes redundant details and keeps installation before entry navigation",()=>{
 const tree=render(memberFixture());const nodes=elements(tree);
 assert.equal(nodes.some(node=>node.tagName==="details"),false);
 assert.doesNotMatch(text(tree),/Profile details|Your membership|Your artifacts|Worth a look|Meet your Circle/);
 const install=region(tree,"data-profile-install");
 assert.equal(attr(install,"data-profile-install"),"profile");
 const header=nodes.find(node=>node.tagName==="header");
 const tablist=nodes.find(node=>attr(node,"role")==="tablist");
 assert.ok(nodes.indexOf(install)>nodes.indexOf(header));
 assert.ok(nodes.indexOf(install)<nodes.indexOf(tablist));
 assert.equal(nodes.filter(node=>attr(node,"data-profile-install")!==undefined).length,1);
 assert.ok(nodes.some(node=>attr(node,"href")==="/my/profile"));
});
test("owner profile enables explicit Journal sharing in production and preview",()=>{
 for(const props of [{},{preview:true}])assert.equal(attr(region(render(memberFixture(),props),"data-journal-sharing"),"data-journal-sharing"),"true");
});
test("profile does not repeat private records, artifacts or membership next steps",()=>{
 for(const kind of ["circle","onboarding","billing","account","foundations","explore"]){
  const member=memberFixture();member.nextAction={kind,title:"A redundant action",body:"Next step body",href:"/my/account"};
  const before=JSON.stringify(member),tree=render(member);
  assert.doesNotMatch(text(tree),/A redundant action|Next step body|Your next step|Worth a look|12 milestones|First artifact|The attended gathering|The credited experience|Ruined Foundations complete/);
  assert.equal(elements(tree).some(node=>attr(node,"data-member-next-action")!==undefined),false);
  assert.equal(elements(tree).some(node=>attr(node,"href")==="https://meet.example/private-room"),false);
  assert.equal(JSON.stringify(member),before,"simplifying the profile does not alter its underlying member record");
 }
});
test("limited profile states keep Journal read-only and the existing profile controls available",()=>{
 for(const mode of ["entry","limited","suspended"]){
  const member=memberFixture();member.access={mode,capabilities:["home.read","profile.read","account.read"]};
  const tree=render(member);
  assert.doesNotMatch(text(tree),/The attended gathering|The credited experience|Ruined Foundations complete|Private announcement body|Future Circle room|Circle person|Worth a look|Your next step/);
  assert.equal(attr(region(tree,"data-journal-writable"),"data-journal-writable"),"false");
  assert.ok(elements(tree).some(node=>attr(node,"href")==="/my/profile"));
  assert.equal(attr(region(tree,"data-profile-install"),"data-profile-install"),"profile");
 }
});

test("welcome stays on the actual profile and is limited to released full or onboarding access", () => {
  const welcome = { ownerId: "22222222-2222-4222-8222-222222222222", dismissedAt: null, calendarViewedAt: null, hasJournalEntry: false };
  for (const mode of ["full", "onboarding", "entry", "limited", "suspended"]) {
    const member = memberFixture(); member.access.mode = mode;
    const tree = render(member, { welcome }), nodes = elements(tree), checklist = region(tree, "data-member-welcome");
    if (mode === "full" || mode === "onboarding") {
      assert.equal(attr(checklist, "data-welcome-snapshot"), "ready");
      assert.ok(nodes.indexOf(checklist) > nodes.indexOf(nodes.find(node => node.tagName === "header")), "identity comes before onboarding");
      assert.ok(nodes.indexOf(checklist) < nodes.indexOf(region(tree, "data-profile-install")));
    } else assert.equal(checklist, undefined, "restricted access cannot expose the onboarding checklist");
    assert.ok(nodes.some(node => node.tagName === "h1"), "the member still lands on their own profile");
  }
});

test("the owner header consistently prefers full name while retaining legacy fallbacks", () => {
  const member = memberFixture();
  member.displayName = member.profile.displayName = "@alex";
  member.profile.memberTag = "alex";
  member.profile.fullName = "Alex de Morgan";
  const before = JSON.stringify(member);
  const tree = render(member);
  const heading = elements(tree).find(node => node.tagName === "h1");
  assert.equal(attr(heading, "aria-label"), "Alex de Morgan");
  assert.deepEqual(elements(heading).filter(node => node.tagName === "span").map(text), ["Alex", "de Morgan"]);
  assert.equal(elements(tree).filter(node => attr(node, "class") === "memberTag").map(text).join(), "@alex");
  assert.equal(JSON.stringify(member), before, "private header presentation must not mutate shared profile data");
  member.profile.displayName = member.displayName = "Authored Name";
  assert.equal(attr(elements(render(member)).find(node => node.tagName === "h1"), "aria-label"), "Alex de Morgan");
  member.profile.displayName = member.displayName = "@alex";
  member.profile.fullName = null;
  assert.equal(attr(elements(render(member)).find(node => node.tagName === "h1"), "aria-label"), "My profile");
});

test("profile badge uses the permanent number and leaves unassigned members unnumbered", () => {
  for (const [number, label, display] of [[0,"Founders","0000"],[4,"Founders","0004"],[5,"Founders","0005"],[6,"Originals","0006"],[51,"Pillars","0051"],[101,"Builders","0101"],[201,"Members","0201"]]) {
    const member=memberFixture();member.memberNumber=number;
    const tree=render(member), badge=elements(tree).find(node=>attr(node,"class")==="memberBadge");
    assert.match(text(badge),new RegExp(`${label}.*No\\. ${display}`));
  }
  const member=memberFixture();
  const rendered=renderToStaticMarkup(React.createElement(MemberHome,{member,preview:true}));
  assert.doesNotMatch(rendered,/No\. 0001|Founder/);
  const tree=render(member), actions=elements(tree).find(node=>attr(node,"class")==="identityActions");
  assert.deepEqual(elements(actions).filter(node=>node.tagName==="a").map(node=>attr(node,"href")),["/my/profile","/profile/11111111-1111-4111-8111-111111111111","/my/card","/my/invitation"]);
});


function interactiveProfile(hash = "#journal", props = {}) {
  const slots = [], listeners = new Map(), historyState = { nextRouter: "retained" };
  const Journal = JournalStub;
  let refreshes=0;
  const router={refresh(){refreshes++;}};
  const document={hidden:false,listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name);}};
  let cursor = 0, queued = [], changed = false, tree, focused = null;
  const window = {
    location: { hash },
    history: { state: historyState, replaceState(state, unused, next) { assert.equal(state, historyState); window.location.hash = next; } },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const hooks = { ...React,
    useId: () => "profile-test",
    useState(initial) {
      const key = cursor++;
      if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial;
      return [slots[key], next => { const value = typeof next === "function" ? next(slots[key]) : next; changed ||= !Object.is(value, slots[key]); slots[key] = value; }];
    },
    useRef(initial) { const key = cursor++; return slots[key] ??= { current: initial }; },
    useEffect(callback, dependencies) {
      const key = cursor++, prior = slots[key];
      if (!prior || dependencies.some((value, index) => !Object.is(value, prior.dependencies[index]))) {
        slots[key] = { dependencies };
        queued.push(() => { prior?.cleanup?.(); slots[key].cleanup = callback(); });
      }
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", compiled)(name => {
    if (name === "react") return hooks;
    if (name === "next/navigation") return {useRouter:()=>router};
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/components/membership/MemberBadges") return { __esModule: true, default: () => null };
    if (name === "@/components/membership/InstallRuined") return { __esModule: true, default: () => null };
    if (name === "@/components/membership/MemberJournal") return { __esModule: true, default: Journal };
    if (name === "@/components/membership/MemberWelcome") return { __esModule: true, default: WelcomeStub };
    if (name === "@/components/membership/MemberPortraitState") return { useMemberPortrait: avatarUrl => ({ avatarUrl }) };
    if (name === "@/lib/membership/access-policy") return { memberCan: (access, capability) => access.capabilities.includes(capability) };
    if (name === "@/lib/membership/member-number") return memberNumber;
    if (name === "next/link" || name === "next/image") return { __esModule: true, default: name };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(`Unexpected profile dependency ${name}`);
  }, loaded, loaded.exports, window, document);
  const childNodes = node => { const children = []; React.Children.forEach(node.props.children, child => children.push(child)); return children; };
  // Keep the raw component element for ownership checks and inspect its rendered layout.
  const nodes = node => React.isValidElement(node)
    ? [node, ...(node.type === Journal ? nodes(Journal(node.props)) : childNodes(node).flatMap(nodes))]
    : [];
  function journalPath(node, path = []) {
    if (!React.isValidElement(node)) return null;
    if (node.type === Journal) return path;
    for (const [index, child] of childNodes(node).entries()) {
      const found = journalPath(child, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  function render() {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 8, "profile effects should settle");
      cursor = 0; queued = []; changed = false;
      tree = loaded.exports.default({ member: memberFixture(), ...props });
      queued.forEach(effect => effect());
    } while (changed);
    nodes(tree).filter(node => node.props.role === "tab").forEach((node, index) => node.props.ref?.({ focus() { focused = index; } }));
    return tree;
  }
  const tabs = () => nodes(render()).filter(node => node.props.role === "tab");
  return { window, render, tabs, nodes,
    refreshes:()=>refreshes,
    update(next){Object.assign(props,next);return render();},
    dispatch(event){listeners.get(event)?.();return render();},
    setHidden(hidden){document.hidden=hidden;document.listeners.get("visibilitychange")?.();return render();},
    welcome() { return nodes(render()).find(node => node.type === WelcomeStub); },
    journal() { const journals = nodes(render()).filter(node => node.type === Journal); assert.equal(journals.length, 1); return journals[0]; },
    panel() { return nodes(render()).find(node => node.props.id === "profile-test-entries-panel"); },
    journalPath() { return journalPath(render()); },
    navigate(next, event = "hashchange") { window.location.hash = next; listeners.get(event)?.(); render(); },
    focus: () => focused,
    unmount() { slots.forEach(slot => slot?.cleanup?.()); assert.equal(listeners.size, 0); assert.equal(document.listeners.size,0); },
  };
}

test("Timeline is the default while Journal links select its private section", () => {
  const ui = interactiveProfile("");
  assert.equal(ui.journal().props.initialMode, "timeline");
  assert.equal(ui.journal().props.view ?? "journal", "journal");
  assert.deepEqual(ui.tabs().map(tab => tab.props["aria-selected"]), [true, false]);
  assert.equal(Boolean(ui.panel().props.hidden), false);
  assert.equal(ui.panel().props["aria-labelledby"], "profile-test-timeline-tab");
  ui.tabs()[1].props.onClick();
  assert.equal(ui.window.location.hash, "#journal"); assert.equal(ui.journal().props.initialMode, "all");
  ui.tabs()[0].props.onClick();
  assert.equal(ui.window.location.hash, "#timeline"); assert.equal(ui.journal().props.initialMode, "timeline");
  ui.navigate("#journal"); assert.equal(ui.journal().props.initialMode, "all");
  ui.navigate("#timeline", "popstate"); assert.equal(ui.journal().props.initialMode, "timeline");
  ui.navigate("", "popstate"); assert.equal(ui.journal().props.initialMode, "timeline");
  ui.unmount();
});

test("welcome opens the private Journal directly without remounting its draft owner", () => {
  const member = memberFixture();
  member.avatarUrl = "/test-portrait.webp"; member.profile.bio = "A real introduction."; member.profile.memberTag = "alex";
  const welcome = { ownerId: member.identity.authUserId, dismissedAt: null, calendarViewedAt: null, hasJournalEntry: false };
  const ui = interactiveProfile("#timeline", { member, welcome, preview: true });
  const path = ui.journalPath(), checklist = ui.welcome();
  assert.equal(checklist.props.ownerId, member.identity.authUserId);
  assert.equal(checklist.props.initialWelcome, welcome);
  assert.equal(checklist.props.profileReady, true);
  assert.equal(checklist.props.preview, true);
  assert.equal(ui.journal().props.privateComposeRequest, 0, "simply opening the profile does not open a composer");
  checklist.props.onWritePrivate();
  assert.equal(ui.journal().props.initialMode, "all");
  assert.equal(ui.journal().props.privateComposeRequest, 1);
  assert.equal(ui.window.location.hash, "#journal");
  assert.deepEqual(ui.journalPath(), path, "checklist navigation preserves the component that owns an unfinished draft");
  ui.welcome().props.onWritePrivate(); assert.equal(ui.journal().props.privateComposeRequest, 2);
  ui.unmount();
  member.profile.bio = "   ";
  const incomplete = interactiveProfile("", { member });
  assert.equal(incomplete.welcome().props.profileReady, false, "blank profile fields do not count as complete"); incomplete.unmount();
});

test("switching sections and legacy hashes never remounts the draft owner", () => {
  const ui = interactiveProfile("#timeline"), initial = ui.journal(), initialPath = ui.journalPath();
  const content = ui.panel().props.children;
  assert.equal(content.props["data-journal-content"], "true");
  for (const hash of ["#saved", "#about", "#journal", "#timeline", "#unknown"]) {
    ui.navigate(hash);
    const journal = ui.journal(), timeline = hash !== "#journal";
    assert.equal(journal.type, initial.type); assert.equal(journal.key, initial.key);
    assert.deepEqual(ui.journalPath(), initialPath, "view switches must not move or remount the draft owner");
    assert.equal(ui.panel().props.children.type, content.type);
    assert.equal(ui.panel().props.children.key, content.key);
    assert.equal(Boolean(ui.panel().props.hidden), false);
    assert.equal(ui.panel().props["aria-labelledby"], `profile-test-${timeline ? "timeline" : "journal"}-tab`);
    assert.equal(journal.props.initialMode, timeline ? "timeline" : "all");
    assert.equal(ui.nodes(ui.render()).some(node => node.type === "details"), false);
  }
  ui.unmount();
});

test("saving an entry can select its private Journal or shared Timeline without remounting the editor", () => {
  const ui=interactiveProfile("#journal"), initialPath=ui.journalPath();
  ui.journal().props.onModeChange("timeline");
  assert.equal(ui.window.location.hash,"#timeline");
  assert.equal(ui.journal().props.initialMode,"timeline");
  assert.equal(ui.panel().props["aria-labelledby"],"profile-test-timeline-tab");
  ui.journal().props.onModeChange("all");
  assert.equal(ui.window.location.hash,"#journal");
  assert.equal(ui.journal().props.initialMode,"all");
  assert.equal(ui.panel().props["aria-labelledby"],"profile-test-journal-tab");
  assert.deepEqual(ui.journalPath(),initialPath);
  ui.unmount();
});

test("two profile tabs keep roving keyboard focus with wrapping boundaries", () => {
  const ui = interactiveProfile("");
  assert.deepEqual(ui.tabs().map(tab => tab.props.tabIndex), [0, -1]);
  let prevented = 0;
  for (const [index,key,destination,focus] of [[1,"Home","timeline",0],[0,"ArrowRight","journal",1],[1,"ArrowRight","timeline",0],[0,"ArrowLeft","journal",1],[1,"ArrowLeft","timeline",0],[0,"End","journal",1]]) {
    ui.tabs()[index].props.onKeyDown({ key, preventDefault() { prevented++; } });
    assert.equal(ui.window.location.hash, `#${destination}`); assert.equal(ui.focus(), focus);
    assert.equal(ui.journal().props.initialMode, destination === "timeline" ? "timeline" : "all");
    assert.deepEqual(ui.tabs().map(tab => tab.props.tabIndex), focus === 0 ? [0,-1] : [-1,0]);
  }
  ui.tabs()[1].props.onKeyDown({ key: "Enter", preventDefault() { prevented++; } });
  assert.equal(prevented, 6, "unrelated keys must remain available to native button behavior");
  ui.unmount();
});

test("profile orders identity, bio, actions, then earned badges and the collection link without empty badge placeholders", () => {
  const empty = render(memberFixture());
  assert.equal(elements(empty).some(node=>attr(node,"data-earned-badges")!==undefined),false);
  const emptyBadgeArea=elements(empty).find(node=>attr(node,"class")==="earnedBadges");
  assert.ok(emptyBadgeArea);
  assert.deepEqual(elements(emptyBadgeArea).filter(node=>node.tagName==="a").map(node=>[attr(node,"href"),text(node)]),[["/my/badges","Your badges ↗"]]);
  assert.equal(emptyBadgeArea.childNodes.filter(node=>node.tagName).length,1,"members with no awards retain only the collection link, never an empty dock");
  const member=memberFixture();member.badges=[{key:"early-supporter",label:"I Was Here",description:"Joined the waitlist, then became a paying member.",earnedAt:"2026-09-28T12:00:00Z"}];
  member.profile.bio="A biography.";
  member.profile.memberTag="alex";
  const before=JSON.stringify(member);
  const tree=render(member);
  const header=elements(tree).find(node=>attr(node,"class")==="identity");
  assert.ok(header);
  assert.deepEqual(header.childNodes.filter(node=>node.tagName).map(node=>attr(node,"class")),["polaroid","nameBlock","bio","identityActions","earnedBadges"]);
  const block=elements(header).find(node=>attr(node,"class")==="nameBlock");
  assert.ok(elements(block).some(node=>node.tagName==="h1"));
  assert.match(text(block),/@alexMemberMember since 2026/);
  assert.equal(elements(block).some(node=>attr(node,"data-earned-badges")!==undefined),false);
  const badges=elements(header).find(node=>attr(node,"class")==="earnedBadges");
  assert.equal(elements(badges).filter(node=>attr(node,"data-earned-badges")!==undefined).length,1);
  const earnedDock=elements(badges).find(node=>attr(node,"data-earned-badges")!==undefined);
  assert.equal(text(earnedDock),"I Was Here");
  assert.deepEqual(badges.childNodes.filter(node=>node.tagName).map(node=>node.tagName),["div","a"]);
  assert.deepEqual(elements(badges).filter(node=>node.tagName==="a").map(node=>[attr(node,"href"),text(node)]),[["/my/badges","Your badges ↗"]]);
  assert.equal(JSON.stringify(member),before,"presentation must preserve private profile and earned badge data");
});


test("profile refreshes stale saved details on arrival, progress and tab return without resetting Journal state",()=>{
  const member=memberFixture(),ui=interactiveProfile("#timeline",{member});
  const initial=ui.journal(),path=ui.journalPath();
  assert.equal(ui.refreshes(),1);
  ui.welcome().props.onWritePrivate();
  assert.equal(ui.journal().props.privateComposeRequest,1);
  ui.dispatch("ruined:member-progress");assert.equal(ui.refreshes(),2);
  const saved={...member,avatarUrl:"/portrait.webp",profile:{...member.profile,bio:"My introduction.",memberTag:"alex"}};
  ui.update({member:saved});assert.equal(ui.welcome().props.profileReady,true);
  assert.equal(ui.refreshes(),2,"fresh server props do not cause another refresh loop");
  assert.equal(ui.journal().type,initial.type);assert.equal(ui.journal().key,initial.key);assert.deepEqual(ui.journalPath(),path);
  assert.equal(ui.journal().props.privateComposeRequest,1);assert.equal(ui.journal().props.initialMode,"all");
  ui.setHidden(true);ui.dispatch("focus");assert.equal(ui.refreshes(),2);
  ui.setHidden(false);assert.equal(ui.refreshes(),3);
  ui.dispatch("focus");assert.equal(ui.refreshes(),4);
  ui.unmount();ui.dispatch("focus");assert.equal(ui.refreshes(),4);
});

test("profile previews do not request live account refreshes",()=>{
  const ui=interactiveProfile("",{preview:true});ui.render();ui.dispatch("ruined:member-progress");ui.dispatch("focus");ui.setHidden(false);
  assert.equal(ui.refreshes(),0);ui.unmount();
});
