import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../../src/components/membership/MemberWelcome.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
export const nodes = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
export const text = node => React.isValidElement(node)
  ? React.Children.toArray(node.props.children).map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : '';

export function welcomeUIFixture(initial, { fetch = async () => { throw new Error('Unexpected request'); } } = {}) {
  const props = { ...initial }, slots = [], effects = [], requests = [], listeners = new Map();
  let cursor = 0, dirty = false;
  const hooks = {
    useId() { const key = cursor++; return slots[key] ??= `welcome-${key}`; },
    useRef(initial) { const key = cursor++; return slots[key] ??= { current: initial }; },
    useState(initial) {
      const key = cursor++;
      if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
      return [slots[key], next => { const value = typeof next === 'function' ? next(slots[key]) : next; if (!Object.is(value, slots[key])) { slots[key] = value; dirty = true; } }];
    },
    useEffect(callback, deps) {
      const key = cursor++, old = slots[key];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        const slot = { deps }; slots[key] = slot;
        effects.push(() => { old?.cleanup?.(); slot.cleanup = callback(); });
      }
    },
  };
  const window = {
    addEventListener(type, callback) { const items = listeners.get(type) ?? new Set(); items.add(callback); listeners.set(type, items); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  };
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'fetch', code)(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'next/link') return { __esModule: true, default: 'a' };
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(`Unexpected welcome dependency: ${name}`);
  }, loaded, loaded.exports, window, async (url, init = {}) => { requests.push({ url, ...init }); return fetch(url, init); });
  function draw(next = {}) {
    Object.assign(props, next); let tree, budget = 10;
    do {
      cursor = 0; dirty = false; tree = loaded.exports.default(props);
      effects.splice(0).forEach(effect => effect());
    } while (dirty && --budget);
    assert.ok(budget, 'Welcome renders did not settle'); return tree;
  }
  function button(label) {
    const found = nodes(draw()).find(node => node.type === 'button' && (typeof label === 'string' ? text(node).startsWith(label) : label.test(text(node))));
    assert.ok(found, `Missing button: ${label}`); return found;
  }
  return {
    draw, requests, listeners, button,
    click(label) { const node = button(label); if (!node.props.disabled) node.props.onClick(); return draw(); },
    dispatch(type, detail) { listeners.get(type)?.forEach(callback => callback({ type, detail })); return draw(); },
    async settle() { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); draw(); } return draw(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
