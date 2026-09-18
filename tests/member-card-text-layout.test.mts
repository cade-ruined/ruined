import assert from "node:assert/strict";
import test from "node:test";
import { abbreviateCardText, fitCardText, wrapCardText } from "../src/components/membership/card/card-text-layout.ts";

// One em per character is deliberately wider than most Latin prose.
const measure = (value: string, size: number) => Array.from(value).length * size;
const contents = (value: string) => value.replace(/\s+/g, "");

test("a full 64-character name stays readable and inside its print area", () => {
  for (const value of ["W".repeat(64), "李".repeat(64), "Alexandra Montgomery-Wellington de la Cruz".padEnd(64, "M")]) {
    const layout = fitCardText(value, { width: 880, height: 292, maxSize: 92, minSize: 48, leading: 1.12, measure });
    assert.equal(layout.overflow, false);
    assert.ok(layout.size >= 48);
    assert.ok(layout.height <= 292);
    assert.equal(contents(layout.lines.join("")), contents(value));
    assert.ok(layout.lines.every(line => measure(line, layout.size) <= 880));
  }
});

test("maximum selected location, building and introduction retain their full text", () => {
  for (const item of [
    { length: 160, width: 880, height: 238, maxSize: 30, minSize: 28, leading: 1.24 },
    { length: 100, width: 864, height: 275, maxSize: 60, minSize: 36, leading: 1.2 },
    { length: 180, width: 864, height: 390, maxSize: 32, minSize: 28, leading: 1.35 },
  ]) {
    const value = "W".repeat(item.length);
    const layout = fitCardText(value, { ...item, measure });
    assert.equal(layout.overflow, false);
    assert.equal(layout.lines.join(""), value);
    assert.ok(layout.height <= item.height);
  }
});

test("unbounded milestone names use an explicit ellipsis within two lines", () => {
  const layout = fitCardText("W".repeat(1500), { width: 838, height: 68, maxSize: 26, minSize: 26, measure });
  const printed = abbreviateCardText(layout, 2, 838, measure);
  assert.equal(printed.lines.length, 2);
  assert.equal(printed.overflow, true);
  assert.ok(printed.lines[1].endsWith("…"));
  assert.ok(printed.lines.every(line => measure(line, printed.size) <= 838));
  assert.equal(printed.size, 26);
});

test("word wrapping preserves astral characters and handles empty fields", () => {
  assert.deepEqual(wrapCardText("", 100, value => value.length), []);
  const value = "🫶".repeat(32);
  const wrapped = wrapCardText(value, 200, text => measure(text, 40));
  assert.equal(wrapped.join(""), value);
  assert.ok(wrapped.every(line => !/[\ud800-\udbff]$/.test(line)));
});
