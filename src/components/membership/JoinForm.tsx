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
import CoupleMembershipApproval from "@/components/membership/CoupleMembershipApproval";
import AgreementText from "@/components/membership/AgreementText";
import MemberPhotoUpload from "@/components/membership/MemberPhotoUpload";
import MemberPaymentMethod from "@/components/membership/MemberPaymentMethod";
import { formatMembershipPrice, isMembershipBillingPlan, MEMBERSHIP_OFFERS, MEMBERSHIP_PLANS, type MembershipBillingPlan, type MembershipOfferId } from "@/lib/membership/pricing";
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
  code?: string;
  plan?: MembershipBillingPlan;
  commercialReservationId?: string;
};

type MembershipQuote = {
  id: string;
  expiresAt: string;
  offer: (typeof MEMBERSHIP_OFFERS)[MembershipOfferId];
  billingTermsVersion: "membership-billing-v2";
  buyoutCap: number;
  participants: Array<{ memberId: string; name: string }>;
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
  initialPlan = "monthly",
  minimumAge,
  photoStorageReady,
  publishableKey,
  paymentSetupEnabled = false,
  registrationOnly = false,
  registrationRequiresPaymentMethod = true,
  preview = false,
}: {
  disabledReason: string | null;
  checkoutDisabledReason: string | null;
  checkoutEnabled: boolean;
  enabled: boolean;
  initialOnboarding: MemberOnboardingSnapshot;
  initialPlan?: MembershipBillingPlan;
  minimumAge: number;
  photoStorageReady: boolean;
  publishableKey: string | null;
  paymentSetupEnabled?: boolean;
  registrationOnly?: boolean;
  registrationRequiresPaymentMethod?: boolean;
  preview?: boolean;
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
  const [plan, setPlan] = useState<MembershipBillingPlan>(initialPlan);
  const [recurringPaymentAccepted, setRecurringPaymentAccepted] = useState(false);
  const [lockedPlan, setLockedPlan] = useState<MembershipBillingPlan | null>(null);
  const [membershipKind, setMembershipKind] = useState<"individual" | "couple">("individual");
  const [quote, setQuote] = useState<MembershipQuote | null>(null);
  const [offerRetryable, setOfferRetryable] = useState(false);
  const selectedPrice = quote?.offer ?? null;
  const selectedAmount = selectedPrice ? formatMembershipPrice(selectedPrice.amount) : "";
  const [submitting, setSubmitting] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [photoDraft, setPhotoDraft] = useState(false);
  const profileComplete = onboarding.requiredFieldsComplete;
  const complimentary = (onboarding.membershipFunding === "operator" || onboarding.membershipFunding === "complimentary");
  const sharedMembership = onboarding.membershipFunding === "couple" && onboarding.billingState === "active";
  const noSeparatePayment = complimentary || sharedMembership;
  const prelaunch = registrationOnly || !noSeparatePayment && onboarding.billingState === "pending" && !checkoutEnabled;
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
        throw new Error(payload.error || (registrationOnly ? "Your details could not be saved." : "Your member profile could not be saved."));
      }
      setOnboarding(payload.onboarding);
      if (registrationOnly && payload.onboarding.requiredFieldsComplete) {
        window.location.assign(registrationRequiresPaymentMethod ? "/my/payment-method" : "/my/registered");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : registrationOnly ? "Your details could not be saved." : "Your member profile could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptAgreement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (registrationOnly || !enabled || submitting || !onboarding.agreement.id) return;
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

  async function changeOffer(nextPlan: MembershipBillingPlan, nextKind = membershipKind) {
    if (clientSecret || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (quote) {
        const response = await fetch("/api/stripe/membership-offer", { method: "POST", cache: "no-store",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "release", reservationId: quote.id }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Resolve your existing payment before changing the offer.");
      }
      setPlan(nextPlan);
      setMembershipKind(nextKind);
      setQuote(null);
      setOfferRetryable(false);
      setRecurringPaymentAccepted(false);
      setLockedPlan(null);
      checkoutAttempt.current = null;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your payment choice could not be changed.");
    } finally { setSubmitting(false); }
  }

  async function prepareOffer() {
    if (!checkoutEnabled || noSeparatePayment || submitting || clientSecret) return;
    setSubmitting(true);
    setError(null);
    setRecurringPaymentAccepted(false);
    setOfferRetryable(false);
    try {
      const response = await fetch("/api/stripe/membership-offer", { method: "POST", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: attemptId(), kind: membershipKind, plan }) });
      const payload = await response.json() as { error?: string; quote?: MembershipQuote; code?: string; plan?: MembershipBillingPlan; kind?: "individual" | "couple" };
      if (payload.code === "founding_place_pending") setOfferRetryable(true);
      if (payload.code === "checkout_plan_locked" && isMembershipBillingPlan(payload.plan)) {
        setLockedPlan(payload.plan);
        if (payload.kind === "individual" || payload.kind === "couple") setMembershipKind(payload.kind);
      }
      if (!response.ok || !payload.quote) throw new Error(payload.error || "Your membership offer could not be prepared.");
      if (payload.quote.offer.plan !== plan || payload.quote.billingTermsVersion !== "membership-billing-v2") {
        throw new Error("Your offer changed. Reload to review it before paying.");
      }
      checkoutAttempt.current = payload.quote.id;
      setQuote(payload.quote);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your membership offer could not be prepared.");
    } finally { setSubmitting(false); }
  }

  async function openCheckout() {
    if (noSeparatePayment || !checkoutEnabled || !publishableKey || !acceptanceId || !quote || !recurringPaymentAccepted || submitting || clientSecret) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        body: JSON.stringify({
          acceptanceId,
          attemptId: attemptId(),
          plan,
          recurringPaymentAccepted,
          commercialReservationId: quote.id,
        }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as CheckoutResponse;
      if (!response.ok || !payload.clientSecret) {
        if (payload.code === "checkout_plan_locked" && isMembershipBillingPlan(payload.plan)) {
          setLockedPlan(payload.plan);
          setRecurringPaymentAccepted(false);
        }
        if (payload.code === "membership_offer_expired") {
          setQuote(null);
          setRecurringPaymentAccepted(false);
          checkoutAttempt.current = null;
        }
        throw new Error(payload.error || "Secure payment is temporarily unavailable.");
      }
      if (payload.plan !== plan || payload.commercialReservationId !== quote.id) throw new Error("Your payment plan changed. Reload this page to review it before paying.");
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
    if (registrationOnly || !enabled || !noSeparatePayment || !profileComplete || !agreementComplete || submitting) return;
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
          <h2 className="sr-only" ref={stageHeadingRef} tabIndex={-1}>{registrationOnly ? "Your details" : "Profile"}</h2>

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
              <span className="text-xs leading-relaxed text-[var(--member-muted)]" id="member-tag-help">{registrationOnly ? "Reserve your unique @tag for Ruined. Use 3–24 letters, numbers, or underscores." : "Your unique @tag. Use 3–24 letters, numbers, or underscores. It appears alongside your display name when you share your card or invitation."}</span>
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

          {!registrationOnly ? <div>
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
          </div> : null}

          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-[var(--member-muted)]">{error ?? disabledReason}</p> : null}
          {photoDraft ? <p className="text-sm text-[var(--member-muted)]" role="status">Use your photo or cancel the crop before continuing.</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || submitting || photoPending || photoDraft} type="submit">{submitting ? registrationOnly ? "Saving details" : "Saving profile" : registrationOnly ? registrationRequiresPaymentMethod ? "Save details & continue" : "Complete registration" : prelaunch ? "Save my profile" : "Save & review agreement"}</button>
        </form>
      ) : null}
      {preview && registrationOnly && !profileComplete ? <Link className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/payment-method">Preview card step · no details saved</Link> : null}

      {profileComplete && prelaunch && !registrationOnly ? <div className="mt-9">
        <h3 className="font-[var(--font-display)] text-4xl" ref={stageHeadingRef} tabIndex={-1}>Your profile is ready.</h3>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--member-muted)]">Membership opens at launch. You’ll review your membership offer and confirm payment before joining.</p>
        {paymentSetupEnabled || preview ? <div className="mt-7"><MemberPaymentMethod preview={preview} /></div> : <div className="mt-6"><p className="text-sm text-[var(--member-muted)]">There’s nothing to pay today. You can return to your account whenever you need.</p><Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/account">Go to my account</Link></div>}
      </div> : null}

      {profileComplete && registrationOnly ? <div className="mt-9">
        <h3 className="font-[var(--font-display)] text-4xl" tabIndex={-1}>Your details are saved.</h3>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--member-muted)]">{registrationRequiresPaymentMethod ? "Save a card securely with Stripe to finish registration. No charge is made today." : "Your complimentary registration does not require a payment card."}</p>
        <Link className="mt-6 inline-flex min-h-12 items-center bg-white px-6 py-3 text-sm font-semibold text-black" href={registrationRequiresPaymentMethod ? "/my/payment-method" : "/my/registered"}>{preview ? "Preview next step" : "Continue registration"}</Link>
      </div> : null}

      {stage === "agreement" && !prelaunch ? (
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

      {stage === "payment" && noSeparatePayment ? (
        <section className="mt-9" aria-labelledby="complimentary-membership-title">
          <h3 className="font-[var(--font-display)] text-4xl" id="complimentary-membership-title" ref={stageHeadingRef} tabIndex={-1}>You’re ready.</h3>
          <p className="mt-4 text-base leading-relaxed text-[var(--member-muted)]">{sharedMembership ? "Your membership is covered by your shared couples subscription. Your profile and agreement are saved; no separate payment is needed." : "Your membership is complimentary. Your profile and agreement are saved—no payment is needed."}</p>
          {error || disabledReason ? <p className="mt-4 text-sm" role="status">{error ?? disabledReason}</p> : null}
          <button className="mt-6 min-h-12 rounded-[4px] bg-[var(--color-signal)] px-6 py-3 font-bold text-black disabled:opacity-50" disabled={!enabled || submitting} onClick={activateComplimentaryMembership} type="button">{submitting ? "Activating membership…" : "Activate my membership"}</button>
        </section>
      ) : null}

      {stage === "payment" && !noSeparatePayment && !prelaunch ? (
        <section className="mt-9" aria-labelledby="secure-payment-title">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red)]">{testCheckout ? "Final / Test checkout" : "Final / Secure payment"}</p>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
            <h3 className="font-[var(--font-display)] text-4xl" id="secure-payment-title" ref={stageHeadingRef} tabIndex={-1}>{testCheckout ? "Test checkout" : "Membership payment"}</h3>
            <span className="text-sm text-[var(--member-muted)]">{onboarding.email}</span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-[var(--member-muted)]">{testCheckout ? "Your profile and agreement are saved. This is a test checkout—no real charge will occur. Do not enter a real payment card." : "Your profile and agreement are saved. Payment is the final step."}</p>
          <fieldset className="mt-6 flex flex-wrap gap-5 border-0 p-0" disabled={Boolean(clientSecret) || submitting}>
            <legend className="mb-3 text-sm font-semibold">Membership</legend>
            {(["individual", "couple"] as const).map(kind => <label key={kind} className="flex items-center gap-2 text-sm"><input type="radio" name="membership-kind" checked={membershipKind === kind} onChange={() => changeOffer(plan, kind)} />{kind === "couple" ? "Couples · two adults" : "Individual"}</label>)}
          </fieldset>
          <fieldset className="mt-6 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2" disabled={Boolean(clientSecret) || submitting || Boolean(lockedPlan)}>
            <legend className="mb-3 text-sm font-semibold">Choose your payment plan</legend>
            {(["monthly", "annual"] as const).map(option => <label key={option} className="flex min-h-20 cursor-pointer items-start gap-3 rounded-[4px] border border-[var(--member-rule)] p-4 has-[:checked]:border-[var(--member-red)]">
              <input className="mt-1 size-4 shrink-0 accent-[var(--member-red)]" type="radio" name="checkout-plan" value={option} checked={plan === option} onChange={() => changeOffer(option)} />
              <span className="min-w-0 text-sm"><strong className="block">{MEMBERSHIP_PLANS[option].label}</strong><span className="mt-1 block text-xs text-[var(--member-muted)]">{option === "annual" ? "Pay for the full year upfront." : "Pay your initial year in 12 monthly installments."}</span></span>
            </label>)}
          </fieldset>
          {membershipKind === "couple" && !quote ? <CoupleMembershipApproval enabled={checkoutEnabled} /> : null}
          {!quote ? <>
            <p className="mt-5 text-sm leading-relaxed text-[var(--member-muted)]">Review your offer to see your price, founding eligibility, and initial commitment before authorizing payment.{membershipKind === "couple" ? " Both adults must register and approve their shared membership first." : ""}</p>
            <button className="mt-5 min-h-12 border border-white px-6 py-3 text-sm disabled:opacity-50" type="button" disabled={!checkoutEnabled || submitting} onClick={prepareOffer}>{submitting ? "Preparing your offer" : offerRetryable ? "Check founding availability again" : "Review membership offer"}</button>
          </> : selectedPrice ? <div className="mt-6 border-t border-[var(--member-rule)] pt-5" aria-live="polite">
            <h4 className="font-semibold">{selectedPrice.tier === "founding_individual" ? "Founding individual membership" : selectedPrice.tier === "couple" ? "Couples membership" : "Individual membership"}</h4>
            <p className="mt-2 text-sm text-[var(--member-muted)]">Your quoted price is held until <time dateTime={quote.expiresAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long" }).format(new Date(quote.expiresAt))}</time>. Review a new offer if you return after that time.</p>
            {selectedPrice.tier === "couple" ? <p className="mt-2 text-sm text-[var(--member-muted)]">For {quote.participants.map(person => person.name).join(" and ")}. Each adult uses their own account.</p> : null}
            <p className="mt-4 text-sm leading-relaxed">{selectedAmount} USD due at signup, plus applicable tax. {plan === "monthly" ? `Initial 12-month commitment: 12 payments of ${selectedAmount}, totaling ${formatMembershipPrice(selectedPrice.initialTermAmount)} before tax. After the first year, renews monthly at ${selectedAmount}.` : `${selectedAmount} pays for the full initial year upfront. Renews annually at ${selectedAmount}, plus applicable tax.`}</p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">{plan === "monthly" ? "Early exit costs the lower of $1,500 or your unpaid remaining first-year installments. This charge replaces those installments. You retain access through the period already paid for. Turning off renewal alone leaves the initial commitment in place." : "Turning off the next annual renewal has no early-exit charge. You retain access through the year already paid for."} Manage renewal or early exit in My Ruined → Account. Refund requests are reviewed individually; applicable rights remain in place.</p>
            {selectedPrice.tier === "founding_individual" ? <p className="mt-3 text-sm text-[var(--member-muted)]">Your founding rate continues while your membership stays active. If you cancel and later rejoin, eligibility is checked again against the current active membership.</p> : null}
            {!clientSecret ? <label className="mt-5 grid grid-cols-[1rem_1fr] items-start gap-3 text-sm leading-relaxed text-[var(--member-muted)]"><input className="mt-1 size-4 accent-[var(--member-red)]" type="checkbox" name="recurring-payment-accepted" checked={recurringPaymentAccepted} disabled={submitting || Boolean(lockedPlan)} onChange={event => setRecurringPaymentAccepted(event.target.checked)} /><span>I authorize {selectedAmount} USD at signup, {plan === "monthly" ? `the remaining monthly installments of my ${formatMembershipPrice(selectedPrice.initialTermAmount)} initial 12-month commitment, and monthly renewals afterward` : `annual renewals of ${selectedAmount}`}, plus applicable tax, under the membership agreement and early-exit terms shown above.</span></label> : null}
          </div> : null}
          {testCheckout ? (
            <dl className="mt-4 grid gap-2 text-sm leading-relaxed text-[var(--member-muted)]">
              <div><dt className="inline font-semibold text-white">Test card: </dt><dd className="inline font-mono [font-variant-numeric:tabular-nums]">4242 4242 4242 4242</dd></div>
              <div><dt className="inline font-semibold text-white">Expiry: </dt><dd className="inline">Any future date</dd></div>
              <div><dt className="inline font-semibold text-white">CVC: </dt><dd className="inline">Any 3-digit number</dd></div>
            </dl>
          ) : null}
          {error || checkoutDisabledReason ? <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-[var(--member-muted)]">{error ?? checkoutDisabledReason}</p> : null}
          {lockedPlan ? <div className="mt-5 border border-[var(--member-rule)] p-4 text-sm" role="status"><p>A {MEMBERSHIP_PLANS[lockedPlan].label.toLowerCase()} checkout is already open. Review that plan before resuming payment.</p><button type="button" className="mt-3 min-h-11 underline underline-offset-4" onClick={() => changeOffer(lockedPlan)}>Use {MEMBERSHIP_PLANS[lockedPlan].label.toLowerCase()} plan</button></div> : null}
          {!clientSecret && quote ? (
            <button className="mt-7 min-h-12 w-full border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!checkoutEnabled || !publishableKey || !quote || !recurringPaymentAccepted || Boolean(lockedPlan) || submitting} onClick={openCheckout} type="button">{submitting ? testCheckout ? "Preparing test checkout" : "Preparing payment" : checkoutEnabled && publishableKey ? testCheckout ? "Open test checkout" : "Open secure payment" : "Payment not connected"}</button>
          ) : null}
          {clientSecret && publishableKey ? <EmbeddedCheckout clientSecret={clientSecret} publishableKey={publishableKey} setError={setError} /> : null}
          <p className="mt-4 text-xs leading-relaxed text-[var(--member-muted)]">{testCheckout ? "Test checkout is provided by Stripe. Store purchases remain separate." : "Payment is handled securely by Stripe. Store purchases remain separate."}</p>
        </section>
      ) : null}

    </div>
  );
}
