"use client";

import Link from "next/link";
import { type ClipboardEvent, type FormEvent, useRef, useState } from "react";

import MemberSettingsHeader from "@/components/membership/MemberSettingsHeader";
import MemberPhotoUpload from "@/components/membership/MemberPhotoUpload";
import { SUPPORT_ACTION_CLASS, SUPPORT_FIELD_CLASS, SUPPORT_LABEL_CLASS } from "@/components/support/supportStyles";
import type { MemberProfileSnapshot } from "@/lib/membership/model";
import { MEMBER_TIMEZONES, memberTimezoneLabel } from "@/lib/membership/profile-fields";
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

import styles from "./MemberProfileEditor.module.css";

const fieldClass = `${SUPPORT_FIELD_CLASS} ${styles.field}`;

function savedString(record: Record<string, unknown> | null | undefined, key: string) {
  return typeof record?.[key] === "string" ? record[key] as string : "";
}

function scopeLabel(value: string) {
  return value === "none"
    ? "Keep private"
    : "Share with Circle";
}

export default function MemberProfileEditor({
  initialProfile,
  photoStorageReady,
  writable,
  preview = false,
  timezoneOptions = MEMBER_TIMEZONES,
}: {
  initialProfile: MemberProfileSnapshot;
  photoStorageReady: boolean;
  writable: boolean;
  preview?: boolean;
  timezoneOptions?: string[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const memberTagRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const address = profile.privateProfile.fulfillmentAddress;
  const shirtSize = savedString(profile.privateProfile.apparelSizing, "top");
  const shirtSizes = [...new Set(["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", ...(shirtSize ? [shirtSize] : [])])];
  const initialPhoneCountry = phoneCountryFromProfile(initialProfile.privateProfile.mobile, savedString(initialProfile.privateProfile.fulfillmentAddress, "countryCode"));
  const [phoneCountry, setPhoneCountry] = useState(initialPhoneCountry);
  const [phoneNumber, setPhoneNumber] = useState(() => phoneInputFromProfile(initialProfile.privateProfile.mobile, initialPhoneCountry));
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [memberTag, setMemberTag] = useState(initialProfile.directory.memberTag ?? "");
  const [memberTagError, setMemberTagError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [photoDraft, setPhotoDraft] = useState(false);
  const tagLocked = Boolean(profile.directory.memberTag);
  const phoneChanged = Boolean(profile.privateProfile.mobile) && mobileToE164(phoneNumber, phoneCountry) !== profile.privateProfile.mobile;
  const timezones = [...new Set([...timezoneOptions, profile.directory.timezone ?? "America/Denver"])];

  function changeMemberTag(value: string) {
    if (tagLocked) return;
    setMemberTag(value.trim().replace(/^@/, "").toLowerCase());
    setMemberTagError(null);
    setError(null);
    setSaved(false);
  }

  function pasteMemberTag(event: ClipboardEvent<HTMLInputElement>) {
    if (tagLocked) return;
    const input = event.currentTarget;
    event.preventDefault();
    changeMemberTag(input.value.slice(0, input.selectionStart ?? 0) + event.clipboardData.getData("text") + input.value.slice(input.selectionEnd ?? input.value.length));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || pending || photoPending || photoDraft || conflict) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const tag = profile.directory.memberTag ?? String(form.get("member-tag") ?? "").trim().replace(/^@/, "").toLowerCase();
    if ((tag || profile.directory.memberTag) && !/^[a-z0-9_]{3,24}$/.test(tag)) {
      setMemberTagError("Use 3–24 letters, numbers, or underscores.");
      memberTagRef.current?.focus();
      setPending(false);
      return;
    }
    try {
      const rawMobile = String(form.get("mobile-national") ?? "").trim();
      const country = supportedPhoneCountry(String(form.get("mobile-country") ?? "")) ?? phoneCountry;
      const mobile = rawMobile ? mobileToE164(rawMobile, country) : "";
      if (rawMobile && !mobile) {
        const message = "Enter a complete mobile number for the selected country.";
        setPhoneError(message);
        phoneInputRef.current?.focus();
        throw new Error(message);
      }
      const response = await fetch("/api/my/profile", {
        body: JSON.stringify({
          revision: profile.revision,
          bio: String(form.get("bio") ?? ""),
          buildingNow: String(form.get("building-now") ?? ""),
          directory: {
            emailScope: String(form.get("email-scope") ?? "none"),
            phoneScope: String(form.get("phone-scope") ?? "none"),
          },
          fullName: String(form.get("full-name") ?? ""),
          city: String(form.get("city") ?? ""),
          state: String(form.get("state") ?? ""),
          memberTag: tag,
          timezone: String(form.get("timezone") ?? ""),
          privateProfile: {
            mobile,
            birthDate: String(form.get("birth-date") ?? ""),
            apparelTopSize: String(form.get("apparel-size") ?? ""),
            shippingAddress: {
              addressLine1: String(form.get("shipping-address-line-1") ?? ""),
              addressLine2: String(form.get("shipping-address-line-2") ?? ""),
              city: String(form.get("shipping-city") ?? ""),
              region: String(form.get("shipping-region") ?? ""),
              postalCode: String(form.get("shipping-postal-code") ?? ""),
              countryCode: String(form.get("shipping-country-code") ?? ""),
            },
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        code?: string;
        error?: string;
        profile?: MemberProfileSnapshot;
      };
      if (!response.ok || !payload.profile) {
        if (payload.code === "member_tag_unavailable") {
          setMemberTagError(payload.error || "That member tag is already taken. Choose another.");
          memberTagRef.current?.focus();
        } else if (response.status === 409) setConflict(true);
        throw new Error(payload.error || "Your profile could not be saved.");
      }
      setProfile(payload.profile);
      setMemberTag(payload.profile.directory.memberTag ?? "");
      setMemberTagError(null);
      setPhoneError(null);
      const savedCountry = phoneCountryFromProfile(payload.profile.privateProfile.mobile, savedString(payload.profile.privateProfile.fulfillmentAddress, "countryCode"));
      setPhoneCountry(savedCountry);
      setPhoneNumber(phoneInputFromProfile(payload.profile.privateProfile.mobile, savedCountry));
      setSaved(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Your profile could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={`member-journey-page member-profile-editor mx-auto max-w-[78rem] pb-24 font-[var(--font-body)] text-[var(--member-ink)] ${styles.editor}`}>
      <MemberSettingsHeader title="Edit profile" /><p className={styles.intro}>Your name, @tag, bio, member number, and Timeline appear on your public profile. Your Journal is private.</p>
      {!writable ? <p className="mb-6 rounded-[4px] bg-[var(--member-soft)] p-4 text-base leading-relaxed" role="status">{preview ? "Preview only. Profile changes are not saved." : profile.access.reason ?? "Your profile is read only. Contact support if you need to update it."} {!preview ? <Link className="underline underline-offset-4" href="/my/support">Get help</Link> : null}</p> : null}

      <form onSubmit={save} onChange={() => setSaved(false)}>
        <fieldset className="m-0 min-w-0 space-y-8 border-0 p-0" disabled={!writable || pending || photoPending}>
        <legend className="sr-only">Profile details and contact sharing</legend>
        <section className="grid items-start gap-6 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
          <div className="max-w-64">
            <MemberPhotoUpload
              avatarUrl={profile.directory.avatarUrl}
              available={photoStorageReady}
              enabled={writable && !pending}
              onBusyChange={setPhotoPending}
              onDraftChange={setPhotoDraft}
              onChange={(avatarUrl) => setProfile((current) => ({ ...current, directory: { ...current.directory, avatarUrl } }))}
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <label className={SUPPORT_LABEL_CLASS}>
              Full name
              <input className={fieldClass} defaultValue={profile.directory.fullName || profile.privateProfile.legalName || profile.directory.displayName} key={profile.directory.fullName || profile.directory.displayName} maxLength={120} name="full-name" autoComplete="name" required />
            </label>
            <label className={SUPPORT_LABEL_CLASS} htmlFor="profile-member-tag">
              Member tag
              <span className="relative isolate mt-2 block">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center [font-family:var(--font-body)] text-base text-[var(--member-muted)]">@</span>
                <input
                  aria-describedby="profile-member-tag-help profile-member-tag-error"
                  aria-invalid={Boolean(memberTagError)}
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  className={`${fieldClass} !mt-0 !pl-8`}
                  id="profile-member-tag"
                  maxLength={24}
                  minLength={3}
                  name="member-tag"
                  onChange={(event) => changeMemberTag(event.currentTarget.value)}
                  onPaste={pasteMemberTag}
                  onInvalid={() => setMemberTagError("Use 3–24 letters, numbers, or underscores.")}
                  pattern="[a-z0-9_]{3,24}"
                  readOnly={tagLocked}
                  ref={memberTagRef}
                  required={Boolean(profile.directory.memberTag)}
                  spellCheck={false}
                  title="Use 3–24 letters, numbers, or underscores."
                  value={memberTag}
                />
              </span>
              <span className="mt-2 block [font-family:var(--font-body)] font-normal normal-case tracking-normal text-xs leading-relaxed text-[var(--member-muted)]" id="profile-member-tag-help">{tagLocked ? "Your member tag is locked. It stays with you." : "Use 3–24 letters, numbers, or underscores. Your tag is permanent once saved."}</span>
              <span className="mt-2 block [font-family:var(--font-body)] font-normal normal-case tracking-normal text-xs leading-relaxed text-[var(--member-red)]" id="profile-member-tag-error" role="status">{memberTagError}</span>
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              City
              <input className={fieldClass} defaultValue={profile.directory.city ?? ""} maxLength={100} name="city" autoComplete="address-level2" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              State
              <input className={fieldClass} defaultValue={profile.directory.state ?? ""} maxLength={100} name="state" autoComplete="address-level1" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Timezone
              <select className={fieldClass} defaultValue={profile.directory.timezone ?? "America/Denver"} name="timezone">{timezones.map(zone => <option key={zone} value={zone}>{memberTimezoneLabel(zone)}</option>)}</select>
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              What are you building now?
              <textarea className={fieldClass} defaultValue={profile.directory.buildingNow ?? ""} maxLength={500} name="building-now" rows={4} />
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              Bio
              <textarea className={fieldClass} defaultValue={profile.directory.bio ?? ""} maxLength={1200} name="bio" rows={5} />
            </label>

          </div>
        </section>

        <section className="grid gap-6 border-t border-[var(--member-rule)] pt-8 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
          <div>
            <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Contact sharing</h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--member-muted)]">Choose whether your Circle can see your email and phone. These never appear on your public profile.</p>
          </div>
          <div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className={SUPPORT_LABEL_CLASS}>
                Email sharing
                <select className={fieldClass} defaultValue={profile.preferences.emailScope} name="email-scope">
                  {["none", "circle"].map((scope) => <option key={scope} value={scope}>{scopeLabel(scope)}</option>)}
                </select>
              </label>
              <label className={SUPPORT_LABEL_CLASS}>
                Phone sharing
                <select className={fieldClass} defaultValue={profile.preferences.phoneScope} name="phone-scope">
                  {["none", "circle"].map((scope) => <option key={scope} value={scope}>{scopeLabel(scope)}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="grid gap-6 border-t border-[var(--member-rule)] pt-8 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10" aria-labelledby="membership-details-heading">
          <div>
            <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"} id="membership-details-heading">Membership details</h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--member-muted)]">Your shipping address, birth date, and shirt size stay private. Phone sharing follows your choice above.</p>
          </div>
          <div className="grid min-w-0 gap-6 sm:grid-cols-2">
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className={SUPPORT_LABEL_CLASS}>Phone</legend>
              <div className="mt-2 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2">
                <label className="sr-only" htmlFor="profile-mobile-country">Phone country and calling code</label>
                <select
                  className={`${fieldClass} !mt-0`}
                  id="profile-mobile-country"
                  name="mobile-country"
                  value={phoneCountry}
                  onChange={event => {
                    const nextCountry = supportedPhoneCountry(event.currentTarget.value);
                    if (!nextCountry) return;
                    setPhoneNumber(phoneInputForCountry(phoneNumber, phoneCountry, nextCountry));
                    setPhoneCountry(nextCountry);
                    setPhoneError(null);
                    setError(null);
                  }}
                >
                  {PHONE_COUNTRY_OPTIONS.map(country => <option key={country.code} value={country.code}>{country.callingCode} · {country.name}</option>)}
                </select>
                <label className="sr-only" htmlFor="profile-mobile-number">Phone number</label>
                <input
                  aria-describedby="profile-phone-error profile-phone-change"
                  aria-invalid={Boolean(phoneError)}
                  autoComplete="tel"
                  className={`${fieldClass} !mt-0 min-w-0`}
                  id="profile-mobile-number"
                  inputMode="tel"
                  maxLength={40}
                  name="mobile-national"
                  onInput={event => {
                    const formatted = formatPhoneInput(event.currentTarget.value, phoneCountry);
                    setPhoneNumber(formatted);
                    setPhoneCountry(phoneCountryFromInput(formatted, phoneCountry));
                    setPhoneError(null);
                    setError(null);
                  }}
                  placeholder="Phone number"
                  ref={phoneInputRef}
                  type="tel"
                  value={phoneNumber}
                />
              </div>
              {phoneError ? <p className="mt-2 text-sm text-[var(--member-red)]" id="profile-phone-error" role="status">{phoneError}</p> : null}
              {phoneChanged ? <p className="mt-2 text-sm text-[var(--member-muted)]" id="profile-phone-change">Changing your number turns off text reminders.</p> : null}
            </fieldset>
            <label className={SUPPORT_LABEL_CLASS}>
              Birth date
              <input autoComplete="bday" className={fieldClass} defaultValue={profile.privateProfile.birthDate ?? ""} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} name="birth-date" type="date" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Shirt size
              <select className={fieldClass} defaultValue={shirtSize} name="apparel-size">
                <option value="">Select size</option>
                {shirtSizes.map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              Shipping address
              <input autoComplete="shipping address-line1" className={fieldClass} defaultValue={savedString(address, "addressLine1")} maxLength={160} name="shipping-address-line-1" />
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              Apartment, suite, etc.
              <input autoComplete="shipping address-line2" className={fieldClass} defaultValue={savedString(address, "addressLine2")} maxLength={160} name="shipping-address-line-2" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Shipping city
              <input autoComplete="shipping address-level2" className={fieldClass} defaultValue={savedString(address, "city")} maxLength={100} name="shipping-city" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Shipping state or region
              <input autoComplete="shipping address-level1" className={fieldClass} defaultValue={savedString(address, "region")} maxLength={100} name="shipping-region" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Postal code
              <input autoComplete="shipping postal-code" className={fieldClass} defaultValue={savedString(address, "postalCode")} maxLength={24} name="shipping-postal-code" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Shipping country
              <select autoComplete="shipping country" className={fieldClass} defaultValue={supportedShippingCountry(savedString(address, "countryCode")) ?? "US"} name="shipping-country-code">
                {SHIPPING_COUNTRY_OPTIONS.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>
            </label>
          </div>
        </section>

        </fieldset>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-5">
          <div>
            {error ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 font-[var(--font-body)] text-sm text-[var(--member-muted)]">{error}</p> : null}
            {conflict ? <p className="mt-3 text-sm">Reload to review the latest profile. This discards unsaved edits. <button type="button" className="underline underline-offset-4" onClick={() => window.location.reload()}>Reload profile</button></p> : null}
            {saved ? <p aria-live="polite" className="font-[var(--font-body)] text-sm text-[var(--member-muted)]">Profile saved.</p> : null}
            {photoDraft ? <p className="mt-3 text-sm" role="status">Use your photo or cancel the crop before saving your profile.</p> : null}
          </div>
          <button className={SUPPORT_ACTION_CLASS} disabled={!writable || pending || photoPending || photoDraft || conflict} type="submit">{pending ? "Saving…" : writable ? "Save profile" : "Read only"}</button>
        </div>
      </form>

      <p className="mt-8 text-sm text-[var(--member-muted)]">Your card uses your full name. Invite someone through <Link className="underline underline-offset-4" href="/my/invitation">My Invitations</Link>.</p>
    </main>
  );
}
