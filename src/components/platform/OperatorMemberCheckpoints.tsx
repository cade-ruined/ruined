import type { operatorMemberJourney } from "@/lib/membership/operator-registration-progress";

type Journey = ReturnType<typeof operatorMemberJourney>;
const shortLabels = { email: "Email", information: "Info", payment_method: "Payment info", payment: "Payment", profile: "Profile" };
const stateLabels = { complete: "Complete", needed: "Needed", not_required: "Not required", review: "Review" };

function completionDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" }).format(new Date(value));
}

/** Read-only evidence. Checkpoints never grant access or initiate billing. */
export default function OperatorMemberCheckpoints({ journey, compact = false }: { journey: Journey | null; compact?: boolean }) {
  if (!journey) return <p className="text-xs leading-relaxed text-black/70">Registration checkpoints are unavailable for this record.</p>;

  return <ol aria-label="Member checkpoints" className={compact ? "grid grid-cols-5 gap-1.5" : "divide-y divide-black/10"}>
    {journey.checkpoints.map(checkpoint => {
      const date = completionDate(checkpoint.completedAt);
      const description = `${checkpoint.label}: ${stateLabels[checkpoint.state]}${date ? ` · ${date}` : ""}`;
      return <li key={checkpoint.key} aria-label={description} className={compact ? "min-w-0" : "flex items-start gap-3 py-3"}>
        <span aria-hidden="true" className={`${compact ? "mb-2 flex h-6 w-full" : "mt-0.5 flex size-6 shrink-0"} items-center justify-center rounded-none text-xs font-semibold ${checkpoint.state === "complete" ? "bg-[#36594a] text-white" : checkpoint.state === "review" ? "bg-[#f4d04b] text-black" : checkpoint.state === "not_required" ? "bg-[var(--operator-surface-muted)] text-black/50" : "border border-black/20 text-black/45"}`}>
          {checkpoint.state === "complete" ? "✓" : checkpoint.state === "review" ? "!" : checkpoint.state === "not_required" ? "—" : "·"}
        </span>
        <div className={compact ? "min-w-0" : "min-w-0 flex-1"}>
          <p className={compact ? "text-[11px] font-medium leading-tight" : "text-sm font-medium"}>{compact ? shortLabels[checkpoint.key] : checkpoint.label}</p>
          {compact ? <p className="mt-1 text-[10px] leading-tight text-black/70">{stateLabels[checkpoint.state]}{date ? <span className="sr-only"> · {date}</span> : null}</p> : <>
            <p className="mt-1 text-xs text-black/70">{stateLabels[checkpoint.state]}{date ? <> · <time dateTime={checkpoint.completedAt!}>{date}</time></> : null}</p>
            {checkpoint.detail ? <p className="mt-1 text-xs leading-relaxed text-black/70">{checkpoint.detail}</p> : null}
          </>}
        </div>
      </li>;
    })}
  </ol>;
}
