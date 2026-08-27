"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

import AddressFields from "@/components/membership/AddressFields";
import type { MemberOnboardingSnapshot } from "@/lib/membership/model";
import {
  formatPhoneInput,
  mobileToE164,
  PHONE_COUNTRY_OPTIONS,
  phoneCountryFromInput,
  phoneCountryFromProfile,
  phoneInputForCountry,
  phoneInputFromProfile,
  supportedPhoneCountry,
} from "@/lib/membership/phone";

type CheckoutResponse = {
  clientSecret?: string;
  error?: string;
};

type AgreementResponse = {
  acceptance?: { id: string };
  error?: string;
  onboarding?: MemberOnboardingSnapshot;
};

type OnboardingResponse = {
  error?: string;
  onboarding?: MemberOnboardingSnapshot;
};

const stripeClients = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string): Promise<Stripe | null> {
  const existing = stripeClients.get(publishableKey);
  if (existing) return existing;
  const client = loadStripe(publishableKey);
  stripeClients.set(publishableKey, client);
  return client;
}

function EmbeddedCheckout({
  clientSecret,
  publishableKey,
  setError,
}: {
  clientSecret: string;
  publishableKey: string;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let checkout: Awaited<ReturnType<Stripe["createEmbeddedCheckoutPage"]>> | null = null;

    async function mountCheckout() {
      const stripe = await stripeFor(publishableKey);
      if (!stripe) throw new Error("Secure payment could not be loaded.");
      const instance = await stripe.createEmbeddedCheckoutPage({ clientSecret });
      if (cancelled) {
        instance.destroy();
        return;
      }
      checkout = instance;
      if (!mountRef.current) throw new Error("Secure payment could not be mounted.");
      instance.mount(mountRef.current);
    }

    mountCheckout().catch((checkoutError) => {
      if (!cancelled) {
        setError(
          checkoutError instanceof Error
            ? checkoutError.message
            : "Secure payment could not be loaded.",
        );
      }
    });
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [clientSecret, publishableKey, setError]);

  return (
    <div className="mt-8 min-h-[34rem] overflow-hidden bg-white" aria-label="Secure Stripe payment">
      <div ref={mountRef} />
    </div>
  );
}

const fieldClass =
  "min-h-12 w-full rounded-[4px] border border-white/20 bg-transparent px-3 py-3 font-[var(--font-body)] text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-[var(--color-poster)]";
const fieldLabelClass = "grid gap-2";
const fieldLabelTextClass =
  "inline-block w-fit origin-left [font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none tracking-normal text-[var(--color-poster)] [transform:rotate(-2deg)]";

function savedString(value: Record<string, unknown> | null, key: string) {
  return value && typeof value[key] === "string" ? String(value[key]) : "";
}

function StageLine({ active, complete, label, number }: { active: boolean; complete: boolean; label: string; number: string }) {
  return (
    <li className={`border-t pt-3 ${active ? "border-[var(--color-poster)]" : "border-white/15"}`}>
      <span className="text-[0.58rem] uppercase tracking-[0.14em] text-white/35">{number}</span>
      <p className={`mt-2 text-xs uppercase tracking-[0.12em] ${active ? "text-white" : complete ? "text-white/58" : "text-white/30"}`}>
        {complete ? `${label} / Complete` : label}
      </p>
    </li>
  );
}

export default function JoinForm({
  addressLookupEnabled,
  disabledReason,
  checkoutDisabledReason,
  checkoutEnabled,
  enabled,
  initialOnboarding,
  minimumAge,
  publishableKey,
}: {
  addressLookupEnabled: boolean;
  disabledReason: string | null;
  checkoutDisabledReason: string | null;
  checkoutEnabled: boolean;
  enabled: boolean;
  initialOnboarding: MemberOnboardingSnapshot;
  minimumAge: number;
  publishableKey: string | null;
}) {
  const checkoutAttempt = useRef<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [acceptanceId, setAcceptanceId] = useState(initialOnboarding.agreement.acceptanceId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const profileComplete = onboarding.requiredFieldsComplete;
  const agreementComplete = Boolean(acceptanceId);
  const stage = !profileComplete ? "profile" : !agreementComplete ? "agreement" : "payment";
  const address = onboarding.profile.fulfillmentAddress;
  const sizing = onboarding.profile.apparelSizing;
  const initialPhoneCountry = phoneCountryFromProfile(
    onboarding.profile.mobile,
    savedString(address, "countryCode"),
  );
  const [phoneCountry, setPhoneCountry] = useState(initialPhoneCountry);
  const [phoneNumber, setPhoneNumber] = useState(() =>
    phoneInputFromProfile(onboarding.profile.mobile, initialPhoneCountry),
  );

  function attemptId() {
    checkoutAttempt.current ??= crypto.randomUUID();
    return checkoutAttempt.current;
  }

  function changePhoneCountry(event: ChangeEvent<HTMLSelectElement>) {
    const nextCountry = supportedPhoneCountry(event.currentTarget.value);
    if (!nextCountry) return;
    setError(null);
    phoneInputRef.current?.setCustomValidity("");
    setPhoneNumber((current) => phoneInputForCountry(current, phoneCountry, nextCountry));
    setPhoneCountry(nextCountry);
  }

  function changePhoneNumber(event: FormEvent<HTMLInputElement>) {
    setError(null);
    event.currentTarget.setCustomValidity("");
    const formatted = formatPhoneInput(event.currentTarget.value, phoneCountry);
    setPhoneNumber(formatted);
    setPhoneCountry((current) => phoneCountryFromInput(formatted, current));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || submitting) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const selectedPhoneCountry =
        supportedPhoneCountry(String(form.get("mobile-country") ?? "")) ?? phoneCountry;
      const mobile = mobileToE164(
        String(form.get("mobile-national") ?? ""),
        selectedPhoneCountry,
      );
      if (!mobile) {
        phoneInputRef.current?.setCustomValidity(
          "Enter a complete mobile number for the selected country.",
        );
        phoneInputRef.current?.reportValidity();
        phoneInputRef.current?.focus();
        throw new Error("Enter a complete mobile number for the selected country.");
      }
      const shippingAddress = {
        addressLine1: String(form.get("address-line-1") ?? "").trim(),
        addressLine2: String(form.get("address-line-2") ?? "").trim() || null,
        city: String(form.get("city") ?? "").trim(),
        countryCode: String(form.get("country-code") ?? "").trim(),
        postalCode: String(form.get("postal-code") ?? "").trim(),
        region: String(form.get("region") ?? "").trim(),
      };
      if (
        !shippingAddress.addressLine1 ||
        !shippingAddress.city ||
        !shippingAddress.countryCode ||
        !shippingAddress.postalCode ||
        !shippingAddress.region
      ) {
        const lookupInput = event.currentTarget.querySelector<HTMLInputElement>(
          "#shipping-address-search",
        );
        lookupInput?.setCustomValidity(
          "Choose an address from the results or enter it manually.",
        );
        lookupInput?.reportValidity();
        lookupInput?.focus();
        throw new Error("Choose an address from the results or enter it manually.");
      }
      const response = await fetch("/api/my/onboarding", {
        body: JSON.stringify({
          action: "save_profile",
          apparelTopSize: String(form.get("apparel-size") ?? ""),
          birthDate: String(form.get("birth-date") ?? ""),
          legalName: String(form.get("legal-name") ?? ""),
          mobile,
          preferredName: String(form.get("preferred-name") ?? ""),
          shippingAddress,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as OnboardingResponse;
      if (!response.ok || !payload.onboarding) {
        throw new Error(payload.error || "Your member profile could not be saved.");
      }
      setOnboarding(payload.onboarding);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Your member profile could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptAgreement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || submitting || !onboarding.agreement.id) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/my/agreement", {
        body: JSON.stringify({
          affirmativeAction: "checkbox_and_submit",
          ageConfirmed: form.get("age-confirmed") === "on",
          agreementVersionId: onboarding.agreement.id,
          attemptId: attemptId(),
          signerName: String(form.get("signer-name") ?? ""),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AgreementResponse;
      if (!response.ok || !payload.acceptance?.id || !payload.onboarding) {
        throw new Error(payload.error || "The agreement could not be recorded.");
      }
      setAcceptanceId(payload.acceptance.id);
      setOnboarding(payload.onboarding);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The agreement could not be recorded.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openCheckout() {
    if (!checkoutEnabled || !publishableKey || !acceptanceId || submitting || clientSecret) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        body: JSON.stringify({
          acceptanceId,
          attemptId: attemptId(),
        }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as CheckoutResponse;
      if (!response.ok || !payload.clientSecret) {
        throw new Error(payload.error || "Secure payment is temporarily unavailable.");
      }
      setClientSecret(payload.clientSecret);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Secure payment is temporarily unavailable.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8">
      {stage === "profile" ? (
        <form className="grid gap-8" onSubmit={saveProfile}>
          <h3 className="font-[var(--font-display)] text-4xl tracking-[-0.03em]">Profile</h3>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={fieldLabelClass} htmlFor="member-legal-name">
              <span className={fieldLabelTextClass}>Full name</span>
              <input
                autoCapitalize="words"
                autoComplete="name"
                autoCorrect="off"
                className={fieldClass}
                defaultValue={onboarding.profile.legalName ?? ""}
                id="member-legal-name"
                maxLength={180}
                name="legal-name"
                required
                spellCheck={false}
              />
            </label>
            <label className={fieldLabelClass} htmlFor="member-preferred-name">
              <span className={fieldLabelTextClass}>Preferred name</span>
              <input
                autoCapitalize="words"
                autoComplete="nickname"
                autoCorrect="off"
                className={fieldClass}
                defaultValue={onboarding.profile.preferredName ?? ""}
                id="member-preferred-name"
                maxLength={120}
                name="preferred-name"
                required
                spellCheck={false}
              />
            </label>
            <label className={fieldLabelClass} htmlFor="member-email">
              <span className={fieldLabelTextClass}>Confirmed email</span>
              <input
                autoComplete="email"
                className={`${fieldClass} text-white/45`}
                disabled
                id="member-email"
                value={onboarding.email}
              />
            </label>
            <label className={fieldLabelClass} htmlFor="member-birth-date">
              <span className={fieldLabelTextClass}>Birth date</span>
              <input
                autoComplete="bday"
                className={fieldClass}
                defaultValue={onboarding.profile.birthDate ?? ""}
                id="member-birth-date"
                name="birth-date"
                required
                type="date"
              />
            </label>
            <div className="grid gap-5 sm:col-span-2 sm:grid-cols-[minmax(0,1.35fr)_minmax(12rem,0.65fr)]">
              <fieldset className="min-w-0">
                <legend className={fieldLabelTextClass}>Mobile</legend>
                <div className="mt-2 grid grid-cols-[minmax(9.5rem,0.55fr)_minmax(0,1fr)] gap-2">
                  <label className="sr-only" htmlFor="member-mobile-country">Mobile country and calling code</label>
                  <select
                    aria-label="Mobile country and calling code"
                    className={fieldClass}
                    id="member-mobile-country"
                    name="mobile-country"
                    onChange={changePhoneCountry}
                    value={phoneCountry}
                  >
                    {PHONE_COUNTRY_OPTIONS.map((country) => (
                      <option className="text-black" key={country.code} value={country.code}>
                        {country.callingCode} · {country.name}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="member-mobile-number">Mobile number</label>
                  <input
                    aria-label="Mobile number"
                    autoComplete="tel"
                    className={fieldClass}
                    id="member-mobile-number"
                    inputMode="tel"
                    name="mobile-national"
                    onInput={changePhoneNumber}
                    placeholder="Phone number"
                    ref={phoneInputRef}
                    required
                    type="tel"
                    value={phoneNumber}
                  />
                </div>
              </fieldset>
              <label className={fieldLabelClass} htmlFor="member-apparel-size">
                <span className={fieldLabelTextClass}>Apparel top size</span>
                <select
                  className={fieldClass}
                  defaultValue={savedString(sizing, "top")}
                  id="member-apparel-size"
                  name="apparel-size"
                  required
                >
                  <option className="text-black" value="">Choose</option>
                  {["XS", "S", "M", "L", "XL", "2XL", "3XL"].map((size) => (
                    <option className="text-black" key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <AddressFields
            addressLookupEnabled={addressLookupEnabled}
            fieldClass={fieldClass}
            fieldLabelClass={fieldLabelClass}
            fieldLabelTextClass={fieldLabelTextClass}
            initialAddress={address}
          />

          <div>
            <p className={fieldLabelTextClass}>Profile photo / Optional</p>
            <div className="mt-3 flex aspect-square w-full max-w-64 items-end overflow-hidden rounded-[4px] border border-dashed border-white/20 bg-white/[0.025] p-5">
              <p className="max-w-48 font-[var(--font-body)] text-xs leading-relaxed text-white/42">Photo upload will open when private member storage is connected.</p>
            </div>
          </div>

          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? disabledReason}</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || submitting} type="submit">{submitting ? "Saving profile" : "Save & review agreement"}</button>
        </form>
      ) : null}

      {stage === "agreement" ? (
        <form className="mt-9 grid gap-6" onSubmit={acceptAgreement}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">Second / Exact agreement</p>
            <h3 className="mt-4 font-[var(--font-display)] text-4xl tracking-[-0.03em]">{onboarding.agreement.title ?? "Agreement not published"}</h3>
            {onboarding.agreement.version ? <p className="mt-3 text-xs uppercase tracking-[0.13em] text-white/38">Version {onboarding.agreement.version}</p> : null}
          </div>
          {onboarding.agreement.body && onboarding.agreement.id ? (
            <div className="max-h-[26rem] overflow-y-auto border border-white/18 bg-white/[0.025] p-5 sm:p-7" tabIndex={0}>
              <p className="whitespace-pre-wrap font-[var(--font-body)] text-sm leading-7 text-white/68">{onboarding.agreement.body}</p>
            </div>
          ) : (
            <p className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/68">Ruined has not published the membership agreement yet. Entry remains closed until the approved copy is available.</p>
          )}
          <label className={fieldLabelClass}>
            <span className={fieldLabelTextClass}>Type the full name you entered</span>
            <input
              autoCapitalize="words"
              autoComplete="name"
              autoCorrect="off"
              className={fieldClass}
              name="signer-name"
              required
              spellCheck={false}
            />
          </label>
          <div className="grid gap-4 text-sm leading-relaxed text-white/68">
            <label className="grid grid-cols-[1rem_1fr] items-start gap-3"><input className="mt-1 size-4 accent-[var(--color-poster)]" name="age-confirmed" required type="checkbox" /><span>I confirm that I am at least {minimumAge} years old.</span></label>
            <label className="grid grid-cols-[1rem_1fr] items-start gap-3"><input className="mt-1 size-4 accent-[var(--color-poster)]" name="agreement-accepted" required type="checkbox" /><span>I have read and accept this exact published Ruined Membership Agreement. A durable receipt will be kept with my account.</span></label>
          </div>
          <p className="text-xs leading-relaxed text-white/38">Ruined’s separate <Link className="underline underline-offset-4" href="/privacy">privacy policy</Link> explains how personal information is handled.</p>
          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? disabledReason}</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || !onboarding.agreement.id || !onboarding.agreement.body || submitting} type="submit">{submitting ? "Recording acceptance" : "Accept & continue"}</button>
        </form>
      ) : null}

      {stage === "payment" ? (
        <section className="mt-9" aria-labelledby="secure-payment-title">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">Final / Secure payment</p>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
            <h3 className="font-[var(--font-display)] text-4xl" id="secure-payment-title">Membership payment</h3>
            <span className="text-sm text-white/48">{onboarding.email}</span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-white/52">Your profile and agreement are saved. Payment is the final step.</p>
          {error || checkoutDisabledReason ? <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? checkoutDisabledReason}</p> : null}
          {!clientSecret ? (
            <button className="mt-7 min-h-12 w-full border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!checkoutEnabled || !publishableKey || submitting} onClick={openCheckout} type="button">{submitting ? "Preparing payment" : checkoutEnabled && publishableKey ? "Open secure payment" : "Payment not connected"}</button>
          ) : null}
          {clientSecret && publishableKey ? <EmbeddedCheckout clientSecret={clientSecret} publishableKey={publishableKey} setError={setError} /> : null}
          <p className="mt-4 text-xs leading-relaxed text-white/40">Payment is handled securely by Stripe. Store purchases remain separate.</p>
        </section>
      ) : null}

      <ol aria-label="Membership progress" className="mt-12 grid grid-cols-3 gap-3">
        <StageLine active={stage === "profile"} complete={profileComplete} label="Profile" number="01" />
        <StageLine active={stage === "agreement"} complete={agreementComplete} label="Agreement" number="02" />
        <StageLine active={stage === "payment"} complete={Boolean(clientSecret)} label="Payment" number="03" />
      </ol>
    </div>
  );
}
