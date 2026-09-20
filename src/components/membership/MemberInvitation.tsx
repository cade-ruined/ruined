"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import type { PersonalInvitationSnapshot, PersonalMemberInvitation } from "@/lib/membership/personal-invitation-model";
import { memberInvitationDeadline, memberInvitationExpired } from "@/lib/membership/invitation-expiry";
import { complimentaryEndOfLocalDay, complimentaryMembershipDeadline } from "@/lib/membership/personal-invitation-presentation";
import { useInvitationExpired } from "./use-invitation-expiry";
import type { PublicMemberCard } from "@/lib/membership/public-card-model";
import MembershipWaitlistForm from "@/components/public-members/MembershipWaitlistForm";
import PublicMemberCardPage from "./card/PublicMemberCardPage";
import PersonalInvitationAcceptance from "./PersonalInvitationAcceptance";
import styles from "./MemberInvitation.module.css";

export function InvitationLanding({ card, token, expiresAt, recipientName, membershipType = "standard", complimentaryEndsAt = null, preview = false }: { card: PublicMemberCard; token?: string; expiresAt: string | null; recipientName?: string | null; membershipType?: "standard" | "complimentary"; complimentaryEndsAt?: string | null; preview?: boolean }) {
  const expired = useInvitationExpired(expiresAt);
  const personal = Boolean(recipientName);
  return <PublicMemberCardPage card={card} variant="invitation" invitationExpiresAt={expiresAt} invitationRecipientName={recipientName} preview={preview} title="AN INVITATION TO RUINED"
    headerActions={preview ? <Link href="/my/invitation">My Invitation ↗</Link> : <a href={personal ? "#accept-invitation" : "#join-ruined"}>{personal ? "Accept invitation ↗" : "Request to join ↗"}</a>}
    footerNote={preview ? "Example invitation. Nothing is sent or published." : `An invitation from ${card.name}.`}
    footerActions={<a href="https://theruinedproject.com/#members">About membership ↗</a>}>
    {personal ? <PersonalInvitationAcceptance invitationToken={token} recipientName={recipientName!} inviterName={card.name} expiresAt={expiresAt} membershipType={membershipType} complimentaryEndsAt={complimentaryEndsAt} preview={preview} /> : <section id="join-ruined" className={styles.panel} aria-labelledby="invitation-join-title">
      <p className={styles.eyebrow}>{recipientName ? `For ${recipientName}` : "Your next step"}</p><h2 id="invitation-join-title">Find your people.</h2>
      <p>Leave your details and we’ll be in touch about joining. Your invitation will stay connected to {card.name}.</p>
      {recipientName ? <p className={styles.note}>Use the email address this invitation was sent to.</p> : null}
      {expired ? <p role="status">This invitation has expired. Ask {card.name} for a new one.</p> : <p className={styles.note}>Valid until <time dateTime={expiresAt!}>{memberInvitationDeadline(expiresAt)}</time>.</p>}
      {preview ? <p className={styles.note}>Preview only. Visit your invitation to create a shareable link.</p> : <MembershipWaitlistForm invitationToken={token} disabled={expired} {...(recipientName ? { prefillName: recipientName } : {})} />}
    </section>}
  </PublicMemberCardPage>;
}

type InvitationStatus = "active" | "expired" | "accepted" | "requested" | "joined" | "revoked" | "unavailable";
type HistoryFilter = "all" | "active" | "expired" | "accepted" | "joined";
const statusLabels: Record<InvitationStatus, string> = { active: "Active", expired: "Expired", accepted: "Accepted", requested: "Requested", joined: "Joined", revoked: "Cancelled", unavailable: "Unavailable" };
function invitationStatus(invitation: PersonalMemberInvitation): InvitationStatus {
  if (invitation.joinedAt) return "joined";
  if (invitation.acceptedAt) return "accepted";
  if (invitation.submittedAt) return "requested";
  if (invitation.revokedAt) return "revoked";
  if (memberInvitationExpired(invitation.expiresAt)) return "expired";
  return invitation.available === false || (invitation.membershipType === "complimentary" && invitation.complimentaryEndsAt && memberInvitationExpired(invitation.complimentaryEndsAt)) ? "unavailable" : "active";
}
function invitationActive(invitation: PersonalMemberInvitation) {
  return invitationStatus(invitation) === "active";
}
function canShare(invitation: PersonalMemberInvitation) {
  return Boolean(invitation.url && invitationActive(invitation));
}
function deliveryLabel(invitation: PersonalMemberInvitation) {
  switch (invitation.deliveryStatus) {
    case "queued": return "Email queued";
    case "sending": return "Sending email";
    case "sent": return "Email sent";
    case "failed": return "Email didn’t send";
    case "cancelled": return "Email cancelled";
    default: return "Link created";
  }
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" }).format(new Date(value));
}

export default function MemberInvitation({ initialSnapshot, preview = false }: { initialSnapshot: PersonalInvitationSnapshot | null; preview?: boolean }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0), [loading, setLoading] = useState(!initialSnapshot && !preview);
  const [recipientName, setRecipientName] = useState(""), [recipientEmail, setRecipientEmail] = useState("");
  const [membershipType, setMembershipType] = useState<"standard" | "complimentary">("standard");
  const [complimentaryReason, setComplimentaryReason] = useState("Founding member");
  const [limitedDuration, setLimitedDuration] = useState(false), [complimentaryEndDate, setComplimentaryEndDate] = useState("");
  const [sendEmail, setSendEmail] = useState(Boolean(initialSnapshot?.emailReady));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all"), [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [confirmEndAccess, setConfirmEndAccess] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState("");
  const requestId = useRef<string | null>(null), writing = useRef(false);
  const busy = pending !== null || loading;
  const writable = Boolean(snapshot?.eligible && snapshot.writable && !preview);
  const canManageComplimentary = Boolean(snapshot?.canGrantComplimentary && snapshot.writable && !preview);
  const complimentary = Boolean(snapshot?.canGrantComplimentary && membershipType === "complimentary");
  const draftEndsAt = limitedDuration ? complimentaryEndOfLocalDay(complimentaryEndDate) : null;
  const selected = snapshot?.invitations.find(invitation => invitation.id === selectedId);
  const draftName = useDeferredValue(recipientName.trim());
  // Re-render at the next deadline even when the owner leaves the history open.
  const nextExpiry = snapshot?.invitations.flatMap(invitation => [invitation.expiresAt,
    ...(invitation.complimentaryEndsAt ? [invitation.complimentaryEndsAt] : []),
    ...(invitation.complimentaryGrant?.endsAt ? [invitation.complimentaryGrant.endsAt] : [])])
    .concat(snapshot.legacyInvitation?.expiresAt ? [snapshot.legacyInvitation.expiresAt] : [])
    .filter(value => !memberInvitationExpired(value)).sort()[0] ?? null;
  useInvitationExpired(nextExpiry);

  useEffect(() => {
    if ((initialSnapshot && retry === 0) || preview) return;
    const controller = new AbortController();
    setError(""); setLoading(true);
    fetch("/api/my/invitations", { cache: "no-store", signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Your invitations could not be loaded.");
      setSnapshot(payload.snapshot);
      if (!initialSnapshot) setSendEmail(Boolean(payload.snapshot.emailReady));
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Your invitations could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialSnapshot, preview, retry]);

  useEffect(() => {
    if (preview) return;
    const refresh = () => { if (!document.hidden && !busy) setRetry(value => value + 1); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [busy, preview]);

  useEffect(() => {
    if (preview || busy || !snapshot?.invitations.some(invitation => invitation.deliveryStatus === "queued" || invitation.deliveryStatus === "sending")) return;
    const timer = window.setTimeout(() => { if (!document.hidden) setRetry(value => value + 1); }, 15_000);
    return () => window.clearTimeout(timer);
  }, [busy, preview, snapshot]);

  function editRecipient(field: "name" | "email", value: string) {
    requestId.current = null; setSelectedId(null); setStatus(""); setError("");
    if (field === "name") setRecipientName(value); else setRecipientEmail(value);
  }

  function editMembership() {
    requestId.current = null; setStatus(""); setError("");
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || !writable || busy || writing.current || snapshot.remainingToday < 1) return;
    const name = recipientName.trim(), email = recipientEmail.trim();
    if (!name || !email) { setError("Add their name and email to create an invitation."); return; }
    if (complimentary && !complimentaryReason.trim()) { setError("Add a reason for complimentary membership."); return; }
    if (complimentary && limitedDuration && (!draftEndsAt || new Date(draftEndsAt).getTime() <= Date.now())) { setError("Choose a future end date for complimentary membership."); return; }
    writing.current = true; setPending("create"); setError(""); setStatus(""); setFallbackUrl("");
    const existingIds = new Set(snapshot.invitations.map(invitation => invitation.id));
    try {
      requestId.current ??= crypto.randomUUID();
      const membership = complimentary ? { membershipType: "complimentary", complimentaryReason: complimentaryReason.trim(), complimentaryEndsAt: draftEndsAt } : snapshot.canGrantComplimentary ? { membershipType: "standard" } : {};
      const response = await fetch("/api/my/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientName: name, recipientEmail: email, requestId: requestId.current, sendEmail: sendEmail && snapshot.emailReady, ...membership }) });
      const payload = await response.json();
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Your invitation could not be created. Try again.");
      const updated = payload.snapshot as PersonalInvitationSnapshot;
      const created = updated.invitations.find(invitation => !existingIds.has(invitation.id)) ?? updated.invitations.find(invitation => invitation.recipientEmail.toLowerCase() === email.toLowerCase());
      setSnapshot(updated); setSelectedId(created?.id ?? null); setFilter("all");
      setRecipientName(""); setRecipientEmail(""); requestId.current = null;
      setMembershipType("standard"); setComplimentaryReason("Founding member"); setLimitedDuration(false); setComplimentaryEndDate("");
      setStatus(created?.deliveryStatus === "sent" ? `Invitation sent to ${name}.` : created?.deliveryStatus === "queued" || created?.deliveryStatus === "sending" ? `Invitation created for ${name}. Their email is queued.` : created?.deliveryStatus === "failed" ? `Invitation created for ${name}, but the email didn’t send. You can retry it below or copy the link.` : `Invitation created for ${name}. Copy the link below to send it.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Your invitation could not be created. Try again."); }
    finally { writing.current = false; setPending(null); }
  }

  async function updateInvitation(invitation: PersonalMemberInvitation, action: "revoke" | "retry_email" | "end_complimentary") {
    if (!(action === "end_complimentary" ? canManageComplimentary : writable) || busy || writing.current) return;
    writing.current = true; setPending(invitation.id); setError(""); setStatus("");
    try {
      const response = await fetch(`/api/my/invitations/${invitation.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, version: invitation.version }) });
      const payload = await response.json();
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Your invitation could not be updated.");
      setSnapshot(payload.snapshot); setConfirmCancel(null); setConfirmEndAccess(null);
      setStatus(action === "end_complimentary" ? `Complimentary access for ${invitation.recipientName} ended. Their member record stays in place.` : action === "revoke" ? `Invitation for ${invitation.recipientName} cancelled. Its history stays here.` : `Email queued for ${invitation.recipientName}. The original deadline stays the same.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Your invitation could not be updated."); }
    finally { writing.current = false; setPending(null); }
  }

  async function copyLink(url: string, expiresAt: string) {
    if (busy || memberInvitationExpired(expiresAt)) { setStatus("This invitation has expired. Create a new one to invite them again."); return; }
    const absoluteUrl = new URL(url, window.location.origin).href;
    setError(""); setStatus(""); setFallbackUrl("");
    try { await navigator.clipboard.writeText(absoluteUrl); setStatus("Invitation link copied. The deadline stays the same."); }
    catch { setFallbackUrl(absoluteUrl); setStatus("Select and copy your invitation link below."); }
  }

  if (!snapshot?.card) return <main className={styles.empty}><Link href="/my">↖ My profile</Link><h1>My Invitations</h1>{error ? <><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></> : <p role="status">Preparing your invitations…</p>}</main>;
  const active = snapshot.invitations.filter(invitationActive).length;
  const expired = snapshot.invitations.filter(invitation => invitationStatus(invitation) === "expired").length;
  const visibleInvitations = snapshot.invitations.filter(invitation => filter === "all" || (filter === "active" ? invitationActive(invitation) : invitationStatus(invitation) === filter));
  const legacy = snapshot.legacyInvitation;
  const emailEnabled = snapshot.emailReady && sendEmail;

  return <PublicMemberCardPage card={snapshot.card} variant="invitation" invitationExpiresAt={selected?.expiresAt ?? null} invitationRecipientName={selected?.recipientName ?? (draftName || null)} title={preview ? "MY INVITATIONS / PREVIEW" : "MY INVITATIONS"}
    headerActions={<><Link href="/my">My profile ↗</Link><a href="#create-invitation">Create invitation ↓</a></>}
    footerNote={preview ? "Preview only. Nothing is sent or published." : "Personal invitations. Your name and member tag stay synced with your profile."}
    footerActions={<Link href="/my/card">My Card ↗</Link>}>
    <div className={styles.dashboard}>
      <p className={styles.previewCaption}>{selected ? <>Showing the invitation for <strong>{selected.recipientName}</strong><button type="button" onClick={() => setSelectedId(null)}>Back to new invitation</button></> : <>Your next invitation{recipientName.trim() ? <>, for <strong>{recipientName.trim()}</strong></> : " starts here."}</>}</p>
      <section id="create-invitation" className={styles.panel} aria-labelledby="my-invitation-title">
        <p className={styles.eyebrow}>A personal introduction</p><h2 id="my-invitation-title">Bring someone in.</h2>
        <p>Put their name on a card. Each person gets their own invitation, with 48 hours to accept and verify their email.</p>
        <form className={styles.form} onSubmit={createInvitation} aria-label="Create a personal invitation" aria-busy={pending === "create"}>
          <fieldset className={styles.fields} disabled={busy || (!preview && !writable)}>
            <legend className={styles.visuallyHidden}>Who are you inviting?</legend>
            <label className={styles.field} htmlFor="invite-recipient-name">Their name<input id="invite-recipient-name" name="recipientName" autoComplete="off" maxLength={100} required value={recipientName} placeholder="First and last name" onChange={event => editRecipient("name", event.target.value)} /></label>
            <label className={styles.field} htmlFor="invite-recipient-email">Their email<input id="invite-recipient-email" name="recipientEmail" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} required value={recipientEmail} placeholder="name@example.com" onChange={event => editRecipient("email", event.target.value)} /></label>
            {snapshot.canGrantComplimentary ? <div className={styles.membershipControls}>
              <label className={styles.field} htmlFor="invite-membership-type">Membership<select id="invite-membership-type" name="membershipType" value={membershipType} onChange={event => { setMembershipType(event.target.value === "complimentary" ? "complimentary" : "standard"); editMembership(); }}><option value="standard">Standard</option><option value="complimentary">Complimentary</option></select></label>
              {complimentary ? <div className={styles.complimentaryFields}>
                <label className={styles.field} htmlFor="invite-complimentary-reason">Reason<input id="invite-complimentary-reason" name="complimentaryReason" value={complimentaryReason} required maxLength={500} aria-describedby="invite-reason-note" onChange={event => { setComplimentaryReason(event.target.value); editMembership(); }} /><span id="invite-reason-note" className={styles.note}>Private admin note. This does not assign a membership tier.</span></label>
                <label className={styles.field} htmlFor="invite-complimentary-duration">Duration<select id="invite-complimentary-duration" name="complimentaryDuration" value={limitedDuration ? "limited" : "ongoing"} onChange={event => { setLimitedDuration(event.target.value === "limited"); editMembership(); }}><option value="ongoing">Ongoing</option><option value="limited">Set an end date</option></select></label>
                {limitedDuration ? <label className={styles.field} htmlFor="invite-complimentary-end-date">Complimentary through<input id="invite-complimentary-end-date" name="complimentaryEndDate" type="date" required value={complimentaryEndDate} aria-describedby="invite-membership-duration-note" onChange={event => { setComplimentaryEndDate(event.target.value); editMembership(); }} /></label> : null}
                <p id="invite-membership-duration-note" className={styles.note}>{limitedDuration ? <>Access lasts through 11:59 PM on the selected day in your local timezone.{draftEndsAt ? <> Saved deadline: {complimentaryMembershipDeadline(draftEndsAt)}.</> : null} No payment is needed during this period.</> : "No payment needed. Complimentary membership continues until an admin ends it."} The invitation still has 48 hours to be accepted.</p>
              </div> : null}
            </div> : null}
          </fieldset>
          {snapshot.emailReady ? <label className={styles.emailChoice}><input type="checkbox" checked={sendEmail} disabled={busy || !writable} onChange={event => { setSendEmail(event.target.checked); requestId.current = null; }} />Email this invitation</label> : <p className={styles.note}>Email delivery isn’t available right now. You can create an invitation and send its link yourself.</p>}
          <div className={styles.formFooter}><p className={styles.note}>{emailEnabled ? "We’ll email their personal link from Ruined." : "Their email is private. Only their name appears on the card."}</p><button className={styles.enable} type="submit" disabled={busy || !writable || snapshot.remainingToday < 1}>{pending === "create" ? "Creating…" : emailEnabled ? "Create & email invitation" : "Create invitation"}<span aria-hidden="true">↗</span></button></div>
        </form>
        <p className={styles.note}>Your invitation approves them to join. The 48 hours begin when you create it; after accepting, they complete their profile and membership.</p>
        {preview ? <p className={styles.note}>This is a preview with example names and counts. You can try a name on the card; creating and sending are disabled.</p> : !snapshot.eligible ? <p className={styles.note}>Invitations become available once membership entry is complete and your membership is active.</p> : !snapshot.writable ? <p className={styles.note}>Invitations are temporarily read-only. Please try again later.</p> : snapshot.remainingToday < 1 ? <p className={styles.note}>You’ve reached today’s limit of {snapshot.dailyLimit} invitations. Please try again later.</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
      <p className={styles.status} role="status">{status}</p>
      {fallbackUrl ? <label className={`${styles.field} ${styles.panel}`}>Invitation link<input readOnly value={fallbackUrl} onFocus={event => event.target.select()} /></label> : null}
      <section className={styles.panel} aria-labelledby="invitation-history-title" aria-busy={loading}>
        <div className={styles.historyHeading}><div><p className={styles.eyebrow}>Your invitations</p><h2 id="invitation-history-title">Keep track.</h2></div><button className={styles.quiet} type="button" disabled={busy || preview} onClick={() => setRetry(value => value + 1)}>{loading ? "Refreshing…" : "Refresh"}</button></div>
        <dl className={styles.statistics}><div><dt>Created</dt><dd>{snapshot.counts.created}</dd></div><div><dt>Active</dt><dd>{active}</dd></div><div><dt>Expired</dt><dd>{expired}</dd></div><div><dt>Accepted</dt><dd>{snapshot.counts.accepted}</dd></div><div><dt>Joined</dt><dd>{snapshot.counts.joined}</dd></div></dl>
        <p className={styles.note}>Accepted means they verified their email. Joined means they completed membership. Earlier waitlist submissions still appear as Requested.</p>
        {snapshot.invitations.length > 0 ? <>
          <div className={styles.historyFilters} role="group" aria-label="Filter invitations">{(["all", "active", "expired", "accepted", "joined"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All" : statusLabels[value]}</button>)}</div>
          {visibleInvitations.length > 0 ? <ul className={styles.history}>{visibleInvitations.map(invitation => {
            const state = invitationStatus(invitation), shareable = canShare(invitation), updating = pending === invitation.id;
            const canCancel = shareable;
            const grant = invitation.complimentaryGrant;
            const grantEnded = Boolean(grant && (grant.revokedAt || (grant.endsAt && memberInvitationExpired(grant.endsAt))));
            const canEndAccess = Boolean(snapshot.canGrantComplimentary && invitation.membershipType === "complimentary" && invitation.acceptedAt && grant && !grantEnded);
            const membershipEndsAt = grant?.endsAt ?? invitation.complimentaryEndsAt;
            return <li key={invitation.id} data-selected={selectedId === invitation.id}>
              <div className={styles.recordHeading}><div className={styles.recipient}><button type="button" aria-label={`Preview invitation for ${invitation.recipientName}`} aria-pressed={selectedId === invitation.id} onClick={() => setSelectedId(invitation.id)}>{invitation.recipientName}</button><span>{invitation.recipientEmail}</span></div><div className={styles.recordBadges}><span className={styles.badge} data-status={state}>{statusLabels[state]}</span>{invitation.membershipType === "complimentary" ? <span className={styles.badge}>Complimentary</span> : null}</div></div>
              {invitation.membershipType === "complimentary" ? <p className={styles.membershipMeta}>{grantEnded ? <>Complimentary access ended{grant?.revokedAt || grant?.endsAt ? <> · <time dateTime={(grant.revokedAt ?? grant.endsAt)!}>{complimentaryMembershipDeadline((grant.revokedAt ?? grant.endsAt)!)}</time></> : null}</> : membershipEndsAt ? <>Complimentary through <time dateTime={membershipEndsAt}>{complimentaryMembershipDeadline(membershipEndsAt)}</time></> : "Ongoing complimentary membership"}{snapshot.canGrantComplimentary && invitation.complimentaryReason ? <span>{invitation.complimentaryReason}</span> : null}</p> : null}
              <div className={styles.recordMeta}><p>Created <time dateTime={invitation.issuedAt}>{shortDate(invitation.issuedAt)}</time></p><p>{invitation.acceptedAt || invitation.joinedAt || invitation.submittedAt ? "Original deadline" : memberInvitationExpired(invitation.expiresAt) ? "Expired" : "Expires"} <time dateTime={invitation.expiresAt}>{memberInvitationDeadline(invitation.expiresAt)}</time></p></div>
              <div className={styles.recordMeta}><p className={invitation.deliveryStatus === "failed" ? styles.failed : undefined}>{deliveryLabel(invitation)}{invitation.sentAt ? <> · <time dateTime={invitation.sentAt}>{shortDate(invitation.sentAt)}</time></> : null}</p>{invitation.acceptedAt ? <p>Accepted <time dateTime={invitation.acceptedAt}>{shortDate(invitation.acceptedAt)}</time></p> : null}{invitation.submittedAt ? <p>Requested <time dateTime={invitation.submittedAt}>{shortDate(invitation.submittedAt)}</time></p> : null}{invitation.joinedAt ? <p>Joined <time dateTime={invitation.joinedAt}>{shortDate(invitation.joinedAt)}</time></p> : null}</div>
              <div className={styles.recordActions}>
                {shareable ? <><button type="button" disabled={busy} onClick={() => void copyLink(invitation.url!, invitation.expiresAt)}>Copy link</button><a href={invitation.url!} target="_blank" rel="noreferrer">View invitation ↗</a></> : null}
                {invitation.deliveryStatus === "failed" && shareable && snapshot.emailReady ? <button type="button" disabled={busy || !writable} onClick={() => void updateInvitation(invitation, "retry_email")}>{updating ? "Queuing…" : "Retry email"}</button> : null}
                {canCancel ? <button className={styles.cancel} type="button" disabled={busy || !writable} onClick={() => setConfirmCancel(invitation.id)}>Cancel invitation</button> : null}
                {canEndAccess ? <button className={styles.cancel} type="button" disabled={busy || !canManageComplimentary} onClick={() => setConfirmEndAccess(invitation.id)}>End complimentary access</button> : null}
                {(state === "expired" || state === "revoked" || state === "unavailable") ? <a href="#create-invitation" onClick={() => { editRecipient("name", invitation.recipientName); setRecipientEmail(invitation.recipientEmail); }}>Invite again ↗</a> : null}
              </div>
              {confirmCancel === invitation.id ? <div className={styles.cancelPrompt}><p>Cancel the invitation for {invitation.recipientName}? Their link will stop working. The record stays here.</p><div className={styles.recordActions}><button type="button" disabled={busy} onClick={() => void updateInvitation(invitation, "revoke")}>{updating ? "Cancelling…" : "Yes, cancel invitation"}</button><button type="button" disabled={busy} onClick={() => setConfirmCancel(null)}>Keep invitation</button></div></div> : null}
              {canEndAccess && confirmEndAccess === invitation.id ? <div className={styles.cancelPrompt}><p>End complimentary access for {invitation.recipientName} now? If no other membership covers them, their access will end. Their member record and history stay in place.</p><div className={styles.recordActions}><button type="button" disabled={busy || !canManageComplimentary} onClick={() => void updateInvitation(invitation, "end_complimentary")}>{updating ? "Ending access…" : "Yes, end complimentary access"}</button><button type="button" disabled={busy} onClick={() => setConfirmEndAccess(null)}>Keep complimentary access</button></div></div> : null}
            </li>;
          })}</ul> : <p className={styles.historyEmpty}>No {filter} invitations.</p>}
        </> : <p className={styles.historyEmpty}>Your first personal invitation will appear here. You’ll see who it’s for, when it expires, and whether they join.</p>}
        {legacy ? <div className={styles.legacy}><div className={styles.recordHeading}><p>Earlier shared invitation</p><span className={styles.badge}>{!legacy.enabled ? "Sharing off" : memberInvitationExpired(legacy.expiresAt) ? "Expired" : "Active"}</span></div><p className={styles.note}>Your original shared link. New personal invitations have their own links.</p><p className={styles.note}>{memberInvitationExpired(legacy.expiresAt) ? "Expired" : "Expires"} <time dateTime={legacy.expiresAt}>{memberInvitationDeadline(legacy.expiresAt)}</time>.</p>{legacy.enabled && legacy.url && !memberInvitationExpired(legacy.expiresAt) ? <div className={styles.recordActions}><button type="button" disabled={busy} onClick={() => void copyLink(legacy.url!, legacy.expiresAt)}>Copy earlier link</button><a href={legacy.url} target="_blank" rel="noreferrer">View invitation ↗</a></div> : null}</div> : null}
      </section>
    </div>
  </PublicMemberCardPage>;
}
