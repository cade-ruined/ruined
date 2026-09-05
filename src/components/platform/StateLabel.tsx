const LABELS: Record<string, string> = {
  active: "Active",
  archived: "Archived",
  attention_required: "Attention required",
  canceled: "Cancelled",
  cancelled: "Cancelled",
  closed: "Closed",
  collecting: "Collecting",
  completed: "Complete",
  dead_letter: "Needs intervention",
  delivered: "Delivered",
  draft: "Draft",
  ended: "Ended",
  exception: "Delivery issue",
  failed: "Failed",
  forming: "Forming",
  fulfilled: "Fulfilled",
  in_progress: "In progress",
  in_production: "In production",
  invited: "Invited",
  in_transit: "In transit",
  label_created: "Label created",
  not_started: "Not started",
  onboarding: "Onboarding",
  paused: "Paused",
  pending: "Pending",
  published: "Published",
  provisional: "Provisional",
  prospect: "Prospect",
  returned: "Returned",
  scheduled: "Scheduled",
  suspended: "Suspended",
  waitlisted: "Waitlisted",
  withdrawn: "Withdrawn",
};

export default function StateLabel({ state }: { state: string }) {
  const attention = [
    "attention_required",
    "canceled",
    "cancelled",
    "dead_letter",
    "ended",
    "exception",
    "failed",
    "suspended",
  ].includes(state);
  const complete = ["active", "completed", "delivered", "fulfilled", "published"].includes(state);
  const inMotion = [
    "collecting",
    "forming",
    "in_progress",
    "in_production",
    "in_transit",
    "invited",
    "label_created",
    "onboarding",
    "pending",
    "scheduled",
    "waitlisted",
  ].includes(state);

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
              : inMotion
                ? "bg-[var(--color-shop)]"
                : "bg-current"
        }`}
      />
      {LABELS[state] ?? state.replaceAll("_", " ")}
    </span>
  );
}
