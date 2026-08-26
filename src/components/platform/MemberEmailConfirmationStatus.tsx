"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

import {
  consumeMemberEmailConfirmationLocation,
  type MemberEmailConfirmationStatus,
} from "@/lib/auth/email-confirmation";

const STATUS_COPY: Record<
  MemberEmailConfirmationStatus,
  { eyebrow: string; message: string; title: string }
> = {
  confirmed: {
    eyebrow: "Confirmation complete",
    message:
      "Your email address is verified. Continue to member access and request a one-time code. Payment follows there only if your membership is not yet active.",
    title: "Email confirmed.",
  },
  error: {
    eyebrow: "Confirmation incomplete",
    message:
      "We could not confirm your email from this link. It may have expired or already been used. Return to access to request another email.",
    title: "That link did not work.",
  },
  neutral: {
    eyebrow: "Confirmation status",
    message:
      "Open the confirmation link in the email Ruined sent you. Visiting this page by itself does not confirm an email or grant access.",
    title: "Check your email.",
  },
};

export default function MemberEmailConfirmationStatus() {
  const [status, setStatus] = useState<MemberEmailConfirmationStatus>("neutral");
  const consumed = useRef(false);

  useLayoutEffect(() => {
    if (consumed.current) return;
    consumed.current = true;

    setStatus(
      consumeMemberEmailConfirmationLocation({
        history: window.history,
        location: window.location,
      }),
    );
  }, []);

  const copy = STATUS_COPY[status];

  return (
    <section className="lg:pt-12" aria-live="polite" aria-labelledby="confirmation-status">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
        {copy.eyebrow}
      </p>
      <h2
        className="mt-5 font-[var(--font-display)] text-4xl tracking-[-0.03em]"
        id="confirmation-status"
      >
        {copy.title}
      </h2>
      <p className="mt-5 text-sm leading-relaxed text-white/50">{copy.message}</p>
      <Link
        className="mt-10 inline-flex min-h-12 items-center border border-white bg-white px-5 text-xs font-semibold uppercase tracking-[0.16em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white"
        href="/my/access"
        referrerPolicy="no-referrer"
      >
        {status === "confirmed" ? "Continue to access" : "Return to access"}
      </Link>
    </section>
  );
}
