"use client";

import { useState } from "react";
import { closureDateLabel, closureLastDate, closuresInDateRange } from "@/lib/membership/calendar-closures";
import { OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";

export default function OperatorClosedDates() {
  const [year, setYear] = useState(() => Math.min(2027, Math.max(2026, new Date().getFullYear())));
  const closures = closuresInDateRange(`${year}-01-01`, `${year + 1}-01-01`);
  return (
    <section aria-labelledby="closed-dates-title" className="operator-bento-card mt-6" data-operator-closed-dates>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="operator-section-heading" id="closed-dates-title">Closed dates</h2>
          <p className="mt-1 text-sm text-[color:var(--operator-muted)]">All-day closures shown on every member’s Calendar.</p>
        </div>
        <label>
          <span className="sr-only">Closure calendar year</span>
          <select className={`${OPERATOR_FIELD_CLASS} !mt-0`} onChange={(event) => setYear(Number(event.target.value))} value={year}>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </label>
      </div>
      <ul className="mt-4 grid gap-x-6 md:grid-cols-2">
        {closures.map((closure) => <li className="border-t border-[var(--operator-line)] py-3" key={closure.id}>
          <p className="text-sm font-semibold">{closure.title} <span className="ml-2 text-xs font-normal text-[color:var(--operator-muted)]">Closed · All day</span></p>
          <p className="mt-1 text-sm text-[color:var(--operator-muted)]">
            <time dateTime={closure.startDate}>{closureDateLabel(closure.startDate)}</time>
            {closureLastDate(closure) !== closure.startDate ? <> – <time dateTime={closureLastDate(closure)}>{closureDateLabel(closureLastDate(closure))}</time></> : null}
          </p>
        </li>)}
      </ul>
    </section>
  );
}
