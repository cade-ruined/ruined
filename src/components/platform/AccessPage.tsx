import PasswordlessAccessForm from "@/components/platform/PasswordlessAccessForm";

export default function AccessPage({
  audience,
  enabled,
}: {
  audience: "member" | "ops";
  enabled: boolean;
}) {
  const member = audience === "member";

  return (
    <main className="grid min-h-[68vh] gap-14 border-t border-white/15 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:gap-24">
      <div>
        <p className="font-[var(--font-handwritten)] text-xl text-[var(--color-poster)]">
          {member ? "RUINED MEMBERSHIP" : "OPERATIONS"}
        </p>
        <h1 className="mt-12 max-w-4xl font-[var(--font-header)] text-[clamp(3.8rem,9vw,8.5rem)] font-bold uppercase leading-[0.78] tracking-[-0.06em]">
          {member ? "Return without a password." : "Enter the system."}
        </h1>
      </div>

      <section className="lg:pt-12" aria-labelledby={`${audience}-access-title`}>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-poster)]">
          Passwordless access
        </p>
        <h2 className="ui-heading mt-5 text-3xl font-semibold tracking-[-0.03em]" id={`${audience}-access-title`}>
          One email. One code.
        </h2>
        <p className="mt-5 text-sm leading-relaxed text-white/50">
          {member
            ? "Use the email attached to your Ruined account. New member accounts remain pending until Stripe confirms payment."
            : "Use the email your Ruined invitation was sent to. Your code confirms identity; the approved responsibility and Circle access are applied automatically."}
        </p>
        <PasswordlessAccessForm
          audience={audience}
          enabled={enabled}
          nextPath={member ? "/my/join" : "/ops"}
        />
      </section>
    </main>
  );
}
