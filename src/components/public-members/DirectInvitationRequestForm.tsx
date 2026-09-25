"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";
import styles from "./MembershipOverview.module.css";

export default function DirectInvitationRequestForm({ billingPlan, onRequestStateChange, preview = false }: {
  billingPlan: MembershipBillingPlan;
  preview?: boolean;
  onRequestStateChange: (locked: boolean) => void;
}) {
  const id = useId();
  const [name, setName] = useState(""), [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "received">("idle");
  const [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || inFlight.current || state === "received") return;
    const recipientName = name.trim().replace(/\s+/gu, " "), recipientEmail = email.trim().toLowerCase();
    if (!recipientName || !recipientEmail) { setError("Add your name and email to request your invitation."); return; }
    const key = JSON.stringify([recipientName, recipientEmail, billingPlan]);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    inFlight.current = true; setState("pending"); setError(""); onRequestStateChange(true);
    try {
      const response = await fetch("/api/membership/signup/invitation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.current.id, recipientName, recipientEmail, billingPlan }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || "Your request could not be received. Please try again.");
      setState("received");
    } catch (failure) {
      setState("idle"); setError(failure instanceof Error ? failure.message : "Your request could not be received. Please try again."); onRequestStateChange(false);
    } finally { inFlight.current = false; }
  }

  if (state === "received") return <div className={styles.invitationReceived} role="status">
    <h3>Check your email.</h3>
    <p>Your request has been received. Look for your personal invitation from The Ruined Project, including in your spam folder. Open it to verify your email and continue joining.</p>
    <p>Already a member? <Link href="/access">Sign in ↗</Link>. If you need help, <a href="mailto:connect@theruinedproject.com">contact Ruined</a>.</p>
  </div>;

  return <form className={styles.directInvitationForm} aria-label="Request your Ruined invitation" aria-busy={state === "pending"} onSubmit={submit}>
    <fieldset disabled={preview || state === "pending"}>
      <legend className={styles.srOnly}>Your invitation details</legend>
      <label htmlFor={`${id}-name`}>Your name<input id={`${id}-name`} name="recipientName" autoComplete="name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
      <label htmlFor={`${id}-email`}>Your email<input id={`${id}-email`} name="recipientEmail" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <button className={styles.primary} type="submit">{state === "pending" ? "Requesting…" : "Send my invitation"}<span aria-hidden="true">↗</span></button>
    </fieldset>
    {preview ? <p className={styles.signupPreviewNotice}>Preview only. Invitation delivery, account creation, and payments are disabled.</p> : null}
    {error ? <p className={styles.invitationError} role="alert">{error}</p> : null}
    <p className={styles.signupTerms}>Your invitation is valid for 48 hours after it is created. Payment comes after email verification, your profile, and the membership agreement.</p>
  </form>;
}
