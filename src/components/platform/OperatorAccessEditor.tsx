"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS, OPERATOR_LABEL_TEXT_CLASS } from "@/components/platform/operatorStyles";
import type { OperatorAccessCircle, OperatorAccessEntry, OperatorAccessRole } from "@/lib/platform/ops-access-repository";

const RESPONSIBILITIES = [
  { value: "guide", label: "Guide", detail: "Supports selected Circles and their members." },
  { value: "circle_leader", label: "Shaper", detail: "Leads selected Circles. Each Circle can have one Shaper." },
  { value: "ops_admin", label: "Administrator", detail: "Manages every area, including other operators." },
] as const;

export default function OperatorAccessEditor({ entry, circles, preview, onClose, onSaved }: {
  entry: OperatorAccessEntry; circles: OperatorAccessCircle[]; preview: boolean;
  onClose: () => void; onSaved: (entry: OperatorAccessEntry) => void;
}) {
  const [role, setRole] = useState<OperatorAccessRole>(entry.role);
  const [circleIds, setCircleIds] = useState(entry.circles.map((circle) => circle.id));
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const [restore, setRestore] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting.current) { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]') ?? [])];
      const first = elements[0]; const last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus.current?.focus(); };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !entry.authUserId) return;
    submitting.current = true; setPending(true); setError("");
    const requestedCircles = role === "ops_admin" ? [] : circleIds;
    try {
      if (preview) { setError("Preview only. Operator access was not changed."); return; }
      const response = await fetch("/api/ops/operators", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        authUserId: entry.authUserId, role, circleIds: requestedCircles,
        expectedRole: entry.role, expectedCircleIds: entry.circles.map((circle) => circle.id), expectedStatus: entry.status,
        administratorConfirmed: adminConfirmed, restoreAccount: restore, reason,
      }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.access?.authUserId !== entry.authUserId || payload.access.role !== role || payload.access.status !== "active" || !Array.isArray(payload.access.circles)
        || !payload.access.circles.every((circle: OperatorAccessCircle) => circle && typeof circle.id === "string" && typeof circle.name === "string")
        || JSON.stringify(payload.access.circles.map((circle: OperatorAccessCircle) => circle.id).sort()) !== JSON.stringify([...requestedCircles].sort())) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "The change could not be confirmed. Refresh this operator before trying again.");
      }
      onSaved({ ...entry, role: payload.access.role, circles: payload.access.circles, status: "active" });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The change could not be saved."); }
    finally { submitting.current = false; setPending(false); }
  }

  return <div className="fixed inset-0 z-[160] flex justify-end bg-black/55" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <div aria-labelledby="edit-operator-title" aria-modal="true" className="h-full w-full max-w-xl overflow-y-auto bg-[var(--color-bone)] p-5 text-[var(--color-faded)] shadow-xl sm:p-8" ref={dialog} role="dialog" tabIndex={-1}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-black/60">{entry.displayName}</p><h2 className="font-[var(--font-display)] text-4xl" id="edit-operator-title">Edit access</h2><p className="mt-2 break-all text-sm text-black/60">{entry.email}</p></div><button className="min-h-11 px-2 text-sm underline" disabled={pending} onClick={onClose} type="button">Close</button></div>
      <form className="mt-7 space-y-6" onSubmit={save}>
        <fieldset disabled={pending}><legend className={OPERATOR_LABEL_TEXT_CLASS}>Responsibility</legend><div className="mt-3 grid gap-2">{RESPONSIBILITIES.map((option) => <label className={`flex cursor-pointer items-start gap-3 rounded-[4px] border p-4 ${role === option.value ? "border-black bg-[var(--color-shop)]/35" : "border-black/15"}`} key={option.value}><input checked={role === option.value} className="mt-1" name="role" onChange={() => { setRole(option.value); setAdminConfirmed(false); }} type="radio" value={option.value} /><span><strong className="block text-sm">{option.label}</strong><span className="mt-1 block text-sm text-black/60">{option.detail}</span></span></label>)}</div></fieldset>
        {role !== "ops_admin" ? <fieldset disabled={pending}><legend className={OPERATOR_LABEL_TEXT_CLASS}>Circles they manage</legend><div className="mt-3 grid gap-2">{circles.map((circle) => <label className="flex min-h-11 items-center gap-3 rounded-[4px] bg-black/[0.035] px-3" key={circle.id}><input checked={circleIds.includes(circle.id)} onChange={(event) => setCircleIds((current) => event.target.checked ? [...current, circle.id] : current.filter((id) => id !== circle.id))} type="checkbox" /><span className="text-sm">{circle.name}</span></label>)}</div>{circleIds.some((id) => !circles.some((circle) => circle.id === id)) ? <p className="mt-3 text-sm text-[var(--color-poster)]">A previous Circle is closed. <button className="min-h-11 underline" type="button" onClick={() => setCircleIds((current) => current.filter((id) => circles.some((circle) => circle.id === id)))}>Remove closed Circles from this edit</button></p> : null}{!circles.length ? <p className="mt-3 text-sm">Create a Circle before assigning Shaper or Guide access.</p> : null}</fieldset> : <label className="flex items-start gap-3 text-sm"><input checked={adminConfirmed} className="mt-1" disabled={pending} onChange={(event) => setAdminConfirmed(event.target.checked)} required type="checkbox" /><span>I confirm full administrator access, including managing other operators.</span></label>}
        {entry.status === "suspended" ? <label className="flex items-start gap-3 rounded-[4px] bg-[var(--color-highlight)]/35 p-4 text-sm"><input checked={restore} className="mt-1" disabled={pending} onChange={(event) => setRestore(event.target.checked)} required type="checkbox" /><span>Restore this suspended account and operator access. This permits sign-in again. Existing member billing and lifecycle restrictions still apply.</span></label> : null}
        <label className="block"><span className={OPERATOR_LABEL_TEXT_CLASS}>Reason for change</span><textarea className={`${OPERATOR_FIELD_CLASS} min-h-24`} disabled={pending} maxLength={500} minLength={3} onChange={(event) => setReason(event.target.value)} required value={reason} /></label>
        <p className="text-sm text-black/60">Saving applies these permissions immediately. Their member Circle placement stays the same.</p>
        {error ? <p className="text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-4"><button className="min-h-11 text-sm underline" disabled={pending} onClick={onClose} type="button">Cancel</button><button className={OPERATOR_BUTTON_CLASS} disabled={pending || (role === "ops_admin" ? !adminConfirmed : !circleIds.length) || (entry.status === "suspended" && !restore)} type="submit">{pending ? "Saving…" : entry.status === "suspended" ? "Restore and save access" : "Save access"}</button></div>
      </form>
    </div>
  </div>;
}
