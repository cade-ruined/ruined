"use client";

import Link from "next/link";
import { OPERATOR_BUTTON_CLASS } from "./operatorStyles";
import { AUTOMATION_STAGE_NAMES } from "@/lib/communications/email-automation-view";
import type { CadenceEvent, CadenceStage } from "@/lib/communications/member-email-cadence-model";
import type { CadenceDraft } from "@/lib/communications/member-email-cadence-types";
import type { ResendEmailTemplate } from "@/lib/communications/resend-email-model";
import styles from "./OperatorEmailAutomationReview.module.css";

type EmailPreview = { html: string; subject: string; text: string };
export type AutomationReview = {
  reviewToken: string; expiresAt?: string; preview: EmailPreview; previews?: Array<EmailPreview & { stage: string }>;
  scope?: "event" | "sequence";
  matchingEvents?: Array<Pick<CadenceEvent, "id" | "title" | "startsAt" | "timeZone">>;
  occurrences: Array<{ stage: string; dueAt: string; expiresAt: string }>;
  recipients: Array<{ memberId: string; name: string; email: string; eligible: boolean; reason: string | null }>;
  warnings: string[];
};

type Props = {
  review: AutomationReview; draft: CadenceDraft; previousDraft?: CadenceDraft;
  event?: CadenceEvent; template: ResendEmailTemplate | null; context: string;
  previewStage: number; pending: string | null; preview: boolean; expired: boolean;
  deliveryReady: boolean; setupRequired: boolean;
  onStage: (index: number) => void; onBack: () => void; onActivate: () => void;
};

function stageName(value: string) { return AUTOMATION_STAGE_NAMES[value as CadenceStage] ?? value.replaceAll("_", " "); }
function dateLabel(value: string, timeZone = "America/Denver") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  try { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date); }
  catch { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver" }).format(date); }
}
function safePreview(html: string) {
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\' https:; font-src https: data:; script-src \'none\'; connect-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">';
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, head => `${head}${policy}`) : `${policy}${html}`;
}
function changes(draft: CadenceDraft, previous: CadenceDraft | undefined, template: ResendEmailTemplate | null) {
  if (!previous) return "New automation";
  const stages = (Object.keys(AUTOMATION_STAGE_NAMES) as CadenceStage[]).filter(stage =>
    (draft.messages?.[stage]?.subject ?? "") !== (previous.messages?.[stage]?.subject ?? "") ||
    (draft.messages?.[stage]?.message ?? "") !== (previous.messages?.[stage]?.message ?? ""));
  const copyChanged = template?.fields.some(field => ![draft.bodyTarget, draft.headingTarget].includes(`copy:${field.key}`) &&
    (draft.copy?.[field.key] ?? field.value) !== (previous.copy?.[field.key] ?? field.value));
  const designChanged = copyChanged || draft.templateId !== previous.templateId || draft.templateVersion !== previous.templateVersion ||
    draft.bodyTarget !== previous.bodyTarget || draft.headingTarget !== previous.headingTarget ||
    JSON.stringify(draft.bindings) !== JSON.stringify(previous.bindings);
  const labels = [...stages.map(stageName), ...(designChanged ? ["Design settings"] : [])];
  return labels.length ? labels.join(" · ") : "No message or design changes";
}

export default function OperatorEmailAutomationReview({ review, draft, previousDraft, event, template, context, previewStage, pending, preview, expired, deliveryReady, setupRequired, onStage, onBack, onActivate }: Props) {
  const sequence = review.scope === "sequence";
  const email = review.previews?.[previewStage] ?? review.preview;
  const selectedStage = review.previews?.[previewStage]?.stage;
  const occurrence = selectedStage ? review.occurrences.find(item => item.stage === selectedStage) : review.occurrences[0];
  const eligible = review.recipients.filter(recipient => recipient.eligible).length;
  const excluded = review.recipients.length - eligible;
  const activationDisabled = preview || !!pending || expired || setupRequired || (!sequence && (!eligible || !review.occurrences.length));

  return <section className={styles.review} aria-labelledby="automation-review-heading">
    <header className={styles.header}>
      <p className={styles.eyebrow}>Final review</p>
      <h3 id="automation-review-heading" tabIndex={-1}>Review before activating</h3>
      <p className={styles.context}>{context}</p>
    </header>
    <div className={styles.layout}>
      <aside className={styles.summary} aria-label="Activation summary">
        <dl className={styles.facts}>
          <div><dt>Applies to</dt><dd className={styles.scope}>{sequence ? "All matching calls" : "This call only"}</dd></div>
          <div><dt>{previousDraft ? "Changes" : "Setup"}</dt><dd>{changes(draft, previousDraft, template)}</dd></div>
          <div><dt>{sequence ? "Example call audience" : "Audience"}</dt><dd>{eligible} eligible · {excluded} excluded</dd></div>
        </dl>
        <p className={styles.boundary}>{sequence ? "Activates the full sequence for current and future matching published calls. Individual overrides and paused calls keep their settings." : "Activates this call’s future reminders. Past reminders are skipped. Other calls stay unchanged."}</p>
        {sequence ? <p className={styles.note}>Each call uses its own eligible audience. Members joining later receive only future stages.</p> : null}
        {!deliveryReady ? <p className={styles.warning}>Delivery is currently paused. This setup will wait until automatic delivery is enabled and ready.</p> : null}
        {!sequence && !eligible ? <p className={styles.warning}>No recipients currently qualify. Check this call’s audience and reminder preferences before activating.</p> : null}
        {!sequence && !review.occurrences.length ? <p className={styles.warning}>No future reminders remain for this call.</p> : null}
        {expired ? <p className={styles.warning} role="alert">This review has expired. Review the setup again before activating.</p> : null}
        <div className={styles.actions}>
          <button className={OPERATOR_BUTTON_CLASS} disabled={activationDisabled} onClick={onActivate} type="button">{pending === "activate" ? "Activating…" : preview ? "Activation off in preview" : sequence ? "Activate sequence" : "Activate automation"}</button>
          <button className={styles.back} disabled={!!pending} onClick={onBack} type="button">Back to editing</button>
        </div>
        {review.expiresAt ? <p className={styles.note}>Review valid until {dateLabel(review.expiresAt, event?.timeZone)} ({event?.timeZone ?? "America/Denver"}). Editing requires a new review.</p> : null}
      </aside>
      <section className={styles.email} aria-label="Automation email preview">
        <div className={styles.previewHeader}>
          <h4>Email preview</h4>
          {review.previews?.length ? <div className={styles.stages} aria-label="Review reminder emails">{review.previews.map((item, index) => <button type="button" key={item.stage} aria-pressed={previewStage === index} onClick={() => onStage(index)}>{stageName(item.stage)}</button>)}</div> : null}
          <p className={styles.subject}><span>Subject</span>{email.subject}</p>
          {occurrence ? <p className={styles.note}>{sequence ? "Example send" : "Scheduled send"}: {dateLabel(occurrence.dueAt, event?.timeZone)} · {event?.timeZone ?? "America/Denver"}</p> : <p className={styles.note}>No future send for this reminder{sequence ? " on the example call" : ""}.</p>}
          {sequence ? <p className={styles.note}>{event ? `Example call: ${event.title}.` : "Preview uses a representative future call."}</p> : null}
        </div>
        <iframe className={styles.frame} title="Automation email design" sandbox="" referrerPolicy="no-referrer" srcDoc={safePreview(email.html)} />
      </section>
    </div>
    {review.warnings.length ? <div className="operator-emphasis mt-5 p-4 text-sm" data-operator-tone="wait"><ul className="space-y-2">{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
    <div className={styles.details}>
      {sequence ? <details aria-label="Matching published calls"><summary>Matching published calls <span>{review.matchingEvents?.length ?? 0}</span></summary>{review.matchingEvents?.length ? <ul>{review.matchingEvents.map(item => <li key={item.id}>{preview ? <strong>{item.title}</strong> : <Link className="font-semibold underline underline-offset-4" href={`/ops/experiences/${encodeURIComponent(item.id)}`}>{item.title} ↗</Link>}<span>{dateLabel(item.startsAt, item.timeZone)} · {item.timeZone}</span></li>)}</ul> : <p>No matching calls are scheduled yet. The sequence can be approved now and will apply when matching calls are published.</p>}</details> : null}
      <details><summary>{sequence ? "Example reminder timing" : "Scheduled reminders"} <span>{review.occurrences.length}</span></summary><p>Times shown in {event?.timeZone ?? "America/Denver"}. {sequence ? "Timing is calculated from each call’s scheduled time." : "Only future stages can be activated."}</p><ul>{review.occurrences.map(item => <li key={`${item.stage}:${item.dueAt}`}><strong>{stageName(item.stage)}</strong><span>{dateLabel(item.dueAt, event?.timeZone)}</span><span>Expires {dateLabel(item.expiresAt, event?.timeZone)}</span></li>)}</ul>{!review.occurrences.length ? <p>{sequence ? "There are no remaining reminders for this example. Future matching calls use the approved sequence." : "No future reminders are available for this event."}</p> : null}</details>
      <details><summary>{sequence ? "Example call recipients" : "Recipients"} <span>{eligible} eligible · {excluded} excluded</span></summary><p>Eligibility and communication choices are checked again before each delivery.</p>{review.recipients.length ? <ul>{review.recipients.map(recipient => <li key={recipient.memberId}><strong>{recipient.name || "Member"}</strong><span>{recipient.email}</span><span>{recipient.eligible ? "Eligible" : `Excluded: ${recipient.reason || "Not eligible for this reminder."}`}</span></li>)}</ul> : <p>{sequence ? "No recipients are included in this example. Future calls resolve their own audience." : "No recipients currently qualify. Check the call audience, membership access, and reminder preferences. Foundations and founder tests also need confirmed invitations in Events."}</p>}</details>
    </div>
  </section>;
}
