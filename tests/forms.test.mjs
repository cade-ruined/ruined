import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

async function source(file) {
  return fs.readFile(path.join(root, file), "utf8");
}

test("public forms expose labels, autofill hints, progress, and live feedback", async () => {
  const [contact, gate, journey] = await Promise.all([
    source("src/components/ContactForm.tsx"),
    source("src/components/ComingSoonGate.tsx"),
    source("src/components/sequence/JourneyComingSoon.tsx"),
  ]);

  for (const component of [contact, gate, journey]) {
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
});

test("form delivery routes bound outbound requests and return controlled failures", async () => {
  const [contactRoute, signupRoute] = await Promise.all([
    source("app/api/contact/route.ts"),
    source("app/api/hubspot-signup/route.ts"),
  ]);

  for (const route of [contactRoute, signupRoute]) {
    assert.match(route, /signal: AbortSignal\.timeout\(10_000\)/);
    assert.match(route, /try \{/);
    assert.match(route, /catch \{/);
    assert.match(route, /status: 502/);
  }
});
