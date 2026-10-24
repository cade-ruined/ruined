"use client";

import Link from "next/link";

export default function PlatformUnavailable({
  accessHref,
  reason = "connection",
}: {
  accessHref?: string;
  reason?: "connection" | "member_access" | "operator_access";
}) {
  const copy = reason === "member_access"
    ? {
        description:
          "This signed-in account does not have member access. Sign out, then request a new code with the email tied to your Ruined Membership.",
        title: "Member access required.",
      }
    : reason === "operator_access"
      ? {
          description:
            "This signed-in account does not have an active operator role. Sign out, then request a new code with an email that has operator access.",
          title: "Operator access required.",
        }
      : {
          description:
            "Please try again. If this page still won’t open, contact us and we’ll help.",
          title: "We couldn’t load this page.",
        };

  return (
    <section className="grid min-h-[55vh] content-center border-t border-[var(--member-rule,var(--operator-line,currentColor))] py-12 text-[var(--member-ink,var(--operator-ink,currentColor))] sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--member-red,var(--operator-danger,var(--color-poster)))]">
        Ruined Membership
      </p>
      <h1 className="mt-6 max-w-4xl font-[var(--font-display)] text-[clamp(2.75rem,7vw,6rem)] leading-[0.95] tracking-[-0.045em]">
        {copy.title}
      </h1>
      <p className="mt-6 max-w-xl text-sm leading-relaxed text-[var(--member-muted,var(--operator-muted,currentColor))] sm:text-base">
        {copy.description}
      </p>
      {reason === "connection" ? <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          className="inline-flex min-h-12 items-center border border-current px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
          onClick={() => window.location.reload()}
          type="button"
        >
          Try again
        </button>
        <a className="inline-flex min-h-12 items-center text-sm underline underline-offset-4" href="mailto:connect@theruinedproject.com">Contact Ruined</a>
      </div> : accessHref ? (
        <Link
          className="mt-8 inline-flex min-h-12 w-fit items-center text-sm underline underline-offset-4"
          href={accessHref}
        >
          Sign in with another email
        </Link>
      ) : null}
    </section>
  );
}
