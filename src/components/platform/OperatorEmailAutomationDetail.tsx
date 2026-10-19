"use client";

import { useState } from "react";
import Link from "next/link";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import { CADENCE_STAGE_LABELS, type CadenceStage } from "@/lib/communications/member-email-cadence-model";
import type { CadenceDeliveryOutcome, CadenceManagedCall, CadenceManagementDetail } from "@/lib/communications/member-email-cadence-management";
import styles from "./OperatorEmailAutomationDetail.module.css";

export type OperatorEmailAutomationDetailProps = {
  detail: CadenceManagementDetail;
  previewStage: number;
  recipientEventId: string;
  pending: string | null;
  preview: boolean;
  onStage: (index: number) => void;
  onRecipientEvent: (eventId: string) => void;
  onInspectRecipients: () => void;
  onEdit: () => void;
  onPause: () => void;
  onClose: () => void;
  onSelectCall?: (planId: string) => void;
};

type DetailView = "emails" | "audience" | "activity";
const STAGE_NAMES: Record<CadenceStage, string> = {
  orientation: "Orientation", one_week: "One-week reminder", two_days: "Two-day reminder",
  day_before: "Tomorrow’s call", day_of: "Today’s call",
};

function dateLabel(value: string, timeZone = "America/Denver") {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(new Date(value));
  } catch { return "Time unavailable"; }
}

function stageTiming(stage: CadenceStage, detail: CadenceManagementDetail) {
  if (stage === "orientation") return "16 days before";
  if (stage === "one_week") return "7 days before";
  if (stage === "two_days") return "48 hours before";
  if (stage === "day_before") return "24 hours before";
  return detail.draft.kind === "foundations_01" && detail.draft.track === "members" ? "8 a.m. Mountain on call day" : "2½ hours before";
}

// Email HTML remains isolated from the operator app, even when a saved design changes.
function safePreview(html: string) {
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\' https:; font-src https: data:; script-src \'none\'; connect-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">';
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, head => `${head}${policy}`) : `${policy}${html}`;
}

function deliveryLabel(status: CadenceDeliveryOutcome["status"]) {
  switch (status) {
    case "sent": return "Accepted by provider";
    case "manual_review": return "Needs delivery review";
    case "cancelled": return "Skipped / cancelled";
    case "sending": return "Sending";
    case "pending": return "Waiting to send";
    case "failed": return "Failed";
  }
}

function callStatus(call: CadenceManagedCall) {
  if (call.status === "manual_override") return "Custom reminders";
  if (call.status === "inheritance_pending") return "Setup pending";
  if (call.status === "cancelled") return "Call cancelled";
  if (call.status === "past") return "Call finished";
  if (call.status === "changed" || call.status === "unavailable" || call.status === "blocked") return "Needs attention";
  if (!call.active || call.status === "paused") return "Paused";
  return "Uses sequence";
}

function Badge({ children, attention = false }: { children: React.ReactNode; attention?: boolean }) {
  return <span className={styles.badge} data-attention={attention || undefined}>{children}</span>;
}

export default function OperatorEmailAutomationDetail({ detail, previewStage, recipientEventId, pending, preview, onStage, onRecipientEvent, onInspectRecipients, onEdit, onPause, onClose, onSelectCall }: OperatorEmailAutomationDetailProps) {
  const [view, setView] = useState<DetailView>("emails");
  const selectedIndex = detail.previews[previewStage] ? previewStage : 0;
  const email = detail.previews[selectedIndex];
  const selectedCall = detail.calls.find(call => call.id === recipientEventId);
  const checked = detail.recipientsChecked && detail.selectedEventId === recipientEventId;
  const eligible = checked ? detail.recipients.filter(recipient => recipient.eligible) : [];
  const excluded = checked ? detail.recipients.filter(recipient => !recipient.eligible) : [];
  const sequenceEnabled = detail.active;
  const sendingEnabled = detail.configuration.enabled && detail.configuration.ready;
  const customCall = detail.scope === "sequence" && selectedCall?.status === "manual_override";
  const nextState = !sequenceEnabled || detail.status === "paused" ? "Paused"
    : !sendingEnabled ? "Sending paused"
      : ["changed", "unavailable", "blocked"].includes(detail.status) ? "Needs attention"
        : detail.status === "cancelled" ? "Call cancelled"
          : detail.scope === "event" && checked && eligible.length === 0 && detail.calls.length ? "No eligible recipients"
            : detail.nextReminder ? "Scheduled" : detail.scope === "sequence" ? "Waiting for a call" : "No upcoming reminders";
  const occurrence = email ? detail.occurrences.find(item => item.stage === email.stage) : undefined;
  const occurrenceMatchesCall = selectedCall && detail.selectedEventId === selectedCall.id && (!detail.previewIsExample || preview);
  const stageDate = occurrence && occurrenceMatchesCall ? dateLabel(occurrence.dueAt, selectedCall.timeZone) : null;
  const recentFailures = detail.recentDeliveries.filter(item => item.status === "failed" || item.status === "manual_review").length;

  function audienceContent(expanded: boolean) {
    return <section className={`${styles.audience} ${expanded ? styles.audienceExpanded : ""}`} aria-labelledby={expanded ? "automation-full-audience-heading" : "automation-audience-heading"} aria-busy={pending === "recipients"}>
      <div className={styles.sectionHeading}><h4 id={expanded ? "automation-full-audience-heading" : "automation-audience-heading"}>Who receives it</h4>{detail.calls.length ? <button type="button" className={styles.textButton} onClick={onInspectRecipients} disabled={!!pending || !recipientEventId}>{pending === "recipients" ? "Checking…" : "Refresh audience"}</button> : null}</div>
      <p className={styles.muted}>{detail.audienceSummary}</p>
      {pending === "recipients" ? <p role="status" className={styles.recipientCount}>Checking this call’s audience…</p> : checked ? <>
        <p className={styles.recipientCount} role="status"><strong>{eligible.length}</strong> eligible <span>· {excluded.length} excluded</span></p>
        {eligible.length === 0 ? <p className={styles.attention}>No eligible recipients. Review this call’s audience and the reasons below.</p> : null}
        {eligible.length ? <details className={styles.peopleDisclosure} open={expanded || undefined}>
          <summary>View {eligible.length === 1 ? "recipient" : `all ${eligible.length} recipients`}</summary>
          <ul className={styles.peopleList}>{eligible.map(person => <li key={person.memberId}><strong>{person.name || "Member"}</strong><span>{person.email}</span></li>)}</ul>
        </details> : null}
        {excluded.length ? <details className={styles.peopleDisclosure} open={expanded || eligible.length === 0 || undefined}>
          <summary>{excluded.length} excluded · see why</summary>
          <ul className={styles.peopleList}>{excluded.map(person => <li key={person.memberId}><strong>{person.name || "Member"}</strong><span>{person.email}</span><p>{person.reason || "Not eligible for this reminder."}</p></li>)}</ul>
        </details> : null}
        {!detail.recipients.length ? <p className={styles.muted}>This call has no recipients yet.</p> : null}
      </> : <p className={styles.emptyAudience}>{detail.calls.length ? "The audience has not been verified for this call. Refresh the audience to check eligibility." : "Recipients will appear when a matching call is scheduled."}</p>}
      <p className={styles.smallNote}>Current access and email preferences are checked again before each send.</p>
    </section>;
  }

  return <section className={styles.detail} aria-labelledby="automation-detail-heading" aria-busy={pending === "detail"}>
    <header className={styles.header}>
      <button className={styles.textButton} type="button" onClick={onClose} disabled={!!pending}>← Back to automated emails</button>
      <div className={styles.titleRow}>
        <div className={styles.titleCopy}><p className={styles.eyebrow}>{detail.scope === "sequence" ? "Email sequence" : "Call reminders"} · {detail.draft.track === "founder_test" ? "Founder test" : "Members"}</p><h3 id="automation-detail-heading" tabIndex={-1}>{detail.title}</h3></div>
        <div className={styles.actions}><button className={OPERATOR_BUTTON_CLASS} type="button" disabled={!!pending} onClick={onEdit}>{detail.active ? "Edit emails" : "Review and resume"}</button>{detail.active ? <button className={styles.secondaryButton} type="button" disabled={preview || !!pending} onClick={onPause}>{pending?.startsWith("pause") ? "Pausing…" : detail.scope === "sequence" ? "Pause sequence" : "Pause reminders"}</button> : null}</div>
      </div>
      <div className={styles.statusRow}><span>{detail.scope === "sequence" ? "Sequence" : "Reminders"}: <Badge>{sequenceEnabled ? "Enabled" : "Paused"}</Badge></span><span>Next email: <Badge attention={nextState === "Needs attention" || nextState === "No eligible recipients"}>{nextState}</Badge></span></div>
      {detail.nextReminder ? <p className={styles.nextSend}><strong>{CADENCE_STAGE_LABELS[detail.nextReminder.stage]}</strong><span>{dateLabel(detail.nextReminder.dueAt, detail.nextReminder.timeZone)}</span><span>{detail.nextReminder.eventTitle}</span></p> : <p className={styles.muted}>{detail.status === "paused" && detail.active ? "The saved setup is enabled, but call delivery is paused. Review Audience & calls for details." : detail.scope === "sequence" ? "No future email is scheduled. This sequence can be used for matching calls." : "This call has no remaining scheduled reminders."}</p>}
      {nextState === "Sending paused" ? <p className={styles.smallNote}>Delivery is disabled or its activation time is not configured. A saved schedule alone does not send emails.</p> : null}
    </header>

    <nav className={styles.tabs} aria-label="Automation detail views">{([{ id: "emails", label: "Emails" }, { id: "audience", label: "Audience & calls" }, { id: "activity", label: "Activity" }] as const).map(item => <button className={styles.tab} key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}{item.id === "activity" && recentFailures ? <span aria-label={`${recentFailures} need review`}>{recentFailures}</span> : null}</button>)}</nav>

    {view !== "activity" ? <div className={styles.callContext}>
      <div><label htmlFor="automation-recipient-call">Scheduled call</label>{detail.calls.length ? <select className={OPERATOR_FIELD_CLASS} id="automation-recipient-call" value={recipientEventId} disabled={!!pending} onChange={event => onRecipientEvent(event.currentTarget.value)}><option value="" disabled>Choose a call</option>{detail.calls.map(call => <option key={call.id} value={call.id}>{call.title} · {dateLabel(call.startsAt, call.timeZone)}</option>)}</select> : <p className={styles.muted}>No matching calls yet.</p>}</div>
      <div className={styles.contextNote}>{customCall ? <><p>This call uses custom reminders. The preview below shows the reusable sequence.</p>{onSelectCall && selectedCall?.planId ? <button type="button" className={styles.textButton} disabled={!!pending} onClick={() => onSelectCall(selectedCall.planId!)}>View custom reminders →</button> : null}</> : <p>{detail.previewIsExample ? "Example preview. A scheduled call will supply its own date, link, and recipients." : selectedCall ? <>Showing the message and current audience for <strong>{selectedCall.title}</strong>.</> : "Select a call to view its message and recipients."}</p>}</div>
    </div> : null}

    {view === "emails" ? <div className={styles.emailLayout}>
      <nav className={styles.stages} aria-label="Emails in this sequence"><h4>Emails in this sequence</h4><div className={styles.stageButtons}>{detail.previews.map((item, index) => <button className={styles.stage} type="button" key={item.stage} aria-label={`Preview ${CADENCE_STAGE_LABELS[item.stage]}`} aria-pressed={index === selectedIndex} disabled={!!pending} onClick={() => onStage(index)}><span>{STAGE_NAMES[item.stage]}</span><strong>{stageTiming(item.stage, detail)}</strong></button>)}</div>{!detail.previews.length ? <p className={styles.muted}>No email previews available.</p> : null}</nav>
      <section className={styles.emailPreview} aria-label="Approved automation email preview"><div className={styles.previewHeader}><p className={styles.eyebrow}>Approved email design</p>{email ? <><h4>{STAGE_NAMES[email.stage]}</h4><p className={styles.muted}>{stageTiming(email.stage, detail)}{stageDate ? ` · ${stageDate}` : ""}</p><p className={styles.subject}><span>Subject</span>{email.subject}</p></> : null}</div>{email ? <iframe className={styles.previewFrame} title="Saved automation email design" sandbox="" referrerPolicy="no-referrer" srcDoc={safePreview(email.html)} /> : <p className={styles.emptyAudience}>The saved email could not be rendered. Open the notes below for details.</p>}</section>
      {audienceContent(false)}
    </div> : null}

    {view === "audience" ? <div className={styles.audienceLayout}>{audienceContent(true)}<section className={styles.calls} aria-labelledby="automation-calls-heading"><h4 id="automation-calls-heading">{detail.scope === "sequence" ? "Calls using this sequence" : "This call"}</h4><p className={styles.muted}>Custom reminders and paused calls keep their own settings.</p>{detail.calls.length ? <ul className={styles.callList}>{detail.calls.map(call => <li key={call.id}><div className={styles.callHeading}><strong>{call.title}</strong><Badge attention={callStatus(call) === "Needs attention"}>{detail.scope === "event" && callStatus(call) === "Uses sequence" ? "Enabled" : callStatus(call)}</Badge></div><p className={styles.muted}>{dateLabel(call.startsAt, call.timeZone)}</p>{call.attention ? <p className={styles.attention}>{call.attention}</p> : null}<div className={styles.callActions}>{onSelectCall && call.planId ? <button className={styles.textButton} type="button" disabled={!!pending} onClick={() => onSelectCall(call.planId!)}>View call reminders →</button> : null}{!preview ? <Link className={styles.textButton} href={`/ops/experiences/${encodeURIComponent(call.id)}`}>Manage call ↗</Link> : null}</div></li>)}</ul> : <p className={styles.emptyAudience}>Publish a matching call to give these emails a date and audience.</p>}</section></div> : null}

    {view === "activity" ? <section className={styles.activity} aria-labelledby="automation-activity-heading"><div className={styles.sectionHeading}><h4 id="automation-activity-heading">Recent activity</h4><Link className={styles.textButton} href="/ops/messages?mode=emails">Delivery history ↗</Link></div><p className={styles.muted}>Accepted by provider means the send request succeeded. Check delivery history for delivered, bounced, or complained events.</p>{detail.recentDeliveries.length ? <ul className={styles.activityList}>{detail.recentDeliveries.map(item => <li key={item.id}><div className={styles.callHeading}><strong>{CADENCE_STAGE_LABELS[item.stage]}</strong><Badge attention={item.status === "failed" || item.status === "manual_review"}>{deliveryLabel(item.status)}</Badge></div><p className={styles.muted}>{item.eventTitle} · {dateLabel(item.sentAt ?? item.updatedAt ?? item.dueAt)}</p>{item.reason ? <p className={styles.activityReason}>{item.reason}</p> : null}</li>)}</ul> : <p className={styles.emptyAudience}>No deliveries have been recorded for this automation yet.</p>}</section> : null}

    <details className={styles.notes}><summary>Schedule, rules & notes{detail.warnings.length ? <span>{detail.warnings.length} {detail.warnings.length === 1 ? "note" : "notes"}</span> : null}</summary><dl><div><dt>Timing</dt><dd>{detail.timingSummary}</dd></div><div><dt>How calls use this sequence</dt><dd>{detail.inheritanceSummary}</dd></div><div><dt>Saved design</dt><dd>{detail.template.name} · Revision {detail.revision}</dd></div><div><dt>Review before sending</dt><dd>Edits and resumptions require a fresh email and recipient review before activation. New members receive future stages only.</dd></div></dl>{detail.warnings.length ? <ul aria-label="Automation notes">{detail.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}</details>
  </section>;
}
