"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import { cadenceCopy, cadenceMessageDefaults, cadenceMessagesValidationError } from "@/lib/communications/member-email-cadence-copy";
import {
  CADENCE_KINDS, CADENCE_KIND_LABELS, CADENCE_STAGE_LABELS, cadenceOccurrences,
  type CadenceEvent, type CadenceKind, type CadenceStage, type CadenceTrack,
} from "@/lib/communications/member-email-cadence-model";
import type { CadenceManagementOverview } from "@/lib/communications/member-email-cadence-management";
import type { CadenceBindingSource, CadenceDraft } from "@/lib/communications/member-email-cadence-types";
import type { ResendEmailTemplate } from "@/lib/communications/resend-email-model";

const SOURCES: Array<{ value: CadenceBindingSource; label: string }> = [
  { value: "literal", label: "Fixed text" }, { value: "member_name", label: "Member name" },
  { value: "call_title", label: "Call title" }, { value: "call_date", label: "Call date" },
  { value: "call_time", label: "Call time" }, { value: "call_url", label: "Call link" },
  { value: "profile_url", label: "Member profile link" }, { value: "preferences_url", label: "Email reminder preferences link" },
];

export type OperatorEmailAutomationEditorProps = {
  draft: CadenceDraft;
  template: ResendEmailTemplate | null;
  overview: CadenceManagementOverview;
  pending: string | null;
  editing?: boolean;
  preview?: boolean;
  initialStage?: CadenceStage;
  onStage?: (stage: CadenceStage) => void;
  onDraft: (patch: Partial<CadenceDraft>) => void;
  onSelectTemplate: (id: string) => void | Promise<void>;
  onReview: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

/** Only exact, unambiguous field names are connected without operator selection. */
export function suggestedCadenceDesignConnections(template: ResendEmailTemplate): Pick<CadenceDraft, "bodyTarget" | "headingTarget" | "bindings" | "copy"> {
  const fields = [
    ...template.fields.map(field => ({ key: field.key.toLowerCase(), target: `copy:${field.key}` })),
    ...template.variables.filter(variable => variable.type === "string").map(variable => ({ key: variable.key.toLowerCase(), target: `variable:${variable.key}` })),
  ];
  const uniqueTarget = (keys: string[]) => {
    const matches = fields.filter(field => keys.includes(field.key));
    return matches.length === 1 ? matches[0].target : undefined;
  };
  const sourceByKey: Record<string, CadenceBindingSource> = {
    MEMBER_NAME: "member_name", CALL_TITLE: "call_title", CALL_DATE: "call_date", CALL_TIME: "call_time",
    CALL_URL: "call_url", PROFILE_URL: "profile_url", PREFERENCES_URL: "preferences_url",
  };
  const bindings = Object.fromEntries(template.variables.map(variable => {
    const source = variable.type === "string" ? sourceByKey[variable.key.toUpperCase()] : undefined;
    return [variable.key, source ? { source } : { source: "literal" as const, value: variable.fallbackValue == null ? "" : String(variable.fallbackValue) }];
  }));
  return {
    bodyTarget: uniqueTarget(["body", "message", "main_message"]) ?? "",
    headingTarget: uniqueTarget(["heading", "headline"]),
    bindings,
    copy: Object.fromEntries(template.fields.map(field => [field.key, field.value])),
  };
}

function exampleEvent(kind: CadenceKind): CadenceEvent {
  return {
    id: "editor-example", title: `${CADENCE_KIND_LABELS[kind]} — example call`,
    startsAt: "2030-11-05T22:00:00.000Z", endsAt: "2030-11-05T23:30:00.000Z", timeZone: "America/Denver",
  };
}

function timingLabel(stage: CadenceStage, kind: CadenceKind, track: CadenceTrack): string {
  if (stage === "orientation") return "16 days before the call";
  if (stage === "one_week") return "7 days before the call";
  if (stage === "two_days") return "48 hours before the call";
  if (stage === "day_before") return "24 hours before the call";
  return kind === "foundations_01" && track === "members" ? "8 a.m. Mountain time" : "2½ hours before the call";
}

function callDate(event: CadenceEvent): string {
  try { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: event.timeZone }).format(new Date(event.startsAt)); }
  catch { return "Time unavailable"; }
}

export default function OperatorEmailAutomationEditor({
  draft, template, overview, pending, editing = false, preview = false, initialStage, onStage, onDraft, onSelectTemplate, onReview,
}: OperatorEmailAutomationEditorProps) {
  const [requestedStage, setRequestedStage] = useState<CadenceStage>(initialStage ?? "day_before");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const event = overview.events.find(item => item.id === draft.eventId);
  const messageEvent = event ?? exampleEvent(draft.kind);
  const occurrences = cadenceOccurrences(messageEvent, draft.kind, draft.track);
  const stage = occurrences.find(item => item.stage === requestedStage)?.stage ?? occurrences[0]?.stage;
  const defaults = stage ? cadenceMessageDefaults({ event: messageEvent, kind: draft.kind, track: draft.track, stage }) : null;
  const custom = stage ? draft.messages?.[stage] : undefined;
  const subject = custom?.subject ?? defaults?.subject ?? "";
  const message = custom?.message ?? defaults?.message ?? "";
  const messageError = cadenceMessagesValidationError(draft.messages);
  const draftPreview = stage ? cadenceCopy({ event: messageEvent, kind: draft.kind, track: draft.track, stage, memberName: "Alex", siteUrl: "https://members.theruinedproject.com", message: custom }) : null;
  const sequenceScope = draft.scope === "sequence";
  const disabled = Boolean(pending) || overview.setupRequired;
  const mappingInvalid = !draft.bodyTarget || draft.bodyTarget === draft.headingTarget;
  const targets = template ? [
    ...template.variables.filter(variable => variable.type === "string").map(variable => ({ value: `variable:${variable.key}`, label: `${variable.key} · variable` })),
    ...template.fields.map(field => ({ value: `copy:${field.key}`, label: `${field.label} · template text` })),
  ] : [];

  function updateMessage(field: "subject" | "message", value: string) {
    if (!stage) return;
    const override = { ...draft.messages?.[stage] };
    if (value === defaults?.[field]) delete override[field];
    else override[field] = value;
    const values = { ...draft.messages };
    if (Object.keys(override).length) values[stage] = override;
    else delete values[stage];
    onDraft({ messages: Object.keys(values).length ? values : undefined });
  }

  function resetMessage() {
    if (!stage) return;
    const values = { ...draft.messages };
    delete values[stage];
    onDraft({ messages: Object.keys(values).length ? values : undefined });
  }

  const setup = <fieldset className="min-w-0" disabled={disabled}>
    <legend className="sr-only">Choose reminder scope and design</legend>
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-scope">Apply to
        <select className={OPERATOR_FIELD_CLASS} id="cadence-scope" value={draft.scope ?? "event"} onChange={e => onDraft({ scope: e.currentTarget.value as "event" | "sequence" })}>
          <option value="sequence">Current and future calls of this type</option><option value="event">One scheduled call</option>
        </select>
      </label>
      <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-kind">Call type
        <select className={OPERATOR_FIELD_CLASS} id="cadence-kind" value={draft.kind} onChange={e => onDraft({ kind: e.currentTarget.value as CadenceKind })}>
          {CADENCE_KINDS.map(kind => <option key={kind} value={kind}>{CADENCE_KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-track">Audience track
        <select className={OPERATOR_FIELD_CLASS} id="cadence-track" value={draft.track} onChange={e => onDraft({ track: e.currentTarget.value as CadenceTrack })}>
          <option value="members">Members</option><option value="founder_test">Founder test</option>
        </select>
      </label>
      <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-event">{sequenceScope ? "Preview with a call (optional)" : "Scheduled call"}
        <select className={OPERATOR_FIELD_CLASS} id="cadence-event" value={draft.eventId} onChange={e => onDraft({ eventId: e.currentTarget.value })}>
          <option value="">{sequenceScope ? "Use an example call" : "Choose a scheduled call"}</option>
          {overview.events.map(item => <option key={item.id} value={item.id}>{item.title} · {callDate(item)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 text-sm font-medium md:col-span-2" htmlFor="cadence-template">Email design
        <select className={OPERATOR_FIELD_CLASS} id="cadence-template" value={draft.templateId} onChange={e => void onSelectTemplate(e.currentTarget.value)}>
          <option value="">Choose an email design</option>
          {overview.templates.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === "draft" ? " · draft" : ""}</option>)}
        </select>
      </label>
    </div>
    <p className="mt-4 text-sm leading-relaxed text-[color:var(--operator-muted)]">{sequenceScope ? "Each matching published call uses these reminders and its own eligible audience. Calls with individual settings keep them." : "These settings apply only to the selected call."}</p>
    {event && !preview ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`/ops/experiences/${encodeURIComponent(event.id)}`}>Review this call and its audience ↗</Link> : null}
    {!overview.events.length ? <p className="mt-3 text-sm">{sequenceScope ? "You can prepare a sequence before its calls are scheduled." : <>Create and publish a call in <Link className="underline underline-offset-4" href="/ops/experiences">Calendar</Link> first.</>}</p> : null}
    {!overview.templates.length ? <p className="mt-3 text-sm">No email designs are available. Add a design in Resend, then refresh.</p> : null}
  </fieldset>;

  return <form className="min-w-0 space-y-5" onSubmit={onReview}>
    {!editing ? <section className="operator-bento-card min-w-0" aria-labelledby="cadence-setup-heading"><h3 className="mb-5 text-lg font-semibold" id="cadence-setup-heading">Choose your calls and design</h3>{setup}</section> : null}

    <section className="operator-bento-card min-w-0" aria-labelledby="cadence-message-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-semibold" id="cadence-message-heading">Edit the emails</h3><p className="mt-2 text-sm text-[color:var(--operator-muted)]">Choose a reminder, then edit its subject and message.</p></div>
        {editing && template ? <p className="max-w-sm break-words text-sm text-[color:var(--operator-muted)]">{template.name}</p> : null}
      </div>
      <div className="mt-5 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Email reminder stages">
        {occurrences.map(occurrence => <button
          className={`min-h-20 min-w-0 border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--operator-focus)] ${stage === occurrence.stage ? "border-[color:var(--operator-ink)] bg-[var(--operator-ink)] text-[var(--operator-surface)]" : "border-[color:var(--operator-ink)]/25 hover:border-[color:var(--operator-ink)]"}`}
          type="button" key={occurrence.stage} aria-pressed={stage === occurrence.stage} disabled={disabled}
          onClick={() => { setRequestedStage(occurrence.stage); onStage?.(occurrence.stage); }}
        ><span className="block text-sm font-semibold">{CADENCE_STAGE_LABELS[occurrence.stage]}</span><span className="mt-1 block text-xs opacity-80">{timingLabel(occurrence.stage, draft.kind, draft.track)}</span>{draft.messages?.[occurrence.stage] ? <span className="mt-2 block text-xs">Customized</span> : null}</button>)}
      </div>
      {stage ? <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2"><fieldset className="min-w-0 space-y-5" disabled={disabled}>
        <legend className="sr-only">{CADENCE_STAGE_LABELS[stage]} email</legend>
        <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-message-subject">Subject
          <input className={OPERATOR_FIELD_CLASS} id="cadence-message-subject" maxLength={200} required value={subject} onChange={e => updateMessage("subject", e.currentTarget.value)} />
        </label>
        <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-message-body">Message
          <textarea className={`${OPERATOR_FIELD_CLASS} min-h-64 resize-y leading-relaxed`} id="cadence-message-body" maxLength={12000} rows={10} required aria-describedby="cadence-message-help" value={message} onChange={e => updateMessage("message", e.currentTarget.value)} />
        </label>
        <div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-2xl text-sm leading-relaxed text-[color:var(--operator-muted)]" id="cadence-message-help">The member’s greeting, call details, access link, reminder preferences, and sign-off are added automatically. Review the complete email before activating.</p>{custom ? <button className="inline-flex min-h-11 shrink-0 items-center text-sm underline underline-offset-4" type="button" onClick={resetMessage}>Restore default message</button> : null}</div>
      </fieldset><section className="min-w-0 border border-[color:var(--operator-ink)]/20" aria-labelledby="cadence-draft-preview-heading">
        <header className="border-b border-[color:var(--operator-ink)]/20 px-5 py-4"><h4 className="text-sm font-semibold" id="cadence-draft-preview-heading">Draft text preview</h4><p className="mt-1 text-xs leading-relaxed text-[color:var(--operator-muted)]">Sample recipient: Alex. {event ? "Using the selected call’s details." : "Using example call details."} Your email design appears in the review.</p></header>
        <div className="max-h-[38rem] overflow-y-auto px-5 py-5" tabIndex={0} aria-label="Draft email content"><p className="break-words text-base font-semibold">{draftPreview?.subject}</p><p className="mt-5 whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{draftPreview?.body}</p></div>
      </section></div> : <p className="mt-5 text-sm" role="status">Choose a valid call to see its reminders.</p>}
      {messageError ? <p className="mt-4 text-sm text-[var(--operator-danger)]" role="alert">{messageError}</p> : null}
    </section>

    <details className="operator-bento-card min-w-0" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-semibold">Advanced settings<span className="ml-2 font-normal text-[color:var(--operator-muted)]">Design connections{editing ? ", audience, and call settings" : " and other template text"}</span></summary>
      <div className="mt-6 space-y-6">
        {editing ? setup : null}
        {template ? <fieldset className="min-w-0 space-y-5 border-t border-[color:var(--operator-ink)]/15 pt-5" disabled={disabled}>
          <legend className="sr-only">Connect the design’s editable fields</legend>
          <div><h4 className="text-sm font-semibold">Design connections</h4><p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">Choose where the full message and heading appear in this email design. Existing connections stay in place when you edit the message.</p></div>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-body">Message area<select className={OPERATOR_FIELD_CLASS} id="cadence-body" value={draft.bodyTarget} onChange={e => onDraft({ bodyTarget: e.currentTarget.value })}><option value="">Choose the main message area</option>{targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
            <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-heading">Heading area (optional)<select className={OPERATOR_FIELD_CLASS} id="cadence-heading" value={draft.headingTarget ?? ""} onChange={e => onDraft({ headingTarget: e.currentTarget.value || undefined })}><option value="">Keep the template heading</option>{targets.filter(target => target.value !== draft.bodyTarget).map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
          </div>
          {draft.bodyTarget && draft.bodyTarget === draft.headingTarget ? <p className="text-sm text-[var(--operator-danger)]" role="alert">Choose different areas for the heading and message.</p> : null}
          {template.variables.filter(variable => ![draft.bodyTarget, draft.headingTarget].includes(`variable:${variable.key}`)).map(variable => {
            const binding = draft.bindings[variable.key] ?? { source: "literal", value: "" };
            return <div className="grid min-w-0 gap-3 border-t border-[color:var(--operator-ink)]/15 pt-4 md:grid-cols-2" key={variable.key}>
              <label className="block min-w-0 text-sm font-medium" htmlFor={`cadence-source-${variable.key}`}>{variable.key}<select className={OPERATOR_FIELD_CLASS} id={`cadence-source-${variable.key}`} value={binding.source} onChange={e => { const source = e.currentTarget.value as CadenceBindingSource; onDraft({ bindings: { ...draft.bindings, [variable.key]: { source, ...(source === "literal" ? { value: binding.value ?? "" } : {}) } } }); }}>{SOURCES.filter(source => variable.type !== "number" || source.value === "literal").map(source => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label>
              {binding.source === "literal" ? <label className="block min-w-0 text-sm font-medium" htmlFor={`cadence-value-${variable.key}`}>Fixed value<input className={OPERATOR_FIELD_CLASS} id={`cadence-value-${variable.key}`} maxLength={2000} type={variable.type === "number" ? "number" : "text"} value={binding.value ?? ""} onChange={e => onDraft({ bindings: { ...draft.bindings, [variable.key]: { source: "literal", value: e.currentTarget.value } } })} /></label> : <p className="self-end pb-3 text-xs leading-relaxed text-[color:var(--operator-muted)]">Filled for each recipient and scheduled call.</p>}
            </div>;
          })}
          {template.fields.some(field => ![draft.bodyTarget, draft.headingTarget].includes(`copy:${field.key}`)) ? <section className="space-y-4 border-t border-[color:var(--operator-ink)]/15 pt-4" aria-labelledby="cadence-template-text-heading">
            <div><h4 className="text-sm font-semibold" id="cadence-template-text-heading">Other template text</h4><p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">These fields surround the message. Clear any duplicate greeting or sample signature here. The original Resend design stays unchanged.</p></div>
            {template.fields.map((field, index) => ![draft.bodyTarget, draft.headingTarget].includes(`copy:${field.key}`) ? <label className="block min-w-0 text-sm font-medium" htmlFor={`cadence-copy-${index}`} key={field.key}>{field.label}<textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} id={`cadence-copy-${index}`} maxLength={12000} rows={3} value={draft.copy?.[field.key] ?? field.value} onChange={e => onDraft({ copy: { ...draft.copy, [field.key]: e.currentTarget.value } })} /></label> : null)}
          </section> : null}
        </fieldset> : <p className="text-sm text-[color:var(--operator-muted)]">Choose an email design to see its connections.</p>}
      </div>
    </details>

    {template && mappingInvalid ? <p className="text-sm" role="status">Connect the message area in <button className="underline underline-offset-4" type="button" onClick={() => setAdvancedOpen(true)}>Advanced settings</button> before reviewing.</p> : null}
    <div className="flex flex-wrap items-center gap-4">
      <button className={OPERATOR_BUTTON_CLASS} disabled={disabled || !template || (!sequenceScope && !event) || mappingInvalid || !stage || !subject.trim() || !message.trim() || Boolean(messageError)} type="submit">{pending === "review" ? "Preparing preview…" : "Preview and review"}</button>
      <p className="text-sm text-[color:var(--operator-muted)]">Changes go live only after review and activation.</p>
    </div>
  </form>;
}
