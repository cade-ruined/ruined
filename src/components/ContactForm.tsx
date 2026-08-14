"use client";

import { FormEvent, useState } from "react";

type SubmissionState = "idle" | "sending" | "sent" | "error";

export default function ContactForm() {
  const [state, setState] = useState<SubmissionState>("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState("sending");

    try {
      const body = Object.fromEntries(new FormData(form));
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setState("error");
        return;
      }

      form.reset();
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid max-w-2xl gap-4"
      aria-busy={state === "sending"}
    >
      <label htmlFor="contact-name" className="sr-only">
        Name
      </label>
      <input
        id="contact-name"
        name="name"
        required
        autoComplete="name"
        placeholder="Name"
        className="border border-black/25 bg-transparent px-4 py-3 font-sans"
      />

      <label htmlFor="contact-email" className="sr-only">
        Email address
      </label>
      <input
        id="contact-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="Email"
        className="border border-black/25 bg-transparent px-4 py-3 font-sans"
      />

      <label htmlFor="contact-message" className="sr-only">
        Submission details
      </label>
      <textarea
        id="contact-message"
        name="message"
        required
        minLength={20}
        rows={7}
        placeholder="Tell us what you would like to submit."
        className="border border-black/25 bg-transparent px-4 py-3 font-sans"
      />

      <button
        type="submit"
        disabled={state === "sending"}
        className="ui-heading w-fit border border-black px-5 py-3 text-xs disabled:cursor-wait disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Send submission"}
      </button>

      {state === "sent" && (
        <p role="status" aria-live="polite">
          Submission sent.
        </p>
      )}
      {state === "error" && (
        <p role="alert" aria-live="assertive">
          Form delivery is not connected yet.
        </p>
      )}
    </form>
  );
}
