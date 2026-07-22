"use client";

import { FormEvent, useState } from "react";
import styles from "./lp.module.css";

type Status = "idle" | "sending" | "success" | "error";

export default function LeadForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));

    try {
      const response = await fetch("/api/mastermind-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Unable to submit");
      form.reset();
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className={styles.heroFormSuccess} id="apply" role="status" aria-live="polite">
        <span>Application received</span>
        <strong>We will reply within two business days.</strong>
      </div>
    );
  }

  return (
    <form className={styles.heroForm} id="apply" onSubmit={submit} aria-busy={status === "sending"}>
      <label>
        <span>01 · Full name <b aria-hidden>*</b></span>
        <input name="fullName" autoComplete="name" maxLength={100} required placeholder="Type your name" />
      </label>

      <label>
        <span>02 · Email <b aria-hidden>*</b></span>
        <input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="Enter your email" />
      </label>

      <label>
        <span>03 · Your work <b aria-hidden>*</b></span>
        <select name="role" required defaultValue="">
          <option value="" disabled>Select one</option>
          <option value="Founder / business owner">Founder / business owner</option>
          <option value="Creative leader">Creative leader</option>
          <option value="Independent creator">Independent creator</option>
          <option value="Executive / operator">Executive / operator</option>
          <option value="Other">Other</option>
        </select>
      </label>

      <label>
        <span>04 · What needs to move? <b aria-hidden>*</b></span>
        <input name="goal" required minLength={20} maxLength={500} placeholder="Write one or two direct sentences" />
      </label>

      <div className={styles.heroFormAction}>
        <label className={styles.heroConsent}>
          <input name="consent" type="checkbox" required />
          <span>I accept the <a href="/privacy">privacy policy</a>.</span>
        </label>
        <button type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Request invitation"}<span aria-hidden>↗</span>
        </button>
        {status === "error" && (
          <p className={styles.heroFormError} role="alert">Could not send. Try again or email <a href="mailto:studio@ruined.studio">the studio</a>.</p>
        )}
      </div>

      <input className={styles.honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
    </form>
  );
}
