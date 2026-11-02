"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { COMMUNICATION_BUCKETS, type CommunicationBucket, type CommunicationNavigation, type CommunicationItem } from "@/lib/communications/communications-catalog";
import { getMemberSmsTemplatePreviews } from "@/lib/communications/member-sms-operations-model";
import { memberSmsReminderBody } from "@/lib/communications/member-sms-model";
import type { MemberSmsHistoryItem, MemberSmsOperationsOverview, MemberSmsOperationTemplate, MemberSmsUpcomingItem, MemberSmsOperationJob } from "@/lib/communications/member-sms-operations-types";
import { OPERATOR_BUTTON_CLASS } from "./operatorStyles";
import styles from "./OperatorSmsOperations.module.css";

const API = "/api/ops/messages/texts";
const OPERATIONS_TIME_ZONE = "America/Denver";
type Props = { preview?: boolean; previewCommunications?: CommunicationItem[]; view: CommunicationNavigation["view"]; bucket: CommunicationBucket | null; onNavigate: (next: Partial<CommunicationNavigation>) => void };

export function smsOperationDate(value: string, timeZone = OPERATIONS_TIME_ZONE): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  try { return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date); }
  catch { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date); }
}

export function smsDeliveryLabel(item: MemberSmsHistoryItem): { label: string; explanation: string; tone?: string } {
  if (item.status === "blocked") return { label: "Blocked", explanation: "The eligibility check stopped this text before sending.", tone: "attention" };
  if (item.deliveryStatus === "delivered") return { label: "Delivered", explanation: "The carrier reported delivery.", tone: "complete" };
  if (item.deliveryStatus === "failed" || item.deliveryStatus === "undelivered") return { label: item.deliveryStatus === "failed" ? "Failed" : "Undelivered", explanation: "The provider reported that this text was not delivered.", tone: "attention" };
  if (item.deliveryStatus === "sent") return { label: "Sent to carrier", explanation: "Sent to the carrier; delivery has not been confirmed." };
  if (item.deliveryStatus === "sending") return { label: "Sending", explanation: "The provider is sending this text. Delivery has not been confirmed." };
  if (item.deliveryStatus === "queued") return { label: "Queued by Twilio", explanation: "Twilio is holding the text for delivery. It has not been reported delivered." };
  if (item.status === "accepted") return { label: "Accepted by Twilio", explanation: "Twilio accepted this text. Delivery has not been confirmed." };
  if (item.status === "unknown") return { label: "Outcome unconfirmed", explanation: "The send result is uncertain. It will not be automatically resent.", tone: "attention" };
  return { label: "Awaiting provider response", explanation: "A send attempt started, but no confirmed provider result is recorded." };
}

function reason(value: string | null) {
  if (!value) return null;
  const labels: Record<string, string> = { member_inactive: "The member is not currently eligible.", phone_missing: "No usable mobile number is saved.", no_current_consent: "Current text-message consent is missing.", phone_suppressed: "The mobile number has opted out.", source_ineligible: "The call, audience, or send window is no longer eligible.", shared_phone: "This phone number is shared with another member.", expired: "The send window has ended." };
  return labels[value] ?? value.replaceAll("_", " ");
}

function templateInBucket(template: MemberSmsOperationTemplate, bucket: CommunicationBucket | null) {
  if (!bucket) return true;
  if (template.id === "opt_in_confirmation") return bucket === "registration";
  if (template.id === "foundations_01") return bucket === "foundations";
  return bucket === "foundations" || bucket === "membership";
}

function sampleOverview(communications: CommunicationItem[] = []): MemberSmsOperationsOverview {
  const now = new Date(), due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const templates = getMemberSmsTemplatePreviews("https://members.example.test");
  const recipient = { memberId: "00000000-0000-4000-8000-000000000001", name: "Alex Example", maskedPhone: "••• ••• 0100", sharedPhone: false };
  const call = { eventId: "00000000-0000-4000-8000-000000000002", title: "Foundations 01 — sample call", startsAt: new Date(due.getTime() + 150 * 60000).toISOString(), timeZone: OPERATIONS_TIME_ZONE, foundations01: true };
  const body = memberSmsReminderBody({ memberId: recipient.memberId, kind: "call_reminder", reminderKey: "sample-only", callDetails: { ...call, meetingUrl: "https://meet.google.com/abc-defg-hij" } }, "https://members.example.test");
  return { generatedAt: now.toISOString(), automation: { enabled: false, transportEnabled: false, automationEnabled: false, ready: false, callReady: false, warnings: [], activatedAt: null, state: "disabled", missing: [], schedule: "*/5 * * * *", batchSize: 100 }, templates, communications,
    upcoming: { horizonEnd: new Date(now.getTime() + 14 * 86400000).toISOString(), truncated: false, label: "Fictional sample schedule", currentOptIns: 1, items: [{ id: "sample-upcoming", kind: "call_reminder", reminderKey: "sample-only", recipient, call, dueAt: due.toISOString(), expiresAt: new Date(due.getTime() + 600000).toISOString(), body, source: "forecast", confirmation: "required", confirmationBody: templates[0].body, confirmationStatus: null, blockedReason: null }] },
    jobs: { items: [], truncated: false }, history: { nextCursor: null, items: [{ id: "sample-delivery", kind: "opt_in_confirmation", reminderKey: "sample-only", recipient, call: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), status: "accepted", deliveryStatus: "delivered", deliveryUpdatedAt: now.toISOString(), deliveryErrorCode: null, blockedReason: null, messageSid: null, body: templates[0].body, bodySource: "snapshot" }] } };
}

function TextBody({ body, label = "Message" }: { body: string; label?: string }) { return <div><p className={styles.eyebrow}>{label}</p><p className={styles.body}>{body}</p></div>; }
function Empty({ title, children }: { title: string; children: React.ReactNode }) { return <div className={`operator-glass ${styles.empty}`}><h3>{title}</h3><p>{children}</p></div>; }

function UpcomingCard({ item }: { item: MemberSmsUpcomingItem }) {
  const state = item.blockedReason ? "Blocked" : item.source === "forecast" ? "Projected" : item.source === "queued" ? "Queued" : "Processing";
  return <details className={`operator-glass ${styles.card}`}><summary aria-label={`${item.recipient.name}: ${item.call?.title ?? "Text opt-in confirmation"}`}><div className={styles.rowHeading}><div className={styles.identity}><h3>{item.recipient.name}</h3><p>{item.recipient.maskedPhone} · {item.call?.title ?? "Text opt-in confirmation"}</p><p>{smsOperationDate(item.dueAt, item.call?.timeZone)}</p></div><span className={styles.status} data-tone={item.blockedReason ? "attention" : undefined}>{state}</span></div></summary>
    <dl className={styles.facts}><div><dt>Send window begins</dt><dd>{smsOperationDate(item.dueAt, item.call?.timeZone)}</dd></div><div><dt>Send window ends</dt><dd>{smsOperationDate(item.expiresAt, item.call?.timeZone)}</dd></div>{item.call ? <div><dt>Call begins</dt><dd>{smsOperationDate(item.call.startsAt, item.call.timeZone)}</dd></div> : null}<div><dt>Recipient</dt><dd>{item.recipient.name} · {item.recipient.maskedPhone}{item.recipient.sharedPhone ? " · Shared phone" : ""}</dd></div></dl>
    {item.blockedReason ? <p className={styles.note}>{reason(item.blockedReason)}</p> : null}
    <TextBody body={item.body} label="Text prepared for this occurrence" />
    {item.confirmation === "required" ? <><p className={styles.note}>This member needs an opt-in confirmation first. The call reminder follows only if that confirmation is accepted.</p>{item.confirmationBody ? <TextBody body={item.confirmationBody} label="Confirmation sent first" /> : null}</> : item.confirmation === "accepted" ? <p className={styles.messageNote}>Opt-in confirmation already accepted.</p> : item.confirmation === "unavailable" ? <p className={styles.note}>The confirmation needs review before this call reminder can proceed{item.confirmationStatus ? ` (${item.confirmationStatus.replaceAll("_", " ")})` : ""}.</p> : null}
  </details>;
}

function HistoryCard({ item }: { item: MemberSmsHistoryItem }) {
  const status = smsDeliveryLabel(item);
  return <details className={`operator-glass ${styles.card}`}><summary aria-label={`${item.recipient.name}: ${status.label}`}><div className={styles.rowHeading}><div className={styles.identity}><h3>{item.recipient.name}</h3><p>{item.recipient.maskedPhone} · {item.call?.title ?? (item.kind === "opt_in_confirmation" ? "Text opt-in confirmation" : item.kind === "call_reminder" ? "Call reminder" : "Membership reminder")}</p><p>{smsOperationDate(item.createdAt, item.call?.timeZone)}</p></div><span className={styles.status} data-tone={status.tone}>{status.label}</span></div></summary>
    <p className={styles.note}>{status.explanation}</p>
    <dl className={styles.facts}><div><dt>Attempt started</dt><dd>{smsOperationDate(item.createdAt, item.call?.timeZone)}</dd></div><div><dt>Last status update</dt><dd>{smsOperationDate(item.deliveryUpdatedAt ?? item.updatedAt, item.call?.timeZone)}</dd></div>{item.blockedReason ? <div><dt>Reason</dt><dd>{reason(item.blockedReason)}</dd></div> : null}{item.deliveryErrorCode ? <div><dt>Provider error</dt><dd>{item.deliveryErrorCode}</dd></div> : null}</dl>
    {item.body ? <><TextBody body={item.body} label={item.bodySource === "snapshot" ? "Recorded message" : "Verified message wording"} /><p className={styles.messageNote}>{item.bodySource === "snapshot" ? "Saved with this send attempt." : "Verified against the original send record."}</p></> : <p className={styles.note}>Exact wording was not saved for this older attempt and cannot be verified. Its recorded delivery status is shown above.</p>}
  </details>;
}

function JobCard({ item, checkedAt }: { item: MemberSmsOperationJob; checkedAt: string }) {
  const ended = Date.parse(item.expiresAt) <= Date.parse(checkedAt);
  const label = (item.status === "processing" && ended) || item.outcome === "unknown" ? "Needs review" : item.status === "processing" ? "Processing" : item.status === "queued" ? ended ? "Window ended" : "Queued" : item.outcome === "expired" ? "Expired" : "No send recorded";
  return <details className={`operator-glass ${styles.card}`}><summary><div className={styles.rowHeading}><div className={styles.identity}><h3>{item.recipient.name}</h3><p>{item.recipient.maskedPhone} · {item.call?.title ?? (item.kind === "call_reminder" ? "Call reminder" : "Text opt-in confirmation")}</p><p>{smsOperationDate(item.dueAt, item.call?.timeZone)}</p></div><span className={styles.status} data-tone={label === "Needs review" ? "attention" : undefined}>{label}</span></div></summary><p className={styles.note}>No provider send attempt is recorded for this job.{item.status === "processing" && ended ? " Processing did not finish before the send window ended. It will not be automatically retried." : ""}</p><dl className={styles.facts}><div><dt>Send window</dt><dd>{smsOperationDate(item.dueAt, item.call?.timeZone)} – {smsOperationDate(item.expiresAt, item.call?.timeZone)}</dd></div><div><dt>Last update</dt><dd>{smsOperationDate(item.updatedAt, item.call?.timeZone)}</dd></div>{item.outcome ? <div><dt>Outcome</dt><dd>{reason(item.outcome)}</dd></div> : null}</dl></details>;
}

export default function OperatorSmsOperations({ preview = false, previewCommunications = [], view, bucket, onNavigate }: Props) {
  const [overview, setOverview] = useState<MemberSmsOperationsOverview | null>(() => preview ? sampleOverview(previewCommunications) : null);
  const [pending, setPending] = useState<"loading" | "more" | null>(preview ? null : "loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const requestId = useRef(0), controller = useRef<AbortController | null>(null);
  const section = view === "upcoming" || view === "activity" ? view : "catalog";
  async function load(more = false) {
    if (preview) { setOverview(sampleOverview(previewCommunications)); return; }
    controller.current?.abort(); controller.current = new AbortController();
    const signal = controller.current.signal, id = ++requestId.current;
    const cursor = more ? overview?.history.nextCursor : null;
    setPending(more ? "more" : "loading"); setError("");
    try {
      const response = await fetch(`${API}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET", cache: "no-store", signal });
      const result = await response.json().catch(() => null) as (MemberSmsOperationsOverview & { error?: string }) | null;
      if (!response.ok || !result) throw new Error(result?.error ?? "Text operations are unavailable. Try refreshing.");
      if (id !== requestId.current || signal.aborted) return;
      setOverview(current => more && current ? { ...current, history: { items: [...current.history.items, ...result.history.items.filter(item => !current.history.items.some(existing => existing.id === item.id))], nextCursor: result.history.nextCursor } } : result);
    } catch (failure) { if (id === requestId.current && !signal.aborted) setError(failure instanceof Error ? failure.message : "Text operations are unavailable. Try refreshing."); }
    finally { if (id === requestId.current && !signal.aborted) setPending(null); }
  }
  function cancelRequest() { requestId.current++; controller.current?.abort(); }
  useEffect(() => { if (!preview) void load(); return cancelRequest; /* Initial request is intentionally independent of email configuration. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (item: MemberSmsUpcomingItem | MemberSmsHistoryItem) => !needle || `${item.recipient.name} ${item.recipient.maskedPhone} ${item.call?.title ?? "Text opt-in confirmation"}`.toLocaleLowerCase().includes(needle);
  const upcoming = overview?.upcoming.items.filter(matches) ?? [], history = overview?.history.items.filter(matches) ?? [];
  const jobs = overview?.jobs.items.filter(item => !needle || `${item.recipient.name} ${item.recipient.maskedPhone} ${item.call?.title ?? "Text opt-in confirmation"}`.toLocaleLowerCase().includes(needle)) ?? [];
  const templates = overview?.templates.filter(item => templateInBucket(item, bucket)) ?? [];
  const manual = overview?.communications.filter(item => item.channel === "texts" && !item.id.startsWith("sms:") && (!bucket || item.bucket === bucket)) ?? [];
  const state = overview?.automation.state;
  const stateLabel = preview ? "Sample · sending disabled" : state === "enabled" ? "Automatic texts enabled" : state === "disabled" ? "Automatic texts paused" : state === "not_activated" ? "Activation scheduled" : "Text delivery needs setup";
  return <section className={styles.workspace} aria-label="Text operations" aria-busy={pending !== null}>
    <header className={styles.header}><div><h2 className="operator-page-heading">Texts</h2><p>See the wording, send windows, recipients, and delivery results for member texts.</p></div><button className={OPERATOR_BUTTON_CLASS} type="button" disabled={pending !== null} onClick={() => void load()}>Refresh texts</button></header>
    {preview ? <p className={styles.note}>Sample workspace. Names, schedules, and deliveries below are fictional. Nothing is saved or sent.</p> : null}
    {overview ? <div className={`operator-glass ${styles.readiness}`}><strong>{stateLabel}</strong><p>Checked every five minutes.</p><p>{overview.upcoming.currentOptIns} current {overview.upcoming.currentOptIns === 1 ? "opt-in" : "opt-ins"}.</p></div> : null}
    <nav className={`operator-glass ${styles.nav}`} aria-label="Text views">{([['catalog','Messages'],['upcoming','Upcoming'],['activity','Activity']] as const).map(([value,label]) => <button key={value} type="button" aria-current={section === value ? "page" : undefined} onClick={() => { setQuery(""); onNavigate({view:value}); }}>{label}</button>)}</nav>
    {error ? <div className={styles.error} role="alert"><p>{error}</p>{overview ? <p>Showing the last successfully loaded records. Refresh to check the current state.</p> : null}</div> : null}
    {!overview ? <p role="status" className={styles.note}>{pending ? "Loading text operations…" : "Text records could not be loaded."}</p> : <>
      {overview.automation.missing.length ? <p className={styles.note}>Setup needed: {overview.automation.missing.join(", ")}.</p> : null}
      {overview.automation.warnings.length ? <aside className={`operator-emphasis ${styles.error}`} data-operator-tone="wait" aria-label="Text delivery notes">{overview.automation.warnings.map(warning => <p key={warning}>{warning}</p>)}</aside> : null}
      {section === "catalog" ? <>
        <div className={styles.toolbar}><h3>Automatic messages</h3><label>Member journey<select value={bucket ?? "all"} onChange={event => onNavigate({bucket:event.currentTarget.value === "all" ? null : event.currentTarget.value as CommunicationBucket})}><option value="all">All stages</option>{COMMUNICATION_BUCKETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
        <div className={styles.stack}>{templates.map(item => <article key={item.id} className={`operator-glass ${styles.card}`}><h3>{item.title}</h3><dl className={styles.facts}><div><dt>When it goes out</dt><dd>{item.timing}</dd></div><div><dt>Who receives it</dt><dd>{item.audience}</dd></div><div><dt>Trigger</dt><dd>{item.trigger}</dd></div></dl><TextBody body={item.body} label={item.bodyIsExample ? "Example with sample call details" : "Exact message wording"} />{item.bodyIsExample ? <p className={styles.messageNote}>The real call details replace these examples at sending time. {item.variables.length ? `Changes with each call: ${item.variables.join(", ")}.` : ""}</p> : null}</article>)}</div>
        {!templates.length ? <Empty title="No automatic texts in this stage">Choose another stage to review its messages.</Empty> : null}
        {manual.length ? <section className={styles.manual} aria-label="Manual texts"><h3>Manual texts</h3><p className={styles.note}>These are prepared and sent separately from automatic member texts.</p><div className={styles.stack}>{manual.map(item => <article className={`operator-glass ${styles.card}`} key={item.id}><div className={styles.rowHeading}><h4>{item.title}</h4><span className={styles.status}>{item.statusLabel}</span></div><dl className={styles.facts}><div><dt>When</dt><dd>{item.timing}</dd></div><div><dt>Audience</dt><dd>{item.audience}</dd></div></dl>{item.detail ? <p className={styles.note}>{item.detail}</p> : null}{item.action?.href && !preview ? <Link className={styles.action} href={item.action.href}>{item.action.label} →</Link> : null}</article>)}</div></section> : null}
      </> : <>
        <div className={styles.toolbar}><h3>{section === "upcoming" ? "Upcoming texts" : "Text delivery activity"}</h3><label>Find a recipient or call<input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Name, last four digits, or call" /></label></div>
        {section === "upcoming" ? <>
          <p className={styles.note}>{overview.upcoming.label} Through {smsOperationDate(overview.upcoming.horizonEnd)}. Projected recipients and wording reflect current information; consent, access, call details, and opt-outs are checked again before sending. The send window is not a delivery guarantee.</p>
          {overview.upcoming.truncated ? <p role="status" className={styles.note}>This is a limited set of upcoming texts. Additional occurrences or recipients are not shown.</p> : null}
          {upcoming.length ? <div className={styles.stack}>{upcoming.map(item => <UpcomingCard key={item.id} item={item} />)}</div> : <Empty title={needle ? "No upcoming texts match this search" : "No texts are due in this window"}>{needle ? "Try another recipient or call name." : "Future eligible calls and new opt-ins will appear here. Existing consent alone does not trigger a new confirmation."}</Empty>}
        </> : <>
          <p className={styles.note}>Actual send attempts and the latest provider updates. Acceptance and carrier delivery are separate. Times without a call timezone are shown in Mountain time.</p>
          {history.length ? <div className={styles.stack}>{history.map(item => <HistoryCard key={item.id} item={item} />)}</div> : <Empty title={needle ? "No loaded activity matches this search" : "No text attempts recorded"}>{needle ? "Try another recipient or call, or load older activity." : "Delivery activity appears after an actual send attempt."}</Empty>}
          {overview.history.nextCursor ? <button className={`${OPERATOR_BUTTON_CLASS} mt-4`} type="button" disabled={pending !== null} onClick={() => void load(true)}>{pending === "more" ? "Loading older activity…" : "Load older activity"}</button> : null}
          {overview.jobs.items.length || overview.jobs.truncated ? <section className={styles.manual} aria-label="Jobs without a send attempt"><h3>Jobs without a send attempt</h3><p className={styles.note}>Queued, interrupted, expired, or stopped jobs are separate from carrier delivery results.</p>{overview.jobs.truncated ? <p className={styles.note}>Only the most recent jobs are shown, with processing jobs first.</p> : null}<div className={styles.stack}>{jobs.map(item => <JobCard key={item.id} item={item} checkedAt={overview.generatedAt} />)}</div>{!jobs.length ? <p className={styles.note}>No loaded jobs match this search.</p> : null}</section> : null}
        </>}
      </>}
      <footer className={styles.footer}><p>Checked {smsOperationDate(overview.generatedAt)}.</p><p>{section === "activity" ? `${overview.history.items.length} ${overview.history.items.length === 1 ? "attempt" : "attempts"} loaded` : section === "upcoming" ? `${upcoming.length} ${upcoming.length === 1 ? "occurrence" : "occurrences"} shown` : "Read-only review"}</p></footer>
    </>}
  </section>;
}
