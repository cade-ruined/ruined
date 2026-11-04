"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import type { MemberArchiveState } from "@/lib/platform/member-archive-repository";

function validArchive(value: unknown): value is MemberArchiveState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<MemberArchiveState>;
  return (state.archivedAt === null || typeof state.archivedAt === "string")
    && Number.isSafeInteger(state.version) && (state.version ?? -1) >= 0
    && typeof state.memberName === "string" && typeof state.allowed === "boolean"
    && typeof state.restoreAllowed === "boolean"
    && Array.isArray(state.blockers) && state.blockers.every(blocker => typeof blocker === "string")
    && (state.reason === null || typeof state.reason === "string");
}

export default function OperatorMemberArchiveAction({ memberId, preview = false }: {
  memberId: string;
  preview?: boolean;
}) {
  const router = useRouter();
  const [archive, setArchive] = useState<MemberArchiveState | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);
  const endpoint = `/api/ops/members/${encodeURIComponent(memberId)}/archive`;

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !validArchive(body.archive)) throw new Error(body.error || "Could not load archive status. Refresh to try again.");
        if (!controller.signal.aborted) setArchive(body.archive);
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load archive status.");
      });
    return () => controller.abort();
  }, [endpoint, preview]);

  async function save() {
    if (preview || !archive || saving.current ||
      (archive.archivedAt ? !archive.restoreAllowed : !archive.allowed || archive.blockers.length > 0 || reason.trim().length < 3)) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: archive.archivedAt ? "restore" : "archive", reason: archive.archivedAt ? "Restored to the current member list." : reason.trim(), expectedVersion: archive.version }),
      });
      const body = await response.json();
      if (!response.ok || !validArchive(body.archive) || Boolean(body.archive.archivedAt) === Boolean(archive.archivedAt)) throw new Error(body.error || "The change could not be confirmed. Refresh the record before trying again.");
      setArchive(body.archive);
      setOpen(false);
      setReason("");
      setMessage(body.archive.archivedAt ? "Moved to Archived. The full member record is retained." : "Restored to the member list.");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The change could not be confirmed. Refresh the record before trying again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const archived = Boolean(archive?.archivedAt);
  const allowed = preview || Boolean(archived ? archive?.restoreAllowed : archive?.allowed && archive.blockers.length === 0);
  return <section className="operator-bento-card my-4" aria-labelledby="member-archive-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="ui-heading text-base font-semibold" id="member-archive-heading">{archived ? "Archived member" : "Archive member"}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[color:var(--operator-muted)]">{archived
          ? "This member is in Archived. Their full record is still available here."
          : "Move an inactive member out of the current list. Keep their full record and restore them any time."}</p>
        {archived && archive?.reason ? <p className="mt-2 break-words text-sm text-[color:var(--operator-muted)]">Reason: {archive.reason}</p> : null}
      </div>
      <button className={OPERATOR_BUTTON_CLASS} disabled={busy || (!preview && !archive)} aria-expanded={open} aria-controls="member-archive-review" onClick={() => setOpen(!open)} type="button">{archived ? "Restore to members" : "Archive member"}</button>
    </div>
    {open ? <div className="mt-4 border-t border-[color:var(--operator-line)] pt-4" id="member-archive-review">
      <p className="text-sm leading-relaxed text-[color:var(--operator-muted)]">Archiving only organizes the member list. Billing, account access, communications, and saved work stay unchanged.</p>
      {!allowed ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[color:var(--operator-muted)]">{(archive?.blockers.length ? archive.blockers : ["This record cannot be changed here. Refresh the record to check its current status."]).map(blocker => <li key={blocker}>{blocker}</li>)}</ul> : <>
        {!archived ? <label className="mt-3 block text-sm font-medium">Reason for archiving
          <textarea className={OPERATOR_FIELD_CLASS} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} placeholder="For example, no longer participating" />
        </label> : <p className="mt-3 text-sm">Return this record to the current member list?</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={OPERATOR_BUTTON_CLASS} disabled={busy || preview || (!archived && reason.trim().length < 3)} onClick={save} type="button">{busy ? "Saving…" : archived ? "Confirm restore" : "Confirm archive"}</button>
          <button className={OPERATOR_BUTTON_CLASS} disabled={busy} onClick={() => setOpen(false)} type="button">Cancel</button>
        </div>
      </>}
      {preview ? <p className="mt-3 text-xs text-[color:var(--operator-muted)]">Preview only. No member records will change.</p> : null}
    </div> : null}
    {message ? <p className="mt-3 text-sm" role="status">{message} {archived ? <Link href="/ops/members?archive=archived" className="underline underline-offset-4">View archived members →</Link> : null}</p> : null}
    {error ? <p className="mt-3 text-sm text-[var(--operator-danger)]" role="alert">{error}</p> : null}
  </section>;
}
