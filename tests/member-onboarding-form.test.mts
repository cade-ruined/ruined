import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MEMBERSHIP_ENTRY_STAGES,
  membershipEntryStage,
} from "../src/lib/membership/entry-stage.ts";
import {
  formatPhoneInput,
  mobileToE164,
  PHONE_COUNTRY_OPTIONS,
  phoneCountryFromInput,
  phoneCountryFromProfile,
  phoneInputForCountry,
  phoneInputFromProfile,
  SHIPPING_COUNTRY_OPTIONS,
} from "../src/lib/membership/phone.ts";

const joinForm = await readFile(
  new URL("../src/components/membership/JoinForm.tsx", import.meta.url),
  "utf8",
);
const joinPage = await readFile(
  new URL("../app/my/join/page.tsx", import.meta.url),
  "utf8",
);
const entryProgress = await readFile(
  new URL("../src/components/membership/MembershipEntryProgress.tsx", import.meta.url),
  "utf8",
);
const membershipRepository = await readFile(
  new URL("../src/lib/membership/repository.ts", import.meta.url),
  "utf8",
);
const theme = await readFile(
  new URL("../src/styles/theme.css", import.meta.url),
  "utf8",
);
const platformShell = await readFile(
  new URL("../src/components/platform/PlatformShell.tsx", import.meta.url),
  "utf8",
);

test("member entry exposes native identity and shipping autofill", () => {
  for (const token of [
    "name",
    "nickname",
    "email",
    "bday",
    "shipping address-line1",
    "shipping address-line2",
    "shipping address-level2",
    "shipping address-level1",
    "shipping postal-code",
    "shipping country",
  ]) {
    assert.match(joinForm, new RegExp(`autoComplete=\\"${token}\\"`));
  }
  assert.match(joinForm, /autoCapitalize="words"/);
  assert.match(joinForm, /autoCapitalize="characters"/);
  assert.doesNotMatch(joinForm, /toTitleCase|text-transform:\s*capitalize/i);
});

test("member entry uses the friendly image-led form hierarchy", () => {
  for (const removedCopy of [
    "Administrative entry",
    "Administrative profile",
    "Three thresholds",
    "Your email is confirmed. Save the practical details",
    "MEMBER PORTRAIT / ARRIVAL",
  ]) {
    assert.doesNotMatch(`${joinPage}\n${joinForm}`, new RegExp(removedCopy, "i"));
  }

  assert.match(joinPage, /src="\/after-the-fear-hero\.webp"/);
  assert.match(joinPage, /Your place begins here\./);
  assert.match(theme, /--color-highlight:\s*#FFCD35;/);
  assert.match(
    joinPage,
    /ui-heading[^"\n]*bg-\[var\(--color-highlight\)\][^"\n]*uppercase/,
  );
  assert.equal(
    (`${joinPage}\n${joinForm}`.match(/bg-\[var\(--color-highlight\)\]/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(joinForm, /color-highlight/);
  assert.doesNotMatch(joinPage, /<main className="[^"]*border-t/);
  assert.match(joinForm, />Profile<\/h3>/);
  assert.match(joinForm, />Full name<\/span>/);
  assert.match(joinForm, /const fieldClass =\s*\n\s*"[^"]*rounded-\[4px\]/);
  assert.match(joinForm, /fieldLabelTextClass[\s\S]*--font-cadehandy2/);
  assert.match(joinForm, /Profile photo \/ Optional[\s\S]*aspect-square/);

  const progressIndex = joinPage.indexOf("<MembershipEntryProgress />");
  const heroIndex = joinPage.indexOf('<section className="relative isolate');
  assert.ok(progressIndex >= 0 && heroIndex > progressIndex);
  assert.doesNotMatch(joinForm, /StageLine|Membership progress/);
});

test("member entry uses a live accessible step rail beneath the header", () => {
  assert.deepEqual(
    MEMBERSHIP_ENTRY_STAGES.map(({ id }) => id),
    ["profile", "agreement", "payment"],
  );
  assert.equal(membershipEntryStage(false, false), "profile");
  assert.equal(membershipEntryStage(true, false), "agreement");
  assert.equal(membershipEntryStage(true, true), "payment");

  for (const token of [
    'role="status"',
    'aria-live="polite"',
    'aria-atomic="true"',
    'aria-label="Membership entry steps"',
    'aria-current={status === "current" ? "step" : undefined}',
    "bg-[var(--color-verdigris)]",
    "bg-[var(--color-poster)]",
    "bg-white/15",
    "max-w-4xl",
  ]) {
    assert.ok(entryProgress.includes(token), `missing progress token: ${token}`);
  }
  assert.match(entryProgress, /Step \{currentIndex \+ 1\} of 3/);
  assert.doesNotMatch(entryProgress, /color-highlight|sticky|rounded/);
  assert.match(joinForm, /useMembershipEntryProgressStage\(stage\)/);
  assert.match(joinForm, /previousStage\.current === stage[\s\S]*stageHeadingRef\.current\?\.focus\(\)/);
  assert.equal((joinForm.match(/ref=\{stageHeadingRef\}/g) ?? []).length, 3);
  assert.doesNotMatch(joinForm, /complete=\{Boolean\(clientSecret\)\}/);
  assert.match(platformShell, /const membershipEntry = member && pathname === "\/my\/join";/);
  assert.match(platformShell, /membershipEntry[\s\S]*\? "pb-10 sm:pb-14 lg:pb-16"/);
});

test("member entry uses named country selectors instead of free-form codes", () => {
  assert.match(joinForm, /Mobile country and calling code/);
  assert.match(joinForm, /name="mobile-country"/);
  assert.match(joinForm, /name="country-code"/);
  assert.match(joinForm, /PHONE_COUNTRY_OPTIONS\.map/);
  assert.match(joinForm, /SHIPPING_COUNTRY_OPTIONS\.map/);
  assert.doesNotMatch(joinForm, /maxLength=\{2\}[\s\S]*name="country-code"/);
});

test("country options and phone parsing cover international E.164 values", () => {
  assert.ok(PHONE_COUNTRY_OPTIONS.length > 200);
  assert.deepEqual(PHONE_COUNTRY_OPTIONS[0], {
    callingCode: "+1",
    code: "US",
    name: "United States",
  });
  assert.equal(PHONE_COUNTRY_OPTIONS.find(({ code }) => code === "GB")?.name, "United Kingdom");
  assert.equal(
    PHONE_COUNTRY_OPTIONS.find(({ code }) => code === "AE")?.name,
    "United Arab Emirates",
  );
  assert.notEqual(
    PHONE_COUNTRY_OPTIONS.find(({ code }) => code === "CG")?.name,
    PHONE_COUNTRY_OPTIONS.find(({ code }) => code === "CD")?.name,
  );
  assert.ok(SHIPPING_COUNTRY_OPTIONS.length > PHONE_COUNTRY_OPTIONS.length);
  assert.equal(SHIPPING_COUNTRY_OPTIONS.find(({ code }) => code === "AQ")?.name, "Antarctica");
  assert.equal(SHIPPING_COUNTRY_OPTIONS.some(({ code }) => code === "AC"), false);
  assert.equal(phoneCountryFromProfile("+442079460018", "US"), "GB");
  assert.equal(phoneCountryFromProfile("+14165550123", "US"), "CA");
  assert.equal(phoneCountryFromProfile(null, "CA"), "CA");
  assert.equal(phoneCountryFromInput("+44 20 7946 0018", "US"), "GB");
  assert.equal(mobileToE164("(801) 555-0100", "US"), "+18015550100");
  assert.equal(mobileToE164("020 7946 0018", "GB"), "+442079460018");
  assert.equal(mobileToE164("+44 20 7946 0018", "US"), "+442079460018");
  assert.equal(mobileToE164("8999", "TA"), "+2908999");
  assert.equal(mobileToE164("7290", "TK"), "+6907290");
  assert.equal(mobileToE164("12", "US"), null);
  assert.equal(mobileToE164("Call +1 801 555 0100", "US"), null);
  assert.equal(mobileToE164("+1 801 555 0100 ext. 9", "US"), null);
});

test("phone input remains readable while changing country", () => {
  assert.equal(formatPhoneInput("8015550100", "US"), "(801) 555-0100");
  assert.equal(phoneInputFromProfile("+18015550100", "US"), "(801) 555-0100");
  assert.equal(phoneInputForCountry("+442079460018", "GB", "US"), "(207) 946-0018");
});

test("member entry submits normalized E.164 instead of a raw visible value", () => {
  assert.match(joinForm, /mobileToE164\(/);
  assert.match(joinForm, /mobile,\s*preferredName/);
  assert.match(joinForm, /setCustomValidity\(/);
  assert.match(joinForm, /reportValidity\(\)/);
  assert.doesNotMatch(joinForm, /mobile:\s*String\(form\.get\("mobile"\)/);
  assert.match(membershipRepository, /parsePhoneNumber\(mobile, \{ extract: false \}\)/);
  assert.match(membershipRepository, /parsedMobile\?\.isPossible\(\)/);
  assert.match(membershipRepository, /parsedMobile\.ext/);
  assert.match(membershipRepository, /parsedMobile\.number !== mobile/);
  assert.match(membershipRepository, /supportedShippingCountry\(input\.shippingAddress\.countryCode\)/);
  assert.match(membershipRepository, /const E164 = \/\^\\\+\[1-9\]\[0-9\]\{1,14\}\$\//);
});
