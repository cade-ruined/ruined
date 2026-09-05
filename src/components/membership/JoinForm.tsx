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

import { useMembershipEntryProgressStage } from "@/components/membership/MembershipEntryProgress";
import AgreementText from "@/components/membership/AgreementText";
import MemberPhotoUpload from "@/components/membership/MemberPhotoUpload";
import { membershipEntryStage } from "@/lib/membership/entry-stage";
import type { MemberOnboardingSnapshot } from "@/lib/membership/model";
import {
  formatPhoneInput,
  mobileToE164,
  PHONE_COUNTRY_OPTIONS,
  SHIPPING_COUNTRY_OPTIONS,
  phoneCountryFromInput,
  phoneCountryFromProfile,
  phoneInputForCountry,
  phoneInputFromProfile,
  supportedPhoneCountry,
  supportedShippingCountry,
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

export default function JoinForm({
  disabledReason,
  checkoutDisabledReason,
  checkoutEnabled,
  enabled,
  initialOnboarding,
  minimumAge,
  photoStorageReady,
  publishableKey,
}: {
  disabledReason: string | null;
  checkoutDisabledReason: string | null;
  checkoutEnabled: boolean;
  enabled: boolean;
  initialOnboarding: MemberOnboardingSnapshot;
  minimumAge: number;
  photoStorageReady: boolean;
  publishableKey: string | null;
}) {
  const checkoutAttempt = useRef<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [acceptanceId, setAcceptanceId] = useState(initialOnboarding.agreement.acceptanceId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const profileComplete = onboarding.requiredFieldsComplete;
  const agreementComplete = Boolean(acceptanceId);
  const stage = membershipEntryStage(profileComplete, agreementComplete);
  const testCheckout = publishableKey?.startsWith("pk_test_") ?? false;
  const previousStage = useRef(stage);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  useMembershipEntryProgressStage(stage);
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

  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    const frame = requestAnimationFrame(() => stageHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [stage]);

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
    if (photoPending) return;
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
      const response = await fetch("/api/my/onboarding", {
        body: JSON.stringify({
          action: "save_profile",
          apparelTopSize: String(form.get("apparel-size") ?? ""),
          birthDate: String(form.get("birth-date") ?? ""),
          legalName: String(form.get("legal-name") ?? ""),
          mobile,
          preferredName: String(form.get("preferred-name") ?? ""),
          shippingAddress: {
            addressLine1: String(form.get("address-line-1") ?? ""),
            addressLine2: String(form.get("address-line-2") ?? "").trim() || null,
            city: String(form.get("city") ?? ""),
            countryCode: String(form.get("country-code") ?? ""),
            postalCode: String(form.get("postal-code") ?? ""),
            region: String(form.get("region") ?? ""),
          },
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
          <h3 className="font-[var(--font-display)] text-4xl tracking-[-0.03em]" ref={stageHeadingRef} tabIndex={-1}>Profile</h3>

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

          <fieldset className="grid gap-5 sm:grid-cols-2">
            <legend className="sr-only">Shipping address</legend>
            <label className={`${fieldLabelClass} sm:col-span-2`} htmlFor="shipping-address-line-1">
              <span className={fieldLabelTextClass}>Shipping address</span>
              <input
                autoCapitalize="words"
                autoComplete="shipping address-line1"
                autoCorrect="off"
                className={fieldClass}
                defaultValue={savedString(address, "addressLine1")}
                id="shipping-address-line-1"
                name="address-line-1"
                required
                spellCheck={false}
              />
            </label>
            <label className={`${fieldLabelClass} sm:col-span-2`} htmlFor="shipping-address-line-2">
              <span className={fieldLabelTextClass}>Apartment, suite, etc. / Optional</span>
              <input
                autoCapitalize="words"
                autoComplete="shipping address-line2"
                autoCorrect="off"
                className={fieldClass}
                defaultValue={savedString(address, "addressLine2")}
                id="shipping-address-line-2"
                name="address-line-2"
                spellCheck={false}
              />
            </label>
            <label className={fieldLabelClass} htmlFor="shipping-city">
              <span className={fieldLabelTextClass}>City</span>
              <input
                autoCapitalize="words"
                autoComplete="shipping address-level2"
                autoCorrect="off"
                className={fieldClass}
                defaultValue={savedString(address, "city")}
                id="shipping-city"
                name="city"
                required
                spellCheck={false}
              />
            </label>
            <label className={fieldLabelClass} htmlFor="shipping-region">
              <span className={fieldLabelTextClass}>State or region</span>
              <input
                autoCapitalize="words"
                autoComplete="shipping address-level1"
                autoCorrect="off"
                className={fieldClass}
                defaultValue={savedString(address, "region")}
                id="shipping-region"
                name="region"
                required
                spellCheck={false}
              />
            </label>
            <label className={fieldLabelClass} htmlFor="shipping-postal-code">
              <span className={fieldLabelTextClass}>Postal code</span>
              <input
                autoCapitalize="characters"
                autoComplete="shipping postal-code"
                autoCorrect="off"
                className={fieldClass}
                defaultValue={savedString(address, "postalCode")}
                id="shipping-postal-code"
                name="postal-code"
                required
                spellCheck={false}
              />
            </label>
            <label className={fieldLabelClass} htmlFor="shipping-country">
              <span className={fieldLabelTextClass}>Country</span>
              <select
                autoComplete="shipping country"
                className={fieldClass}
                defaultValue={supportedShippingCountry(savedString(address, "countryCode")) ?? "US"}
                id="shipping-country"
                name="country-code"
                required
              >
                {SHIPPING_COUNTRY_OPTIONS.map((country) => (
                  <option className="text-black" key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <div>
            <p className={fieldLabelTextClass}>Profile photo / Optional</p>
            <MemberPhotoUpload
              avatarUrl={onboarding.profile.avatarUrl}
              available={photoStorageReady}
              enabled={enabled && !submitting}
              onBusyChange={setPhotoPending}
              onChange={(avatarUrl) => setOnboarding((current) => ({ ...current, profile: { ...current.profile, avatarUrl } }))}
            />
          </div>

          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? disabledReason}</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || submitting || photoPending} type="submit">{submitting ? "Saving profile" : "Save & review agreement"}</button>
        </form>
      ) : null}

      {stage === "agreement" ? (
        <form className="mt-9 grid gap-6" onSubmit={acceptAgreement}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">Second / Exact agreement</p>
            <h3 className="mt-4 font-[var(--font-display)] text-4xl tracking-[-0.03em]" ref={stageHeadingRef} tabIndex={-1}>{onboarding.agreement.title ?? "Agreement not published"}</h3>
            {onboarding.agreement.version ? <p className="mt-3 text-xs uppercase tracking-[0.13em] text-white/38">Version {onboarding.agreement.version}</p> : null}
          </div>
          {onboarding.agreement.body && onboarding.agreement.id ? (
            <div aria-label="Published membership agreement" className="max-h-[26rem] overflow-y-auto rounded-[4px] bg-white/[0.035] p-5 sm:p-7" role="region" tabIndex={0}>
              <AgreementText body={onboarding.agreement.body} />
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">{testCheckout ? "Final / Test checkout" : "Final / Secure payment"}</p>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
            <h3 className="font-[var(--font-display)] text-4xl" id="secure-payment-title" ref={stageHeadingRef} tabIndex={-1}>{testCheckout ? "Test checkout" : "Membership payment"}</h3>
            <span className="text-sm text-white/48">{onboarding.email}</span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-white/72">{testCheckout ? "Your profile and agreement are saved. This is a test checkout—no real charge will occur. Do not enter a real payment card." : "Your profile and agreement are saved. Payment is the final step."}</p>
          {testCheckout ? (
            <dl className="mt-4 grid gap-2 text-sm leading-relaxed text-white/72">
              <div><dt className="inline font-semibold text-white">Test card: </dt><dd className="inline font-mono [font-variant-numeric:tabular-nums]">4242 4242 4242 4242</dd></div>
              <div><dt className="inline font-semibold text-white">Expiry: </dt><dd className="inline">Any future date</dd></div>
              <div><dt className="inline font-semibold text-white">CVC: </dt><dd className="inline">Any 3-digit number</dd></div>
            </dl>
          ) : null}
          {error || checkoutDisabledReason ? <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-white/72">{error ?? checkoutDisabledReason}</p> : null}
          {!clientSecret ? (
            <button className="mt-7 min-h-12 w-full border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!checkoutEnabled || !publishableKey || submitting} onClick={openCheckout} type="button">{submitting ? testCheckout ? "Preparing test checkout" : "Preparing payment" : checkoutEnabled && publishableKey ? testCheckout ? "Open test checkout" : "Open secure payment" : "Payment not connected"}</button>
          ) : null}
          {clientSecret && publishableKey ? <EmbeddedCheckout clientSecret={clientSecret} publishableKey={publishableKey} setError={setError} /> : null}
          <p className="mt-4 text-xs leading-relaxed text-white/40">{testCheckout ? "Test checkout is provided by Stripe. Store purchases remain separate." : "Payment is handled securely by Stripe. Store purchases remain separate."}</p>
        </section>
      ) : null}

    </div>
  );
}
