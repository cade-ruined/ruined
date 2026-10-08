"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { OpsRegistrationInvitation } from "@/lib/membership/registration-model";
import styles from "./OperatorInvitationDetails.module.css";

const OPEN_EVENT = "operator-invitation-open";
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/Denver", timeZoneName: "short",
});

function invitationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : dateFormat.format(date);
}

function emailStatus(invitation: OpsRegistrationInvitation) {
  if (!invitation.emailRequested || invitation.deliveryStatus === "not_requested") return "Email not requested";
  switch (invitation.deliveryStatus) {
    case "sent": return "Sent";
    case "sending": return "Sending";
    case "failed": return "Send failed";
    case "cancelled": return "Cancelled";
    default: return "Queued";
  }
}

export default function OperatorInvitationDetails({ invitation, memberName }: {
  invitation?: OpsRegistrationInvitation | null;
  memberName: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const pointerInside = useRef(false);
  const suppressFocus = useRef(false);
  const [open, setOpen] = useState(false);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const dismiss = useCallback((restoreFocus = false) => {
    cancelClose();
    pinned.current = false;
    pointerInside.current = false;
    suppressFocus.current = restoreFocus;
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, [cancelClose]);

  const reveal = useCallback(() => {
    cancelClose();
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(true);
  }, [cancelClose, id]);

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (!pinned.current && !pointerInside.current && focused !== trigger.current && !panel.current?.contains(focused)) dismiss();
    }, 180);
  }

  function leaveFocus(next: EventTarget | null) {
    if (next instanceof Node && (trigger.current?.contains(next) || panel.current?.contains(next))) return;
    // Leaving by keyboard dismisses even while the pointer remains over the card.
    dismiss();
  }

  useEffect(() => {
    const anotherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) dismiss();
    };
    window.addEventListener(OPEN_EVENT, anotherOpened);
    return () => { window.removeEventListener(OPEN_EVENT, anotherOpened); cancelClose(); };
  }, [cancelClose, dismiss, id]);

  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    const element = panel.current;
    if (typeof element.showPopover === "function") element.showPopover();
    const position = () => {
      if (!trigger.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const margin = 12;
      const below = anchor.bottom + 6;
      const top = below + bounds.height <= window.innerHeight - margin ? below : anchor.top - bounds.height - 6;
      element.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - bounds.width - margin))}px`;
      element.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - bounds.height - margin))}px`;
    };
    position();
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !trigger.current?.contains(target) && !element.contains(target)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss(document.activeElement === trigger.current || element.contains(document.activeElement));
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [dismiss, open]);

  return <>
    <button
      ref={trigger}
      type="button"
      className={styles.trigger}
      aria-label={`Invitation details for ${memberName}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onPointerEnter={event => {
        if (event.pointerType === "touch") return;
        pointerInside.current = true; suppressFocus.current = false; reveal();
      }}
      onPointerLeave={() => { pointerInside.current = false; scheduleClose(); }}
      onFocus={() => { if (!suppressFocus.current) reveal(); }}
      onBlur={event => leaveFocus(event.relatedTarget)}
      onClick={() => {
        if (pinned.current) { dismiss(); return; }
        pinned.current = true; suppressFocus.current = false; reveal();
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 9h4M7 12h10M7 15h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
    {open ? <div
      ref={panel}
      id={id}
      role="dialog"
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      popover="manual"
      className={styles.panel}
      onPointerEnter={() => { pointerInside.current = true; cancelClose(); }}
      onPointerLeave={() => { pointerInside.current = false; scheduleClose(); }}
      onBlur={event => leaveFocus(event.relatedTarget)}
    >
      <div className={styles.heading}>
        <h3 id={`${id}-title`}>Invitation</h3>
        <button type="button" className={styles.close} aria-label="Close invitation details" onClick={() => dismiss(true)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </div>
      {invitation ? <>
        <p className={styles.name}>{invitation.recipientName}</p>
        <p className={styles.email}>{invitation.recipientEmail || "No recipient email recorded"}</p>
        <dl className={styles.details}>
          <div><dt>Invited by</dt><dd>{invitation.origin === "ruined_direct" ? "Ruined · direct invitation" : invitation.inviterName}</dd></div>
          <div><dt>Created</dt><dd><time dateTime={invitation.issuedAt}>{invitationDate(invitation.issuedAt)}</time></dd></div>
          <div><dt>Invite email</dt><dd>{emailStatus(invitation)}{invitation.deliveryStatus === "sent" && invitation.sentAt ? <time className={styles.subline} dateTime={invitation.sentAt}>{invitationDate(invitation.sentAt)}</time> : null}</dd></div>
          {invitation.submittedAt && !invitation.acceptedAt ? <div><dt>Submitted</dt><dd><time dateTime={invitation.submittedAt}>{invitationDate(invitation.submittedAt)}</time></dd></div> : null}
          <div><dt>Accepted</dt><dd>{invitation.acceptedAt ? <time dateTime={invitation.acceptedAt}>{invitationDate(invitation.acceptedAt)}</time> : "Not yet accepted"}</dd></div>
          {invitation.revokedAt ? <div><dt>Revoked</dt><dd><time dateTime={invitation.revokedAt}>{invitationDate(invitation.revokedAt)}</time></dd></div> : !invitation.acceptedAt && invitation.expiresAt ? <div><dt>Expires</dt><dd><time dateTime={invitation.expiresAt}>{invitationDate(invitation.expiresAt)}</time></dd></div> : null}
          {invitation.membershipType === "complimentary" ? <div><dt>Membership</dt><dd>Complimentary</dd></div> : null}
        </dl>
      </> : <p className={styles.empty}>No personal invitation found for this registration.</p>}
    </div> : null}
  </>;
}
