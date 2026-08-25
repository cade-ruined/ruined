"use client";

import { FormEvent, useId, useRef, useState } from "react";

type SubmissionState = "idle" | "sending" | "sent" | "error";

export default function ContactForm() {
  const [state, setState] = useState<SubmissionState>("idle");
  const fieldId = useId();
  const submissionIdRef = useRef<string | null>(null);

  function submissionId() {
    if (!submissionIdRef.current) {
      submissionIdRef.current = crypto.randomUUID();
    }
    return submissionIdRef.current;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState("sending");

    try {
      const body = Object.fromEntries(new FormData(form));
      body.submissionId = submissionId();
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
      submissionIdRef.current = null;
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      onChange={() => {
        if (state === "error" || state === "sent") setState("idle");
      }}
      className="relative grid gap-5"
      aria-busy={state === "sending"}
    >
      <div className="pointer-events-none absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`${fieldId}-company`}>Company website</label>
        <input
          id={`${fieldId}-company`}
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <ContactField label="Name" htmlFor={`${fieldId}-name`}>
        <input
          id={`${fieldId}-name`}
          name="name"
          required
          maxLength={100}
          autoComplete="name"
          placeholder="Your name"
          className="w-full border-0 border-b border-black/30 bg-transparent px-0 py-3 font-sans text-base outline-none transition-colors placeholder:text-black/30 focus:border-[var(--color-poster)]"
        />
      </ContactField>

      <ContactField label="Email" htmlFor={`${fieldId}-email`}>
        <input
          id={`${fieldId}-email`}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="w-full border-0 border-b border-black/30 bg-transparent px-0 py-3 font-sans text-base outline-none transition-colors placeholder:text-black/30 focus:border-[var(--color-poster)]"
        />
      </ContactField>

      <ContactField label="Message" htmlFor={`${fieldId}-message`}>
        <textarea
          id={`${fieldId}-message`}
          name="message"
          required
          minLength={20}
          maxLength={4000}
          rows={6}
          placeholder="Your question or message."
          className="w-full resize-y border-0 border-b border-black/30 bg-transparent px-0 py-3 font-sans text-base leading-relaxed outline-none transition-colors placeholder:text-black/30 focus:border-[var(--color-poster)]"
        />
      </ContactField>

      <button
        type="submit"
        disabled={state === "sending"}
        className="ui-heading min-h-12 w-fit border border-black bg-black px-6 py-3 text-xs text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Send message"}
      </button>

      {state === "sent" && (
        <p role="status" aria-live="polite" className="font-sans text-sm">
          Message received. We’ll reply by email.
        </p>
      )}
      {state === "error" && (
        <p role="alert" aria-live="assertive" className="max-w-md font-sans text-sm leading-relaxed text-[var(--color-poster)]">
          The message didn’t send. Try again, or email{" "}
          <a className="underline underline-offset-4" href="mailto:connect@theruinedproject.com">
            connect@theruinedproject.com
          </a>
          .
        </p>
      )}
    </form>
  );
}

function ContactField({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="font-mono text-[0.55rem] uppercase tracking-[0.24em] text-black/50"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
