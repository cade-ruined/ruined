"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { memberInvitationDeadline, memberInvitationExpired } from "@/lib/membership/invitation-expiry";
import { complimentaryMembershipDeadline } from "@/lib/membership/personal-invitation-presentation";
import { useInvitationExpired } from "./use-invitation-expiry";
import styles from "./MemberInvitation.module.css";

type AuthResponse = { error?: string; redirectTo?: string; requestId?: string };

export default function PersonalInvitationAcceptance({ invitationToken, recipientName, inviterName, expiresAt, membershipType = "standard", complimentaryEndsAt = null, invitationSource = "member", preview = false }: {
  invitationToken?: string;
  recipientName: string;
  inviterName: string;
  expiresAt: string | null;
  membershipType?: "standard" | "complimentary";
  complimentaryEndsAt?: string | null;
  invitationSource?: "member" | "ruined_direct";
  preview?: boolean;
}) {
  const expired = useInvitationExpired(expiresAt);
  const direct = invitationSource === "ruined_direct";
  const sender = direct ? "The Ruined Project" : inviterName;
  const expiryMessage = direct ? "This invitation has expired. Request a new invitation to continue." : `This invitation has expired. Ask ${sender} for a new one.`;
  const [email, setEmail] = useState(""), [code, setCode] = useState("");
  const [requested, setRequested] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [requestId, setRequestId] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0), [now, setNow] = useState(() => Date.now());
  const writing = useRef(false);
  const resendDelay = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const disabled = preview || expired || !invitationToken || pending;

  useEffect(() => {
    if (resendDelay <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [resendDelay, resendAt]);

  function unavailable() {
    if (preview || !invitationToken || writing.current) return true;
    if (memberInvitationExpired(expiresAt)) {
      setError(expiryMessage);
      return true;
    }
    return false;
  }

  async function sendCode() {
    if (unavailable() || Date.now() < resendAt) return;
    writing.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), invitationToken }),
      });
      const payload = await response.json() as AuthResponse;
      if (!response.ok) throw new Error(payload.error || "A code could not be requested. Please try again.");
      const current = Date.now();
      setRequestId(payload.requestId ?? null); setRequested(true); setCode("");
      setResendAt(current + 60_000); setNow(current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "A code could not be requested. Please try again.");
    } finally { writing.current = false; setPending(false); }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCode();
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable()) return;
    writing.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), token: code, invitationToken }),
      });
      const payload = await response.json() as AuthResponse;
      if (!response.ok || !payload.redirectTo || !/^\/my(?:\/|\?|$)/.test(payload.redirectTo)) {
        throw new Error(payload.error || "That code could not be verified. Please try again.");
      }
      window.location.assign(payload.redirectTo);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That code could not be verified. Please try again.");
      writing.current = false; setPending(false);
    }
  }

  return <section id="accept-invitation" className={styles.panel} aria-labelledby="invitation-join-title">
    <span id="join-ruined" aria-hidden="true" />
    <p className={styles.eyebrow}>{direct ? "Ruined Direct / " : ""}For {recipientName}</p>
    <h2 id="invitation-join-title">{requested ? "Verify your email." : "Accept your invitation."}</h2>
    <p>{direct ? "Your personal invitation from The Ruined Project begins here. Verify your email, then complete your profile, membership agreement, and payment." : <>Your invitation from {sender} is your approval to join. Verify your email, then complete your profile and membership.</>}</p>
    {membershipType === "complimentary" ? <p className={styles.complimentaryNotice}><strong>Complimentary membership.</strong> {complimentaryEndsAt ? <>No payment is needed through <time dateTime={complimentaryEndsAt}>{complimentaryMembershipDeadline(complimentaryEndsAt)}</time>.</> : "No payment is needed. Your complimentary membership is ongoing."} You’ll still complete your profile and accept the membership agreement.</p> : null}
    {expired ? <p role="status">{expiryMessage}{direct ? <> <Link href="/signup">Request a new invitation ↗</Link></> : null}</p> : <p className={styles.note}>Accept by <time dateTime={expiresAt!}>{memberInvitationDeadline(expiresAt)}</time>.</p>}
    <form className={styles.form} onSubmit={requested ? verifyCode : submitEmail} aria-label={requested ? "Verify invitation email" : "Accept personal invitation"} aria-busy={pending}>
      {requested ? <>
        <p className={styles.acceptanceStatus} role="status">Request received for <strong>{email.trim().toLowerCase()}</strong>. If it matches this invitation, check your inbox and spam folder for the newest code. If the email contains a confirmation link instead, follow it, then return here to request a code.</p>
        <label className={`${styles.field} ${styles.codeField}`} htmlFor="invitation-access-code">Email verification code<input id="invitation-access-code" name="token" autoComplete="one-time-code" autoFocus inputMode="numeric" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required disabled={disabled} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label>
      </> : <label className={styles.field} htmlFor="invitation-email">Your email<input id="invitation-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={254} required value={email} placeholder="you@example.com" disabled={disabled} aria-describedby="invitation-email-note" onChange={event => { setEmail(event.target.value); setError(""); }} /><span id="invitation-email-note" className={styles.note}>Use the email address this invitation was sent to.</span></label>}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={`${styles.enable} ${styles.acceptanceButton}`} type="submit" disabled={disabled || (!requested && resendDelay > 0)}>{pending ? requested ? "Verifying…" : "Sending code…" : requested ? "Verify & continue" : resendDelay > 0 ? `Try again in ${resendDelay}s` : "Accept invitation"}<span aria-hidden="true">↗</span></button>
      {requested ? <div className={styles.recordActions}>
        <button type="button" disabled={disabled} onClick={() => { setRequested(false); setCode(""); setError(""); }}>Use another email</button>
        <button type="button" disabled={disabled || resendDelay > 0} onClick={() => void sendCode()}>{resendDelay > 0 ? `Send again in ${resendDelay}s` : "Send a new code"}</button>
      </div> : null}
    </form>
    {preview ? <p className={styles.note}>Preview only. Acceptance and email delivery are disabled.</p> : requested ? <p className={styles.note}>Still no code? <a href={`mailto:connect@theruinedproject.com?subject=${encodeURIComponent("Invitation help")}&body=${encodeURIComponent(`I could not receive an invitation verification code. Request reference: ${requestId ?? "not available"}.`)}`}>Get help</a>.{requestId ? <> Request reference: {requestId}.</> : null}</p> : <p className={styles.note}>We’ll send a verification code to confirm it’s you.</p>}
  </section>;
}
