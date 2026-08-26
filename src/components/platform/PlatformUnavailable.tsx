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
            "This area is unavailable until its secure connection returns. No payment, member access, or operator action is being imitated in the meantime.",
          title: "Connection required.",
        };

  return (
    <section className="grid min-h-[55vh] content-center border-t border-white/15 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
        Ruined Membership
      </p>
      <h1 className="mt-6 max-w-4xl font-[var(--font-display)] text-[clamp(3.4rem,9vw,8rem)] leading-[0.84] tracking-[-0.055em]">
        {copy.title}
      </h1>
      <p className="mt-8 max-w-xl text-sm leading-relaxed text-white/50 sm:text-base">
        {copy.description}
      </p>
      {accessHref && reason === "connection" ? (
        <Link
          className="mt-8 w-fit border-b border-white/35 pb-1 text-xs font-semibold uppercase tracking-[0.16em] text-white"
          href={accessHref}
        >
          Request passwordless access
        </Link>
      ) : null}
    </section>
  );
}
