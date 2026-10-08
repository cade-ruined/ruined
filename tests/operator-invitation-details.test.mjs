import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/components/platform/OperatorInvitationDetails.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const nodes = input => React.isValidElement(input) ? [input, ...React.Children.toArray(input.props.children).flatMap(nodes)] : [];
const content = input => React.isValidElement(input) ? React.Children.toArray(input.props.children).map(content).join("") : input == null || typeof input === "boolean" ? "" : String(input);
const invitation = {
  id: "invite-1", recipientName: "Cherry Hill", recipientEmail: "cherry@example.test", inviterName: "Morgan Reid",
  issuedAt: "2026-10-06T19:18:00Z", expiresAt: null, revokedAt: null, submittedAt: null,
  acceptedAt: "2026-10-07T00:01:00Z", emailRequested: false, deliveryStatus: "not_requested", sentAt: null,
  origin: "member", membershipType: "standard",
};
let instanceId = 0;

function environment() {
  class Target {
    listeners = new Map();
    addEventListener(type, callback) { const callbacks = this.listeners.get(type) ?? new Set(); callbacks.add(callback); this.listeners.set(type, callbacks); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatchEvent(event) { for (const callback of this.listeners.get(event.type) ?? []) callback(event); }
  }
  const document = Object.assign(new Target(), { activeElement: null });
  const window = Object.assign(new Target(), { innerWidth: 390, innerHeight: 844 });
  class Node {
    props = {}; children = []; style = {};
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    getBoundingClientRect() { return { left: 300, top: 120, bottom: 164, width: this.props.role === "dialog" ? 336 : 44, height: this.props.role === "dialog" ? 340 : 44 }; }
    showPopover() { this.shown = true; }
    focus() { document.activeElement = this; this.props.onFocus?.(); }
  }
  let time = 0, nextTimer = 0;
  const timers = new Map();
  const globals = { window, document, Node,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  return { globals, outside: () => new Node(),
    tick(ms) { time += ms; for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    fixture(record = invitation, memberName = "Cherry Hill") {
      let cursor = 0, tree; const slots = [], effects = [], refs = new Set(), dom = new Map();
      const scheduleEffect = (effect, deps) => {
        const i = cursor++, old = slots[i];
        if (!old || deps.some((value, index) => value !== old.deps[index])) {
          effects.push(() => { old?.cleanup?.(); slots[i].cleanup = effect(); });
          slots[i] = { deps, cleanup: old?.cleanup };
        }
      };
      const hooks = { ...React,
        useId() { const i = cursor++; return slots[i] ??= `invitation-${++instanceId}`; },
        useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
        useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = next; }]; },
        useCallback(callback, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) slots[i] = { callback, deps }; return slots[i].callback; },
        useEffect: scheduleEffect, useLayoutEffect: scheduleEffect,
      };
      const loaded = { exports: {} };
      new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => name === "react" ? hooks : name.endsWith(".module.css") ? { default: {} } : require(name), loaded, loaded.exports, ...Object.values(globals));
      const Component = loaded.exports.default;
      function render() {
        cursor = 0; tree = Component({ invitation: record, memberName });
        const currentRefs = new Set();
        function attach(element) {
          if (!React.isValidElement(element)) return null;
          const ref = element.props.ref;
          const node = ref ? ref.current ?? new Node() : new Node();
          node.props = element.props;
          node.children = React.Children.toArray(element.props.children).map(attach).filter(Boolean);
          if (ref) { ref.current = node; currentRefs.add(ref); }
          dom.set(element.props, node);
          return node;
        }
        attach(tree);
        for (const ref of refs) if (!currentRefs.has(ref)) ref.current = null;
        refs.clear(); for (const ref of currentRefs) refs.add(ref);
        for (const effect of effects.splice(0)) effect();
        return tree;
      }
      function find(predicate) { render(); return nodes(tree).find(predicate); }
      const trigger = () => find(node => node.type === "button" && node.props["aria-haspopup"] === "dialog");
      const panel = () => find(node => node.props.role === "dialog");
      render();
      return { render, trigger, panel,
        open: () => trigger().props["aria-expanded"],
        focusTrigger() { const node = trigger(); dom.get(node.props).focus(); render(); },
        dom: element => dom.get(element.props),
        text: () => content(render()),
        cleanup() { for (const slot of slots) slot?.cleanup?.(); },
      };
    },
  };
}

test("hover remains open across the trigger-to-card gap and closes after leaving both", () => {
  const e = environment(), f = e.fixture();
  f.trigger().props.onPointerEnter({ pointerType: "mouse" }); assert.equal(f.open(), true);
  f.trigger().props.onPointerLeave(); e.tick(90);
  f.panel().props.onPointerEnter(); e.tick(200); assert.equal(f.open(), true);
  f.panel().props.onPointerLeave(); e.tick(180); assert.equal(f.open(), false);
  f.trigger().props.onPointerEnter({ pointerType: "touch" }); assert.equal(f.open(), false);
  f.trigger().props.onClick(); assert.equal(f.open(), true, "touch click opens the card");
  f.cleanup();
});

test("click pins the card, outside pointer dismisses, and a second click closes", () => {
  const e = environment(), f = e.fixture();
  f.trigger().props.onPointerEnter({ pointerType: "mouse" }); f.trigger().props.onClick();
  f.trigger().props.onPointerLeave(); e.tick(180); assert.equal(f.open(), true);
  e.globals.document.dispatchEvent({ type: "pointerdown", target: e.outside() }); assert.equal(f.open(), false);
  f.trigger().props.onClick(); assert.equal(f.open(), true);
  f.trigger().props.onClick(); assert.equal(f.open(), false);
  f.cleanup();
});

test("opening another row never suppresses keyboard focus, and only one card remains open", () => {
  const e = environment(), first = e.fixture(), second = e.fixture({ ...invitation, recipientName: "Alex Rivera" }, "Alex Rivera");
  first.focusTrigger(); assert.equal(first.open(), true);
  second.focusTrigger(); assert.equal(second.open(), true); assert.equal(first.open(), false);
  assert.match(second.text(), /Alex Rivera/);
  first.cleanup(); second.cleanup();
});

test("Escape and close return focus without reopening; tabbing out dismisses a pinned hovered card", () => {
  const e = environment(), f = e.fixture();
  f.focusTrigger(); let prevented = false;
  e.globals.document.dispatchEvent({ type: "keydown", key: "Escape", preventDefault: () => { prevented = true; } });
  assert.equal(f.open(), false); assert.equal(prevented, true);
  assert.equal(e.globals.document.activeElement, f.dom(f.trigger()));
  f.trigger().props.onBlur({ relatedTarget: e.outside() }); f.focusTrigger(); assert.equal(f.open(), true);
  f.trigger().props.onPointerEnter({ pointerType: "mouse" }); f.trigger().props.onClick();
  const card = f.panel();
  f.trigger().props.onBlur({ relatedTarget: f.dom(card) }); assert.equal(f.open(), true, "moving focus into the card keeps it open");
  f.panel().props.onBlur({ relatedTarget: e.outside() }); assert.equal(f.open(), false, "tabbing away closes even when pointer stays over trigger");
  f.focusTrigger();
  const close = nodes(f.render()).find(node => node.props["aria-label"] === "Close invitation details");
  close.props.onClick(); assert.equal(f.open(), false);
  assert.equal(e.globals.document.activeElement, f.dom(f.trigger()));
  f.cleanup();
});

test("invitation content separates email request, send status, direct origin and missing record", () => {
  const e = environment();
  for (const [status, label] of [["not_requested", "Email not requested"], ["queued", "Queued"], ["sending", "Sending"], ["sent", "Sent"], ["failed", "Send failed"], ["cancelled", "Cancelled"]]) {
    const f = e.fixture({ ...invitation, emailRequested: status !== "not_requested", deliveryStatus: status, sentAt: status === "sent" ? "2026-10-06T19:19:00Z" : null });
    f.focusTrigger(); assert.match(f.text(), new RegExp(label)); assert.doesNotMatch(f.text(), /Delivered/); f.cleanup();
  }
  const direct = e.fixture({ ...invitation, origin: "ruined_direct", inviterName: "Private operator name" });
  direct.focusTrigger(); assert.match(direct.text(), /Ruined · direct invitation/); assert.doesNotMatch(direct.text(), /Private operator name/); direct.cleanup();
  const missing = e.fixture(null); missing.focusTrigger(); assert.match(missing.text(), /No personal invitation found for this registration\./); missing.cleanup();
});
