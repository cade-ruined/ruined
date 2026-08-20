import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

async function source(file) {
  return fs.readFile(path.join(root, file), "utf8");
}

test("public forms expose labels, autofill hints, progress, and live feedback", async () => {
  const [contact, signup] = await Promise.all([
    source("src/components/ContactForm.tsx"),
    source("src/components/EmailSignupForm.tsx"),
  ]);

  for (const component of [contact, signup]) {
    assert.match(component, /<label/);
    assert.match(component, /htmlFor=/);
    assert.match(component, /autoComplete="email"/);
    assert.match(component, /aria-busy=\{state === "sending"\}/);
    assert.match(component, /disabled=\{state === "sending"\}/);
    assert.match(component, /role="status"/);
    assert.match(component, /aria-live="polite"/);
    assert.match(component, /role="alert"/);
    assert.match(component, /aria-live="assertive"/);
    assert.match(component, /const form = event\.currentTarget/);
    assert.match(component, /try \{/);
    assert.match(component, /catch \{/);
  }

  assert.match(contact, /autoComplete="name"/);
  assert.match(contact, /\{state === "sending" \? "Sending…" : "Send submission"\}/);
  assert.match(signup, /name="consent"/);
  assert.match(signup, /type="checkbox"/);
  assert.match(signup, /required/);
  assert.match(signup, /href="\/privacy"/);
});

test("contact delivery bounds outbound requests and returns controlled failures", async () => {
  const contactRoute = await source("app/api/contact/route.ts");

  assert.match(contactRoute, /signal: AbortSignal\.timeout\(10_000\)/);
  assert.match(contactRoute, /try \{/);
  assert.match(contactRoute, /catch \{/);
  assert.match(contactRoute, /status: 502/);
});
