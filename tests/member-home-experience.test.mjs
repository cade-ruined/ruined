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
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "react/jsx-runtime" || name === "react") return require(name);
  if (name === "@/components/membership/MemberJournal") return {__esModule:true,default:({writable})=>React.createElement("section",{"data-journal-writable":String(writable)})};
  if (name === "@/components/membership/MemberPortraitState") return { useMemberPortrait: avatarUrl => ({ avatarUrl }) };
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
    memberNumber: null, identity: { standingState: "active", email: "alex@example.com" }, memberSince: "2026-01-01T12:00:00.000Z",
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
const render = (member) => parseFragment(renderToStaticMarkup(React.createElement(MemberHome, { member })));


test("profile uses the actual name, portrait, and full editor link",()=>{
 const member=memberFixture();member.profile.bio="A biography.";
 const tree=render(member);assert.match(text(tree),/Alex/);assert.match(text(tree),/A biography/);
 assert.ok(elements(tree).some(node=>attr(node,"src")==="/membership/polaroid-frame.png"));
 assert.ok(elements(tree).some(node=>attr(node,"href")==="/my/profile"));
 assert.doesNotMatch(text(tree),/Founding member|@alex/);
});
test("all profile tabs point to real accessible panels",()=>{
 const tree=render(memberFixture());const nodes=elements(tree);const tabs=nodes.filter(node=>attr(node,"role")==="tab");
 assert.deepEqual(tabs.map(text),["Journal","Saved","About"]);
 for(const tab of tabs)assert.ok(nodes.some(node=>attr(node,"role")==="tabpanel"&&attr(node,"id")===attr(tab,"aria-controls")));
 assert.equal(tabs.filter(node=>attr(node,"aria-selected")==="true").length,1);
});
test("member record keeps full totals, explicit truncation, and credited attendance distinct",()=>{
 const tree=render(memberFixture());assert.match(text(tree),/12 milestones · 7 attended/);
 assert.match(text(tree),/Showing the 2 most recent milestones of 12/);
 assert.match(text(tree),/Attendance confirmed/);assert.match(text(tree),/Credited attendance/);
 assert.match(text(tree),/7 attended and 2 credited/);
 assert.equal(elements(tree).some(node=>attr(node,"href")==="https://meet.example/private-room"),false);
});
test("limited profile states suppress records and retain a useful next action",()=>{
 for(const mode of ["entry","limited","suspended"]){const member=memberFixture();member.access={mode,capabilities:["home.read","profile.read","account.read"]};member.nextAction={kind:"account",title:"Review membership",body:"",href:"/my/account"};const tree=render(member);
 assert.doesNotMatch(text(tree),/The attended gathering|The credited experience|Ruined Foundations complete|Private announcement body|Future Circle room|Circle person/);
 assert.match(text(tree),/Review membership/);assert.equal(attr(region(tree,"data-journal-writable"),"data-journal-writable"),"false");}
});
test("artifacts preserve earned, gifted, and purchased distinctions",()=>{
 const member=memberFixture();member.artifacts.push({...member.artifacts[0],awardId:"gift",name:"Gifted piece",acquisitionType:"gifted"},{...member.artifacts[0],awardId:"purchase",name:"Purchased piece",acquisitionType:"purchased"});const tree=render(member);
 assert.match(text(tree),/EarnedFirst artifact/);assert.match(text(tree),/GiftedGifted piece/);assert.match(text(tree),/PurchasedPurchased piece/);
 assert.ok(elements(tree).some(node=>attr(node,"href")==="/my/artifacts"));
});

test("the owner header uses full name for a generated tag without changing public identity", () => {
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
  assert.equal(attr(elements(render(member)).find(node => node.tagName === "h1"), "aria-label"), "Authored Name");
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
  assert.deepEqual(elements(actions).filter(node=>node.tagName==="a").map(node=>attr(node,"href")),["/my/profile","/my/card","/my/invitation"]);
});


function interactiveProfile(hash = "#journal") {
  const slots = [], listeners = new Map(), historyState = { nextRouter: "retained" };
  const Journal = () => null;
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
  new Function("require", "module", "exports", "window", compiled)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/components/membership/MemberJournal") return { __esModule: true, default: Journal };
    if (name === "@/components/membership/MemberPortraitState") return { useMemberPortrait: avatarUrl => ({ avatarUrl }) };
    if (name === "@/lib/membership/access-policy") return { memberCan: (access, capability) => access.capabilities.includes(capability) };
    if (name === "@/lib/membership/member-number") return memberNumber;
    if (name === "next/link" || name === "next/image") return { __esModule: true, default: name };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(`Unexpected profile dependency ${name}`);
  }, loaded, loaded.exports, window);
  const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
  function render() {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 8, "profile effects should settle");
      cursor = 0; queued = []; changed = false;
      tree = loaded.exports.default({ member: memberFixture() });
      queued.forEach(effect => effect());
    } while (changed);
    nodes(tree).filter(node => node.props.role === "tab").forEach((node, index) => node.props.ref?.({ focus() { focused = index; } }));
    return tree;
  }
  const tabs = () => nodes(render()).filter(node => node.props.role === "tab");
  return { window, render, tabs, nodes,
    journal() { const journals = nodes(render()).filter(node => node.type === Journal); assert.equal(journals.length, 1); return journals[0]; },
    panel() { return nodes(render()).find(node => node.props.id === "profile-test-entries-panel"); },
    navigate(next, event = "hashchange") { window.location.hash = next; listeners.get(event)?.(); render(); },
    focus: () => focused,
    unmount() { slots.forEach(slot => slot?.cleanup?.()); assert.equal(listeners.size, 0); },
  };
}

test("legacy Timeline hashes select the Journal timeline view and mode changes preserve browser state", () => {
  const ui = interactiveProfile("#timeline");
  assert.equal(ui.journal().props.initialMode, "timeline");
  assert.equal(ui.journal().props.view, "journal");
  assert.deepEqual(ui.tabs().map(tab => tab.props["aria-selected"]), [true, false, false]);
  assert.equal(ui.panel().props.hidden, false);
  ui.journal().props.onModeChange("all");
  assert.equal(ui.window.location.hash, "#journal"); assert.equal(ui.journal().props.initialMode, "all");
  ui.journal().props.onModeChange("timeline");
  assert.equal(ui.window.location.hash, "#timeline");
  ui.navigate("#journal"); assert.equal(ui.journal().props.initialMode, "all");
  ui.navigate("#timeline", "popstate"); assert.equal(ui.journal().props.initialMode, "timeline");
  ui.navigate("", "popstate"); assert.equal(ui.journal().props.initialMode, "all");
  ui.unmount();
});

test("Journal remains in one unchanged panel across Timeline, Saved and About so drafts retain their owner", () => {
  const ui = interactiveProfile("#timeline"), initial = ui.journal();
  for (const [hash, view, hidden, labelled] of [
    ["#saved", "saved", false, "saved"], ["#about", "journal", true, "journal"], ["#timeline", "journal", false, "journal"],
  ]) {
    ui.navigate(hash);
    const journal = ui.journal();
    assert.equal(journal.type, initial.type); assert.equal(journal.key, initial.key);
    assert.equal(ui.panel().props.children.type, journal.type);
    assert.equal(ui.panel().props.children.key, null, "view switches must not key-remount the Journal");
    assert.equal(ui.panel().props.hidden, hidden);
    assert.equal(ui.panel().props["aria-labelledby"], `profile-test-${labelled}-tab`);
    assert.equal(journal.props.view, view); assert.equal(journal.props.initialMode, "timeline");
  }
  ui.tabs()[1].props.onClick(); assert.equal(ui.window.location.hash, "#saved");
  ui.tabs()[0].props.onClick(); assert.equal(ui.window.location.hash, "#timeline");
  ui.unmount();
});

test("three profile tabs keep roving keyboard focus and explicit Journal hashes restore All entries", () => {
  const ui = interactiveProfile("#saved");
  assert.deepEqual(ui.tabs().map(tab => tab.props.tabIndex), [-1, 0, -1]);
  let prevented = 0;
  ui.tabs()[1].props.onKeyDown({ key: "End", preventDefault() { prevented++; } });
  assert.equal(ui.window.location.hash, "#about"); assert.equal(ui.focus(), 2);
  ui.tabs()[2].props.onKeyDown({ key: "ArrowRight", preventDefault() { prevented++; } });
  assert.equal(ui.window.location.hash, "#journal"); assert.equal(ui.focus(), 0);
  ui.tabs()[0].props.onKeyDown({ key: "ArrowLeft", preventDefault() { prevented++; } });
  assert.equal(ui.window.location.hash, "#about"); assert.equal(ui.focus(), 2);
  ui.tabs()[2].props.onKeyDown({ key: "Home", preventDefault() { prevented++; } });
  assert.equal(ui.window.location.hash, "#journal"); assert.equal(ui.focus(), 0); assert.equal(prevented, 4);
  ui.unmount();
});
