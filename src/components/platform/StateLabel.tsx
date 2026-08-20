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

  return (
    <span
      className={`font-mono text-[0.56rem] uppercase tracking-[0.17em] ${
        attention ? "text-[var(--color-poster)]" : "text-white/52"
      }`}
    >
      {LABELS[state] ?? state.replaceAll("_", " ")}
    </span>
  );
}
