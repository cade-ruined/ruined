"use client";

import { useState } from "react";
import MemberSmsConsentDisclosure from "@/components/membership/MemberSmsConsentDisclosure";
import {
  MEMBER_EMAIL_UPDATES_NOTICE,
  MEMBER_SMS_UPDATES_NOTICE,
} from "@/lib/membership/member-communication-preferences-model";

/** Deliberately has no form, submit button, persistence, or network request. */
export default function MemberSmsOptInExample() {
  const [phone, setPhone] = useState("2025550123");
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [smsUpdates, setSmsUpdates] = useState(false);

  return (
    <div className="mt-6 border border-black/20 p-5 sm:p-6">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[var(--color-poster)]">Interactive example · No enrollment</p>
      <p className="mt-3 text-sm leading-relaxed">Try the optional choices below with the example number. This example does not collect or save information, enroll you, or send messages.</p>
      <label className="mt-6 grid gap-2 text-sm" htmlFor="sms-example-mobile">
        <span>Mobile number · Example only</span>
        <input
          autoComplete="off"
          className="min-h-12 w-full rounded-[4px] border border-black/25 bg-transparent px-3 py-3 text-base outline-none focus:border-[var(--color-poster)]"
          id="sms-example-mobile"
          inputMode="tel"
          maxLength={30}
          onChange={event => { setPhone(event.currentTarget.value); setSmsUpdates(false); }}
          type="tel"
          value={phone}
        />
      </label>
      <fieldset className="mt-7 grid gap-3">
        <legend className="mb-4 text-sm font-semibold">Membership updates</legend>
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input checked={emailUpdates} className="mt-1 size-4 shrink-0 accent-current" name="example-email-updates" onChange={event => setEmailUpdates(event.currentTarget.checked)} type="checkbox" />
          <span>{MEMBER_EMAIL_UPDATES_NOTICE}</span>
        </label>
        <div>
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input aria-describedby="sms-example-disclosure" checked={smsUpdates} className="mt-1 size-4 shrink-0 accent-current" disabled={!phone.trim()} name="example-text-updates" onChange={event => setSmsUpdates(event.currentTarget.checked)} type="checkbox" />
            <span>{MEMBER_SMS_UPDATES_NOTICE}</span>
          </label>
          <MemberSmsConsentDisclosure className="mt-1 pl-7 text-xs leading-relaxed" id="sms-example-disclosure" />
        </div>
      </fieldset>
      <p aria-live="polite" className="mt-5 border-t border-black/15 pt-4 text-xs leading-relaxed">{smsUpdates ? "Example selected. No text-message consent has been submitted." : "Text messages are optional and unchecked by default."}</p>
    </div>
  );
}
