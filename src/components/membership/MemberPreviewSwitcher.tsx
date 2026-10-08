"use client";

import { useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import type { MemberPreviewScenario } from "@/lib/membership/preview-scenarios";

const labels = { foundations: "In Foundations", joining: "Still joining", active: "Active member", operator: "Complimentary operator", limited: "Paused membership", "registration-info": "Registration · details", "registration-card": "Registration · card", registered: "Registration · receipt" };
export default function MemberPreviewSwitcher({ scenario }: { scenario: MemberPreviewScenario }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function applyScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const body = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/preview/member-scenario", { method: "POST", headers: { Accept: "application/json" }, body });
      if (!response.ok) throw new Error("The demo account could not be changed. Try again.");
      const selected = body.get("scenario");
      window.location.assign(selected === "registration-info" ? "/my/join" : selected === "registration-card" ? "/my/payment-method" : selected === "registered" ? "/my/registered" : "/my");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo account could not be changed.");
      setPending(false);
    }
  }
  const form = <form action="/api/preview/member-scenario" method="post" onSubmit={applyScenario} className="mb-5 flex flex-wrap items-center gap-3 text-sm" aria-busy={pending}>
    <label htmlFor="member-preview-scenario">Demo account</label>
    <select className="min-h-11 rounded-[4px] border border-current/30 bg-[var(--color-bone)] px-3 text-[var(--color-faded)]" defaultValue={scenario} disabled={pending} id="member-preview-scenario" name="scenario">
      {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <button className="min-h-11 rounded-[4px] bg-[var(--color-faded)] px-4 text-[var(--color-bone)]" disabled={pending} type="submit">{pending ? "Opening…" : "View account"}</button>
    {error ? <span role="alert">{error}</span> : null}
    <span className="text-xs opacity-60">Example snapshot: Aug 27, 2026 · changes are not saved</span>
  </form>;
  return pathname === "/my/foundations/timeline/part-1" ? <details className="mb-3 text-[var(--member-muted)]">
    <summary className="min-h-11 cursor-pointer py-3 text-xs">Preview account · {scenario === "complimentary" ? "Complimentary member" : labels[scenario]}</summary>
    {form}
  </details> : form;
}
