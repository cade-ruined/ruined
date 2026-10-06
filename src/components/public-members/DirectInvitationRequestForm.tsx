"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";
import styles from "./MembershipOverview.module.css";

type SignupInput = { requestId: string; recipientName: string; recipientEmail: string; billingPlan: MembershipBillingPlan };
type SignupResponse = { ok?: boolean; requestId?: string; error?: string; redirectTo?: string };
const normalizeName = (value: string) => value.trim().replace(/\s+/gu, " ");
const codePattern = /^[0-9]{6,10}$/;

function memberDestination(value: unknown): string | null {
  if (value === "/ops" || value === "/membership#your-invitation") return value;
  if (typeof value !== "string" || !/^\/my(?:\/|\?|#|$)/.test(value) || /[\\\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const destination = new URL(value, window.location.origin);
    if (destination.origin !== window.location.origin || !/^\/my(?:\/|$)/.test(destination.pathname)) return null;
    return destination.pathname + destination.search + destination.hash;
  } catch { return null; }
}

export default function DirectInvitationRequestForm({ billingPlan, onRequestStateChange, onRecipientNameChange, preview = false, paymentSetupOnly = false, registrationOnly = false, prepaymentRequired = false, compact = false }: {
  billingPlan: MembershipBillingPlan;
  preview?: boolean;
  paymentSetupOnly?: boolean;
  registrationOnly?: boolean; prepaymentRequired?: boolean;
  compact?: boolean;
  onRequestStateChange: (locked: boolean) => void;
  onRecipientNameChange?: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(""), [email, setEmail] = useState("");
  const [stage, setStage] = useState<"details" | "code">("details");
  const [pending, setPending] = useState<"sending" | "verifying" | null>(null);
  const [code, setCode] = useState(""), [verificationEmail, setVerificationEmail] = useState("");
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0), [now, setNow] = useState(() => Date.now());
  const request = useRef<{ key: string; input: SignupInput } | null>(null);
  const lastRequestedKey = useRef<string | null>(null);
  const inFlight = useRef(false), returnToEmail = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const emailField = useRef<HTMLInputElement>(null), codeField = useRef<HTMLInputElement>(null);
  const resendDelay = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (stage !== "code" || resendDelay <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [stage, resendDelay, resendAt]);
  useEffect(() => {
    if (pending) return;
    if (stage === "code") codeField.current?.focus();
    else if (returnToEmail.current) { emailField.current?.focus(); returnToEmail.current = false; }
  }, [stage, pending]);

  async function sendCode(resend = false) {
    if (inFlight.current || (resend && (stage !== "code" || Date.now() < resendAt))) return;
    const recipientName = normalizeName(name), recipientEmail = email.trim().toLowerCase();
    if (!recipientName || !recipientEmail) { setError("Add your name and email to continue."); return; }
    const key = JSON.stringify([recipientName, recipientEmail, billingPlan]);
    if (!resend && lastRequestedKey.current === key && Date.now() < resendAt) {
      setStage("code"); setNow(Date.now()); setError(""); onRequestStateChange(true);
      return;
    }
    if (preview) {
      setVerificationEmail(recipientEmail); setCode(""); setError(""); setStage("code");
      const current = Date.now(); setResendAt(current + 60_000); setNow(current);
      lastRequestedKey.current = key; onRequestStateChange(true);
      return;
    }
    if (!resend && request.current?.key !== key) request.current = {
      key, input: { requestId: crypto.randomUUID(), recipientName, recipientEmail, billingPlan },
    };
    const currentRequest = request.current;
    if (!currentRequest) return;
    inFlight.current = true; setPending("sending"); setError(""); onRequestStateChange(true);
    const attempt = new AbortController(); controller.current = attempt;
    try {
      const response = await fetch("/api/membership/signup/start", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: attempt.signal,
        body: JSON.stringify(currentRequest.input),
      });
      const result = await response.json().catch(() => null) as SignupResponse | null;
      if (attempt.signal.aborted) return;
      if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "A code could not be requested. Please try again.");
      const current = Date.now();
      lastRequestedKey.current = currentRequest.key;
      setVerificationEmail(currentRequest.input.recipientEmail); setCode(""); setStage("code");
      setResendAt(current + 60_000); setNow(current);
    } catch (failure) {
      if (attempt.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "A code could not be requested. Please try again.");
      if (!resend) onRequestStateChange(false);
    } finally {
      inFlight.current = false;
      if (!attempt.signal.aborted) setPending(null);
    }
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage !== "details") return;
    await sendCode();
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || stage !== "code") return;
    if (preview) { setError("Preview only. No code was sent and verification cannot create an account here."); return; }
    if (!codePattern.test(code)) { setError("Enter the 6–10 digit code from your email."); codeField.current?.focus(); return; }
    inFlight.current = true; setPending("verifying"); setError("");
    const attempt = new AbortController(); controller.current = attempt;
    let navigating = false;
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: attempt.signal,
        body: JSON.stringify({ email: verificationEmail, token: code, directSignup: true }),
      });
      const result = await response.json().catch(() => null) as SignupResponse | null;
      if (attempt.signal.aborted) return;
      const destination = response.ok ? memberDestination(result?.redirectTo) : null;
      if (!destination) throw new Error(typeof result?.error === "string" ? result.error : "That code could not be verified. Try again or request a new code.");
      window.location.assign(destination);
      navigating = true;
    } catch (failure) {
      if (!attempt.signal.aborted) setError(failure instanceof Error ? failure.message : "That code could not be verified. Please try again.");
    } finally {
      if (!navigating) {
        inFlight.current = false;
        if (!attempt.signal.aborted) setPending(null);
      }
    }
  }

  function changeEmail() {
    if (inFlight.current) return;
    returnToEmail.current = true;
    setStage("details"); setCode(""); setError(""); onRequestStateChange(false);
  }

  if (stage === "code") return <div className={styles.invitationVerification}>
    <h3>Check your email.</h3>
    <p id={`${id}-code-help`} className={styles.invitationCodeStatus} role="status">{preview ? <>Preview for <strong>{verificationEmail}</strong>. No code was sent and no account was created.</> : <>Look for a verification code at <strong>{verificationEmail}</strong>. {registrationOnly ? "Enter it here to continue registration." : "Enter it here to continue to your profile."}</>}</p>
    <form className={styles.directInvitationForm} aria-label="Verify your email" aria-busy={Boolean(pending)} onSubmit={verifyCode}>
      <fieldset disabled={Boolean(pending)}>
        <legend className={styles.srOnly}>Email verification</legend>
        <label htmlFor={`${id}-code`}>Email code<input ref={codeField} id={`${id}-code`} name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required aria-describedby={`${id}-code-help`} value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, "").slice(0, 10)); setError(""); }} /></label>
        <button className={styles.primary} type="submit">{pending === "verifying" ? "Verifying…" : preview ? "Preview verification" : "Verify & continue"}<span aria-hidden="true">↗</span></button>
      </fieldset>
      {error ? <p className={styles.invitationError} role="alert">{error}</p> : null}
    </form>
    <div className={styles.invitationVerificationActions}>
      <button type="button" className={styles.invitationEditDetails} disabled={Boolean(pending)} onClick={changeEmail}>Change email</button>
      <button type="button" className={styles.invitationEditDetails} disabled={Boolean(pending) || resendDelay > 0} onClick={() => sendCode(true)}>{pending === "sending" ? "Requesting code…" : resendDelay > 0 ? `Send again in ${resendDelay}s` : "Send a new code"}</button>
    </div>
    {!preview ? <p className={styles.signupTerms}>Not seeing it? Check spam or <a href={`mailto:connect@theruinedproject.com?subject=${encodeURIComponent("Signup verification help")}&body=${encodeURIComponent(`I cannot receive my signup verification code. Request reference: ${request.current?.input.requestId ?? "not available"}.`)}`}>get help</a>. Already a member? <Link href="/access">Sign in ↗</Link></p> : null}
  </div>;

  return <form className={styles.directInvitationForm} aria-label="Start your Ruined registration" aria-busy={Boolean(pending)} onSubmit={submitDetails}>
    <fieldset disabled={Boolean(pending)}>
      <legend className={styles.srOnly}>Your invitation details</legend>
      <label htmlFor={`${id}-name`}>Your name<input id={`${id}-name`} name="recipientName" autoComplete="name" required maxLength={100} value={name} onChange={event => { setName(event.target.value); onRecipientNameChange?.(normalizeName(event.target.value)); }} /></label>
      <label htmlFor={`${id}-email`}>Your email<input ref={emailField} id={`${id}-email`} name="recipientEmail" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <button className={styles.primary} type="submit">{pending === "sending" ? "Requesting code…" : preview ? "Preview next step" : "Create my invitation"}<span aria-hidden="true">↗</span></button>
    </fieldset>
    {preview ? <p className={styles.signupPreviewNotice}>Preview only. No email, account, or payment will be created.</p> : null}
    {error ? <p className={styles.invitationError} role="alert">{error}</p> : null}
    <p className={styles.signupTerms}>{prepaymentRequired ? "Payment follows email verification, your information, and your agreement. Review your exact price and dates before paying. Payment completes registration; your profile opens later by email." : registrationOnly ? "$0 today. Saving a card completes registration and does not authorize a charge. Profile access follows by email." : compact ? paymentSetupOnly ? "No payment now. Optional card saving does not authorize a charge." : "Review your offer and agreement before paying." : paymentSetupOnly ? "Saving a payment method is optional. It does not start membership or authorize a charge." : "Payment follows email verification, your profile, and the membership agreement."}</p>
  </form>;
}
