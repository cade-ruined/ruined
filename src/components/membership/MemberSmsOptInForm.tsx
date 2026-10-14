"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import PasswordlessAccessForm from "@/components/platform/PasswordlessAccessForm";
import MemberSmsConsentDisclosure from "@/components/membership/MemberSmsConsentDisclosure";
import { MEMBER_COMMUNICATION_NOTICE_VERSION, MEMBER_SMS_UPDATES_NOTICE } from "@/lib/membership/member-communication-preferences-model";
import { mobileToE164 } from "@/lib/membership/phone";

type Snapshot = { phone: string | null; sms: boolean | null; revision: string; noticeVersion: string };
type Phase = "loading" | "signed_out" | "ready" | "unavailable" | "outdated";
const endpoint = "/api/my/sms-preferences";
const buttonClass = "min-h-12 rounded-[4px] bg-[var(--color-faded)] px-5 py-3 text-sm font-semibold text-[var(--color-bone)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-wait disabled:opacity-50";

export default function MemberSmsOptInForm() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phone, setPhone] = useState("");
  const [sms, setSms] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function loadPreferences(preserveDraft = false) {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.status === 401) {
      setSnapshot(null);
      setPhase("signed_out");
      if (preserveDraft) throw new Error("Your account could not be verified. Please sign in again.");
      return;
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Your text preference could not be loaded. Please try again.");
    if (payload.noticeVersion !== MEMBER_COMMUNICATION_NOTICE_VERSION) {
      setSnapshot(null); setPhase("outdated");
      setError("The text-message terms have changed. Reload this page to review the current wording before saving.");
      return false;
    }
    setSnapshot(payload);
    if (!preserveDraft) { setPhone(payload.phone ?? ""); setSms(false); }
    setPhase("ready");
    return true;
  }

  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" }).then(async response => {
      if (!active) return;
      if (response.status === 401) { setPhase("signed_out"); return; }
      const payload = await response.json();
      if (!active) return;
      if (!response.ok) throw new Error(payload.error || "Your text preference could not be loaded. Please try again.");
      if (payload.noticeVersion !== MEMBER_COMMUNICATION_NOTICE_VERSION) {
        setPhase("outdated");
        setError("The text-message terms have changed. Reload this page to review the current wording before saving.");
        return;
      }
      setSnapshot(payload);
      setPhone(payload.phone ?? "");
      setPhase("ready");
    }).catch(() => {
      if (active) { setPhase("unavailable"); setError("Your text preference could not be loaded. Please try again."); }
    });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || phase === "loading" || phase === "unavailable" || phase === "outdated") return;
    setError(null);
    setSaved(null);
    const normalized = mobileToE164(phone, "US");
    if (!normalized) { setError("Enter a valid mobile number. Include the country code for numbers outside the US."); return; }
    if (phase === "signed_out" || !snapshot) { setSignIn(true); return; }
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: normalized, sms, expectedRevision: snapshot.revision,
          noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION, ...(sms ? { smsOptIn: { phone: normalized } } : {}) }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        setSnapshot(null); setPhase("signed_out"); setSignIn(true);
        throw new Error("Your session expired. Verify your email, then save your text preference again.");
      }
      if (response.status === 409) {
        // Refresh the revision without replaying a stale opt-in or withdrawal.
        setSms(false);
        if (await loadPreferences() === false) return;
        throw new Error("Your saved details changed. Review the current number, choose your text preference again, and save.");
      }
      if (!response.ok) throw new Error(payload.error || "Your text preference could not be saved. Please try again.");
      setSnapshot(payload);
      setPhone(payload.phone ?? normalized);
      setSms(false);
      setSaved(payload.sms
        ? "Your text-message consent is saved. Delivery is not currently enabled; membership texts can begin once the program is available."
        : "Your preference is saved. You are not enrolled in Ruined membership texts.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your text preference could not be saved. Please try again.");
    } finally { setPending(false); }
  }

  return <div className="mt-6 border border-black/20 p-5 sm:p-6" id="text-message-signup">
    <p className="text-sm leading-relaxed">For members and people completing registration. Enter your mobile number, choose whether to receive texts, and save. We verify your account by email before recording your choice.</p>
    <form aria-label="Ruined text-message preferences" className="mt-6 grid gap-5" onSubmit={submit}>
      <label className="grid gap-2 text-sm" htmlFor="sms-mobile">
        <span>Mobile number</span>
        <input autoComplete="tel" className="min-h-12 min-w-0 w-full rounded-[4px] border border-black/25 bg-transparent px-3 py-3 text-base outline-none focus:border-[var(--color-poster)]"
          disabled={pending || phase === "loading"} id="sms-mobile" inputMode="tel" maxLength={30} name="phone"
          onChange={event => { const value = event.currentTarget.value; setPhone(value); setSms(false); setSaved(null); setError(null); }}
          required type="tel" value={phone} aria-describedby="sms-phone-help" />
        <span className="text-xs" id="sms-phone-help">Include the country code for numbers outside the US. Saving updates the mobile number on your membership account.</span>
      </label>
      <div>
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input aria-describedby="sms-disclosure" checked={sms} className="mt-1 size-4 shrink-0 accent-current" disabled={pending || phase === "loading"}
            name="sms" onChange={event => { setSms(event.currentTarget.checked); setSaved(null); setError(null); }} type="checkbox" />
          <span>{MEMBER_SMS_UPDATES_NOTICE}</span>
        </label>
        <MemberSmsConsentDisclosure className="mt-2 pl-7 text-xs leading-relaxed" id="sms-disclosure" />
      </div>
      <p className="text-xs leading-relaxed">Select the checkbox to opt in. Leave it unchecked and save to turn membership texts off. Changing your number clears the checkbox and requires a new choice. Your email preferences stay the same.</p>
      {snapshot ? <p className="text-xs">Currently saved: {snapshot.sms ? "text-message consent recorded" : "not enrolled in membership texts"}.</p> : null}
      <button className={buttonClass} disabled={pending || phase === "loading" || phase === "unavailable" || phase === "outdated"} type="submit">
        {pending ? "Saving…" : phase === "loading" ? "Loading preferences…" : phase === "outdated" ? "Reload to review current terms" : phase === "ready" ? "Save text preference" : "Continue to email verification"}
      </button>
      {error ? <p className="text-sm" role="alert">{error}</p> : null}
      {saved ? <p className="text-sm" role="status">{saved}</p> : null}
    </form>
    {phase === "outdated" ? <button className="mt-3 min-h-11 text-sm underline underline-offset-4" type="button" onClick={() => window.location.reload()}>Reload page</button> : null}
    {phase === "unavailable" ? <button className="mt-3 min-h-11 text-sm underline underline-offset-4" type="button" onClick={async () => {
      setError(null); setPhase("loading");
      try { await loadPreferences(); } catch { setPhase("unavailable"); setError("Your text preference could not be loaded. Please try again."); }
    }}>Try again</button> : null}
    {signIn && phase === "signed_out" ? <div className="mt-7 border-t border-black/15 pt-5">
      <h3 className="font-semibold" tabIndex={-1}>Verify your membership email</h3>
      <p className="mt-2 text-sm">Your choice has not been saved yet. Verify the email on your membership account, then select Save text preference.</p>
      <PasswordlessAccessForm enabled returnTo="/my" onAuthenticated={async () => {
        await loadPreferences(true);
        setSignIn(false);
      }} />
      <p className="mt-4 text-sm">New to Ruined? <Link className="underline underline-offset-4" href="/membership#your-invitation">Begin membership registration</Link>, then return here to save your text preference. Texts are optional throughout registration.</p>
    </div> : null}
  </div>;
}
