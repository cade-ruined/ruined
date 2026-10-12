import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { createCanvas } from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => {
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => key });
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const model = load("src/lib/membership/public-card-model.ts");
const baseCard = { name: "Alex Morgan", memberTag: null, avatarUrl: null, memberSince: null, location: null, bio: null, buildingNow: null, websiteUrl: null, labels: [], wearSeed: "custom-invitation-proof" };
const snapshot = { invitationCustomized:false, card: baseCard, settings: model.defaultMemberCardSettings(), version: 5, writable: true, eligible: true, availableLabels: [] };
const nodes = tree => React.isValidElement(tree) ? [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)] : [];
const text = tree => React.isValidElement(tree) ? React.Children.toArray(tree.props.children).map(text).join("") : typeof tree === "string" ? tree : "";
async function harness(options = {}) {
  const state = [], effects = [], calls = [], saved = []; let cursor = 0;
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useEffect(effect, dependencies) { const index = cursor++; if (!state[index] || dependencies.some((value, i) => value !== state[index][i])) { state[index] = dependencies; effects.push(effect); } },
  };
  const Component = load("src/components/membership/InvitationCardSettings.tsx", { react, "@/lib/membership/public-card-model": model }, {
    fetch: async (url, init) => { const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, method: init.method || "GET", body });
      return { ok: true, json: async () => ({ snapshot: body ? { ...snapshot, card: { ...baseCard, bio: "Shared bio" }, settings: body, invitationCustomized:true, version: 6 } : (options.snapshot ?? snapshot) }) }; },
  }).default;
  const render = () => { cursor = 0; return Component({ disabled: false, preview: false, onSaved: card => saved.push(card), ...options }); };
  render(); effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve));
  return { render, calls, saved };
}

test("invitation customization saves selected fields with optimistic version and no publication changes", async () => {
  const ui = await harness();
  const bioLabel = nodes(ui.render()).find(node => node.type === "label" && text(node) === "Bio");
  nodes(bioLabel).find(node => node.type === "input").props.onChange({ currentTarget: { checked: true } });
  const save = nodes(ui.render()).find(node => node.type === "button" && text(node) === "Save card details");
  save.props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.calls.length,2);
  assert.deepEqual(ui.calls[1], { url: "/api/my/card", method: "POST", body: { ...snapshot.settings, showBio: true, showPortrait: false, showWebsite: false, version: 5, customizeInvitation: true } });
  assert.equal(ui.saved[0].bio,"Shared bio");
  assert.doesNotMatch(text(ui.render()),/Make.*public|Make private|Timeline visibility/);
});

test("preview and read-only customization never send writes", async () => {
  const preview = await harness({ preview: true }); assert.deepEqual(preview.calls,[]);
  const readOnly = await harness({ disabled: true });
  const save = nodes(readOnly.render()).find(node => node.type === "button" && text(node) === "Save card details");
  assert.equal(save.props.disabled,true); save.props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(readOnly.calls.length,1); assert.equal(readOnly.saved.length,0);
});

test("invitation print uses selected details, keeps the name-only default, and strips all direct-invitation member fields", async () => {
  const artworkModule = load("src/components/membership/card/card-artwork.ts", {
    "@/lib/membership/public-card-model": model,
    "@/lib/membership/invitation-expiry": load("src/lib/membership/invitation-expiry.ts"),
    "./card-text-layout": load("src/components/membership/card/card-text-layout.ts"),
  });
  const requests = [];
  const renderer = artworkModule.createCardArtworkRenderer({
    createCanvas(width,height) { const canvas = createCanvas(width,height), context = canvas.getContext("2d"), fill = context.fillText.bind(context); canvas.printed = [];
      context.fillText = (value,x,y) => { canvas.printed.push(value); fill(value,x,y); }; return canvas; },
    loadImage: async url => { requests.push(url); return null; }, loadFonts: async () => {}, handwritingFamily: () => "serif", editionYear: () => 2026,
  });
  const plain = await renderer.createCardArtwork(baseCard,"invitation");
  const selected = { ...baseCard, bio: "Selected biography", location: "Alpine, Utah", buildingNow: "Independent work", labels: ["Earned milestone"], avatarUrl: "/private-photo", websiteUrl: "https://private.example" };
  const customized = await renderer.createCardArtwork(selected,"invitation");
  const printed = customized.back.printed.join(" ");
  for (const value of ["Selected biography","Alpine, Utah","Independent work","Earned milestone"]) assert.ok(printed.includes(value));
  assert.doesNotMatch(plain.back.printed.join(" "),/Selected|Alpine|Independent|Earned/);
  assert.equal(requests.includes("/private-photo"),false);
  const direct = await renderer.createCardArtwork(selected,"invitation",null,null,"ruined_direct");
  assert.doesNotMatch([...direct.front.printed,...direct.back.printed].join(" "),/Alex Morgan|Selected|Alpine|Independent|Earned|private.example/);
  assert.match(direct.front.printed.join(" "),/The Ruined Project/);
});


test("customization starts with all optional fields off until Invitations has been explicitly saved", async () => {
  const legacy = { ...snapshot, settings: { ...snapshot.settings, publicEnabled:true, showBio:true, showLocation:true, showBuilding:true } };
  const ui = await harness({ snapshot:legacy });
  for (const node of nodes(ui.render()).filter(node => node.type === "input" && node.props.type === "checkbox")) assert.equal(node.props.checked,false);
  const saved = await harness({ snapshot:{ ...legacy, invitationCustomized:true } });
  const bio = nodes(saved.render()).find(node => node.type === "label" && text(node) === "Bio");
  assert.equal(nodes(bio).find(node => node.type === "input").props.checked,true);
});
