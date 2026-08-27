const LABELS: Record<string, string> = {
  active: "Active",
  attention_required: "Attention required",
  closed: "Closed",
  collecting: "Collecting",
  completed: "Complete",
  ended: "Ended",
  fulfilled: "Fulfilled",
  in_progress: "In progress",
  in_production: "In production",
  invited: "Invited",
  not_started: "Not started",
  onboarding: "Onboarding",
  paused: "Paused",
  pending: "Pending",
  provisional: "Provisional",
  prospect: "Prospect",
  suspended: "Suspended",
  withdrawn: "Withdrawn",
};

export default function StateLabel({ state }: { state: string }) {
  const attention = state === "attention_required" || state === "ended" || state === "suspended";
  const complete = state === "active" || state === "completed" || state === "fulfilled";

  return (
    <span
      className={`inline-flex items-center gap-2 font-[var(--font-body)] text-sm leading-none ${
        attention ? "text-[var(--color-poster)]" : "text-current opacity-60"
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 ${
          attention
            ? "bg-[var(--color-poster)]"
            : complete
              ? "bg-[var(--color-verdigris)]"
              : "bg-current"
        }`}
      />
      {LABELS[state] ?? state.replaceAll("_", " ")}
    </span>
  );
}
