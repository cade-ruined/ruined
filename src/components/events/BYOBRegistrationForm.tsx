"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  BYOB_02_EVENT_KEY,
  BYOB_02_TANK_HREF,
  BYOB_02_WAIVER_BODY,
  BYOB_02_WAIVER_TITLE,
  BYOB_02_WAIVER_VERSION,
  type Byob02RegistrationSuccess,
} from "@/lib/events/byob-registration-model";

type SubmissionState = "idle" | "sending" | "success" | "error";

const INPUT_CLASS =
  "min-h-12 w-full border border-black/60 bg-[var(--color-shop)] px-4 py-3 font-sans text-base text-[var(--color-faded)] outline-none placeholder:text-black/60 transition-colors hover:border-black focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bone)]";
const FIELD_LABEL_CLASS =
  "inline-block w-fit origin-left [font-family:var(--font-cadehandy2)] text-[1.5rem] leading-none text-[var(--color-poster)] [transform:rotate(-3deg)] sm:text-[1.65rem]";
const WAIVER_ACKNOWLEDGMENT_CLASS =
  "mt-5 grid cursor-pointer grid-cols-[1rem_1fr] items-start gap-3 border border-black/60 bg-[var(--color-shop)] px-4 py-3 text-sm leading-relaxed transition-colors has-[:checked]:border-black focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-black";
const TANK_CTA_HREF = `${BYOB_02_TANK_HREF}?utm_source=byob-02-registration&utm_medium=onsite&utm_campaign=byob-02`;
const TANK_FLAT_LAY_IMAGE =
  "https://cdn.shopify.com/s/files/1/1001/4077/7793/files/BYOB_Tee_Product.png?v=1787271453";
const TANK_FLAT_LAY_ALT =
  "Black BYOB Tank shown front and back on dark earth among yellow wildflowers.";

export default function BYOBRegistrationForm() {
  const [state, setState] = useState<SubmissionState>("idle");
  const [error, setError] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const fieldPrefix = useId();

  useEffect(() => {
    if (state === "success") successHeadingRef.current?.focus();
  }, [state]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;

    const form = event.currentTarget;
    const data = new FormData(form);

    setError("");
    setState("sending");

    try {
      const response = await fetch("/api/events/byob-02/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: data.get("firstName"),
          lastName: data.get("lastName"),
          email: data.get("email"),
          instagramHandle: data.get("instagramHandle"),
          waiverAccepted: data.get("waiverAccepted") === "on",
          waiverVersion: BYOB_02_WAIVER_VERSION,
          company: data.get("company"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<Byob02RegistrationSuccess> & { error?: string })
        | null;

      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "Registration is temporarily unavailable.");
      }

      setSubmittedEmail(String(data.get("email") ?? "").trim());
      setState("success");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Registration is temporarily unavailable.",
      );
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <section
        aria-labelledby="byob-registration-success-heading"
        className="py-7 sm:py-9"
      >
        <p className="ui-heading text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">
          BYOB Nº 02
        </p>
        <h2
          ref={successHeadingRef}
          id="byob-registration-success-heading"
          tabIndex={-1}
          className="display mt-2 max-w-3xl text-[clamp(2.75rem,6vw,4.75rem)] leading-[0.88] outline-none"
        >
          You’re in.
        </h2>
        <p role="status" aria-live="polite" className="mt-5 max-w-xl text-base leading-relaxed text-black/65">
          Your registration is recorded. We’ll send the final details to{" "}
          <span className="break-all text-black">{submittedEmail}</span>.
        </p>

        <div className="mt-9 grid max-w-3xl gap-6 sm:grid-cols-[minmax(0,20rem)_minmax(15rem,1fr)] sm:items-end lg:gap-9">
          <div className="relative aspect-[4/5] overflow-hidden bg-black">
            <Image
              src={TANK_FLAT_LAY_IMAGE}
              alt={TANK_FLAT_LAY_ALT}
              fill
              sizes="(min-width: 640px) 20rem, calc(100vw - 2rem)"
              className="object-cover"
            />
          </div>

          <div className="pb-1">
            <p className="ui-heading text-[0.55rem] uppercase tracking-[0.16em] text-black/45">
              Optional
            </p>
            <h3 className="display mt-2 text-3xl leading-none sm:text-4xl">
              BYOB Tank
            </h3>
            <p className="mt-3 font-sans text-sm text-black/55">
              $32 · Preorder · Ships September 14, 2026
            </p>
            <Link
              href={TANK_CTA_HREF}
              className="ui-heading mt-6 inline-flex min-h-12 w-full items-center justify-between gap-8 border border-black bg-black px-5 py-3 text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              View the tank <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <Link
          href={`/community#${BYOB_02_EVENT_KEY}`}
          className="ui-heading mt-7 inline-flex text-[0.58rem] uppercase tracking-[0.14em] transition-colors hover:text-[var(--color-poster)]"
        >
          ← Back to BYOB Nº 02
        </Link>
      </section>
    );
  }

  return (
    <form
      onSubmit={submit}
      aria-busy={state === "sending"}
      aria-label="Register for BYOB Nº 02"
      className="py-4 sm:py-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-1">
        <h2 className="ui-heading text-[0.66rem] uppercase tracking-[0.16em]">
          Registration
        </h2>
        <p className="font-sans text-xs text-black/45">
          18+ · One form per person.
        </p>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.72fr)] lg:gap-10">
        <div className="grid content-start gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label htmlFor={`${fieldPrefix}-first-name`} className="grid gap-2">
              <span className={FIELD_LABEL_CLASS}>First name</span>
              <input
                id={`${fieldPrefix}-first-name`}
                name="firstName"
                required
                maxLength={80}
                autoComplete="given-name"
                className={INPUT_CLASS}
              />
            </label>

            <label htmlFor={`${fieldPrefix}-last-name`} className="grid gap-2">
              <span className={FIELD_LABEL_CLASS}>Last name</span>
              <input
                id={`${fieldPrefix}-last-name`}
                name="lastName"
                required
                maxLength={80}
                autoComplete="family-name"
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label htmlFor={`${fieldPrefix}-email`} className="grid gap-2">
              <span className={FIELD_LABEL_CLASS}>Email</span>
              <input
                id={`${fieldPrefix}-email`}
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                inputMode="email"
                className={INPUT_CLASS}
              />
            </label>

            <label htmlFor={`${fieldPrefix}-instagram`} className="grid gap-2">
              <span className={FIELD_LABEL_CLASS}>Instagram · optional</span>
              <input
                id={`${fieldPrefix}-instagram`}
                name="instagramHandle"
                maxLength={31}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="@handle"
                className={INPUT_CLASS}
              />
            </label>
          </div>
          <p className="max-w-xl font-sans text-xs leading-relaxed text-black/50">
            Parking is limited. Please carpool when possible and use designated
            stalls or marked overflow.
          </p>
        </div>

        <div className="grid content-start gap-5">
          <section aria-labelledby={`${fieldPrefix}-waiver-title`}>
            <details className="group">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 outline-none [&::-webkit-details-marker]:hidden focus-visible:text-[var(--color-poster)]">
                <span id={`${fieldPrefix}-waiver-title`} className="ui-heading text-[0.6rem] uppercase tracking-[0.13em]">
                  {BYOB_02_WAIVER_TITLE}
                </span>
                <span className="flex items-center gap-3">
                  <span className="ui-heading text-[0.52rem] uppercase tracking-[0.12em] text-black/40 group-open:hidden">
                    Read
                  </span>
                  <span className="ui-heading hidden text-[0.52rem] uppercase tracking-[0.12em] text-black/40 group-open:inline">
                    Close
                  </span>
                  <span aria-hidden="true" className="font-sans text-lg leading-none transition-transform group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <div className="pb-5">
                <span className="sr-only">Version {BYOB_02_WAIVER_VERSION}</span>
                <p id={`${fieldPrefix}-waiver-copy`} className="text-sm leading-relaxed text-black/60">
                  {BYOB_02_WAIVER_BODY}
                </p>
              </div>
            </details>

            <label htmlFor={`${fieldPrefix}-waiver`} className={WAIVER_ACKNOWLEDGMENT_CLASS}>
              <input
                id={`${fieldPrefix}-waiver`}
                name="waiverAccepted"
                type="checkbox"
                required
                aria-describedby={`${fieldPrefix}-waiver-copy`}
                className="mt-0.5 size-4 accent-[var(--color-faded)]"
              />
              <span>
                I have read and agree to the {BYOB_02_WAIVER_TITLE}. I confirm
                that I am 18 or older and am registering only myself.
              </span>
            </label>
          </section>

          <input
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute left-[-9999px] h-px w-px opacity-0"
          />

          {error ? (
            <p role="alert" aria-live="assertive" className="border-l-2 border-[var(--color-poster)] pl-4 text-sm leading-relaxed text-black/70">
              {error}
            </p>
          ) : null}

          <div className="grid gap-3">
            <button
              type="submit"
              disabled={state === "sending"}
              className="ui-heading inline-flex min-h-12 items-center justify-between gap-8 border border-black bg-black px-5 py-3 text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-wait disabled:opacity-55"
            >
              {state === "sending" ? "Registering…" : "Register"}
              <span aria-hidden="true">→</span>
            </button>
            <p className="text-xs leading-relaxed text-black/40">
              Registration details are used for this event only. Read our{" "}
              <Link href="/privacy" className="underline decoration-black/35 underline-offset-2 hover:decoration-black">
                Privacy policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}
