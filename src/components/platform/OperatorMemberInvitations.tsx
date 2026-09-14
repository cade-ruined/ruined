"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OpsInvitationActions } from "@/components/platform/OpsActions";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import type { PendingMemberInvitation, PendingMemberInvitationPage } from "@/lib/platform/ops-member-invitation-repository";

const SIGN_IN = "https://members.theruinedproject.com/access";
const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver", timeZoneName: "short" }).format(new Date(value));
const expired = (entry: PendingMemberInvitation) => entry.status === "expired" || Boolean(entry.expiresAt && Date.parse(entry.expiresAt) <= Date.now());
function instructions(entry: PendingMemberInvitation) {
  return `You're invited to join Ruined.\n\nSign in at ${SIGN_IN} using ${entry.email}${entry.expiresAt ? ` before ${date(entry.expiresAt)}` : ""}. Request your own email code, then complete your profile, membership agreement, and payment instructions. We'll then place you in a Circle.\n\nQuestions? Reach us at connect@theruinedproject.com.`;
}

export default function OperatorMemberInvitations({ data, preview = false, directoryParams = {} }: {
  data: PendingMemberInvitationPage | null; preview?: boolean; directoryParams?: Record<string, string>;
}) {
  const router = useRouter();
  const [reviewed, setReviewed] = useState<PendingMemberInvitation | null>(null);
  const [confirmation, setConfirmation] = useState<{ entry: PendingMemberInvitation; action: "renew" | "revoke" } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [expiryReached, setExpiryReached] = useState(false);
  const messageField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setExpiryReached(Boolean(reviewed && expired(reviewed)));
    if (!reviewed?.expiresAt) return;
    const timeout = window.setTimeout(() => setExpiryReached(true), Math.min(2_147_483_647, Math.max(0, Date.parse(reviewed.expiresAt) - Date.now()) + 10));
    return () => window.clearTimeout(timeout);
  }, [reviewed]);

  async function current(entry: PendingMemberInvitation) {
    if (preview) return entry;
    const response = await fetch(`/api/ops/invitations?invitationId=${encodeURIComponent(entry.id)}`, { cache: "no-store" });
    const result = await response.json().catch(() => null);
    const saved = result?.invitation;
    if (!response.ok || saved?.id !== entry.id || saved.email !== entry.email
      || !["pending", "expired"].includes(saved.status) || (saved.expiresAt !== null && !Number.isFinite(Date.parse(saved.expiresAt)))) {
      throw new Error(typeof result?.error === "string" ? result.error : "This allowance could not be confirmed. Refresh pending joining before sharing.");
    }
    return saved as PendingMemberInvitation;
  }
  async function review(entry: PendingMemberInvitation) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailed(false); setMessage(""); setReviewed(null); setConfirmation(null);
    try { setReviewed(await current(entry)); }
    catch (failure) { setFailed(true); setMessage(failure instanceof Error ? failure.message : "This allowance could not be checked."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function copy() {
    if (!reviewed || inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailed(false); setMessage("");
    try {
      const checked = await current(reviewed);
      if (expired(checked)) { setReviewed(checked); throw new Error("This allowance has expired. Renew it before sharing instructions."); }
      setReviewed(checked);
      try {
        await navigator.clipboard.writeText(`${preview ? "PREVIEW — SAMPLE ONLY\n\n" : ""}${instructions(checked)}`);
        setMessage("Instructions copied. Paste them into your email or chat. Nothing was sent automatically.");
      } catch { setMessage("Select the instructions below and copy them manually."); messageField.current?.focus(); messageField.current?.select(); }
    } catch (failure) { setReviewed(null); setFailed(true); setMessage(failure instanceof Error ? failure.message : "This allowance could not be confirmed."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!confirmation || inFlight.current) return;
    if (preview) { setMessage("Preview only. No joining allowance was changed."); setConfirmation(null); return; }
    inFlight.current = true; setBusy(true); setFailed(false); setMessage("");
    try {
      const response = await fetch("/api/ops/invitations", { method: confirmation.action === "renew" ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: confirmation.entry.email, invitationId: confirmation.entry.id }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || (confirmation.action === "renew"
        ? payload?.invitation?.email !== confirmation.entry.email || typeof payload.invitation.id !== "string"
          || !/^[1-9][0-9]*$/.test(payload.invitation.id) || payload.invitation.reissued !== true
          || !Number.isFinite(Date.parse(payload.invitation.expiresAt)) || Date.parse(payload.invitation.expiresAt) <= Date.now()
        : payload?.revocation?.email !== confirmation.entry.email || payload.revocation.revoked !== 1)) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "This change could not be confirmed. Refresh pending joining before trying again.");
      }
      if (confirmation.action === "renew") setReviewed({ ...confirmation.entry, id: payload.invitation.id, expiresAt: payload.invitation.expiresAt, status: "pending" });
      else setReviewed(null);
      setMessage(confirmation.action === "renew" ? "Joining allowance renewed for seven days. Review and copy the instructions to share them." : "Pending joining allowance removed. The member’s account and history are unchanged.");
      setConfirmation(null); router.refresh();
    } catch (failure) { setFailed(true); setMessage(failure instanceof Error ? failure.message : "The allowance could not be updated."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function pageHref(page: number) { const params = new URLSearchParams({ ...directoryParams, invitationQ: data?.query ?? "", invitationPage: String(page) }); return `/ops/members?${params.toString()}#pending-member-joining`; }

  return <div>
    <OpsInvitationActions preview={preview} onSaved={() => router.refresh()} />
    <section aria-labelledby="pending-member-joining-title" className="mt-8 scroll-mt-32 border-t border-black/15 pt-6" id="pending-member-joining">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="ui-heading text-xl font-semibold" id="pending-member-joining-title">Pending joining</h3><button className="min-h-11 text-sm underline underline-offset-4" disabled={busy} onClick={() => { setReviewed(null); setConfirmation(null); router.refresh(); }} type="button">Refresh list</button></div>
      <p className="mt-2 text-sm text-black/60">Saved allowances for people who have not completed sign-in. Reviewing keeps their expiry unchanged.</p>
      {data ? <>
        <form action="/ops/members#pending-member-joining" className="mt-4 flex flex-wrap gap-3" method="get">{Object.entries(directoryParams).map(([name, value]) => <input key={name} name={name} type="hidden" value={value} />)}<label className="min-w-0 flex-1"><span className="sr-only">Find pending joining email</span><input className={OPERATOR_FIELD_CLASS} defaultValue={data.query} maxLength={120} name="invitationQ" placeholder="Find pending email" type="search" /></label><button className={OPERATOR_BUTTON_CLASS} type="submit">Find allowance</button></form>
        <p className="my-4 text-sm text-black/60">{data.totalResults} pending or expired {data.totalResults === 1 ? "allowance" : "allowances"}</p>
        <ul className="space-y-2">{data.entries.map((entry) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] bg-[var(--color-bone)] px-4 py-3" key={entry.id}><div className="min-w-0"><p className="break-all text-sm font-semibold">{entry.email}</p><p className="mt-1 text-xs text-black/60">{entry.expiresAt ? `${entry.status === "expired" ? "Expired" : "Expires"} ${date(entry.expiresAt)}` : "No expiry recorded"}</p>{entry.memberId ? <Link className="inline-flex min-h-9 items-center text-xs underline underline-offset-4" href={`/ops/members/${encodeURIComponent(entry.memberId)}`}>Member record</Link> : null}</div><div className="flex flex-wrap gap-3"><button className="min-h-11 text-sm font-semibold underline underline-offset-4" disabled={busy} onClick={() => review(entry)} type="button">Review</button><button className="min-h-11 text-sm underline underline-offset-4" disabled={busy} onClick={() => { setConfirmation({ entry, action: "renew" }); setReviewed(null); }} type="button">Renew</button><button className="min-h-11 text-sm text-[var(--color-poster)] underline underline-offset-4" disabled={busy} onClick={() => { setConfirmation({ entry, action: "revoke" }); setReviewed(null); }} type="button">Remove</button></div></li>)}</ul>
        {!data.entries.length ? <p className="py-5 text-sm text-black/60">{data.query ? "No pending joining allowances match this email." : "No pending joining allowances."}</p> : null}
        {data.pageCount > 1 ? <nav aria-label="Pending joining pages" className="mt-4 flex items-center justify-between gap-4 text-sm">{data.page > 1 ? <Link className="min-h-11 underline" href={pageHref(data.page - 1)}>Previous</Link> : <span />}<span>{data.page} of {data.pageCount}</span>{data.page < data.pageCount ? <Link className="min-h-11 underline" href={pageHref(data.page + 1)}>Next</Link> : <span />}</nav> : null}
      </> : <p className="mt-4 text-sm text-[var(--color-poster)]" role="alert">Pending joining could not be loaded. Refresh the list to try again.</p>}
      {confirmation ? <div aria-label="Review joining allowance change" className="mt-5 rounded-[4px] bg-[var(--color-highlight)]/35 p-4" role="group"><p className="break-words text-sm">{confirmation.action === "renew" ? "Replace the current allowance with a new seven-day allowance for" : "Remove pending joining access for"} <strong>{confirmation.entry.email}</strong>?</p><p className="mt-2 text-sm text-black/60">{confirmation.action === "renew" ? "No message will be sent. Share the updated instructions afterward." : "This does not delete their member account or history."}</p><div className="mt-3 flex gap-4"><button className={OPERATOR_BUTTON_CLASS} disabled={busy} onClick={confirm} type="button">{busy ? "Saving…" : confirmation.action === "renew" ? "Confirm renewal" : "Confirm removal"}</button><button className="min-h-11 text-sm underline" disabled={busy} onClick={() => setConfirmation(null)} type="button">Cancel</button></div></div> : null}
      {reviewed ? <div className="mt-5 space-y-3 rounded-[4px] bg-[var(--color-bone)] p-4"><h4 className="break-all text-sm font-semibold">{reviewed.email}</h4>{expiryReached || expired(reviewed) ? <p className="text-sm text-[var(--color-poster)]">This allowance has expired. Renew it before sharing instructions.</p> : <><p className="text-sm text-black/60">{reviewed.expiresAt ? `Expires ${date(reviewed.expiresAt)}.` : "This allowance has no expiry."}</p><textarea aria-label="Joining instructions to share" className={`${OPERATOR_FIELD_CLASS} min-h-48`} readOnly ref={messageField} value={`${preview ? "PREVIEW — SAMPLE ONLY\n\n" : ""}${instructions(reviewed)}`} /><button className={OPERATOR_BUTTON_CLASS} disabled={busy} onClick={copy} type="button">Copy instructions</button></>}<button className="ml-4 min-h-11 text-sm underline" disabled={busy} onClick={() => setReviewed(null)} type="button">Close review</button></div> : null}
      {message ? <p className={`mt-4 text-sm ${failed ? "text-[var(--color-poster)]" : "text-black/60"}`} role={failed ? "alert" : "status"}>{message}</p> : null}
    </section>
  </div>;
}
