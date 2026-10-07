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
import { RegistrationCoupleFields, useRegistrationCouple } from "@/components/membership/RegistrationCouplePreference";
import AgreementText from "@/components/membership/AgreementText";
import MemberPhotoUpload from "@/components/membership/MemberPhotoUpload";
import MemberPaymentMethod from "@/components/membership/MemberPaymentMethod";
import { formatMembershipPrice, isMembershipBillingPlan, MEMBERSHIP_OFFERS, MEMBERSHIP_PLANS, type MembershipBillingPlan, type MembershipOfferId } from "@/lib/membership/pricing";
import { membershipEntryStage } from "@/lib/membership/entry-stage";
import type { MemberOnboardingSnapshot } from "@/lib/membership/model";
import type { RegistrationLegalNotice } from "@/lib/membership/registration-legal-model";
import {
  EMPTY_MEMBER_COMMUNICATION_PREFERENCES,
  MEMBER_COMMUNICATION_NOTICE_VERSION,
  MEMBER_EMAIL_UPDATES_NOTICE,
  MEMBER_SMS_UPDATES_NOTICE,
  MEMBER_SMS_UPDATES_DETAIL,
} from "@/lib/membership/member-communication-preferences-model";
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

import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";

type MembershipQuote = {
  id: string;
  expiresAt: string;
  offer: (typeof MEMBERSHIP_OFFERS)[MembershipOfferId];
  billingTermsVersion: "membership-billing-v2";
  buyoutCap: number;
  participants: Array<{ memberId: string; name: string }>;
  firstChargeAt?: string | null;
  billingSchedule?: FoundationsBillingSchedule | null;
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
  "min-h-12 w-full rounded-[4px] border border-[var(--member-rule)] bg-transparent px-3 py-3 font-[var(--font-body)] text-sm text-[var(--member-ink)] outline-none transition-colors placeholder:text-[var(--member-muted)] focus:border-[var(--color-poster)]";
const fieldLabelClass = "grid gap-2";
const fieldLabelTextClass =
  "inline-block w-fit origin-left [font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none tracking-normal text-[var(--member-red)] [transform:rotate(-2deg)]";

function savedString(value: Record<string, unknown> | null, key: string) {
  return value && typeof value[key] === "string" ? String(value[key]) : "";
}

function latestAdultBirthDate() {
  const today = new Date();
  const year = today.getUTCFullYear() - 18;
  const month = today.getUTCMonth();
  const day = Math.min(today.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
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
  registrationRequiresInitialPayment = false,
  registrationLegalNotice = null,
  preview = false,
  activationOnly = false,
  streamlinedPayment = false,
  initialQuote = null,
  agreementOnlyReturnHref = null,
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
  registrationRequiresInitialPayment?: boolean;
  registrationLegalNotice?: RegistrationLegalNotice | null;
  preview?: boolean;
  activationOnly?: boolean;
  streamlinedPayment?: boolean;
  initialQuote?: MembershipQuote | null;
  agreementOnlyReturnHref?: string | null;
}) {
  const checkoutAttempt = useRef<string | null>(null);
  const automaticOfferAttempt = useRef<string | null>(null);
  const prepareOfferRef = useRef<() => Promise<void>>(async () => {});
  const automaticCheckoutAttempt = useRef<string | null>(null);
  const prepareCheckoutRef = useRef<() => Promise<void>>(async () => {});
  const registrationCouple = useRegistrationCouple({ enabled: registrationOnly, preview });
  const legalAcknowledgmentRef = useRef<HTMLInputElement>(null);
  const legalNotice = registrationOnly ? registrationLegalNotice : null;
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const memberTagRef = useRef<HTMLInputElement>(null);
  const [memberTag, setMemberTag] = useState(initialOnboarding.profile.memberTag ?? "");
  const [memberTagError, setMemberTagError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [acceptanceId, setAcceptanceId] = useState(initialOnboarding.agreement.acceptanceId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [editingPaymentPlan, setEditingPaymentPlan] = useState(false);
  const [checkoutMountRevision, setCheckoutMountRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [legalRefreshRequired, setLegalRefreshRequired] = useState(false);
  const [communicationRefreshRequired, setCommunicationRefreshRequired] = useState(false);
  const [plan, setPlan] = useState<MembershipBillingPlan>(initialPlan);
  const [recurringPaymentAccepted, setRecurringPaymentAccepted] = useState(false);
  const [lockedPlan, setLockedPlan] = useState<MembershipBillingPlan | null>(null);
  const [membershipKind, setMembershipKind] = useState<"individual" | "couple">(initialQuote?.offer.tier === "couple" ? "couple" : "individual");
  const [quote, setQuote] = useState<MembershipQuote | null>(initialQuote);
  const [offerRetryable, setOfferRetryable] = useState(false);
  const selectedPrice = quote?.offer ?? null;
  const selectedAmount = selectedPrice ? formatMembershipPrice(selectedPrice.amount) : "";
  const firstChargeDate = quote?.firstChargeAt ? new Intl.DateTimeFormat("en-US", {
    dateStyle: "long", timeZone: "America/Denver",
  }).format(new Date(quote.firstChargeAt)) : null;
  const billingSchedule = quote?.billingSchedule;
  const scheduleDate = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value)) + " Mountain Time";
  const paymentTiming = billingSchedule ? "today" : firstChargeDate ? `on ${firstChargeDate}` : "at signup";
  const [submitting, setSubmitting] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [photoDraft, setPhotoDraft] = useState(false);
  const profileComplete = onboarding.requiredFieldsComplete;
  const complimentary = (onboarding.membershipFunding === "operator" || onboarding.membershipFunding === "complimentary");
  const sharedMembership = onboarding.membershipFunding === "couple" && onboarding.billingState === "active";
  const noSeparatePayment = complimentary || sharedMembership;
  const prelaunch = registrationOnly || !noSeparatePayment && onboarding.billingState === "pending" && !checkoutEnabled;
  const compactCheckout = streamlinedPayment && !noSeparatePayment && !prelaunch && !agreementOnlyReturnHref;
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
  const initialCommunicationPreferences = initialOnboarding.communicationPreferences ?? EMPTY_MEMBER_COMMUNICATION_PREFERENCES;
  const [communicationPreferences, setCommunicationPreferences] = useState(initialCommunicationPreferences);
  const [emailUpdates, setEmailUpdates] = useState(initialCommunicationPreferences.email ?? true);
  const initialMobile = mobileToE164(initialOnboarding.profile.mobile ?? "", initialPhoneCountry);
  const initialSmsPhone = initialCommunicationPreferences.sms === true && initialCommunicationPreferences.smsPhone === initialMobile ? initialMobile : null;
  const [smsUpdates, setSmsUpdates] = useState(Boolean(initialSmsPhone));
  const [smsConsentPhone, setSmsConsentPhone] = useState(initialSmsPhone);
  const [smsOptInPhone, setSmsOptInPhone] = useState<string | null>(null);
  const [smsPhoneChanged, setSmsPhoneChanged] = useState(false);
  const currentMobile = mobileToE164(phoneNumber, phoneCountry);
  const communicationControlsAvailable = communicationPreferences.revision !== "not_loaded" || preview;

  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    const frame = requestAnimationFrame(() => stageHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [stage]);

  useEffect(() => {
    if (preview || !quote?.billingSchedule) return;
    const expiresAt = Math.min(Date.parse(quote.expiresAt), Date.parse(quote.billingSchedule.cutoffAt));
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) { timer = setTimeout(check, Math.min(remaining, 2_147_483_647)); return; }
      setClientSecret(null); setQuote(null); setRecurringPaymentAccepted(false); checkoutAttempt.current = null;
      setError("This offer has expired. Review a new offer and its Foundations dates before authorizing payment.");
    };
    timer = setTimeout(check, Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [preview, quote]);

  function attemptId() {
    checkoutAttempt.current ??= crypto.randomUUID();
    return checkoutAttempt.current;
  }

  function invalidateTextChoice(nextMobile: string | null) {
    if (!smsUpdates || nextMobile === smsConsentPhone) return;
    setSmsUpdates(false);
    setSmsConsentPhone(null);
    setSmsOptInPhone(null);
    setSmsPhoneChanged(true);
  }

  function changeTextUpdates(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.checked && Boolean(currentMobile);
    setSmsUpdates(selected);
    setSmsConsentPhone(selected ? currentMobile : null);
    setSmsOptInPhone(selected ? currentMobile : null);
    setSmsPhoneChanged(false);
  }

  function changePhoneCountry(event: ChangeEvent<HTMLSelectElement>) {
    const nextCountry = supportedPhoneCountry(event.currentTarget.value);
    if (!nextCountry) return;
    setError(null);
    phoneInputRef.current?.setCustomValidity("");
    const nextNumber = phoneInputForCountry(phoneNumber, phoneCountry, nextCountry);
    invalidateTextChoice(mobileToE164(nextNumber, nextCountry));
    setPhoneNumber(nextNumber);
    setPhoneCountry(nextCountry);
  }

  function changePhoneNumber(event: FormEvent<HTMLInputElement>) {
    setError(null);
    event.currentTarget.setCustomValidity("");
    const formatted = formatPhoneInput(event.currentTarget.value, phoneCountry);
    const nextCountry = phoneCountryFromInput(formatted, phoneCountry);
    invalidateTextChoice(mobileToE164(formatted, nextCountry));
    setPhoneNumber(formatted);
    setPhoneCountry(nextCountry);
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
    if (activationOnly || !enabled || submitting || legalRefreshRequired || communicationRefreshRequired) return;
    if (registrationOnly && (registrationCouple.loading || registrationCouple.loadError)) return;
    if (legalNotice?.state === "unavailable") { setError(legalNotice.message); return; }
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    if (legalNotice?.state === "required" && form.get("registration-legal-acknowledged") !== "on") {
      setError("Read the Privacy Policy and Membership Terms, then check the acknowledgment to continue.");
      legalAcknowledgmentRef.current?.focus();
      setSubmitting(false);
      return;
    }
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
      // Also compare the submitted value: autofill or a programmatic change may
      // reach the form without the phone input's normal change handler.
      const sms = smsUpdates && smsConsentPhone === mobile;
      if (smsUpdates && !sms) invalidateTextChoice(mobile);
      const communicationPreferencesInput = registrationOnly && communicationControlsAvailable ? {
        email: emailUpdates,
        sms,
        expectedRevision: communicationPreferences.revision,
        noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION,
        ...(sms && smsOptInPhone === mobile ? { smsOptIn: { phone: mobile } } : {}),
      } : undefined;
      const response = await fetch("/api/my/onboarding", {
        body: JSON.stringify({
          action: "save_profile",
          apparelTopSize: String(form.get("apparel-size") ?? ""),
          birthDate: String(form.get("birth-date") ?? ""),
          legalName: String(form.get("legal-name") ?? ""),
          mobile,
          memberTag: tag,
          ...(communicationPreferencesInput ? { communicationPreferences: communicationPreferencesInput } : {}),
          ...(legalNotice?.state === "required" ? { legalAcknowledgment: {
            acknowledged: true,
            privacyVersion: legalNotice.privacyVersion,
            agreementVersionId: legalNotice.agreementVersionId,
          } } : {}),
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
        if (payload.code === "communication_preferences_changed" || payload.code === "communication_notice_changed") {
          setCommunicationRefreshRequired(true);
        }
        if (payload.code === "sms_opt_in_required") {
          setSmsUpdates(false);
          setSmsConsentPhone(null);
          setSmsOptInPhone(null);
          setSmsPhoneChanged(true);
        }
        if (payload.code === "registration_documents_changed") {
          setLegalRefreshRequired(true);
          if (legalAcknowledgmentRef.current) legalAcknowledgmentRef.current.checked = false;
        }
        if (payload.code === "member_tag_unavailable") {
          setMemberTagError(payload.error || "That member tag is already taken. Choose another.");
          memberTagRef.current?.focus();
        }
        throw new Error(payload.error || (registrationOnly ? "Your details could not be saved." : "Your member profile could not be saved."));
      }
      if (payload.onboarding.communicationPreferences) {
        const saved = payload.onboarding.communicationPreferences;
        setCommunicationPreferences(saved);
        setEmailUpdates(saved.email ?? emailUpdates);
        setSmsUpdates(saved.sms === true && saved.smsPhone === mobile);
        setSmsConsentPhone(saved.sms === true ? saved.smsPhone : null);
        setSmsOptInPhone(null);
      }
      if (registrationOnly) await registrationCouple.save();
      setOnboarding(payload.onboarding);
      if (registrationOnly && payload.onboarding.requiredFieldsComplete) {
        window.location.assign(registrationRequiresInitialPayment ? "/my/activate" : registrationRequiresPaymentMethod ? "/my/payment-method" : "/my/registered");
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
    if (preview || registrationOnly || !enabled || submitting || !onboarding.agreement.id) return;
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    if (form.get("agreement-accepted") !== "on") { setError("Read and accept the membership agreement before continuing."); setSubmitting(false); return; }
    if (compactCheckout && (!quote || offerExpired(quote))) {
      setQuote(null); setError("Your offer has expired. Review a new price and Foundations dates before continuing."); setSubmitting(false); return;
    }
    try {
      const response = await fetch("/api/my/agreement", {
        body: JSON.stringify({
          affirmativeAction: "checkbox_and_submit",
          ageConfirmed: compactCheckout || form.get("age-confirmed") === "on",
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
      if (agreementOnlyReturnHref) { window.location.assign(agreementOnlyReturnHref); return; }
      // Signing the agreement opens a pending Stripe session. Only Stripe's
      // own terms confirmation and Pay action authorize the payment.
      if (compactCheckout && quote) await requestCheckout(quote, payload.acceptance.id);
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
    if (preview || !enabled || clientSecret || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (quote) {
        const response = await fetch("/api/stripe/membership-offer", { method: "POST", cache: "no-store",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "release", reservationId: quote.id }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Resolve your existing payment before changing the offer.");
      }
      automaticOfferAttempt.current = null;
      automaticCheckoutAttempt.current = null;
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

  async function editPaymentPlan() {
    if (preview || !enabled || !compactCheckout || !clientSecret || !quote || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/membership-offer", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "change_plan", reservationId: quote.id }),
      });
      const payload = await response.json() as { released?: boolean; error?: string };
      if (!response.ok || payload.released !== true) {
        throw new Error(payload.error || "Your current payment could not be closed. Please retry before changing plans.");
      }
      // Keep the current Stripe form until the server proves it can no longer
      // accept payment. Editing then pauses automatic quote/session creation.
      setEditingPaymentPlan(true);
      setClientSecret(null);
      setQuote(null);
      setRecurringPaymentAccepted(false);
      setLockedPlan(null);
      setOfferRetryable(false);
      automaticOfferAttempt.current = null;
      automaticCheckoutAttempt.current = null;
      checkoutAttempt.current = null;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your payment plan could not be changed.");
    } finally { setSubmitting(false); }
  }

  async function prepareOffer() {
    if (preview || !enabled || !checkoutEnabled || noSeparatePayment || submitting || clientSecret) return;
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

  function offerExpired(offer: MembershipQuote) {
    return Date.now() >= Math.min(Date.parse(offer.expiresAt), offer.billingSchedule ? Date.parse(offer.billingSchedule.cutoffAt) : Infinity);
  }

  async function requestCheckout(offer: MembershipQuote, acceptedAgreementId: string) {
    if (offerExpired(offer)) {
      setQuote(null); setRecurringPaymentAccepted(false); checkoutAttempt.current = null;
      throw new Error("This offer has expired. Review a new offer and its Foundations dates before authorizing payment.");
    }
    if (compactCheckout) automaticCheckoutAttempt.current = `${offer.id}:${acceptedAgreementId}:${plan}`;
    const response = await fetch("/api/stripe/checkout", {
      body: JSON.stringify({ acceptanceId: acceptedAgreementId, attemptId: attemptId(), plan,
        ...(compactCheckout ? { consentSource: "stripe_checkout" } : { recurringPaymentAccepted: true }), commercialReservationId: offer.id,
        firstChargeAt: offer.firstChargeAt ?? null,
        ...(offer.billingSchedule ? { billingSchedule: offer.billingSchedule } : {}),
      }),
      cache: "no-store", headers: { "content-type": "application/json" }, method: "POST",
    });
    const payload = (await response.json()) as CheckoutResponse;
    if (!response.ok || !payload.clientSecret) {
      if (payload.code === "checkout_plan_locked" && isMembershipBillingPlan(payload.plan)) {
        setLockedPlan(payload.plan); setRecurringPaymentAccepted(false);
      }
      if (payload.code === "membership_offer_expired") {
        setQuote(null); setRecurringPaymentAccepted(false); checkoutAttempt.current = null;
      }
      throw new Error(payload.error || "Secure payment is temporarily unavailable.");
    }
    if (payload.plan !== plan || payload.commercialReservationId !== offer.id) throw new Error("Your payment plan changed. Reload this page to review it before paying.");
    setClientSecret(payload.clientSecret);
  }

  async function openCheckout(authorizationAccepted = recurringPaymentAccepted) {
    if (preview || !enabled || editingPaymentPlan || noSeparatePayment || agreementOnlyReturnHref || !checkoutEnabled || !publishableKey || !acceptanceId || !quote || (!authorizationAccepted && !compactCheckout) || submitting || clientSecret) return;
    if (offerExpired(quote)) {
      setQuote(null); setRecurringPaymentAccepted(false); checkoutAttempt.current = null;
      setError("This offer has expired. Review a new offer and its Foundations dates before authorizing payment.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await requestCheckout(quote, acceptanceId);
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

  // Preparing an offer does not accept terms or authorize payment. Run once for
  // each selection, with an explicit retry only if preparation fails.
  useEffect(() => { prepareOfferRef.current = prepareOffer; });
  useEffect(() => {
    if (!streamlinedPayment || agreementOnlyReturnHref || editingPaymentPlan || preview || !enabled || !checkoutEnabled || noSeparatePayment || !["agreement", "payment"].includes(stage) || submitting || quote || clientSecret) return;
    const selection = `${membershipKind}:${plan}:${acceptanceId}`;
    if (automaticOfferAttempt.current === selection) return;
    automaticOfferAttempt.current = selection;
    void prepareOfferRef.current();
  }, [streamlinedPayment, agreementOnlyReturnHref, editingPaymentPlan, preview, enabled, checkoutEnabled, noSeparatePayment, stage, submitting, quote, clientSecret, membershipKind, plan, acceptanceId]);

  useEffect(() => { prepareCheckoutRef.current = () => openCheckout(false); });
  useEffect(() => {
    if (!compactCheckout || editingPaymentPlan || preview || !enabled || !checkoutEnabled || !publishableKey || stage !== "payment" || !acceptanceId || !quote || clientSecret || submitting || lockedPlan) return;
    const selection = `${quote.id}:${acceptanceId}:${plan}`;
    if (automaticCheckoutAttempt.current === selection) return;
    automaticCheckoutAttempt.current = selection;
    void prepareCheckoutRef.current();
  }, [compactCheckout, editingPaymentPlan, preview, enabled, checkoutEnabled, publishableKey, stage, acceptanceId, quote, clientSecret, submitting, lockedPlan, plan]);

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
      {stage === "profile" && !activationOnly ? (
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
                max={registrationOnly ? latestAdultBirthDate() : undefined}
                name="birth-date"
                required
                type="date"
              />
              {registrationOnly ? <span className="text-xs leading-relaxed text-[var(--member-muted)]">Membership is for adults 18 and over.</span> : null}
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
                defaultValue={registrationOnly ? "US" : supportedShippingCountry(savedString(address, "countryCode")) ?? "US"}
                id="shipping-country"
                name="country-code"
                required
              >
                {SHIPPING_COUNTRY_OPTIONS.filter(country => !registrationOnly || country.code === "US").map((country) => (
                  <option className="text-black" key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {registrationOnly ? <div className="border-t border-[var(--member-rule)] pt-6"><p className="mb-5 text-xs leading-relaxed text-[var(--member-muted)]">Registration is currently available in the United States.</p><RegistrationCoupleFields preference={registrationCouple} disabled={submitting} /></div> : null}

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

          {registrationOnly && communicationControlsAvailable ? <fieldset className="grid gap-3 border-t border-[var(--member-rule)] pt-6" disabled={submitting}>
            <legend className="sr-only">Optional membership updates and reminders</legend>
            <label className="flex items-start gap-3 text-sm leading-relaxed"><input checked={emailUpdates} className="mt-1 size-4 shrink-0 accent-current" name="membership-email-updates" onChange={event => setEmailUpdates(event.currentTarget.checked)} type="checkbox" /><span>{MEMBER_EMAIL_UPDATES_NOTICE}</span></label>
            <div>
              <label className="flex items-start gap-3 text-sm leading-relaxed"><input aria-describedby="membership-text-updates-help" checked={smsUpdates} className="mt-1 size-4 shrink-0 accent-current" disabled={!currentMobile || submitting} name="membership-text-updates" onChange={changeTextUpdates} type="checkbox" /><span>{MEMBER_SMS_UPDATES_NOTICE}</span></label>
              <p className="mt-1 pl-7 text-xs leading-relaxed text-[var(--member-muted)]" id="membership-text-updates-help">{MEMBER_SMS_UPDATES_DETAIL} <a className="underline underline-offset-4" href="/privacy" rel="noopener noreferrer" target="_blank">Privacy</a> · <a className="underline underline-offset-4" href={legalNotice?.state === "required" ? legalNotice.agreementHref : "/membership/registration-terms"} rel="noopener noreferrer" target="_blank">Terms</a></p>
              {!currentMobile || smsPhoneChanged ? <p className="mt-1 pl-7 text-xs leading-relaxed text-[var(--member-muted)]" role="status">{!currentMobile ? "Enter your mobile number above to choose text updates." : "Mobile number changed. Select text updates again for this number."}</p> : null}
            </div>
            <p className="pl-7 text-xs leading-relaxed text-[var(--member-muted)]">Security, account and registration emails still arrive if these are off. <a className="underline underline-offset-4" href="mailto:connect@theruinedproject.com">Contact us</a> to change your preferences anytime.</p>
          </fieldset> : null}

          {legalNotice?.state === "required" ? <div className="border-t border-[var(--member-rule)] pt-6">
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <input aria-describedby="registration-legal-help" className="mt-1 size-4 shrink-0 accent-current" defaultChecked={false} disabled={submitting} name="registration-legal-acknowledged" onChange={() => setError(null)} ref={legalAcknowledgmentRef} required type="checkbox" />
              <span>{legalNotice.noticeText.split(/(Privacy Policy|Membership Terms)/).map((part, index) => part === "Privacy Policy" || part === "Membership Terms"
                ? <a key={index} className="underline underline-offset-4" href={part === "Privacy Policy" ? legalNotice.privacyHref : legalNotice.agreementHref} target="_blank" rel="noopener noreferrer">{part}</a>
                : part)}</span>
            </label>
            <p className="mt-3 pl-7 text-xs leading-relaxed text-[var(--member-muted)]" id="registration-legal-help">The links open in a new tab so your details stay here. Before paid membership begins, you’ll separately review the price and terms and confirm payment.</p>
          </div> : legalNotice?.state === "unavailable" ? <div className="border-t border-[var(--member-rule)] pt-6 text-sm leading-relaxed" role="alert"><p>{legalNotice.message}</p><button className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4" onClick={() => window.location.reload()} type="button">Reload registration ↻</button></div> : null}

          {error || disabledReason ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-[var(--member-muted)]">{error ?? disabledReason}</p> : null}
          {legalRefreshRequired ? <button className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4" onClick={() => window.location.reload()} type="button">Reload & review updated documents ↻</button> : null}
          {communicationRefreshRequired ? <button className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4" onClick={() => window.location.reload()} type="button">Reload current update preferences ↻</button> : null}
          {photoDraft ? <p className="text-sm text-[var(--member-muted)]" role="status">Use your photo or cancel the crop before continuing.</p> : null}
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || submitting || photoPending || photoDraft || legalRefreshRequired || communicationRefreshRequired || legalNotice?.state === "unavailable" || (registrationOnly && (registrationCouple.loading || Boolean(registrationCouple.loadError)))} type="submit">{submitting ? registrationOnly ? "Saving details" : "Saving profile" : registrationOnly ? registrationRequiresInitialPayment ? "Continue to agreement & payment" : registrationRequiresPaymentMethod ? "Save details & continue" : "Complete registration" : prelaunch ? "Save my profile" : "Save & review agreement"}</button>
        </form>
      ) : null}
      {preview && registrationOnly && !profileComplete ? <Link className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/payment-method">Preview card step · no details saved</Link> : null}

      {profileComplete && prelaunch && !registrationOnly && !activationOnly ? <div className="mt-9">
        <h3 className="font-[var(--font-display)] text-4xl" ref={stageHeadingRef} tabIndex={-1}>Your profile is ready.</h3>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--member-muted)]">You’ll review your membership offer and confirm billing separately. Ruined will let you know when your profile is ready.</p>
        {paymentSetupEnabled || preview ? <div className="mt-7"><MemberPaymentMethod preview={preview} /></div> : <div className="mt-6"><p className="text-sm text-[var(--member-muted)]">There’s nothing to pay today. You can return to your account whenever you need.</p><Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/my/account">Go to my account</Link></div>}
      </div> : null}

      {profileComplete && registrationOnly ? <div className="mt-9">
        <h3 className="font-[var(--font-display)] text-4xl" tabIndex={-1}>Your details are saved.</h3>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--member-muted)]">{registrationRequiresInitialPayment ? "Next, review your membership agreement, exact price and Foundations dates. Your first monthly installment or full annual payment completes registration. Your profile opens later." : registrationRequiresPaymentMethod ? "Save a card securely with Stripe to finish registration. No charge is made today." : "Your complimentary registration does not require a payment card."}</p>
        <Link className="mt-6 inline-flex min-h-12 items-center bg-white px-6 py-3 text-sm font-semibold text-black" href={registrationRequiresInitialPayment ? "/my/activate" : registrationRequiresPaymentMethod ? "/my/payment-method" : "/my/registered"}>{preview ? "Preview next step" : "Continue registration"}</Link>
      </div> : null}

      {compactCheckout && (stage === "agreement" || stage === "payment") ? <section aria-labelledby="payment-review-title" className="mt-5">
        <h3 id="payment-review-title" ref={stageHeadingRef} tabIndex={-1} className="font-[var(--font-display)] text-3xl tracking-[-0.03em]">{editingPaymentPlan ? "Choose your plan." : clientSecret ? "Your payment." : "Review & pay."}</h3>
        <p className="mt-2 text-sm text-[var(--member-muted)]">{editingPaymentPlan ? "Choose your membership and payment schedule. We’ll update the price and payment form before you pay." : clientSecret ? "Enter your card below. Stripe shows your final total before you pay." : "Review your membership. Then enter your card securely with Stripe."}</p>
        {clientSecret ? <button type="button" onClick={editPaymentPlan} disabled={!enabled || submitting} className="mt-3 min-h-11 text-sm underline underline-offset-4 disabled:opacity-50">{submitting ? "Closing your current payment form…" : "Change plan"}</button> : null}
        {!clientSecret ? <>
          <fieldset className="mt-5 flex flex-wrap gap-x-6 gap-y-3 border-0 p-0" disabled={!enabled || submitting || Boolean(lockedPlan)}>
            <legend className="sr-only">Membership type</legend>
            {(["individual", "couple"] as const).map(kind => <label className="flex items-center gap-2 text-sm" key={kind}><input type="radio" name="membership-kind" checked={membershipKind === kind} onChange={() => changeOffer(plan, kind)} />{kind === "couple" ? "Couples · two adults" : "Individual"}</label>)}
          </fieldset>
          <fieldset className="mt-4 grid grid-cols-2 gap-2 border-0 p-0" disabled={!enabled || submitting || Boolean(lockedPlan)}>
            <legend className="sr-only">Payment plan</legend>
            {(["monthly", "annual"] as const).map(option => <label key={option} className="flex min-h-12 items-center gap-2 border border-[var(--member-rule)] bg-[var(--member-panel)] px-3 py-3 text-sm has-[:checked]:border-[var(--member-ink)] has-[:checked]:bg-[#ffca2c] has-[:checked]:text-[#171714]"><input className="accent-[#171714]" type="radio" name="checkout-plan" checked={plan === option} onChange={() => changeOffer(option)} /><span>{option === "annual" ? "Pay annually" : "Pay monthly"}</span></label>)}
          </fieldset>
          {membershipKind === "couple" && !quote ? <div className="mt-5"><CoupleMembershipApproval enabled={checkoutEnabled} /></div> : null}
        </> : null}
        {quote && selectedPrice ? <>
          <div className="mt-5 border border-[var(--member-rule)] bg-[var(--member-panel)] p-4 text-[var(--member-ink)] sm:p-5" aria-label="Your membership price and terms">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="inline-block bg-[#ffca2c] px-2 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-[#171714]">{selectedPrice.tier === "founding_individual" ? "Founding membership" : selectedPrice.tier === "couple" ? "Couples membership" : "Individual membership"}</p><p className="mt-2 text-4xl font-semibold tracking-[-0.04em]">{firstChargeDate && !billingSchedule ? "$0" : selectedAmount}<span className="ml-2 text-sm font-normal tracking-normal">due today</span></p></div>
              <p className="text-xs text-[var(--member-muted)]">USD · {firstChargeDate && !billingSchedule ? "First charge " + firstChargeDate : "Plus applicable tax"}</p>
            </div>
            {selectedPrice.tier === "couple" ? <p className="mt-3 text-sm">For {quote.participants.map(person => person.name).join(" and ")}.</p> : null}
            {billingSchedule ? <dl className="mt-4 grid gap-3 border-t border-[var(--member-rule)] pt-4 text-sm sm:grid-cols-2">
              <div><dt className="text-[var(--member-muted)]">Foundations &amp; service begin</dt><dd className="mt-1 font-medium">{scheduleDate(billingSchedule.serviceStartsAt)}</dd></div>
              <div><dt className="text-[var(--member-muted)]">Next payment</dt><dd className="mt-1 font-medium">{selectedAmount} + tax<br />{scheduleDate(billingSchedule.nextChargeAt)}</dd></div>
            </dl> : null}
            <p className="mt-4 text-sm leading-relaxed"><strong>12-month commitment.</strong> {plan === "monthly" ? `${selectedAmount} ${paymentTiming}, then ${billingSchedule ? "11" : "the remaining"} monthly installments. ${formatMembershipPrice(selectedPrice.initialTermAmount)} total before tax. Renews monthly at ${selectedAmount} after the first year.` : `${selectedAmount} pays for the full year. Renews annually at ${selectedAmount}.`} Applicable tax is added.</p>
            {billingSchedule ? <p className="mt-3 text-xs leading-relaxed text-[var(--member-muted)]">Initial commitment ends {scheduleDate(billingSchedule.initialTermEndsAt)}. Your profile opens separately by email.</p> : null}
            <p className="mt-3 text-xs leading-relaxed text-[var(--member-muted)]">{billingSchedule ? "Cancel before service begins for a full refund, including tax. " : firstChargeDate ? "Cancel before the first charge with no fee. " : ""}{plan === "monthly" ? "After service begins, early exit replaces unpaid initial installments with the lower of $1,500 or those installments, plus required tax. Turning off renewal does not erase the commitment." : "Turning off annual renewal stops the next year’s charge. After service begins, it does not automatically refund the prepaid year."}</p>
          </div>
            {billingSchedule ? <details className="mt-3 border-b border-[var(--member-rule)] pb-3 text-sm"><summary className="cursor-pointer py-2 font-medium">Your four Foundations calls &amp; billing details</summary><div className="mt-3 space-y-3 text-[var(--member-muted)]"><ol className="grid gap-2">{billingSchedule.callStartsAt.map(call => <li key={call}><time dateTime={call}>{new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Denver" }).format(new Date(call))}, {scheduleDate(call)}</time></li>)}</ol><p>Four live virtual sessions, 90 minutes each. Your first payment covers service through {scheduleDate(billingSchedule.prepaidThrough)}.</p><p>Finish Checkout before {scheduleDate(billingSchedule.cutoffAt)} to join this cohort. This quote is held until {scheduleDate(quote.expiresAt)}. If either expires, review a new offer before paying.</p><p>Manage renewal or cancellation in <Link href="/my/activate" className="underline underline-offset-4">Membership billing</Link>. After service begins, refund requests are reviewed individually; applicable rights remain unchanged.</p>{selectedPrice.tier === "founding_individual" ? <p>Your Founding rate remains while your membership is continuously active. Canceling before service begins preserves any eligibility reserved at registration; leaving after service begins requires a new eligibility check if you rejoin.</p> : null}</div></details> : null}
            <details className="border-b border-[var(--member-rule)] py-3 text-sm"><summary className="cursor-pointer py-2 font-medium">Read the Membership Agreement{onboarding.agreement.version ? ` · v${onboarding.agreement.version}` : ""}</summary><div className="mt-3 max-h-80 overflow-y-auto bg-[var(--member-soft)] p-4" role="region" aria-label="Published membership agreement" tabIndex={0}>{onboarding.agreement.body ? <AgreementText body={onboarding.agreement.body} /> : <p>The membership agreement is currently unavailable.</p>}</div></details>
          {!clientSecret ? <>
            {stage === "agreement" ? <form key={`${quote.id}:${onboarding.agreement.id}`} onSubmit={acceptAgreement} className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm"><span>Full name</span><input className={fieldClass} autoComplete="name" name="signer-name" defaultValue={onboarding.profile.legalName ?? ""} required disabled={!enabled || submitting} /></label>
              <label className="grid grid-cols-[1rem_1fr] items-start gap-3 text-sm leading-relaxed"><input className="mt-1 size-4 accent-[#ffca2c]" type="checkbox" name="agreement-accepted" required disabled={!enabled || submitting} /><span>I am at least {minimumAge} and accept the Membership Agreement. I’ll review the final total and confirm payment in Stripe.</span></label>
              <button type="submit" className="min-h-14 w-full bg-[#ffca2c] px-5 py-4 text-base font-semibold text-[#171714] disabled:opacity-50" disabled={!enabled || !checkoutEnabled || !publishableKey || !onboarding.agreement.id || !onboarding.agreement.body || Boolean(lockedPlan) || submitting}>{submitting ? "Opening secure payment…" : "Agree & continue"}</button>
            </form> : <div className="mt-5"><p className="text-sm leading-relaxed text-[var(--member-muted)]" role="status">{preview ? "Preview only. Secure Stripe payment appears here after agreement acceptance." : submitting ? "Loading secure payment…" : error ? "Your agreement is saved. Reload secure payment to continue." : "Preparing your secure payment form…"}</p>{error ? <button type="button" onClick={() => openCheckout(false)} disabled={!enabled || !checkoutEnabled || !publishableKey || Boolean(lockedPlan) || submitting} className="mt-4 min-h-14 w-full bg-[#ffca2c] px-5 py-4 text-base font-semibold text-[#171714] disabled:opacity-50">{submitting ? "Opening secure payment…" : "Reload secure payment"}</button> : null}</div>}
            <p className="mt-3 text-center text-xs leading-relaxed text-[var(--member-muted)]">{testCheckout ? "Test only. No real payment is made." : "No charge until you confirm payment in Stripe."} <Link className="underline underline-offset-4" href="/privacy">Privacy policy</Link></p>
          </> : null}
        </> : editingPaymentPlan ? <button type="button" onClick={() => setEditingPaymentPlan(false)} disabled={!enabled || !checkoutEnabled || !publishableKey || submitting} className="mt-5 min-h-14 w-full bg-[#ffca2c] px-5 py-4 text-base font-semibold text-[#171714] disabled:opacity-50">Update payment form</button> : <div className="mt-5 border border-[var(--member-rule)] p-5" role="status"><p className="text-sm">{submitting ? "Loading your exact price and Foundations dates…" : "Your membership offer is being prepared."}</p>{error ? <button className="mt-4 min-h-12 border border-current px-5 py-3 text-sm" disabled={!enabled || submitting} type="button" onClick={prepareOffer}>{offerRetryable ? "Check Founding availability again" : "Try again"}</button> : null}</div>}
        {error || checkoutDisabledReason ? <p role="alert" className="mt-4 border-l-2 border-[#ffca2c] pl-3 text-sm leading-relaxed">{error ?? checkoutDisabledReason}</p> : null}
        {lockedPlan ? <button type="button" onClick={() => changeOffer(lockedPlan)} className="mt-3 min-h-11 underline underline-offset-4 text-sm">Resume your {lockedPlan} plan</button> : null}
        {clientSecret && error ? <button type="button" className="mt-4 min-h-12 border border-current px-5 py-3 text-sm" onClick={() => { setError(null); setCheckoutMountRevision(revision => revision + 1); }}>Reload payment form</button> : null}
        {clientSecret && publishableKey ? <EmbeddedCheckout key={checkoutMountRevision} clientSecret={clientSecret} publishableKey={publishableKey} setError={setError} /> : null}
      </section> : null}

      {agreementOnlyReturnHref && stage === "payment" ? <section className="mt-6"><h3 className="text-2xl font-semibold">Your agreement is saved.</h3><p className="mt-3 text-sm text-[var(--member-muted)]">Return to approve your shared membership. You do not need to start an individual payment.</p><Link className="mt-5 inline-flex min-h-12 items-center bg-[#ffca2c] px-5 py-3 font-semibold text-[#171714]" href={agreementOnlyReturnHref}>Continue to couples approval</Link></section> : null}

      {stage === "agreement" && !prelaunch && !compactCheckout ? (
        <form className="mt-9 grid gap-6" onSubmit={acceptAgreement}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red)]">Review / Membership agreement</p>
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
              defaultValue={onboarding.profile.legalName ?? ""}
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
          <button className="min-h-12 border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || !onboarding.agreement.id || !onboarding.agreement.body || submitting} type="submit">{submitting ? "Recording acceptance" : agreementOnlyReturnHref ? "Agree & return to couples approval" : "Accept & continue"}</button>
        </form>
      ) : null}

      {stage === "payment" && noSeparatePayment && !agreementOnlyReturnHref ? (
        <section className="mt-9" aria-labelledby="complimentary-membership-title">
          <h3 className="font-[var(--font-display)] text-4xl" id="complimentary-membership-title" ref={stageHeadingRef} tabIndex={-1}>You’re ready.</h3>
          <p className="mt-4 text-base leading-relaxed text-[var(--member-muted)]">{sharedMembership ? "Your membership is covered by your shared couples subscription. Your profile and agreement are saved; no separate payment is needed." : "Your membership is complimentary. Your profile and agreement are saved—no payment is needed."}</p>
          {error || disabledReason ? <p className="mt-4 text-sm" role="status">{error ?? disabledReason}</p> : null}
          <button className="mt-6 min-h-12 rounded-[4px] bg-[var(--color-signal)] px-6 py-3 font-bold text-black disabled:opacity-50" disabled={!enabled || submitting} onClick={activateComplimentaryMembership} type="button">{submitting ? "Activating membership…" : "Activate my membership"}</button>
        </section>
      ) : null}

      {stage === "payment" && !noSeparatePayment && !prelaunch && !compactCheckout && !agreementOnlyReturnHref ? (
        <section className="mt-9" aria-labelledby="secure-payment-title">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red)]">{testCheckout ? "Final / Test checkout" : "Confirm / Secure checkout"}</p>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
            <h3 className="font-[var(--font-display)] text-4xl" id="secure-payment-title" ref={stageHeadingRef} tabIndex={-1}>{testCheckout ? "Test checkout" : "Membership payment"}</h3>
            <span className="text-sm text-[var(--member-muted)]">{onboarding.email}</span>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-[var(--member-muted)]">{testCheckout ? "Your profile and agreement are saved. This is a test checkout—no real charge will occur. Do not enter a real payment card." : "Your details and agreement are saved. Review your exact offer before authorizing billing."}</p>
          <fieldset className="mt-6 flex flex-wrap gap-5 border-0 p-0" disabled={!enabled || Boolean(clientSecret) || submitting}>
            <legend className="mb-3 text-sm font-semibold">Membership</legend>
            {(["individual", "couple"] as const).map(kind => <label key={kind} className="flex items-center gap-2 text-sm"><input type="radio" name="membership-kind" checked={membershipKind === kind} onChange={() => changeOffer(plan, kind)} />{kind === "couple" ? "Couples · two adults" : "Individual"}</label>)}
          </fieldset>
          <fieldset className="mt-6 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2" disabled={!enabled || Boolean(clientSecret) || submitting || Boolean(lockedPlan)}>
            <legend className="mb-3 text-sm font-semibold">Choose your payment plan</legend>
            {(["monthly", "annual"] as const).map(option => <label key={option} className="flex min-h-20 cursor-pointer items-start gap-3 rounded-[4px] border border-[var(--member-rule)] p-4 has-[:checked]:border-[var(--member-red)]">
              <input className="mt-1 size-4 shrink-0 accent-[var(--member-red)]" type="radio" name="checkout-plan" value={option} checked={plan === option} onChange={() => changeOffer(option)} />
              <span className="min-w-0 text-sm"><strong className="block">{MEMBERSHIP_PLANS[option].label}</strong><span className="mt-1 block text-xs text-[var(--member-muted)]">{option === "annual" ? "Pay for the full year upfront." : "Pay your initial year in 12 monthly installments."}</span></span>
            </label>)}
          </fieldset>
          {membershipKind === "couple" && !quote ? <CoupleMembershipApproval enabled={checkoutEnabled} /> : null}
          {!quote ? <>
            <p className="mt-5 text-sm leading-relaxed text-[var(--member-muted)]">Review your offer to see your price, founding eligibility, and initial commitment before authorizing payment.{membershipKind === "couple" ? " Both adults must register and approve their shared membership first." : ""}</p>
            {!streamlinedPayment || error ? <button className="mt-5 min-h-12 border border-white px-6 py-3 text-sm disabled:opacity-50" type="button" disabled={!enabled || !checkoutEnabled || submitting} onClick={prepareOffer}>{submitting ? "Preparing your offer" : offerRetryable ? "Check founding availability again" : streamlinedPayment ? "Try loading payment again" : "Review membership offer"}</button> : <p className="mt-5 text-sm" role="status">Loading your price and payment dates…</p>}
          </> : selectedPrice ? <div className="mt-6 border-t border-[var(--member-rule)] pt-5" aria-live="polite">
            <h4 className="font-semibold">{selectedPrice.tier === "founding_individual" ? "Founding individual membership" : selectedPrice.tier === "couple" ? "Couples membership" : "Individual membership"}</h4>
            <p className="mt-2 text-sm text-[var(--member-muted)]">Your quoted price is held until <time dateTime={quote.expiresAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long" }).format(new Date(quote.expiresAt))}</time>. Review a new offer if you return after that time.</p>
            {selectedPrice.tier === "couple" ? <p className="mt-2 text-sm text-[var(--member-muted)]">For {quote.participants.map(person => person.name).join(" and ")}. Each adult uses their own account.</p> : null}
            {billingSchedule ? <p className="mt-5 text-2xl font-semibold">{selectedAmount} due today, plus applicable tax.</p> : firstChargeDate ? <p className="mt-5 text-2xl font-semibold">$0 today. First charge {firstChargeDate}.</p> : null}
            <p className="mt-4 text-sm leading-relaxed">{billingSchedule ? null : `${selectedAmount} USD ${paymentTiming}, plus applicable tax. `}{plan === "monthly" ? `Initial 12-month commitment: 12 payments of ${selectedAmount}, totaling ${formatMembershipPrice(selectedPrice.initialTermAmount)} before tax. After the first year, renews monthly at ${selectedAmount}.` : `${selectedAmount} pays for the full initial year upfront. Renews annually at ${selectedAmount}, plus applicable tax.`}</p>
            {billingSchedule ? <section className="mt-5 border-y border-[var(--member-rule)] py-5" aria-label="Your Foundations schedule">
              <h3 className="font-semibold">Your first four Foundations calls</h3>
              <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{billingSchedule.callStartsAt.map((call, index) => <li key={call}><span className="text-[var(--member-muted)]">{index + 1}. </span><time dateTime={call}>{new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Denver" }).format(new Date(call))}, {scheduleDate(call)}</time></li>)}</ol>
              <p className="mt-3 text-sm text-[var(--member-muted)]">Calls are normally the first four Thursdays at 3 p.m. Mountain Time, with the holiday dates shown above. Complete payment before {scheduleDate(billingSchedule.cutoffAt)}; at or after that cutoff, review the next month’s cohort.</p>
              <dl className="mt-4 grid gap-3 text-sm">
                <div><dt className="text-[var(--member-muted)]">Service and initial 12-month commitment begin</dt><dd>{scheduleDate(billingSchedule.serviceStartsAt)}</dd></div>
                <div><dt className="text-[var(--member-muted)]">Next {plan === "annual" ? "annual" : "monthly"} charge</dt><dd>{selectedAmount}, plus applicable tax, on {scheduleDate(billingSchedule.nextChargeAt)}</dd></div>
                <div><dt className="text-[var(--member-muted)]">Initial commitment ends</dt><dd>{scheduleDate(billingSchedule.initialTermEndsAt)}</dd></div>
              </dl>
              <p className="mt-4 text-sm leading-relaxed text-[var(--member-muted)]">Today’s payment covers {plan === "monthly" ? "your first month" : "your first year"} of service, through {scheduleDate(billingSchedule.prepaidThrough)}. {plan === "monthly" ? "Eleven further monthly installments complete the initial commitment. " : ""}Your profile opens separately when Ruined releases it.</p>
              <p className="mt-3 text-sm leading-relaxed">Cancel before service begins in <Link className="underline underline-offset-4" href="/my/activate">Membership billing</Link> for a full refund of your initial payment, including tax, with no early-exit fee. Your registration and any reserved founding eligibility remain saved.</p>
            </section> : firstChargeDate ? <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Your initial 12-month term begins {firstChargeDate}. Cancel before the first charge at 12:00 a.m. Mountain Time that day with no fee in <Link className="underline underline-offset-4" href="/my/activate">Membership billing</Link>. After billing begins, the terms below apply.</p> : null}
            <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">{plan === "monthly" ? "Early exit costs the lower of $1,500 or your unpaid remaining first-year installments. This charge replaces those installments. Your paid term remains covered through the period already paid for; profile and program access still follow their opening dates. Turning off renewal alone leaves the initial commitment in place." : "Turning off the next annual renewal has no early-exit charge. Your paid term remains covered through the year already paid for; profile and program access still follow their opening dates."} Manage renewal or early exit in <Link className="underline underline-offset-4" href="/my/activate">Membership billing</Link>. {billingSchedule ? "After service begins, refund requests are reviewed individually; applicable rights remain in place." : "Refund requests are reviewed individually; applicable rights remain in place."}</p>
            {selectedPrice.tier === "founding_individual" ? <p className="mt-3 text-sm text-[var(--member-muted)]">Your founding rate continues while your membership stays active. If you leave after service begins and later rejoin, eligibility is checked again against the current active membership.</p> : null}
            {!clientSecret ? <label className="mt-5 grid grid-cols-[1rem_1fr] items-start gap-3 text-sm leading-relaxed text-[var(--member-muted)]"><input className="mt-1 size-4 accent-[var(--member-red)]" type="checkbox" name="recurring-payment-accepted" checked={recurringPaymentAccepted} disabled={!enabled || submitting || Boolean(lockedPlan)} onChange={async event => { const accepted = event.target.checked; setRecurringPaymentAccepted(accepted); if (streamlinedPayment && accepted) await openCheckout(true); }} /><span>I authorize {selectedAmount} USD {paymentTiming}, {plan === "monthly" ? `${billingSchedule ? "11 further monthly installments" : "the remaining monthly installments"} of my ${formatMembershipPrice(selectedPrice.initialTermAmount)} initial 12-month commitment, and monthly renewals afterward` : `annual renewals of ${selectedAmount}`}, plus applicable tax, under the membership agreement and early-exit terms shown above.{billingSchedule ? ` My service begins ${scheduleDate(billingSchedule.serviceStartsAt)}; my next charge is ${scheduleDate(billingSchedule.nextChargeAt)}. I can cancel before service begins for a full refund in Membership billing.` : firstChargeDate ? " Nothing is charged today. I can cancel before the first charge in Membership billing." : ""}</span></label> : null}
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
          {!clientSecret && quote && (!streamlinedPayment || Boolean(error)) ? (
            <button className="mt-7 min-h-12 w-full border border-white bg-white px-6 py-4 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50" disabled={!enabled || !checkoutEnabled || !publishableKey || !quote || !recurringPaymentAccepted || Boolean(lockedPlan) || submitting} onClick={() => openCheckout()} type="button">{submitting ? testCheckout ? "Preparing test checkout" : "Preparing payment" : checkoutEnabled && publishableKey ? testCheckout ? "Open test checkout" : billingSchedule ? "Pay first period with Stripe" : firstChargeDate ? "Confirm future billing with Stripe" : "Open secure payment" : "Payment not connected"}</button>
          ) : null}
          {streamlinedPayment && !clientSecret && quote ? <p className="mt-4 text-sm" role="status">{submitting ? "Loading secure payment…" : "Accept the payment terms above to enter your card securely. Stripe will show the final total before you pay."}</p> : null}
          {clientSecret && publishableKey ? <EmbeddedCheckout clientSecret={clientSecret} publishableKey={publishableKey} setError={setError} /> : null}
          <p className="mt-4 text-xs leading-relaxed text-[var(--member-muted)]">{testCheckout ? "Test checkout is provided by Stripe. Store purchases remain separate." : "Payment is handled securely by Stripe. Store purchases remain separate."}</p>
        </section>
      ) : null}

    </div>
  );
}
