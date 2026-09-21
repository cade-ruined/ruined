"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type ClipboardEvent,
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
  code?: string;
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
  "min-h-12 w-full rounded-[4px] border border-[var(--member-rule)] bg-transparent px-3 py-3 font-[var(--font-body)] text-sm text-white outline-none transition-colors placeholder:text-[var(--member-muted)] focus:border-[var(--color-poster)]";
const fieldLabelClass = "grid gap-2";
const fieldLabelTextClass =
  "inline-block w-fit origin-left [font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none tracking-normal text-[var(--member-red)] [transform:rotate(-2deg)]";

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
  const memberTagRef = useRef<HTMLInputElement>(null);
  const [memberTag, setMemberTag] = useState(initialOnboarding.profile.memberTag ?? "");
  const [memberTagError, setMemberTagError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [acceptanceId, setAcceptanceId] = useState(initialOnboarding.agreement.acceptanceId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [photoDraft, setPhotoDraft] = useState(false);
  const profileComplete = onboarding.requiredFieldsComplete;
  const complimentary = (onboarding.membershipFunding === "operator" || onboarding.membershipFunding === "complimentary");
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

  function changeMemberTag(value: string) {
    setMemberTag(value.trim().replace(/^@/, "").toLowerCase());
    setMemberTagError(null);
    setError(null);
  }

  function pasteMemberTag(event: ClipboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    event.preventDefault();
    changeMemberTag(input.value.slice(0, input.selectionStart ?? 0) + event.clipboardData.getData("text") + input.value.slice(input.selectionEnd ?? input.value.length));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (photoPending || photoDraft) return;
    if (!enabled || submitting) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const tag = String(form.get("member-tag") ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(tag)) {
      setMemberTagError("Use 3–24 letters, numbers, or underscores.");
      memberTagRef.current?.focus();
      setSubmitting(false);
      return;
    }
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
          memberTag: tag,
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
        if (payload.code === "member_tag_unavailable") {
          setMemberTagError(payload.error || "That member tag is already taken. Choose another.");
          memberTagRef.current?.focus();
        }
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
    if (complimentary || !checkoutEnabled || !publishableKey || !acceptanceId || submitting || clientSecret) return;
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

  async function activateComplimentaryMembership() {
    if (!enabled || !complimentary || !profileComplete || !agreementComplete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/my/onboarding", {
        method: "POST", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      const payload = await response.json();
      if (!response.ok || payload.onboarding?.state !== "completed") {
        throw new Error(payload.error || "Membership could not be activated. Please try again.");
      }
      window.location.assign("/my");
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Membership could not be activated.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8">
      {stage === "profile" ? (
        <form className="grid gap-8" onSubmit={saveProfile}>
          <h2 className="sr-only" ref={stageHeadingRef} tabIndex={-1}>Profile</h2>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={fieldLabelClass} htmlFor="member-legal-name">
              <span className={fieldLabelTextClass}>Full name</span>
              <input
                aria-describedby="member-legal-name-visibility"
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
              <span className="text-xs leading-relaxed text-[var(--member-muted)]" id="member-legal-name-visibility">Private · For your membership records.</span>
            </label>
            <label className={fieldLabelClass} htmlFor="member-tag">
              <span className={fieldLabelTextClass}>Member tag</span>
              <span className="relative block">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--member-muted)]">@</span>
                <input
                  aria-describedby="member-tag-help member-tag-error"
                  aria-invalid={Boolean(memberTagError)}
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  className={`${fieldClass} !pl-8`}
                  id="member-tag"
                  maxLength={24}
                  minLength={3}
                  name="member-tag"
                  onChange={(event) => changeMemberTag(event.currentTarget.value)}
                  onPaste={pasteMemberTag}
                  onInvalid={() => setMemberTagError("Use 3–24 letters, numbers, or underscores.")}
                  pattern="[a-z0-9_]{3,24}"
                  ref={memberTagRef}
                  required
                  spellCheck={false}
                  title="Use 3–24 letters, numbers, or underscores."
                  value={memberTag}
                />
              </span>
              <span className="text-xs leading-relaxed text-[var(--member-muted)]" id="member-tag-help">Your unique @tag. Use 3–24 letters, numbers, or underscores. It appears alongside your display name when you share your card or invitation.</span>
              <span className="text-xs leading-relaxed text-[var(--member-red)]" id="member-tag-error" role="status">{memberTagError}</span>
            </label>
            <label className={fieldLabelClass} htmlFor="member-email">
              <span className={fieldLabelTextClass}>Confirmed email</span>
              <input
                autoComplete="email"
                className={`${fieldClass} text-[var(--member-muted)]`}
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
            <p className="mt-2 text-xs leading-relaxed text-[var(--member-muted)]">Public · If you add a photo, it will appear on your public profile.</p>
            <MemberPhotoUpload
              avatarUrl={onboarding.profile.avatarUrl}
              available={photoStorageReady}
              enabled={enabled && !submitting}
              onBusyChange={setPhotoPending}
              onDraftChange={setPhotoDraft}
              onChange={(avatarUrl) => setOnboarding((current) => ({ ...current, profile: { ...current.profile, avatarUrl } }))}
            />
          </div>

          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-[var(--member-muted)]">{error ?? disabledReason}</p> : null}
          {photoDraft ? <p className="text-sm text-[var(--member-muted)]" role="status">Use your photo or cancel the crop before continuing.</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || submitting || photoPending || photoDraft} type="submit">{submitting ? "Saving profile" : "Save & review agreement"}</button>
        </form>
      ) : null}

      {stage === "agreement" ? (
        <form className="mt-9 grid gap-6" onSubmit={acceptAgreement}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red)]">Second / Exact agreement</p>
            <h3 className="mt-4 font-[var(--font-display)] text-4xl tracking-[-0.03em]" ref={stageHeadingRef} tabIndex={-1}>{onboarding.agreement.title ?? "Agreement not published"}</h3>
            {onboarding.agreement.version ? <p className="mt-3 text-xs uppercase tracking-[0.13em] text-[var(--member-muted)]">Version {onboarding.agreement.version}</p> : null}
          </div>
          {onboarding.agreement.body && onboarding.agreement.id ? (
            <div aria-label="Published membership agreement" className="max-h-[26rem] overflow-y-auto rounded-[4px] bg-[var(--member-soft)] p-5 sm:p-7" role="region" tabIndex={0}>
              <AgreementText body={onboarding.agreement.body} />
            </div>
          ) : (
            <p className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-[var(--member-muted)]">Ruined has not published the membership agreement yet. Entry remains closed until the approved copy is available.</p>
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
          <div className="grid gap-4 text-sm leading-relaxed text-[var(--member-muted)]">
            <label className="grid grid-cols-[1rem_1fr] items-start gap-3"><input className="mt-1 size-4 accent-[var(--color-poster)]" name="age-confirmed" required type="checkbox" /><span>I confirm that I am at least {minimumAge} years old.</span></label>
            <label className="grid grid-cols-[1rem_1fr] items-start gap-3"><input className="mt-1 size-4 accent-[var(--color-poster)]" name="agreement-accepted" required type="checkbox" /><span>I have read and accept this exact published Ruined Membership Agreement. A durable receipt will be kept with my account.</span></label>
          </div>
          <p className="text-xs leading-relaxed text-[var(--member-muted)]">Ruined’s separate <Link className="underline underline-offset-4" href="/privacy">privacy policy</Link> explains how personal information is handled.</p>
          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-[var(--member-muted)]">{error ?? disabledReason}</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || !onboarding.agreement.id || !onboarding.agreement.body || submitting} type="submit">{submitting ? "Recording acceptance" : "Accept & continue"}</button>
        </form>
      ) : null}

      {stage === "payment" && complimentary ? (
        <section className="mt-9" aria-labelledby="complimentary-membership-title">
          <h3 className="font-[var(--font-display)] text-4xl" id="complimentary-membership-title" ref={stageHeadingRef} tabIndex={-1}>You’re ready.</h3>
          <p className="mt-4 text-base leading-relaxed text-[var(--member-muted)]">Your membership is complimentary. Your profile and agreement are saved—no payment is needed.</p>
          {error || disabledReason ? <p className="mt-4 text-sm" role="status">{error ?? disabledReason}</p> : null}
          <button className="mt-6 min-h-12 rounded-[4px] bg-[var(--color-signal)] px-6 py-3 font-bold text-black disabled:opacity-50" disabled={!enabled || submitting} onClick={activateComplimentaryMembership} type="button">{submitting ? "Activating membership…" : "Activate my membership"}</button>
        </section>
      ) : null}

      {stage === "payment" && !complimentary ? (
        <section className="mt-9" aria-labelledby="secure-payment-title">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red)]">{testCheckout ? "Final / Test checkout" : "Final / Secure payment"}</p>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
            <h3 className="font-[var(--font-display)] text-4xl" id="secure-payment-title" ref={stageHeadingRef} tabIndex={-1}>{testCheckout ? "Test checkout" : "Membership payment"}</h3>
            <span className="text-sm text-[var(--member-muted)]">{onboarding.email}</span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-[var(--member-muted)]">{testCheckout ? "Your profile and agreement are saved. This is a test checkout—no real charge will occur. Do not enter a real payment card." : "Your profile and agreement are saved. Payment is the final step."}</p>
          {testCheckout ? (
            <dl className="mt-4 grid gap-2 text-sm leading-relaxed text-[var(--member-muted)]">
              <div><dt className="inline font-semibold text-white">Test card: </dt><dd className="inline font-mono [font-variant-numeric:tabular-nums]">4242 4242 4242 4242</dd></div>
              <div><dt className="inline font-semibold text-white">Expiry: </dt><dd className="inline">Any future date</dd></div>
              <div><dt className="inline font-semibold text-white">CVC: </dt><dd className="inline">Any 3-digit number</dd></div>
            </dl>
          ) : null}
          {error || checkoutDisabledReason ? <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-[var(--member-muted)]">{error ?? checkoutDisabledReason}</p> : null}
          {!clientSecret ? (
            <button className="mt-7 min-h-12 w-full border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!checkoutEnabled || !publishableKey || submitting} onClick={openCheckout} type="button">{submitting ? testCheckout ? "Preparing test checkout" : "Preparing payment" : checkoutEnabled && publishableKey ? testCheckout ? "Open test checkout" : "Open secure payment" : "Payment not connected"}</button>
          ) : null}
          {clientSecret && publishableKey ? <EmbeddedCheckout clientSecret={clientSecret} publishableKey={publishableKey} setError={setError} /> : null}
          <p className="mt-4 text-xs leading-relaxed text-[var(--member-muted)]">{testCheckout ? "Test checkout is provided by Stripe. Store purchases remain separate." : "Payment is handled securely by Stripe. Store purchases remain separate."}</p>
        </section>
      ) : null}

    </div>
  );
}
