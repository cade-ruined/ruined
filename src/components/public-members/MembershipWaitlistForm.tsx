"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";

import styles from "./MembershipWaitlistForm.module.css";

const SEND_ERROR = "Your details didn’t send. Please try again.";

export default function MembershipWaitlistForm({ tone = "dark" }: { tone?: "dark" | "paper" } = {}) {
  const fieldId = useId();
  const submitting = useRef(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || state === "sent") return;

    const form = event.currentTarget;
    const values = new FormData(form);
    submitting.current = true;
    setState("sending");
    setError("");

    try {
      const response = await fetch("/api/members/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(values.get("name") ?? ""),
          email: String(values.get("email") ?? ""),
          phone: String(values.get("phone") ?? ""),
          website: String(values.get("website") ?? ""),
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("ok" in result) || result.ok !== true) {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
          ? result.error
          : SEND_ERROR;
        setError(message || SEND_ERROR);
        setState("error");
        return;
      }

      form.reset();
      setState("sent");
    } catch {
      setError(SEND_ERROR);
      setState("error");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form aria-label="Membership waitlist" aria-busy={state === "sending"} className={`${styles.form} ${tone === "paper" ? styles.paper : ""}`} onSubmit={submit}>
      {state !== "sent" && (
        <>
          <div aria-hidden="true" className={styles.honeypot}>
            <label htmlFor={`${fieldId}-website`}>Website</label>
            <input autoComplete="off" id={`${fieldId}-website`} name="website" tabIndex={-1} type="text" />
          </div>
          <fieldset className={styles.fields} disabled={state === "sending"}>
            <legend className={styles.visuallyHidden}>Your details</legend>
            <div className={styles.field}>
              <label htmlFor={`${fieldId}-name`}>Name</label>
              <input autoComplete="name" id={`${fieldId}-name`} maxLength={100} name="name" required />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${fieldId}-email`}>Email</label>
              <input autoCapitalize="none" autoComplete="email" id={`${fieldId}-email`} inputMode="email" maxLength={254} name="email" required spellCheck={false} type="email" />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${fieldId}-phone`}>Phone <span>(optional)</span></label>
              <input autoComplete="tel" id={`${fieldId}-phone`} maxLength={40} name="phone" type="tel" />
            </div>
            <button className={styles.submit} disabled={state === "sending"} type="submit">
              {state === "sending" ? "Joining…" : "Join the waitlist"}
              <span aria-hidden="true">↗</span>
            </button>
          </fieldset>
        </>
      )}
      <div aria-live="polite" role="status">
        {state === "sent" && <p className={styles.feedback}>You’re on the waitlist. We’ll be in touch when membership opens.</p>}
      </div>
      {state === "error" && <p className={styles.error} role="alert">{error}</p>}
    </form>
  );
}
