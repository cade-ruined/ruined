"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";

type DeletionEligibility = {
  allowed: boolean;
  blockers: string[];
  confirmationEmail: string;
  memberName: string;
  lifecycleVersion: number;
};
type DeletionReason = "account_removal" | "member_request" | "test_account" | "duplicate_account";
const REASONS: Record<DeletionReason, string> = {
  account_removal: "Account removal",
  member_request: "Member request",
  test_account: "Test account",
  duplicate_account: "Duplicate account",
};
type Review = { email: string; reason: DeletionReason; version: number };
type Busy = "checking" | "deleting" | null;
type Message = { text: string; error: boolean } | null;

function eligibilityFrom(value: unknown): DeletionEligibility | null {
  if (!value || typeof value !== "object" || !("deletion" in value)) return null;
  const deletion = value.deletion;
  if (!deletion || typeof deletion !== "object") return null;
  const item = deletion as Partial<DeletionEligibility>;
  if (typeof item.allowed !== "boolean" || !Array.isArray(item.blockers) ||
    !item.blockers.every((blocker) => typeof blocker === "string") ||
    typeof item.confirmationEmail !== "string" || !item.confirmationEmail.trim() ||
    typeof item.memberName !== "string" || !Number.isSafeInteger(item.lifecycleVersion) ||
    (item.lifecycleVersion ?? -1) < 0) return null;
  return item as DeletionEligibility;
}

function requestError(status: number, fallback: string): string {
  if (status === 401) return "Your session has expired. Sign in again before deleting a member.";
  if (status === 403) return "Only an administrator can delete a member. Your access may have changed.";
  if (status === 404) return "This member could not be found. Return to the member directory to check their record.";
  if (status === 503) return "Member deletion is temporarily unavailable. Check eligibility again before trying to delete.";
  return fallback;
}

export default function OperatorMemberDeleteAction({ memberId, preview = false }: {
  memberId: string;
  preview?: boolean;
}) {
  const router = useRouter();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [eligibility, setEligibility] = useState<DeletionEligibility | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState<DeletionReason | "">("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message>(null);
  const [deleted, setDeleted] = useState(false);
  const busyRef = useRef<Busy>(null);
  const reviewRef = useRef<Review | null>(null);
  const deletedRef = useRef(false);
  const live = useRef(true);
  const request = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const endpoint = `/api/ops/members/${encodeURIComponent(memberId)}/deletion`;
  const allowed = eligibility?.allowed === true && eligibility.blockers.length === 0;
  const normalizedEmail = email.trim().toLowerCase();
  const matches = Boolean(eligibility && normalizedEmail === eligibility.confirmationEmail.trim().toLowerCase());

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      request.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  function clearReview() {
    reviewRef.current = null;
    setReview(null);
  }

  function resetConfirmation() {
    form.current?.reset();
    setEmail("");
    setReason("");
    clearReview();
  }

  async function checkEligibility(notice?: string) {
    if (preview || busyRef.current || deletedRef.current) return;
    busyRef.current = "checking";
    setBusy("checking");
    resetConfirmation();
    setEligibility(null);
    setMessage(notice ? { text: notice, error: true } : null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (!live.current || controller.signal.aborted) return;
      if (!response.ok) {
        setMessage({ text: requestError(response.status, "Eligibility could not be checked. Try again before deleting this member."), error: true });
        return;
      }
      const next = eligibilityFrom(body);
      if (!next) {
        setMessage({ text: "Eligibility could not be verified. Check again before deleting this member.", error: true });
        return;
      }
      setEligibility(next);
    } catch {
      if (live.current && !controller.signal.aborted) {
        setMessage({ text: "Eligibility could not be checked. Check your connection and try again.", error: true });
      }
    } finally {
      if (request.current === controller) request.current = null;
      busyRef.current = null;
      if (live.current) setBusy(null);
    }
  }

  async function openConfirmation() {
    if (busyRef.current || deletedRef.current || open) return;
    setOpen(true);
    if (preview) {
      setMessage({ text: "Preview only. Eligibility checks and member deletion are unavailable here.", error: false });
      return;
    }
    await checkEligibility();
  }

  function reviewDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || busyRef.current || deletedRef.current || !allowed || !eligibility) return;
    if (!matches || !Object.hasOwn(REASONS, reason)) {
      clearReview();
      setMessage({ text: "Choose a reason and type the member’s email exactly to review deletion.", error: true });
      return;
    }
    const next = { email: eligibility.confirmationEmail.trim(), reason: reason as DeletionReason, version: eligibility.lifecycleVersion };
    reviewRef.current = next;
    setReview(next);
    setMessage(null);
  }

  async function deleteMember() {
    const confirmed = reviewRef.current;
    if (preview || busyRef.current || deletedRef.current || !confirmed || !allowed || !eligibility ||
      confirmed.version !== eligibility.lifecycleVersion || confirmed.reason !== reason ||
      confirmed.email.toLowerCase() !== normalizedEmail) return;
    busyRef.current = "deleting";
    setBusy("deleting");
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationEmail: confirmed.email, expectedLifecycleVersion: confirmed.version, reason: confirmed.reason }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!live.current) return;
      resetConfirmation();
      setEligibility(null);
      if (!response.ok) {
        busyRef.current = null;
        setBusy(null);
        if (response.status === 409) {
          await checkEligibility("This member changed. Review the updated eligibility and confirm again.");
        } else {
          setMessage({ text: requestError(response.status, "Deletion was not confirmed. Check eligibility again before trying to delete."), error: true });
        }
        return;
      }
      if (!body || typeof body !== "object" || !("deleted" in body) || body.deleted !== true) {
        setMessage({ text: "Deletion was not confirmed. Return to the member directory to check their record.", error: true });
        return;
      }
      deletedRef.current = true;
      setDeleted(true);
      setMessage({ text: "cleanupPending" in body && body.cleanupPending === true
        ? "Member deleted. Remaining file cleanup is pending."
        : "Member deleted.", error: false });
      router.replace(`/ops/members/history/${encodeURIComponent(memberId)}`);
      router.refresh();
    } catch {
      if (live.current) {
        resetConfirmation();
        setEligibility(null);
        setMessage({ text: "Deletion could not be confirmed. Return to the member directory to check their record before trying again.", error: true });
      }
    } finally {
      if (busyRef.current === "deleting") {
        busyRef.current = null;
        if (live.current) setBusy(null);
      }
    }
  }

  function cancel() {
    if (busyRef.current || deletedRef.current) return;
    resetConfirmation();
    setEligibility(null);
    setMessage(null);
    restoreFocus.current = true;
    setOpen(false);
  }

  return (
    <div className="grid gap-4" data-operator-pending={busy ? "true" : "false"} data-operator-dirty={email || reason || review ? "true" : "false"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="ui-heading text-base font-semibold">Delete member</h3>
          <p className="mt-1 text-sm leading-relaxed text-black/60">For eligible closed accounts. The historical membership record stays.</p>
        </div>
        <button aria-controls={panelId} aria-expanded={open} className={OPERATOR_BUTTON_CLASS} disabled={Boolean(busy) || deleted || open} onClick={openConfirmation} ref={trigger} type="button">Delete member</button>
      </div>
      {open ? (
        <div className="grid gap-4 border-t border-black/15 pt-4" id={panelId}>
          <div>
            <h4 className="ui-heading text-base font-semibold">Permanently delete member</h4>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/68">This removes sign-in access, the private profile, card, invitation, journal and uploads. It cannot be undone. Deletion does not cancel billing. Membership, financial and audit history are retained; this person will no longer appear in current member counts.</p>
          </div>
          {busy === "checking" ? <p role="status" className="text-sm text-black/60">Checking eligibility…</p> : null}
          {eligibility && !allowed ? (
            <div className="grid gap-2 rounded-[4px] bg-black/[0.035] p-4">
              <p className="text-sm font-semibold">This member cannot be deleted.</p>
              {eligibility.blockers.length ? <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-black/68">{eligibility.blockers.map((blocker, index) => <li key={`${index}:${blocker}`}>{blocker}</li>)}</ul> : <p className="text-sm text-black/68">The account is not eligible for deletion.</p>}
            </div>
          ) : null}
          {allowed && eligibility ? (
            <form className="grid gap-4" onSubmit={reviewDeletion} ref={form}>
              <p className="break-words text-sm leading-relaxed">Deleting <strong>{eligibility.memberName}</strong> · <span>{eligibility.confirmationEmail}</span></p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={OPERATOR_LABEL_CLASS}>
                  <span className={OPERATOR_LABEL_TEXT_CLASS}>Reason</span>
                  <select className={OPERATOR_FIELD_CLASS} disabled={Boolean(busy)} name="reason" onChange={(event) => { clearReview(); setReason(event.target.value as DeletionReason | ""); setMessage(null); }} required value={reason}>
                    <option value="">Choose a reason</option>
                    {Object.entries(REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className={OPERATOR_LABEL_CLASS}>
                  <span className={OPERATOR_LABEL_TEXT_CLASS}>Type the member’s email</span>
                  <input autoCapitalize="none" autoComplete="off" className={OPERATOR_FIELD_CLASS} disabled={Boolean(busy)} name="confirmationEmail" onChange={(event) => { clearReview(); setEmail(event.target.value); setMessage(null); }} required spellCheck={false} type="email" value={email} />
                </label>
              </div>
              {review ? (
                <div aria-label="Review member deletion" className="grid gap-3 rounded-[4px] border border-[var(--color-poster)]/35 bg-black/[0.025] p-4">
                  <p className="break-words text-sm leading-relaxed">Permanently delete <strong>{eligibility.memberName}</strong>’s account ({review.email})? Reason: {REASONS[review.reason]}. The historical membership record stays. Account deletion cannot be undone.</p>
                  <div className="flex flex-wrap gap-2">
                    <button className={OPERATOR_BUTTON_CLASS} disabled={Boolean(busy)} onClick={deleteMember} type="button">{busy === "deleting" ? "Deleting member…" : "Permanently delete member"}</button>
                    <button className={OPERATOR_BUTTON_CLASS} disabled={Boolean(busy)} onClick={clearReview} type="button">Go back</button>
                  </div>
                </div>
              ) : <div><button className={OPERATOR_BUTTON_CLASS} disabled={Boolean(busy) || !matches || !reason} type="submit">Review deletion</button></div>}
            </form>
          ) : null}
          {message ? <p aria-live="polite" className={`text-sm leading-relaxed ${message.error ? "text-[var(--color-poster)]" : "text-black/60"}`} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
          {!deleted ? <div className="flex flex-wrap gap-2">
            {!preview && !allowed && !busy ? <button className={OPERATOR_BUTTON_CLASS} onClick={() => checkEligibility()} type="button">Check eligibility again</button> : null}
            <button className={OPERATOR_BUTTON_CLASS} disabled={Boolean(busy)} onClick={cancel} type="button">Cancel</button>
          </div> : null}
        </div>
      ) : null}
    </div>
  );
}
