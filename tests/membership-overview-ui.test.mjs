import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
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
const opportunityCalls = await load("src/data/opportunity-calls.ts");

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
  const OpportunityCalls = (await load(`${base}MembershipOpportunityCalls.tsx`, { ...shared, "@/data/opportunity-calls": opportunityCalls }, globals)).default;
  const expiration = await load("src/lib/membership/invitation-expiry.ts");
  const invitationExpiry = { useInvitationExpired: value => expiration.memberInvitationExpired(value) };
  const Acceptance = (await load("src/components/membership/PersonalInvitationAcceptance.tsx", {
    ...shared, "@/lib/membership/invitation-expiry": expiration,
    "@/lib/membership/personal-invitation-presentation": await load("src/lib/membership/personal-invitation-presentation.ts"),
    "./use-invitation-expiry": invitationExpiry,
  }, globals)).default;
  const Overview = (await load(`${base}MembershipOverview.tsx`, {
    ...shared,
    "@/data/public-membership": { MEMBERSHIP_LINKS: { signIn: "/access" } },
    "@/components/membership/PersonalInvitationAcceptance": Acceptance,
    "@/components/membership/use-invitation-expiry": invitationExpiry,
    "./MembershipWaitlistForm": WaitlistForm,
    "./MembershipInvitationCard": { __esModule: true, default: EmptyCard, MembershipInvitationRoom: Room },
    "./MembershipSignup": Signup,
    "./MembershipFoundationsSection": Foundations,
    "./MembershipMonthlySection": Monthly,
    "./MembershipCommunitySection": Community,
    "./MembershipOfferSection": Offers,
    "./MembershipQuestions": Questions,
    "./MembershipOpportunityCalls": OpportunityCalls,
  }, globals)).default;
  return { Overview, Signup, DirectForm, WaitlistForm, Acceptance, Foundations, Monthly, Community, Offers, Questions, OpportunityCalls };
}

test("landing modes explain the correct next step without registering or charging on render", async () => {
  const requests = [];
  const c = await components(React, { fetch: (...args) => { requests.push(args); throw Error("Rendering cannot contact a membership endpoint"); } });
  const render = props => renderToStaticMarkup(React.createElement(c.Overview, props));
  const waitlist = render({});
  assert.match(waitlist, /Join the waitlist/);
  assert.match(waitlist, /Free to join the waitlist/);
  assert.doesNotMatch(waitlist, /registration receipt|lock in \$349\/month/);
  assert.match(waitlist, /Joining the waitlist does not start a paid membership or reserve a founding rate/);
  assert.match(waitlist, /aria-label="Membership waitlist"/);
  assert.doesNotMatch(waitlist, /aria-label="Start your Ruined registration"/);
  const unavailableSetup = render({ paymentSetupOnly: true });
  assert.match(unavailableSetup, /aria-label="Membership waitlist"/);
  assert.doesNotMatch(unavailableSetup, /aria-label="Start your Ruined registration"/);
  assert.match(waitlist, /These are fictional examples, not member stories/);
  assert.match(waitlist, /Illustrative exercise\. This letter is fictional/);
  assert.match(waitlist, /December 2026.*TIME/);

  for (const props of [{ preview: true, paymentSetupOnly: true }, { signupEnabled: true, paymentSetupOnly: true }]) {
    const setup = render(props);
    assert.match(setup, /Create my invitation/);
    assert.match(setup, /\$0 today/);
    assert.match(setup, /Saving a card is optional/);
    assert.match(setup, /explicitly confirm payment/);
    assert.match(setup, /Foundations remains closed until launch/);
    assert.match(setup, /no price or place is reserved/);
    assert.doesNotMatch(setup, /lock in \$349\/month|registration receipt/);
    assert.doesNotMatch(setup, /aria-label="Membership waitlist"/);
  }

  const paid = render({ signupEnabled: true });
  assert.match(paid, /Create my invitation/);
  assert.match(paid, /Pay when you activate/);
  assert.match(paid, /Your first monthly or full annual payment starts billing/);
  assert.match(paid, /confirm payment to activate paid membership/);
  assert.match(paid, /12-month initial commitment/);
  assert.match(paid, /lower of \$1,500 or the remaining unpaid installments/);
  assert.doesNotMatch(paid, /due at signup|No payment is due now|Foundations remains closed until launch|registration receipt|lock in \$349\/month/);
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
  assert.match(text(offer), /Eligible individuals who complete registration with a verified saved card lock in \$349\/month/);
  assert.match(text(offer), /Payment requires a separate checkout you choose to complete/);
  assert.match(text(offer), /first 50 places count current active paid and complimentary members, held checkouts, and completed registrations awaiting membership activation/);
  assert.match(text(offer), /saving a card alone does not reserve the rate/);
  assert.match(text(offer), /reserved through your first paid membership activation/);
  assert.match(text(offer), /couples plans keep their separate price/);
  assert.doesNotMatch(text(offer), /Saving a card is optional/);
  const questions = c.Questions({ mode: "payment-setup", registrationOnly: true });
  assert.match(text(questions), /required to complete standard registration/);
  assert.match(text(questions), /When is the Founding rate reserved/);
  assert.match(text(questions), /complete registration with a verified saved card lock in \$349\/month/);
  assert.match(text(questions), /Opening your profile also does not start billing/);
  assert.match(text(questions), /signing in before then shows your registration status/);
});

test("the TIME example is optional while the method, confirmed roadmap, and monthly challenge remain visible", async () => {
  const h = hooks(), requests = [];
  const Monthly = (await load(`${base}MembershipMonthlySection.tsx`, { react: h.react }, { fetch: (...args) => requests.push(args) })).default;
  const render = () => h.render(Monthly, { ctaLabel: "Join the waitlist" });
  const initial = render();
  const sample = nodes(initial).find(node => node.type === "details" && text(node).includes("Explore a month: TIME"));
  assert.ok(sample, "the example has an explicit native disclosure");
  assert.equal(sample.props.open, undefined, "the sample does not expand the default page");
  assert.equal(defaultVisibleNodes(initial).filter(node => node.type === "input").length, 0);
  assert.deepEqual(defaultVisibleNodes(initial).filter(node => node.type === "h3").map(text), ["SEE", "FACE", "CUT", "GROW", "Coming up"]);
  const visibleCopy = defaultVisibleNodes(initial).filter(node => node.type === "p").map(text).join(" ");
  assert.match(visibleCopy, /4 calls.*90 minutes each/);
  assert.match(visibleCopy, /Foundations only/);
  assert.match(visibleCopy, /monthly group challenge.*Each topic/);
  assert.deepEqual(defaultVisibleNodes(initial).filter(node => node.type === "time").map(node => node.props.dateTime), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(defaultVisibleNodes(initial).filter(node => node.type === "h4").map(text), ["Foundations", "TIME", "Reinvention"]);
  assert.equal(nodes(initial).some(node => node.type === "a" && node.props.href === "#your-invitation"), false, "the monthly section does not repeat the main join action");
  const examples = new Set();
  for (const value of ["SEE", "FACE", "CUT", "GROW"]) {
    const input = nodes(render()).find(node => node.type === "input" && node.props.value === value);
    assert.equal(input.props.type, "radio", "native radios provide keyboard selection");
    input.props.onChange();
    const tree = render();
    assert.match(text(tree), /December 2026.*TIME/);
    assert.match(text(tree), /An example of how we’ll explore one topic/);
    assert.equal(nodes(tree).filter(node => node.type === "h3" && ["SEE", "FACE", "CUT", "GROW"].includes(text(node))).length, 4);
    const example = nodes(tree).find(node => node.props.id === input.props["aria-controls"]);
    assert.equal(example.props["aria-live"], "polite");
    assert.match(text(example), /In the call.*In your life/);
    examples.add(text(example));
    assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.checked).length, 1);
  }
  assert.equal(examples.size, 4, "each stage must expose different practice");
  assert.doesNotMatch(text(render()), /fictional|not a scheduled topic|Circle Shaper|Circle Guide/);
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


const issuedInvitation = {
  token: "P".repeat(43), recipientName: "Alex <Recipient>", invitationSource: "member",
  expiresAt: "2099-01-01T12:00:00.000Z", membershipType: "standard",
  card: { name: "Cade <Sender>", memberTag: "cade", wearSeed: "inviter-wear", labels: [] },
};

test("public landing pairs each opportunity call with its own calendar controls and keeps invitations focused", async () => {
  const c = await components();
  const descendants = node => [node, ...(node.childNodes ?? []).flatMap(descendants)];
  const attr = (node, name) => node.attrs?.find(attribute => attribute.name === name)?.value;
  const content = node => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(content).join("");
  const expected = [
    { date: "Tuesday, October 6", start: "2026-10-06T18:00:00-06:00", dates: "20261007T000000Z/20261007T010000Z", meet: "https://meet.google.com/ekx-qtsb-nqt", file: "/calendar/ruined-opportunity-call-2026-10-06.ics" },
    { date: "Tuesday, October 13", start: "2026-10-13T18:00:00-06:00", dates: "20261014T000000Z/20261014T010000Z", meet: "https://meet.google.com/top-uaii-ofh", file: "/calendar/ruined-opportunity-call-2026-10-13.ics" },
  ];
  for (const props of [{}, { signupEnabled: true }, { signupEnabled: true, paymentSetupOnly: true, registrationOnly: true }]) {
    const html = renderToStaticMarkup(React.createElement(c.Overview, props));
    const elements = descendants(parseFragment(html));
    const sections = elements.filter(node => attr(node, "id") === "opportunity-calls");
    assert.equal(sections.length, 1, "public landing modes show one call section");
    const articles = descendants(sections[0]).filter(node => node.nodeName === "article");
    assert.equal(articles.length, 2);
    assert.deepEqual(elements.filter(node => node.nodeName === "a" && attr(node, "href")?.startsWith("https://meet.google.com/")).map(node => attr(node, "href")), expected.map(call => call.meet));
    for (const [index, article] of articles.entries()) {
      const call = expected[index], children = descendants(article);
      const time = children.find(node => node.nodeName === "time");
      assert.equal(content(time), call.date);
      assert.equal(attr(time, "datetime"), call.start);
      assert.match(content(article), /6–7 PM · Denver time/);
      const summary = children.find(node => node.nodeName === "summary");
      assert.match(content(summary), /Add to calendar/);
      assert.ok(attr(summary, "aria-label").includes(call.date), "calendar controls identify their call date");
      const links = children.filter(node => node.nodeName === "a");
      const join = links.find(node => attr(node, "href") === call.meet);
      assert.ok(join, "each call keeps its own meeting link");
      assert.ok(attr(join, "aria-label").includes(call.date));
      const google = links.find(node => attr(node, "href")?.startsWith("https://calendar.google.com/"));
      assert.ok(google, "each call has a Google Calendar action");
      const calendar = new URL(attr(google, "href"));
      assert.equal(calendar.searchParams.get("dates"), call.dates, "calendar actions preserve the 60-minute Denver event");
      assert.equal(calendar.searchParams.get("stz"), "America/Denver");
      assert.equal(calendar.searchParams.get("etz"), "America/Denver");
      assert.equal(calendar.searchParams.get("location"), call.meet);
      const download = links.find(node => attr(node, "href") === call.file);
      assert.ok(download, "each call has its matching Apple / Outlook calendar file");
      assert.equal(attr(download, "download"), "");
    }
  }
  for (const invitation of [issuedInvitation, { ...issuedInvitation, recipientName: undefined }]) {
    const html = renderToStaticMarkup(React.createElement(c.Overview, { invitation, signupEnabled: true }));
    assert.doesNotMatch(html, /id="opportunity-calls"|meet\.google\.com|calendar\.google\.com|Add to calendar/, "personal and shared invitations retain their existing acceptance destination");
  }
});

test("personal invites show the complete landing with the original card and token-bound acceptance", async () => {
  const state = hooks(), c = await components(state.react);
  const tree = state.render(c.Overview, { invitation: issuedInvitation, signupEnabled: false, registrationOnly: true, paymentSetupOnly: true });
  const elements = nodes(tree);
  const card = elements.find(element => element.type === EmptyCard);
  assert.equal(card.props.card, issuedInvitation.card);
  assert.equal(card.props.invitationSource, "member");
  assert.equal(card.props.expiresAt, issuedInvitation.expiresAt);
  assert.equal(card.props.recipientName, issuedInvitation.recipientName);
  assert.equal(elements.some(element => element.type === c.Signup), false, "never mint a Ruined Direct replacement");
  assert.equal(elements.some(element => element.type === c.WaitlistForm), false);
  const acceptance = elements.find(element => element.type === c.Acceptance);
  assert.equal(acceptance.props.invitationToken, issuedInvitation.token);
  assert.equal(acceptance.props.inviterName, issuedInvitation.card.name);
  assert.equal(acceptance.props.recipientName, issuedInvitation.recipientName);
  assert.equal(acceptance.props.expiresAt, issuedInvitation.expiresAt);
  assert.equal(acceptance.props.compact, true);
  assert.equal(elements.find(element => element.type === c.Offers).props.comparisonOnly, true);
  assert.equal(acceptance.props.recipientEmailRequired, true);
  assert.ok(elements.some(element => element.type === c.Foundations));
  assert.ok(elements.some(element => element.type === c.Monthly));
  assert.ok(elements.some(element => element.type === c.Community));
  const real = await components();
  const html = renderToStaticMarkup(React.createElement(real.Overview, { invitation: issuedInvitation, registrationOnly: true, paymentSetupOnly: true }));
  assert.match(html, /Accept my invitation/);
  assert.match(html, /Compare payment options. You’ll choose your plan before activating membership/);
  assert.match(html, /Cade &lt;Sender&gt;/);
  assert.match(html, /Alex &lt;Recipient&gt;/);
  assert.match(html, /id="accept-invitation"/);
  assert.doesNotMatch(html, /Make it yours|Create my invitation|Join the waitlist/);
});

test("complimentary invitation landing keeps the curriculum but removes paid offers and card requirements", async () => {
  const c = await components();
  const html = renderToStaticMarkup(React.createElement(c.Overview, {
    invitation: { ...issuedInvitation, membershipType: "complimentary" }, registrationOnly: true, paymentSetupOnly: true,
  }));
  assert.match(html, /Your starting point/);
  assert.match(html, /Complimentary membership/);
  assert.match(html, /No card or payment is required/);
  assert.doesNotMatch(html, /id="membership-pricing"|Save a card to complete|save your card securely|When is the Founding rate reserved/);
});

test("phone-only invitation landing asks recipients to verify their chosen account email", async () => {
  const c = await components();
  const html = renderToStaticMarkup(React.createElement(c.Overview, {
    invitation: { ...issuedInvitation, recipientEmailRequired: false }, registrationOnly: true, paymentSetupOnly: true,
  }));
  assert.match(html, /Enter the email you want to use for your Ruined account/);
  assert.doesNotMatch(html, /Use the email address this invitation was sent to|use the email address it was sent to/);
});

test("legacy shared invitations retain their attributed waitlist and expiry checks on the full landing", async () => {
  const state = hooks(), c = await components(state.react);
  const legacy = { ...issuedInvitation, recipientName: undefined };
  for (const expiresAt of [legacy.expiresAt, "2000-01-01T00:00:00Z"]) {
    const tree = state.render(c.Overview, { invitation: { ...legacy, expiresAt }, signupEnabled: true });
    const elements = nodes(tree);
    const waitlist = elements.find(element => element.type === c.WaitlistForm);
    assert.equal(waitlist.props.invitationToken, issuedInvitation.token);
    assert.equal(waitlist.props.disabled, expiresAt.startsWith("2000"));
    assert.equal(elements.some(element => element.type === c.Signup || element.type === c.Acceptance), false);
  }
});

test("personal landing invitations accept nullable deadlines while legacy shared links still require one", async () => {
  const invitation = { ...issuedInvitation, expiresAt: null };
  const c = await components();
  const html = renderToStaticMarkup(React.createElement(c.Overview, { invitation, registrationOnly: true, paymentSetupOnly: true }));
  assert.match(html, /Accept my invitation/);
  assert.doesNotMatch(html, /Accept by|This invitation has expired|Valid until|1970/);
  assert.match(html, /<button[^>]*type="submit"(?![^>]*disabled)[^>]*>Accept invitation/);
  const state = hooks(), wired = await components(state.react);
  const tree = state.render(wired.Overview, { invitation, signupEnabled: false });
  assert.equal(nodes(tree).find(element => element.type === EmptyCard).props.expiresAt, null);
  assert.equal(nodes(tree).find(element => element.type === wired.Acceptance).props.expiresAt, null);
  const legacy = state.render(wired.Overview, { invitation: { ...invitation, recipientName: null }, signupEnabled: true });
  assert.equal(nodes(legacy).find(element => element.type === wired.WaitlistForm).props.disabled, true);
});
