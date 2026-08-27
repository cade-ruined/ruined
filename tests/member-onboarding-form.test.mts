import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
const addressFields = await readFile(
  new URL("../src/components/membership/AddressFields.tsx", import.meta.url),
  "utf8",
);
const joinPage = await readFile(
  new URL("../app/my/join/page.tsx", import.meta.url),
  "utf8",
);
const membershipRepository = await readFile(
  new URL("../src/lib/membership/repository.ts", import.meta.url),
  "utf8",
);

test("member entry keeps native identity autofill while shipping uses explicit lookup", () => {
  for (const token of ["name", "nickname", "email", "bday", "tel"]) {
    assert.match(joinForm, new RegExp(`autoComplete=\\"${token}\\"`));
  }

  const memberEntry = `${joinForm}\n${addressFields}`;
  for (const token of [
    "shipping address-line1",
    "shipping address-line2",
    "shipping address-level2",
    "shipping address-level1",
    "shipping postal-code",
    "shipping country",
  ]) {
    assert.doesNotMatch(memberEntry, new RegExp(`autoComplete=\\"${token}\\"`));
  }

  assert.match(joinForm, /<AddressFields/);
  assert.match(addressFields, />Find your address<\/span>/);
  assert.match(addressFields, /fetch\("\/api\/my\/address-lookup"/);
  assert.match(addressFields, /autoComplete="off"/);
  assert.match(addressFields, /Enter address manually/);
  assert.match(addressFields, /!addressLookupEnabled \|\| Boolean\(initialString\(initialAddress, "addressLine1"\)\)/);
  assert.match(addressFields, /setShowAddressFields\(true\)/);
  assert.match(addressFields, /Enter your address manually\./);

  for (const fieldName of [
    "address-line-1",
    "address-line-2",
    "city",
    "region",
    "postal-code",
    "country-code",
  ]) {
    assert.match(addressFields, new RegExp(`name=\\"${fieldName}\\"`));
  }
  assert.match(memberEntry, /autoCapitalize="words"/);
  assert.match(memberEntry, /autoCapitalize="characters"/);
  assert.doesNotMatch(memberEntry, /toTitleCase|text-transform:\s*capitalize/i);
});

test("address lookup is keyboard accessible, cancellable, and Google-attributed", () => {
  for (const contract of [
    /role="combobox"/,
    /role="listbox"/,
    /role="option"/,
    /aria-activedescendant=/,
    /aria-autocomplete="list"/,
    /aria-controls=\{listVisible \? listId : undefined\}/,
    /aria-live="polite"/,
  ]) {
    assert.match(addressFields, contract);
  }
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"]) {
    assert.match(addressFields, new RegExp(`event\\.key === \\"${key}\\"`));
  }
  assert.match(addressFields, /new AbortController\(\)/);
  assert.match(addressFields, /requestRef\.current\?\.abort\(\)/);
  assert.match(
    addressFields,
    /onChange=\{\(event\) => \{[\s\S]*?requestRef\.current\?\.abort\(\);[\s\S]*?setSuggestions\(\[\]\);[\s\S]*?setQuery\(/,
  );
  assert.match(addressFields, /window\.setTimeout\([\s\S]*?, 275\)/);
  assert.match(addressFields, /crypto\.randomUUID\(\)/);
  assert.ok(
    (addressFields.match(/sessionTokenRef\.current = null/g) ?? []).length >= 2,
    "a completed or failed selection must end its lookup session",
  );
  assert.match(addressFields, /alt="Powered by Google"/);
  assert.match(addressFields, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.doesNotMatch(addressFields, /role="option"[\s\S]{0,600}<button/);
});

test("member entry cannot submit before an address is selected or entered", () => {
  assert.match(joinForm, /const shippingAddress = \{/);
  assert.match(
    joinForm,
    /!shippingAddress\.addressLine1[\s\S]*!shippingAddress\.region/,
  );
  assert.match(
    joinForm,
    /Choose an address from the results or enter it manually\./,
  );
  assert.match(joinForm, /lookupInput\?\.reportValidity\(\)/);
  assert.match(joinForm, /lookupInput\?\.focus\(\)/);
  assert.ok(
    joinForm.indexOf("const shippingAddress = {") <
      joinForm.indexOf('fetch("/api/my/onboarding"'),
  );
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
  assert.doesNotMatch(joinPage, /<main className="[^"]*border-t/);
  assert.match(joinForm, />Profile<\/h3>/);
  assert.match(joinForm, />Full name<\/span>/);
  assert.match(joinForm, /const fieldClass =\s*\n\s*"[^"]*rounded-\[4px\]/);
  assert.match(joinForm, /fieldLabelTextClass[\s\S]*--font-cadehandy2/);
  assert.match(joinForm, /Profile photo \/ Optional[\s\S]*aspect-square/);

  const progressIndex = joinForm.indexOf('<ol aria-label="Membership progress"');
  const paymentStageIndex = joinForm.indexOf('{stage === "payment" ?');
  assert.ok(paymentStageIndex >= 0 && progressIndex > paymentStageIndex);
});

test("member entry uses named country selectors instead of free-form codes", () => {
  assert.match(joinForm, /Mobile country and calling code/);
  assert.match(joinForm, /name="mobile-country"/);
  assert.match(addressFields, /name="country-code"/);
  assert.match(joinForm, /PHONE_COUNTRY_OPTIONS\.map/);
  assert.match(addressFields, /SHIPPING_COUNTRY_OPTIONS\.map/);
  assert.doesNotMatch(addressFields, /maxLength=\{2\}[\s\S]*name="country-code"/);
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
