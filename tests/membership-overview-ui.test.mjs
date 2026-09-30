import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const base = "src/components/public-members/";
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join(" ") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const accessibleText = node => React.isValidElement(node) ? node.props["aria-hidden"] ? "" : React.Children.toArray(node.props.children).map(accessibleText).join(" ").trim() : typeof node === "string" || typeof node === "number" ? String(node) : "";
const defaultVisibleNodes = node => {
  if (!React.isValidElement(node) || node.props.hidden) return [];
  const children = React.Children.toArray(node.props.children);
  return [node, ...(node.type === "details" && !node.props.open ? children.filter(child => child.type === "summary") : children).flatMap(defaultVisibleNodes)];
};
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const Image = ({ src, alt, sizes }) => React.createElement("img", { src, alt, sizes });
const EmptyCard = () => null;
const Room = ({ children }) => React.createElement("div", null, children);

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    assert.ok(name in dependencies, `Unexpected landing dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}

function hooks() {
  let cursor = 0;
  const slots = [], pending = new Map();
  return {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
      useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
      useId() { const i = cursor++; if (!(i in slots)) slots[i] = `landing-fixture-${i}`; return slots[i]; },
      useEffect(effect, dependencies) {
        const i = cursor++, previous = slots[i];
        if (!previous || !dependencies || dependencies.some((value, index) => !Object.is(value, previous.dependencies[index]))) {
          pending.set(i, () => { previous?.cleanup?.(); slots[i] = { dependencies, cleanup: effect() }; });
        }
      },
    },
    render(component, props) { cursor = 0; return component(props); },
    flushEffects() { const effects = [...pending.values()]; pending.clear(); effects.forEach(effect => effect()); },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
    reset() { slots.length = 0; pending.clear(); cursor = 0; },
  };
}

const pricing = await load("src/lib/membership/pricing.ts");

async function components(react = React, globals = {}) {
  const shared = { react, "next/image": Image, "next/link": Link, "@/lib/membership/pricing": pricing };
  const DirectForm = (await load(`${base}DirectInvitationRequestForm.tsx`, shared, globals)).default;
  const WaitlistForm = (await load(`${base}MembershipWaitlistForm.tsx`, shared, globals)).default;
  const Signup = (await load(`${base}MembershipSignup.tsx`, { ...shared, "./DirectInvitationRequestForm": DirectForm, "./MembershipWaitlistForm": WaitlistForm }, globals)).default;
  const Foundations = (await load(`${base}MembershipFoundationsSection.tsx`, shared, globals)).default;
  const Monthly = (await load(`${base}MembershipMonthlySection.tsx`, shared, globals)).default;
  const Community = (await load(`${base}MembershipCommunitySection.tsx`, shared, globals)).default;
  const Offers = (await load(`${base}MembershipOfferSection.tsx`, shared, globals)).default;
  const Questions = (await load(`${base}MembershipQuestions.tsx`, shared, globals)).default;
  const Overview = (await load(`${base}MembershipOverview.tsx`, {
    ...shared,
    "@/data/public-membership": { MEMBERSHIP_LINKS: { signIn: "/access" } },
    "./MembershipInvitationCard": { __esModule: true, default: EmptyCard, MembershipInvitationRoom: Room },
    "./MembershipSignup": Signup,
    "./MembershipFoundationsSection": Foundations,
    "./MembershipMonthlySection": Monthly,
    "./MembershipCommunitySection": Community,
    "./MembershipOfferSection": Offers,
    "./MembershipQuestions": Questions,
  }, globals)).default;
  return { Overview, Signup, DirectForm, WaitlistForm, Foundations, Monthly, Community, Offers, Questions };
}

test("landing modes explain the correct next step without registering or charging on render", async () => {
  const requests = [];
  const c = await components(React, { fetch: (...args) => { requests.push(args); throw Error("Rendering cannot contact a membership endpoint"); } });
  const render = props => renderToStaticMarkup(React.createElement(c.Overview, props));
  const waitlist = render({});
  assert.match(waitlist, /Join the waitlist/);
  assert.match(waitlist, /Free to join the waitlist/);
  assert.match(waitlist, /Joining the waitlist does not start a paid membership or reserve a founding rate/);
  assert.match(waitlist, /aria-label="Membership waitlist"/);
  assert.doesNotMatch(waitlist, /aria-label="Start your Ruined registration"/);
  const unavailableSetup = render({ paymentSetupOnly: true });
  assert.match(unavailableSetup, /aria-label="Membership waitlist"/);
  assert.doesNotMatch(unavailableSetup, /aria-label="Start your Ruined registration"/);
  assert.match(waitlist, /These are fictional examples, not member stories/);
  assert.match(waitlist, /Illustrative exercise\. This letter is fictional/);
  assert.match(waitlist, /Sample month.*Example topic/);

  for (const props of [{ preview: true, paymentSetupOnly: true }, { signupEnabled: true, paymentSetupOnly: true }]) {
    const setup = render(props);
    assert.match(setup, /Create my invitation/);
    assert.match(setup, /\$0 today/);
    assert.match(setup, /Saving a card is optional/);
    assert.match(setup, /explicitly confirm payment/);
    assert.match(setup, /Foundations remains closed until launch/);
    assert.match(setup, /no price or place is reserved/);
    assert.doesNotMatch(setup, /aria-label="Membership waitlist"/);
  }

  const paid = render({ signupEnabled: true });
  assert.match(paid, /Create my invitation/);
  assert.match(paid, /Pay when you activate/);
  assert.match(paid, /Your first monthly or full annual payment starts billing/);
  assert.match(paid, /confirm payment to activate paid membership/);
  assert.match(paid, /12-month initial commitment/);
  assert.match(paid, /lower of \$1,500 or the remaining unpaid installments/);
  assert.doesNotMatch(paid, /due at signup|No payment is due now|Foundations remains closed until launch/);
  assert.deepEqual(requests, []);
});

test("all six catalog offers share one billing selector with the invitation form", async () => {
  const parent = hooks(), offerHooks = hooks(), signupHooks = hooks(), requests = [];
  const globals = { fetch: (...args) => { requests.push(args); throw Error("Comparing offers cannot write"); } };
  const c = await components(parent.react, globals);
  const Offers = (await load(`${base}MembershipOfferSection.tsx`, { react: offerHooks.react, "@/lib/membership/pricing": pricing }, globals)).default;
  const Signup = (await load(`${base}MembershipSignup.tsx`, { react: signupHooks.react, "@/lib/membership/pricing": pricing, "./DirectInvitationRequestForm": c.DirectForm, "./MembershipWaitlistForm": c.WaitlistForm }, globals)).default;
  const render = () => parent.render(c.Overview, { signupEnabled: true });
  const childProps = component => nodes(render()).find(node => node.type === component).props;
  const offerTree = () => offerHooks.render(Offers, childProps(c.Offers));
  const signupTree = () => signupHooks.render(Signup, childProps(c.Signup));
  const checkedPlan = tree => nodes(tree).find(node => node.type === "input" && node.props.type === "radio" && node.props.checked).props.value;
  const seen = new Set();

  for (const plan of ["monthly", "annual"]) {
    nodes(offerTree()).find(node => node.type === "input" && node.props.value === plan).props.onChange();
    assert.equal(childProps(c.Offers).plan, plan);
    assert.equal(childProps(c.Signup).plan, plan, "the comparison selection must flow through the parent into signup");
    assert.equal(childProps(c.Signup).showPricing, false, "inline signup must not repeat the comparison prices or controls");
    assert.equal(checkedPlan(offerTree()), plan);
    assert.equal(nodes(signupTree()).filter(node => node.type === "input" && node.props.type === "radio").length, 0);
    const invitation = nodes(signupTree()).find(node => node.type === c.DirectForm);
    assert.equal(invitation.props.billingPlan, plan, "the emailed invitation must carry the selected billing preference");
    const articles = nodes(offerTree()).filter(node => node.type === "article");
    assert.equal(articles.length, 3);
    for (const [index, tier] of ["individual", "founding_individual", "couple"].entries()) {
      const offer = pricing.MEMBERSHIP_OFFERS[`${tier}_${plan}`];
      const copy = text(articles[index]);
      assert.ok(copy.includes(pricing.formatMembershipPrice(offer.amount)), `${offer.id} must show its catalog amount`);
      assert.match(copy, plan === "monthly" ? /\/\s*month/ : /\/\s*year/);
      if (plan === "annual") assert.ok(copy.includes(pricing.formatMembershipPrice(offer.annualSavings)), `${offer.id} must show its actual annual saving`);
      else assert.ok(!copy.includes(pricing.formatMembershipPrice(offer.initialTermAmount)), `${offer.id} must not repeat an annual total on the monthly plan`);
      if (plan === "annual") assert.match(copy, /Paid upfront/);
      else assert.doesNotMatch(copy, /12\s*×|\btotal\b/);
      seen.add(offer.id);
    }
  }
  assert.equal(seen.size, 6);
  nodes(offerTree()).find(node => node.type === "input" && node.props.value === "monthly").props.onChange();
  assert.equal(nodes(signupTree()).find(node => node.type === c.DirectForm).props.billingPlan, "monthly", "changing back to monthly must update the invitation preference");
  assert.deepEqual(requests, []);
});

test("pricing, the interactive card, and registration form occupy one invitation destination", async () => {
  const h = hooks(), c = await components(h.react);
  const root = h.render(c.Overview, { signupEnabled: true, paymentSetupOnly: true });
  const invitation = nodes(root).find(node => node.props.id === "your-invitation");
  assert.ok(invitation);
  const room = nodes(invitation).find(node => node.type === Room);
  assert.ok(room, "pricing and registration belong in the actual basement room");
  assert.equal(nodes(root).filter(node => node.type === c.Offers).length, 1);
  assert.equal(nodes(root).filter(node => node.type === c.Signup).length, 1);
  assert.equal(nodes(room).filter(node => node.type === EmptyCard).length, 1);
  const panel = nodes(room).find(node => node.props.className === "registration");
  assert.ok(panel);
  const children = nodes(panel);
  const offerIndex = children.findIndex(node => node.type === c.Offers);
  const signupIndex = children.findIndex(node => node.type === c.Signup);
  assert.ok(signupIndex >= 0 && offerIndex > signupIndex, "the visible fields sit beside the card before the compact pricing comparison");
  const html = renderToStaticMarkup(React.createElement(c.Overview, { signupEnabled: true, paymentSetupOnly: true }));
  assert.equal((html.match(/id="membership-pricing"/g) ?? []).length, 1, "existing pricing deep links retain one target inside the invitation");
  assert.equal((html.match(/Compare membership payment options/g) ?? []).length, 1);
  assert.equal((html.match(/type="radio"[^>]*value="(?:monthly|annual)"/g) ?? []).length, 2, "there is exactly one monthly/annual choice on the landing page");
  assert.doesNotMatch(html, /Your preferred future billing plan|Choose your signup plan/);
});

test("the invitation fields and comparison stay visible, personalize the card immediately, and lock billing while awaiting verification", async () => {
  const parent = hooks(), signupHooks = hooks(), offerHooks = hooks(), requests = [];
  const globals = { fetch: (...args) => { requests.push(args); throw Error("Editing invitation fields or comparing billing must not submit"); } };
  const c = await components(parent.react, globals);
  const Signup = (await load(`${base}MembershipSignup.tsx`, { react: signupHooks.react, "@/lib/membership/pricing": pricing, "./DirectInvitationRequestForm": c.DirectForm, "./MembershipWaitlistForm": c.WaitlistForm }, globals)).default;
  const Offers = (await load(`${base}MembershipOfferSection.tsx`, { react: offerHooks.react, "@/lib/membership/pricing": pricing }, globals)).default;
  const render = () => parent.render(c.Overview, { signupEnabled: true, paymentSetupOnly: true });
  const child = component => nodes(render()).find(node => node.type === component);
  const visible = component => defaultVisibleNodes(render()).some(node => node.type === component);
  const signupTree = () => signupHooks.render(Signup, child(c.Signup).props);
  const directForm = () => nodes(signupTree()).find(node => node.type === c.DirectForm);
  const offers = () => offerHooks.render(Offers, child(c.Offers).props);
  const choose = plan => nodes(offers()).find(node => node.type === "input" && node.props.value === plan).props.onChange();

  assert.equal(visible(c.Offers), true);
  assert.equal(visible(c.Signup), true, "name and email require no pricing-to-details click");
  assert.equal(nodes(render()).some(node => node.type === "button" && text(node).includes("Back to membership")), false);
  assert.equal(nodes(offers()).some(node => node.type === "button"), false, "the comparison is not a second signup gate");
  directForm().props.onRecipientNameChange("Cherry Hill");
  assert.equal(child(EmptyCard).props.recipientName, "Cherry Hill", "the card updates before any submit or verification");

  choose("annual");
  assert.equal(directForm().props.billingPlan, "annual");
  directForm().props.onRequestStateChange(true);
  assert.equal(child(c.Offers).props.disabled, true);
  assert.equal(nodes(offers()).find(node => node.type === "fieldset").props.disabled, true, "pending invitation/code disables native billing inputs");
  choose("monthly");
  assert.equal(child(c.Offers).props.plan, "annual", "pending confirmation cannot mutate the requested billing preference");
  assert.equal(visible(c.Offers), true);
  assert.equal(visible(c.Signup), true);
  assert.equal(child(EmptyCard).props.recipientName, "Cherry Hill");

  directForm().props.onRequestStateChange(false);
  choose("monthly");
  assert.equal(directForm().props.billingPlan, "monthly", "correcting details restores the billing choice");
  assert.equal(child(c.Offers).props.disabled, false);
  assert.deepEqual(requests, []);
});

test("direct invitation next steps use the inline email code without an email-invitation acceptance detour", async () => {
  const h = hooks(), c = await components(h.react);
  for (const paymentSetupOnly of [false, true]) {
    const root = h.render(c.Overview, { signupEnabled: true, paymentSetupOnly });
    const next = nodes(root).find(node => node.props["aria-labelledby"] === "next-heading");
    assert.deepEqual(nodes(next).filter(node => node.type === "h3").map(text), ["Make your invitation.", "Verify your email.", "Make your profile."]);
    assert.match(text(next), /Add your name.*card become yours.*confirmation code.*profile/);
    assert.doesNotMatch(text(next), /Open your invitation|Accept it within 48 hours|card arrives by email/);
    assert.match(text(next), paymentSetupOnly ? /Saving a card is optional.*explicitly confirm payment/ : /review your agreement.*Confirm payment to activate membership/);
  }
});

test("condensed pricing keeps the commitment visible while payment details and question categories begin closed", async () => {
  const h = hooks(), c = await components(h.react);
  const offer = h.render(c.Offers, { plan: "monthly", onPlanChange() {}, mode: "payment-setup" });
  const visibleParagraphs = defaultVisibleNodes(offer).filter(node => node.type === "p").map(text).join(" ");
  assert.match(visibleParagraphs, /\$0 today.*Saving a card is optional.*No charge or active membership until.*explicitly confirm payment/);
  assert.match(visibleParagraphs, /12-month initial commitment.*lower of \$1,500 or the remaining unpaid installments, replacing those installments/);
  assert.match(visibleParagraphs, /final offer is confirmed before payment; no price or place is reserved/);
  const paymentDetails = nodes(offer).find(node => node.type === "details" && text(node).includes("Payment terms"));
  assert.ok(paymentDetails);
  assert.equal(paymentDetails.props.open, undefined);
  assert.match(text(paymentDetails), /fewer than 50 other registered members/);
  assert.match(text(paymentDetails), /does not reserve a price or place/);

  const questions = c.Questions({ mode: "payment-setup" });
  const summaries = defaultVisibleNodes(questions).filter(node => node.type === "summary");
  assert.equal(summaries.length, 4, "the default page offers four useful question categories");
  for (const title of ["Getting started", "Calls & personal work", "Your Circle & community", "Payment & membership"]) assert.ok(summaries.some(node => text(node).includes(title)));
  assert.ok(nodes(questions).filter(node => node.type === "details").every(node => !node.props.open));
  assert.ok(nodes(questions).some(node => node.type === "summary" && text(node).includes("When do I pay?")), "specific answers remain available inside their categories");
});

test("registration-only landing explains required card saving and a later profile release", async () => {
  const h = hooks(), c = await components(h.react);
  const root = h.render(c.Overview, { signupEnabled: true, paymentSetupOnly: true, registrationOnly: true });
  const next = nodes(root).find(node => node.props["aria-labelledby"] === "next-heading");
  assert.deepEqual(nodes(next).filter(node => node.type === "h3").map(text), ["Make your invitation.", "Verify your email.", "You’re registered."]);
  assert.match(text(next), /welcome email/);
  assert.match(text(next), /another email when your profile is ready/);
  assert.doesNotMatch(text(next), /Saving a card is optional|Make your profile/);
  const offer = h.render(c.Offers, { plan: "monthly", onPlanChange() {}, mode: "payment-setup", registrationOnly: true });
  assert.match(text(offer), /Save a card to complete registration/);
  assert.doesNotMatch(text(offer), /Saving a card is optional/);
  const questions = c.Questions({ mode: "payment-setup", registrationOnly: true });
  assert.match(text(questions), /required to complete standard registration/);
  assert.match(text(questions), /Opening your profile also does not start billing/);
  assert.match(text(questions), /signing in before then shows your registration status/);
});

test("the sample month is optional while all four method steps and the monthly cadence remain visible", async () => {
  const h = hooks(), requests = [];
  const Monthly = (await load(`${base}MembershipMonthlySection.tsx`, { react: h.react }, { fetch: (...args) => requests.push(args) })).default;
  const render = () => h.render(Monthly, { ctaLabel: "Join the waitlist" });
  const initial = render();
  const sample = nodes(initial).find(node => node.type === "details" && text(node).includes("Explore a sample month"));
  assert.ok(sample, "the example has an explicit native disclosure");
  assert.equal(sample.props.open, undefined, "the sample does not expand the default page");
  assert.equal(defaultVisibleNodes(initial).filter(node => node.type === "input").length, 0);
  assert.deepEqual(defaultVisibleNodes(initial).filter(node => node.type === "h3").map(text), ["SEE", "FACE", "CUT", "GROW"]);
  const visibleCopy = defaultVisibleNodes(initial).filter(node => node.type === "p").map(text).join(" ");
  assert.match(visibleCopy, /4 calls.*90 minutes each/);
  assert.equal(nodes(initial).some(node => node.type === "a" && node.props.href === "#your-invitation"), false, "the monthly section does not repeat the main join action");
  const examples = new Set();
  for (const value of ["SEE", "FACE", "CUT", "GROW"]) {
    const input = nodes(render()).find(node => node.type === "input" && node.props.value === value);
    assert.equal(input.props.type, "radio", "native radios provide keyboard selection");
    input.props.onChange();
    const tree = render();
    assert.match(text(tree), /Sample month.*Example topic/);
    assert.match(text(tree), /not a scheduled topic/);
    assert.equal(nodes(tree).filter(node => node.type === "h3" && ["SEE", "FACE", "CUT", "GROW"].includes(text(node))).length, 4);
    const example = nodes(tree).find(node => node.props.id === input.props["aria-controls"]);
    assert.equal(example.props["aria-live"], "polite");
    assert.match(text(example), /In the call.*In your life/);
    examples.add(text(example));
    assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.checked).length, 1);
  }
  assert.equal(examples.size, 4, "each stage must expose different practice");
  assert.doesNotMatch(text(render()), /2027|scheduled for|Circle Shaper|Circle Guide/);
  assert.deepEqual(requests, []);
});

test("Foundations offers three closed expandable cards while preserving each exercise and the one-time virtual cadence", async () => {
  const h = hooks();
  const Foundations = (await load(`${base}MembershipFoundationsSection.tsx`, { react: h.react })).default;
  const render = () => h.render(Foundations, { ctaLabel: "Get my invitation" });
  const initial = render();
  const visible = defaultVisibleNodes(initial);
  const disclosures = nodes(initial).filter(node => node.type === "details");
  const summaryText = disclosure => accessibleText(React.Children.toArray(disclosure.props.children).find(child => child.type === "summary"));
  const timeline = disclosures.find(node => /Your Timeline/.test(summaryText(node)));
  const sessions = disclosures.find(node => /The 4 live virtual sessions/.test(summaryText(node)));
  const letter = disclosures.find(node => /Read an example/.test(summaryText(node)));
  assert.equal(disclosures.length, 3, "each Foundations preview has its own disclosure");
  assert.ok(timeline); assert.ok(sessions); assert.ok(letter);
  assert.match(summaryText(letter), /A letter to your future self\./);
  for (const disclosure of disclosures) {
    assert.equal(disclosure.props.open, undefined, "all three cards begin closed");
    assert.equal(disclosure.props.name, undefined, "opening one card must not automatically close another");
    assert.equal(nodes(disclosure).filter(node => node.type === "details").length, 1, "card content is not hidden in nested disclosures");
  }
  assert.equal(visible.filter(node => node.type === "summary").length, 3);
  assert.deepEqual(nodes(sessions).filter(node => node.type === "h4").map(text), ["Understand Ruined", "Understand your story", "Understand yourself", "Understand what comes next"]);
  assert.equal(visible.filter(node => node.type === "button" && node.props["aria-controls"]).length, 0, "Timeline choices stay inside their closed card");
  const visibleCopy = visible.filter(node => node.type === "p").map(text).join(" ");
  assert.match(visibleCopy, /4 live virtual sessions.*90 minutes each/);
  assert.match(visibleCopy, /Complete Foundations once at the start of membership, before the ongoing monthly work/);
  const timelineButtons = defaultVisibleNodes(React.cloneElement(timeline, { open: true })).filter(node => node.type === "button" && node.props["aria-controls"]);
  assert.equal(timelineButtons.length, 3, "opening the Timeline card reveals all three interactive moments");
  assert.deepEqual(timelineButtons.map(accessibleText), ["2019 Moving somewhere new", "2022 A job I didn’t get", "2025 Making a different choice"]);
  const samples = new Set();
  for (const button of timelineButtons) {
    button.props.onClick();
    const tree = render();
    const panel = nodes(tree).find(node => node.props.id === button.props["aria-controls"]);
    assert.equal(panel.props["aria-live"], "polite");
    assert.match(text(panel), /Then.*Now/);
    const currentTimeline = nodes(tree).find(node => node.type === "details" && /Your Timeline/.test(summaryText(node)));
    assert.ok(defaultVisibleNodes(React.cloneElement(currentTimeline, { open: true })).some(node => node.props.id === panel.props.id), "the selected perspective appears inside the open Timeline card");
    assert.equal(nodes(tree).filter(node => node.type === "button" && node.props["aria-pressed"]).length, 1);
    samples.add(text(panel));
  }
  assert.equal(samples.size, 3, "each Timeline selection changes its event and perspective");
  assert.match(text(render()), /fictional examples, not member stories/);
  assert.equal(nodes(initial).some(node => node.type === "a" && node.props.href === "#your-invitation"), false);
});

test("the three chapter links track reading position, layout changes, and release all listeners on unmount", async () => {
  const h = hooks(), frames = new Map(), windowListeners = new Map(), documentListeners = new Map();
  const positions = new Map([["how-it-works", 0], ["foundations", 700], ["your-invitation", 1900]]);
  let nextFrame = 0, scroll = 0, navigationBottom = 100;
  const window = {
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, callback, options) { windowListeners.set(name, { callback, options }); },
    removeEventListener(name, callback) { assert.equal(windowListeners.get(name)?.callback, callback); windowListeners.delete(name); },
  };
  const document = {
    getElementById: id => positions.has(id) ? { getBoundingClientRect: () => ({ top: positions.get(id) - scroll }) } : null,
    addEventListener(name, callback, capture) { documentListeners.set(name, { callback, capture }); },
    removeEventListener(name, callback, capture) { assert.equal(documentListeners.get(name)?.callback, callback); assert.equal(documentListeners.get(name)?.capture, capture); documentListeners.delete(name); },
  };
  const c = await components(h.react, { window, document });
  const root = h.render(c.Overview, {});
  const navigation = nodes(root).find(node => typeof node.type === "function" && node.type.name === "MembershipSectionNav");
  assert.ok(navigation);
  h.reset();
  const render = () => h.render(navigation.type, navigation.props);
  const initial = render();
  initial.props.ref.current = { getBoundingClientRect: () => ({ bottom: navigationBottom }) };
  h.flushEffects();
  const flushFrame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  const active = () => nodes(render()).filter(node => node.type === "a" && node.props["aria-current"] === "location").map(node => node.props.href);
  assert.deepEqual(nodes(initial).filter(node => node.type === "a").map(node => node.props.href), ["#how-it-works", "#foundations", "#your-invitation"]);
  assert.deepEqual(nodes(initial).filter(node => node.type === "a").map(accessibleText), ["Overview", "The work", "Pricing & join"]);
  assert.equal(windowListeners.get("scroll").options.passive, true);
  assert.equal(documentListeners.get("toggle").capture, true);
  flushFrame();
  assert.deepEqual(active(), ["#how-it-works"]);
  navigationBottom = 130; scroll = 541.83;
  windowListeners.get("scroll").callback(); flushFrame();
  assert.deepEqual(active(), ["#foundations"], "an anchor landing with breathing room and subpixel rounding must select its destination");
  navigationBottom = 100;
  for (const [offset, expected] of [[650, "#foundations"], [1800, "#your-invitation"], [2500, "#your-invitation"], [0, "#how-it-works"]]) {
    scroll = offset;
    windowListeners.get("scroll").callback();
    windowListeners.get("scroll").callback();
    assert.equal(frames.size, 1, "scroll events are coalesced into one frame");
    flushFrame();
    assert.deepEqual(active(), [expected]);
  }
  scroll = 1700;
  windowListeners.get("scroll").callback(); flushFrame();
  assert.deepEqual(active(), ["#foundations"]);
  navigationBottom = 210;
  windowListeners.get("resize").callback(); flushFrame();
  assert.deepEqual(active(), ["#your-invitation"], "responsive navigation height updates the active section boundary");
  positions.set("your-invitation", 2400);
  documentListeners.get("toggle").callback(); flushFrame();
  assert.deepEqual(active(), ["#foundations"], "opening a long exercise recalculates which chapter the reader is in");
  windowListeners.get("scroll").callback();
  assert.equal(frames.size, 1);
  h.cleanup();
  assert.equal(frames.size, 0);
  assert.equal(windowListeners.size, 0);
  assert.equal(documentListeners.size, 0);
});

test("preview invitation interactions never send email or create membership, and waitlist preview cannot submit", async () => {
  const h = hooks(), requests = [], locks = [];
  const c = await components(h.react, { fetch: (...args) => { requests.push(args); throw Error("Preview must not submit"); } });
  const props = { preview: true, paymentSetupOnly: true, billingPlan: "annual", onRequestStateChange: value => locks.push(value) };
  const render = () => h.render(c.DirectForm, props);
  nodes(render()).find(node => node.props.name === "recipientName").props.onChange({ target: { value: "Preview Reader" } });
  nodes(render()).find(node => node.props.name === "recipientEmail").props.onChange({ target: { value: "preview@example.test" } });
  await nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.match(text(render()), /No code was sent and no account was created/);
  const verification = nodes(render()).find(node => node.type === "form" && node.props["aria-label"] === "Verify your email");
  assert.ok(verification, "preview can show the actual code-entry layout without sending a code");
  const token = nodes(render()).find(node => node.props.name === "token");
  assert.equal(token.props.autoComplete, "one-time-code");
  token.props.onChange({ target: { value: "123456" } });
  await nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.match(text(render()), /Preview only.*verification cannot create an account here/);
  assert.deepEqual(locks, [true]);
  const wh = hooks();
  const Waitlist = (await load(`${base}MembershipWaitlistForm.tsx`, { react: wh.react }, { fetch: (...args) => requests.push(args) })).default;
  const waitlist = wh.render(Waitlist, { disabled: true });
  assert.equal(nodes(waitlist).find(node => node.type === "fieldset").props.disabled, true);
  await waitlist.props.onSubmit({ preventDefault() {}, get currentTarget() { throw Error("Disabled preview cannot read or send personal data"); } });
  assert.deepEqual(requests, []);
});

async function filmFixture() {
  const h = hooks(), listeners = new Map();
  const document = { hidden: false, body: { style: { overflow: "auto" } }, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  let plays = 0, pauses = 0, opens = 0, closes = 0;
  const c = await components(h.react, { document });
  const render = () => { const tree = h.render(c.Overview, {}); h.flushEffects(); return tree; };
  const initial = h.render(c.Overview, {});
  nodes(initial).find(node => node.type === "dialog").props.ref.current = { showModal() { opens++; }, close() { closes++; } };
  nodes(initial).find(node => node.type === "video").props.ref.current = { play() { plays++; return Promise.resolve(); }, pause() { pauses++; } };
  h.flushEffects();
  return { render, document, listeners, cleanup: () => h.cleanup(), counts: () => ({ plays, pauses, opens, closes }) };
}

test("the hero remains still and film playback begins only from its deliberate play action", async () => {
  const f = await filmFixture();
  const tree = f.render();
  const hero = nodes(tree).find(node => node.type === "section" && node.props["aria-labelledby"] === "membership-title");
  assert.equal(nodes(hero).some(node => node.type === "video"), false);
  assert.equal(nodes(tree).filter(node => node.type === "video").length, 1);
  const video = nodes(tree).find(node => node.type === "video");
  assert.equal(video.props.autoPlay, undefined);
  assert.equal(video.props.preload, "none");
  assert.deepEqual(f.counts(), { plays: 0, pauses: 0, opens: 0, closes: 0 });
  nodes(tree).find(node => node.type === "button" && /Play Meet Ruined/.test(node.props["aria-label"])).props.onClick();
  f.render();
  assert.deepEqual(f.counts(), { plays: 1, pauses: 0, opens: 1, closes: 0 });
  assert.equal(f.document.body.style.overflow, "hidden");
  f.document.hidden = true;
  f.listeners.get("visibilitychange")();
  assert.equal(f.counts().pauses, 1);
  f.cleanup();
  assert.equal(f.document.body.style.overflow, "auto");
  assert.equal(f.listeners.size, 0);
});

test("closing, escaping, or dismissing the film pauses it and restores page scrolling", async () => {
  for (const reason of ["button", "escape", "backdrop", "native-close"]) {
    const f = await filmFixture();
    nodes(f.render()).find(node => node.type === "button" && /Play Meet Ruined/.test(node.props["aria-label"])).props.onClick();
    const tree = f.render();
    const dialog = nodes(tree).find(node => node.type === "dialog");
    if (reason === "button") nodes(tree).find(node => node.props["aria-label"] === "Close film").props.onClick();
    else if (reason === "escape") dialog.props.onCancel();
    else if (reason === "native-close") dialog.props.onClose();
    else { const target = {}; dialog.props.onClick({ target, currentTarget: target }); }
    f.render();
    assert.equal(f.counts().pauses, 1, `${reason} must stop the audio`);
    assert.equal(f.counts().closes, 1);
    assert.equal(f.document.body.style.overflow, "auto");
    f.cleanup();
  }
});
