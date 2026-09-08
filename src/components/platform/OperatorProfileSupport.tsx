"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import {
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
  OPERATOR_PRIMARY_ACTION_CLASS,
} from "@/components/platform/operatorStyles";
import { SHIPPING_COUNTRY_OPTIONS } from "@/lib/membership/phone";
import type { OpsMemberProfileSupport } from "@/lib/platform/ops-profile-repository";

const CORRECTION_FIELDS = [
  ["displayName", "Display name"],
  ["preferredName", "Preferred name"],
  ["legalName", "Full name"],
  ["mobile", "Mobile"],
  ["location", "Location"],
  ["timezone", "Timezone"],
  ["bio", "Short bio"],
  ["buildingNow", "Building now"],
  ["addressLine1", "Shipping address"],
  ["addressLine2", "Address line 2"],
  ["city", "City"],
  ["region", "State / region"],
  ["postalCode", "Postal code"],
  ["countryCode", "Country"],
  ["apparelTopSize", "Top size"],
  ["accessibilityNotes", "Accessibility support"],
] as const;

type CorrectionField = (typeof CORRECTION_FIELDS)[number][0];

const MULTILINE_FIELDS = new Set<CorrectionField>([
  "accessibilityNotes",
  "bio",
  "buildingNow",
]);

const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];

function profileValues(profile: OpsMemberProfileSupport): Record<CorrectionField, string> {
  return {
    accessibilityNotes: profile.accessibilityNotes ?? "",
    addressLine1: profile.address?.addressLine1 ?? "",
    addressLine2: profile.address?.addressLine2 ?? "",
    apparelTopSize: profile.apparelTopSize ?? "",
    bio: profile.bio ?? "",
    buildingNow: profile.buildingNow ?? "",
    city: profile.address?.city ?? "",
    countryCode: profile.address?.countryCode ?? "",
    displayName: profile.displayName,
    legalName: profile.legalName ?? "",
    location: profile.location ?? "",
    mobile: profile.mobile ?? "",
    postalCode: profile.address?.postalCode ?? "",
    preferredName: profile.preferredName,
    region: profile.address?.region ?? "",
    timezone: profile.timezone ?? "",
  };
}

function profileAddress(profile: OpsMemberProfileSupport): string {
  return [
    profile.address?.addressLine1,
    profile.address?.addressLine2,
    profile.address?.city,
    profile.address?.region,
    profile.address?.postalCode,
    profile.address?.countryCode,
  ].filter(Boolean).join(", ") || "Not recorded";
}

export default function OperatorProfileSupport({
  memberId,
  profile,
  preview = false,
}: {
  memberId: string;
  profile: OpsMemberProfileSupport;
  preview?: boolean;
}) {
  const router = useRouter();
  const [field, setField] = useState<CorrectionField>("preferredName");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const values = profileValues(profile);
  const fieldLabel = CORRECTION_FIELDS.find(([value]) => value === field)?.[1] ?? "Detail";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) { setMessage("Preview — profile details are not changed."); return; }
    setSubmitting(true);
    setMessage("");
    setFailed(false);
    const data = new FormData(event.currentTarget);
    const nextValue = String(data.get("value") ?? "").trim();
    if (nextValue === values[field]) {
      setMessage("Make a profile change before saving.");
      setSubmitting(false);
      return;
    }
    const changes = Object.fromEntries([
      [field, field === "countryCode" ? nextValue.toUpperCase() : nextValue],
    ]);
    try {
      const response = await fetch(`/api/ops/members/${memberId}/profile`, {
        body: JSON.stringify({
          ...changes,
          expectedVersion: profile.version,
          reason: String(data.get("reason") ?? ""),
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "The profile could not be updated.");
      setMessage(`${fieldLabel} corrected and recorded.`);
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "The profile update could not be confirmed. Your correction is still here.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="profile-support-heading" className="mt-3 scroll-mt-36 rounded-[4px] bg-black/[0.025]" id="profile-support">
      <header className="px-5 py-5 sm:px-6">
        <h3 className="ui-heading text-xl font-semibold" id="profile-support-heading">Profile support</h3>
        <p className="mt-2 text-sm text-black/60">Correct one verified detail and record why. The member still controls directory sharing.</p>
        {preview ? <p className="mt-2 text-sm text-black/60">Preview — profile details are not changed.</p> : null}
      </header>
      <div className="px-5 pb-6 sm:px-6">
        <dl className="grid gap-3 rounded-[4px] bg-black/[0.035] p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Preferred name", profile.preferredName],
            ["Mobile", profile.mobile ?? "Not recorded"],
            ["Location", profile.location ?? "Not recorded"],
            ["Shipping", profileAddress(profile)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-black/40">{label}</dt>
              <dd className="mt-1 break-words text-black/68">{value}</dd>
            </div>
          ))}
        </dl>

        <form className="mt-6" onSubmit={submit}>
          <fieldset className="grid gap-5 sm:grid-cols-2" disabled={submitting}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Detail to correct</span>
            <select
              className={OPERATOR_FIELD_CLASS}
              name="field"
              onChange={(event) => setField(event.currentTarget.value as CorrectionField)}
              value={field}
            >
              {CORRECTION_FIELDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>

          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Correct value</span>
            {field === "countryCode" ? (
              <select className={OPERATOR_FIELD_CLASS} defaultValue={values[field] || "US"} key={field} name="value">
                {SHIPPING_COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>
            ) : field === "apparelTopSize" ? (
              <select className={OPERATOR_FIELD_CLASS} defaultValue={values[field]} key={field} name="value">
                <option value="">Not recorded</option>
                {values[field] && !APPAREL_SIZES.includes(values[field]) ? <option value={values[field]}>{values[field]}</option> : null}
                {APPAREL_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            ) : MULTILINE_FIELDS.has(field) ? (
              <textarea className={`${OPERATOR_FIELD_CLASS} min-h-28 resize-y`} defaultValue={values[field]} key={field} maxLength={2000} name="value" />
            ) : (
              <input
                className={OPERATOR_FIELD_CLASS}
                defaultValue={values[field]}
                key={field}
                maxLength={field === "mobile" ? 40 : 180}
                name="value"
                placeholder={field === "mobile" ? "+1 801 555 0123" : undefined}
                required={field === "displayName" || field === "preferredName"}
                type={field === "mobile" ? "tel" : "text"}
              />
            )}
          </label>

          <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-2`}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Why this correction is needed</span>
            <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} maxLength={1000} minLength={3} name="reason" required />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2">
            <div className={`text-sm ${failed ? "text-[var(--color-poster)]" : "text-black/60"}`} role={failed ? "alert" : "status"}>
              <p>{message}</p>
              {failed ? <button className="mt-2 min-h-11 underline underline-offset-4" onClick={() => router.refresh()} type="button">Reload saved profile before retrying</button> : null}
            </div>
            <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={preview || submitting} type="submit">
              {submitting ? "Saving" : `Correct ${fieldLabel}`}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </section>
  );
}
