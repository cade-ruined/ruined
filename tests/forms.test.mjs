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
  assert.match(contact, /\{state === "sending" \? "Sending…" : "Send message"\}/);
  assert.match(signup, /name="consent"/);
  assert.match(signup, /type="checkbox"/);
  assert.match(signup, /required/);
  assert.match(signup, /href="\/privacy"/);
});

test("contact delivery bounds outbound requests and returns controlled failures", async () => {
  const [contactRoute, resend] = await Promise.all([
    source("app/api/contact/route.ts"),
    source("src/lib/communications/resend.ts"),
  ]);

  assert.match(contactRoute, /isTrustedPlatformOrigin\(request\)/);
  assert.match(contactRoute, /startsWith\("application\/json"\)/);
  assert.match(contactRoute, /MAX_BODY_LENGTH/);
  assert.match(contactRoute, /body\.company/);
  assert.match(contactRoute, /Promise\.race/);
  assert.match(contactRoute, /CONTACT_DELIVERY_TIMEOUT_MS = 10_000/);
  assert.match(contactRoute, /isContactDeliveryConfigured\(\)/);
  assert.match(contactRoute, /sendContactSubmission\(\{/);
  assert.match(contactRoute, /idempotencyKey: `contact-\$\{submissionId\}`/);
  assert.match(contactRoute, /try \{/);
  assert.match(contactRoute, /catch \{/);
  assert.match(contactRoute, /503/);
  assert.match(resend, /replyTo: email/);
  assert.match(resend, /subject: "New contact message"/);
  assert.match(resend, /\{ idempotencyKey \}/);
});

test("contact opens as an intercepted modal while direct visits retain a page", async () => {
  const [
    layout,
    modalRoute,
    modal,
    modalDefault,
    modalRoot,
    modalCatchAll,
    backgroundPathname,
    header,
    footer,
    directPage,
  ] = await Promise.all([
    source("app/layout.tsx"),
    source("app/@modal/(.)contact/page.tsx"),
    source("src/components/contact/ContactModal.tsx"),
    source("app/@modal/default.tsx"),
    source("app/@modal/page.tsx"),
    source("app/@modal/[...catchAll]/page.tsx"),
    source("src/hooks/useBackgroundPathname.ts"),
    source("src/components/SiteHeader.tsx"),
    source("src/components/SiteFooter.tsx"),
    source("app/contact/page.tsx"),
  ]);

  assert.match(layout, /modal: React\.ReactNode/);
  assert.match(layout, /\{modal\}/);
  assert.match(modalRoute, /<ContactModal \/>/);
  assert.match(modal, /dialog\.showModal\(\)/);
  assert.match(modal, /router\.back\(\)/);
  assert.match(modal, /onCancel=/);
  assert.match(modal, /Return to room/);
  assert.match(modal, /data-contact-return-focus/);
  assert.doesNotMatch(modal, /aria-describedby/);
  for (const emptySlot of [modalDefault, modalRoot, modalCatchAll]) {
    assert.match(emptySlot, /return null/);
  }
  assert.match(backgroundPathname, /useSelectedLayoutSegments\("children"\)/);
  assert.match(backgroundPathname, /segments\.length === 0 \? "\/"/);
  assert.match(header, /useBackgroundPathname\(\)/);
  assert.match(footer, /useBackgroundPathname\(\)/);
  assert.match(directPage, /<ContactSurface \/>/);
});
