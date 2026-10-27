import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture({ coarse = false, scrollbar = 16 } = {}) {
  const original = {
    overflow: ["auto", "important"], "padding-right": ["7px", ""],
    position: ["relative", ""], top: ["3px", ""], left: ["", ""], width: ["95%", "important"],
    color: ["red", ""],
  };
  const values = new Map(Object.entries(original));
  const style = {
    getPropertyValue: (property) => values.get(property)?.[0] ?? "",
    getPropertyPriority: (property) => values.get(property)?.[1] ?? "",
    setProperty(property, value, priority = "") { values.set(property, [value, priority]); },
    removeProperty(property) { values.delete(property); },
  };
  const body = { style };
  const scrolls = [];
  const browser = {
    scrollX: 12, scrollY: 640, innerWidth: 400,
    matchMedia: () => ({ matches: coarse }),
    getComputedStyle: () => ({ paddingRight: "7px" }),
    scrollTo: (position) => scrolls.push(position),
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/store/product-scroll-lock.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output = { exports: {} };
  new Function("module", "exports", "window", "document", code)(output, output.exports, browser, {
    body, documentElement: { clientWidth: 400 - scrollbar },
  });
  const snapshot = () => Object.fromEntries(Object.keys(original).map((property) => [property, [style.getPropertyValue(property), style.getPropertyPriority(property)]]));
  return { acquire: output.exports.acquireProductScrollLock, style, original, snapshot, scrolls, browser };
}

test("nested product and size-guide locks restore the exact baseline in either cleanup order", () => {
  for (const coarse of [false, true]) {
    for (const parentFirst of [false, true]) {
      const view = fixture({ coarse });
      const parent = view.acquire();
      assert.equal(view.style.getPropertyValue("overflow"), "hidden");
      assert.equal(view.style.getPropertyValue("padding-right"), "23px");
      assert.equal(view.style.getPropertyValue("position"), coarse ? "fixed" : "relative");
      if (coarse) {
        assert.equal(view.style.getPropertyValue("top"), "-640px");
        assert.equal(view.style.getPropertyValue("left"), "-12px");
      }
      const nested = view.acquire();
      assert.equal(view.style.getPropertyValue("padding-right"), "23px", "nested locks never add scrollbar padding twice");
      const releases = parentFirst ? [parent, nested] : [nested, parent];
      releases[0]();
      assert.equal(view.style.getPropertyValue("overflow"), "hidden");
      assert.deepEqual(view.scrolls, []);
      releases[0]();
      assert.equal(view.style.getPropertyValue("overflow"), "hidden", "a repeated release cannot consume the other owner's lock");
      releases[1]();
      assert.deepEqual(view.snapshot(), view.original);
      assert.deepEqual(view.scrolls, coarse ? [{ left: 12, top: 640, behavior: "instant" }] : []);
      releases[1]();
      assert.equal(view.scrolls.length, coarse ? 1 : 0);
    }
  }
});

test("only the first owner's navigation predicate decides whether to restore coarse-pointer scroll", () => {
  for (const parentFirst of [false, true]) {
    const view = fixture({ coarse: true, scrollbar: 0 });
    let backgroundPresent = true;
    let checks = 0;
    const parent = view.acquire({ restoreScroll: () => { checks += 1; return backgroundPresent; } });
    const nested = view.acquire({ restoreScroll: () => assert.fail("Nested navigation cannot override the initial owner") });
    backgroundPresent = false;
    const releases = parentFirst ? [parent, nested] : [nested, parent];
    releases[0]();
    assert.equal(checks, 0);
    releases[1]();
    assert.equal(checks, 1);
    assert.deepEqual(view.scrolls, [], "navigating to Bag cannot jump back to the catalog's old scroll position");
    assert.deepEqual(view.snapshot(), view.original);
  }
});

test("a later dialog captures a fresh baseline after the final prior release", () => {
  const view = fixture({ coarse: true });
  view.acquire()();
  view.style.setProperty("overflow", "clip");
  view.browser.scrollY = 80;
  const release = view.acquire({ restoreScroll: () => true });
  assert.equal(view.style.getPropertyValue("top"), "-80px");
  release();
  assert.equal(view.style.getPropertyValue("overflow"), "clip");
  assert.deepEqual(view.scrolls.at(-1), { left: 12, top: 80, behavior: "instant" });
});
