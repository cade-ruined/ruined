import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const noNetwork = () => { throw new Error("Real network calls are forbidden in Circle communication tests"); };
const link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "next/link") return link;
    if (name === "next/navigation") return { useRouter: () => ({ refresh: noNetwork }) };
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, cjsModule, cjsModule.exports, noNetwork);
  return cjsModule.exports;
}
const styles = { "@/components/platform/operatorStyles": load("src/components/platform/operatorStyles.ts") };
const field = load("src/components/platform/OperatorGoogleCommunicationField.tsx", styles);
const Panel = load("src/components/platform/OperatorCircleCommunicationPanel.tsx", {
  ...styles, "@/components/platform/OperatorGoogleCommunicationField": field,
}).default;
const circle = { id: "11111111-1111-4111-8111-111111111111", name: "Same Circle name", status: "active", activeMembers: 2, capacity: 10 };
const otherCircle = { ...circle, id: "22222222-2222-4222-8222-222222222222" };
const communication = { ...circle, chatUrl: "https://chat.google.com/room/own-circle", googleCommunicationsConfigured: true };
const otherCommunication = { ...otherCircle, chatUrl: "https://chat.google.com/room/other-circle", googleCommunicationsConfigured: true };
const meeting = {
  circleId: circle.id, experienceId: "own-meeting", kind: "circle_meeting", scope: circle.name,
  state: "published", startsAt: "2099-09-15T18:00:00.000Z", endsAt: "2099-09-15T19:00:00.000Z",
  title: "Own Circle meeting", meetingUrl: "https://meet.google.com/abc-defg-hij", googleCommunicationsConfigured: true,
};
const otherMeeting = { ...meeting, circleId: otherCircle.id, experienceId: "other-meeting", title: "Other Circle private meeting" };
const directory = { blocks: [], canCreate: true, canManageGlobal: true, circles: [circle, otherCircle], experiences: [otherMeeting, meeting, { ...meeting, circleId: null, experienceId: "global-meeting", title: "Global meeting with the same display scope" }] };
const now = Date.parse("2099-09-14T18:00:00.000Z");
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const render = (props = {}) => parseFragment(renderToStaticMarkup(React.createElement(Panel, { circle, communication, directory, now, ...props })));
const links = (tree) => elements(tree).filter((node) => node.tagName === "a");
const reactNodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(reactNodes) : [node, ...reactNodes(node.props?.children)];

function interactiveField(props) {
  const slots = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect() {},
  };
  const Field = load("src/components/platform/OperatorGoogleCommunicationField.tsx", { ...styles, react: hooks }).default;
  return { draw() { cursor = 0; const editor = Field(props); return editor.type(editor.props); } };
}

test("Circle chat link instructions are collapsed within setup, never repeated in saved or unavailable controls", () => {
  const setup = render({ communication: { ...communication, chatUrl: null } });
  const disclosure = elements(setup).find((node) => node.tagName === "details");
  assert.ok(disclosure);
  assert.equal(attr(disclosure, "open"), undefined);
  assert.equal(text(elements(disclosure).find((node) => node.tagName === "summary")), "Where do I find the link?");
  assert.deepEqual(elements(disclosure).filter((node) => node.tagName === "li").map(text), [
    "Open your private space in Google Chat.",
    "Click the space name at the top.",
    "Choose Copy link to this space, then paste it below.",
  ]);
  assert.match(text(disclosure), /Keep the space private.*participants in Google Chat separately/);
  const help = links(disclosure).find((node) => attr(node, "href") === "https://support.google.com/chat/answer/11971020?hl=en");
  assert.equal(attr(help, "target"), "_blank");
  assert.equal(attr(help, "rel"), "noreferrer");
  assert.match(text(setup), /Saving a link does not grant Google access/);
  assert.ok(elements(setup).some((node) => node.tagName === "input" && attr(node, "name") === "url"));
  const meetings = elements(setup).find((node) => attr(node, "aria-label") === `${circle.name} meetings`);
  assert.doesNotMatch(text(meetings), /Where do I find|Copy link to this space/);

  for (const tree of [render(), render({ communication: undefined }), render({ circle: { ...circle, status: "archived" }, communication: { ...communication, chatUrl: null } }), render({ communication: { ...communication, chatUrl: null, googleCommunicationsConfigured: false } })]) {
    assert.equal(elements(tree).some((node) => node.tagName === "details"), false);
    assert.doesNotMatch(text(tree), /Where do I find|Copy link to this space/);
  }
});

test("editing a saved Circle chat exposes its help without adding it to Google Meet", () => {
  const panel = Panel({ circle, communication, directory, now });
  const fieldProps = reactNodes(panel).find((node) => node.type === field.default).props;
  const f = interactiveField(fieldProps);
  assert.equal(reactNodes(f.draw()).some((node) => node.type === "details"), false);
  reactNodes(f.draw()).find((node) => node.type === "button" && node.props["aria-label"] === "Edit chat link").props.onClick();
  const editing = parseFragment(renderToStaticMarkup(f.draw()));
  assert.ok(elements(editing).some((node) => node.tagName === "details" && attr(node, "open") === undefined));
  assert.match(text(editing), /Where do I find the link\?/);
  reactNodes(f.draw()).find((node) => node.type === "button" && node.props.children === "Cancel").props.onClick();
  assert.equal(reactNodes(f.draw()).some((node) => node.type === "details"), false);

  for (const initialUrl of [null, meeting.meetingUrl]) {
    const meet = interactiveField({ configured: true, editable: true, entityId: meeting.experienceId, entityType: "experience", initialUrl, kind: "meet" });
    if (initialUrl) reactNodes(meet.draw()).find((node) => node.type === "button" && node.props["aria-label"] === "Edit meeting link").props.onClick();
    const tree = parseFragment(renderToStaticMarkup(meet.draw()));
    assert.equal(elements(tree).some((node) => node.tagName === "details"), false);
    assert.doesNotMatch(text(tree), /Where do I find|Copy link to this space|Google Chat/);
    assert.match(text(tree), /Saving it does not send invitations/);
  }
});

test("Circle chat and meetings use exact identities, never shared display names or global scope", () => {
  const tree = render();
  assert.match(text(tree), /Own Circle meeting/);
  assert.doesNotMatch(text(tree), /Other Circle private meeting|Global meeting with the same display scope/);
  const hrefs = links(tree).map((node) => attr(node, "href"));
  assert.ok(hrefs.includes(communication.chatUrl));
  assert.ok(hrefs.includes(`/ops/experiences?circleId=${circle.id}#new-experience`));
  assert.ok(hrefs.includes("/ops/experiences/own-meeting#meeting-setup"));
  assert.ok(hrefs.includes("/ops/experiences/own-meeting#experience-calendar"));
  assert.equal(hrefs.some((href) => /other-circle|other-meeting|global-meeting/.test(href)), false);
  const mismatch = render({ communication: otherCommunication });
  assert.match(text(mismatch), /saved chat link could not be loaded/);
  assert.equal(links(mismatch).some((node) => attr(node, "href") === otherCommunication.chatUrl), false);
  assert.equal(elements(mismatch).some((node) => node.tagName === "input" && attr(node, "name") === "url"), false);
});

test("missing communication or meeting data is unavailable, not an invented empty or editable state", () => {
  const missing = render({ communication: undefined, directory: null });
  assert.match(text(missing), /saved chat link could not be loaded/);
  assert.match(text(missing), /Meetings could not be loaded/);
  assert.doesNotMatch(text(missing), /No meetings scheduled|Not linked|Schedule a meeting/);
  assert.ok(links(missing).some((node) => attr(node, "href") === "/ops/experiences" && text(node) === "Open Experiences →"));
  assert.equal(elements(missing).some((node) => node.tagName === "form"), false);
  const unconfigured = render({ communication: { ...communication, googleCommunicationsConfigured: false }, directory: { ...directory, experiences: [] } });
  assert.match(text(unconfigured), /Setup needed|Choose test or live Google mode/);
  assert.doesNotMatch(text(unconfigured), /Not linked/);
  assert.equal(links(unconfigured).some((node) => attr(node, "href") === communication.chatUrl), false);
  assert.equal(elements(unconfigured).some((node) => node.tagName === "form"), false);
  assert.match(text(unconfigured), /No meetings scheduled/);
});

test("closed Circles keep review links but cannot schedule meetings or edit chat", () => {
  for (const status of ["archived", "completed"]) {
    const tree = render({ circle: { ...circle, status } });
    assert.match(text(tree), /Circle is closed/);
    assert.doesNotMatch(text(tree), /Schedule a meeting/);
    assert.ok(links(tree).some((node) => attr(node, "href") === communication.chatUrl));
    assert.ok(links(tree).some((node) => attr(node, "href") === "/ops/experiences/own-meeting#meeting-setup"));
    assert.equal(elements(tree).some((node) => node.tagName === "form"), false);
  }
  for (const data of [{ ...directory, canCreate: false }, { ...directory, circles: [otherCircle] }]) {
    assert.doesNotMatch(text(render({ directory: data })), /Schedule a meeting/);
  }
  assert.match(text(render({ circle: { ...circle, status: "forming" } })), /Schedule a meeting/);
});

test("upcoming meetings are time-ordered, bounded, and exclude ended or cancelled meetings", () => {
  const own = (experienceId, startsAt, extra = {}) => ({ ...meeting, experienceId, title: experienceId, startsAt, endsAt: null, ...extra });
  const tree = render({ directory: { ...directory, experiences: [
    own("fourth", "2099-09-19T18:00:00Z"), own("third", "2099-09-18T18:00:00Z"),
    own("second", "2099-09-17T18:00:00Z", { state: "draft" }), own("first", "2099-09-16T18:00:00Z"),
    own("ended", "2099-09-10T18:00:00Z"), own("cancelled", "2099-09-15T18:00:00Z", { state: "cancelled" }),
  ] } });
  const titles = elements(tree).filter((node) => node.tagName === "h4").map(text);
  assert.deepEqual(titles, ["first", "second", "third"]);
  assert.match(text(tree), /Upcoming & drafts|Draft — not published/);
});

function routeHarness({ state = "authenticated", role = "circle_leader", communications = [communication], meetings = directory } = {}) {
  const calls = [];
  const denied = () => { throw new Error("A scoped operator cannot load administration data"); };
  const Page = load("app/ops/circles/page.tsx", {
    "next/navigation": { redirect: (href) => { throw new Error(`redirect:${href}`); } },
    "@/components/platform/OperatorCirclesManager": { __esModule: true, default: "circle-manager" },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: ({ children }) => React.createElement("main", null, children) },
    "@/components/platform/OperatorCircleCommunicationPanel": { __esModule: true, default: Panel },
    "@/components/platform/OpsCircleManagementActions": { __esModule: true, default: "circle-management" },
    "@/components/platform/StateLabel": { __esModule: true, default: ({ state }) => React.createElement("span", null, state) },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: "platform-unavailable" },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({ state, role, viewer: { authUserId: "authorized-shaper" }, dashboard: { members: [], unassignedMembers: 0 } }) },
    "@/lib/platform/ops-preview": {}, "@/lib/platform/ops-experience-preview": {},
    "@/lib/platform/ops-repository": { getOpsCircleSummaries: denied, getOpsCircleManagementOptions: denied, getOpsCircleMemberAssignments: denied },
    "@/lib/platform/repository": { getOperatorMemberDirectoryPage: denied },
    "@/lib/platform/ops-operating-repository": { getOpsCircleCommunicationDirectory: async (actor) => { calls.push(["chat", actor]); if (communications === null) throw new Error("Chat unavailable"); return communications; } },
    "@/lib/platform/ops-experience-repository": { getOpsExperienceManagementDirectory: async (actor) => { calls.push(["meetings", actor]); if (meetings === null) throw new Error("Meetings unavailable"); return meetings; } },
  }).default;
  return { calls, Page, render: async (params = {}) => parseFragment(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }))) };
}

test("scoped Shaper and Guide routes render only authorized Circle data and never load member administration", async () => {
  for (const role of ["circle_leader", "guide"]) {
    const route = routeHarness({ role });
    const tree = await route.render({ circleId: circle.id });
    assert.deepEqual(route.calls, [["chat", "authorized-shaper"], ["meetings", "authorized-shaper"]]);
    assert.match(text(tree), /Own Circle meeting/);
    assert.doesNotMatch(text(tree), /Other Circle private meeting|Global meeting with the same display scope/);
    assert.equal(elements(tree).filter((node) => node.tagName === "article").length, 1);
    assert.equal(links(tree).some((node) => attr(node, "href") === otherCommunication.chatUrl), false);
    assert.equal(elements(tree).some((node) => attr(node, "id") === "circle-communications"), true);
  }
});

test("an invalid or unauthorized requested Circle yields recovery guidance without displaying a different Circle", async () => {
  for (const circleId of [otherCircle.id, "not-a-circle", "<script>wrong</script>"]) {
    const route = routeHarness();
    const tree = await route.render({ circleId });
    assert.match(text(tree), /Circle is not available to your account.*Administrator/);
    assert.doesNotMatch(text(tree), /Same Circle name|Own Circle meeting|Other Circle private meeting|wrong|script/);
    assert.equal(elements(tree).filter((node) => node.tagName === "article").length, 0);
    assert.equal(elements(tree).some((node) => node.tagName === "form"), false);
  }
});

test("scoped routes fail closed on access or data errors and do not misreport a failed directory as empty", async (t) => {
  t.mock.method(console, "error", () => {});
  const noMeetings = await routeHarness({ meetings: null }).render({ circleId: circle.id });
  assert.match(text(noMeetings), /Meetings could not be loaded/);
  assert.doesNotMatch(text(noMeetings), /No meetings scheduled/);
  assert.ok(links(noMeetings).some((node) => attr(node, "href") === communication.chatUrl));
  const noChat = await routeHarness({ communications: null }).render({ circleId: circle.id });
  assert.equal(elements(noChat).some((node) => node.tagName === "platform-unavailable"), true);
  for (const state of ["signed_out", "denied"]) {
    const route = routeHarness({ state });
    if (state === "signed_out") await assert.rejects(route.render(), /redirect:\/ops\/access/);
    else assert.equal(elements(await route.render()).some((node) => node.tagName === "platform-unavailable"), true);
    assert.deepEqual(route.calls, []);
  }
});
