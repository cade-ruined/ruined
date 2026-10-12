"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import { CADENCE_STAGE_LABELS, cadenceOccurrences, type CadenceEvent, type CadenceKind, type CadenceStage, type CadenceTrack } from "@/lib/communications/member-email-cadence-model";
import type { CadenceBindingSource, CadenceDraft } from "@/lib/communications/member-email-cadence-types";
import type { ResendEmailTemplate, ResendEmailTemplateSummary } from "@/lib/communications/resend-email-model";

type Kind = CadenceKind;
type Track = CadenceTrack;
type Source = CadenceBindingSource;
type Event = CadenceEvent;
type Plan = {
  id: string; eventId: string; kind: Kind; track: Track; active: boolean; revision: number; templateName: string; updatedAt: string;
  attention?: string;
  delivery?: { sent: number; pending: number; failed: number; manualReview: number; cancelled: number };
};
type Overview = {
  events: Event[]; plans: Plan[]; templates: ResendEmailTemplateSummary[];
  configuration: { enabled: boolean; ready: boolean };
  inactive: Array<{ title: string; reason: string }>;
  setupRequired?: boolean;
};
type Draft = CadenceDraft;
type Preview = { html: string; subject: string; text: string };
type Review = {
  reviewToken: string; expiresAt?: string; preview: Preview; previews?: Array<Preview & { stage: string }>;
  occurrences: Array<{ stage: string; dueAt: string; expiresAt: string }>;
  recipients: Array<{ memberId: string; name: string; email: string; eligible: boolean; reason: string | null }>;
  warnings: string[];
};
const API = "/api/ops/emails/automations";
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "foundations_01", label: "Foundations 01" }, { value: "foundations_02", label: "Foundations 02" },
  { value: "foundations_03", label: "Foundations 03" }, { value: "foundations_04", label: "Foundations 04" },
  { value: "membership", label: "Membership call" }, { value: "circle", label: "Circle call" },
];
const SOURCES: Array<{ value: Source; label: string }> = [
  { value: "literal", label: "Fixed text" }, { value: "member_name", label: "Member name" },
  { value: "call_title", label: "Call title" }, { value: "call_date", label: "Call date" },
  { value: "call_time", label: "Call time" }, { value: "call_url", label: "Call link" },
  { value: "profile_url", label: "Member profile link" }, { value: "preferences_url", label: "Email reminder preferences link" },
];
const SAMPLE_TEMPLATE: ResendEmailTemplate = {
  id: "preview-template", name: "Member call reminder — sample", status: "published", version: "preview-1", hasUnpublishedVersions: false,
  html: "", text: null, subject: "Tomorrow: Foundations 01.", from: "Ruined <hello@example.test>", replyTo: [],
  variables: [{ key: "MEMBER_NAME", type: "string", fallbackValue: "Friend" }, { key: "CALL_URL", type: "string", fallbackValue: "" }],
  fields: [{ key: "heading", label: "Heading", value: "Tomorrow: Foundations 01." }, { key: "greeting", label: "Greeting", value: "Hi there," }, { key: "body", label: "Message", value: "Your call details will appear here." }, { key: "signature", label: "Signature", value: "Your name" }],
};
const SAMPLE_OVERVIEW: Overview = {
  events: [
    { id: "preview-october", title: "Foundations 03 — October founder test", startsAt: "2026-10-22T21:00:00.000Z", endsAt: "2026-10-22T22:30:00.000Z", timeZone: "America/Denver" },
    { id: "preview-november", title: "Foundations 01 — November", startsAt: "2026-11-05T22:00:00.000Z", endsAt: "2026-11-05T23:30:00.000Z", timeZone: "America/Denver" },
  ],
  plans: [], templates: [SAMPLE_TEMPLATE], configuration: { enabled: false, ready: false },
  inactive: [
    { title: "Missed calls and unfinished work", reason: "Completion rules, catch-up instructions, and deadlines need approval." },
    { title: "Foundations completion and Circle reveal", reason: "These will be connected to verified completion and an approved Circle assignment." },
    { title: "Birthdays, anniversaries, and promotions", reason: "Timing, approved offers, and the appropriate communication permissions need setup." },
  ],
};
const blankDraft = (): Draft => ({ eventId: "", kind: "foundations_01", track: "members", templateId: "", templateVersion: "", bodyTarget: "", bindings: {} });
function dateLabel(value: string, timeZone = "America/Denver") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  try { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date); }
  catch { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver" }).format(date); }
}
function stageLabel(value: string) { return CADENCE_STAGE_LABELS[value as CadenceStage] ?? value.replaceAll("_", " ").replaceAll("-", " "); }
function safePreview(html: string) {
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\' https:; font-src https: data:; script-src \'none\'; connect-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">';
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, head => `${head}${policy}`) : `${policy}${html}`;
}
function escaped(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(typeof result?.error === "string" ? result.error : "Automations are unavailable. Please try again.");
  return result;
}
function sampleReview(draft: Draft, event: Event, template: ResendEmailTemplate): Review {
  const subject = `Tomorrow: ${event.title}.`;
  const body = `Alex, we’re back together tomorrow.\n\n${event.title}\n${dateLabel(event.startsAt, event.timeZone)}\n\nGive yourself the full call and come ready to participate.\n\nThis is a sample. No email will be sent.`;
  const fields = template.fields.map(field => ({
    heading: `copy:${field.key}` === draft.headingTarget,
    value: `copy:${field.key}` === draft.bodyTarget ? body : `copy:${field.key}` === draft.headingTarget ? subject : draft.copy?.[field.key] ?? field.value,
  }));
  if (draft.headingTarget?.startsWith("variable:")) fields.unshift({ heading: true, value: subject });
  if (draft.bodyTarget.startsWith("variable:")) fields.push({ heading: false, value: body });
  const text = fields.map(field => field.value).filter(Boolean).join("\n\n");
  const html = fields.filter(field => field.value).map(field => field.heading ? `<h1>${escaped(field.value)}</h1>` : `<p style="white-space:pre-wrap;line-height:1.7">${escaped(field.value)}</p>`).join("");
  return { reviewToken: "preview-only", preview: { subject, text, html: `<html><head></head><body style="margin:0;padding:32px;background:#e5e0d5;color:#2a2a2a;font-family:Arial,sans-serif"><p>RU/NED · SAMPLE</p>${html}</body></html>` },
    occurrences: cadenceOccurrences(event, draft.kind, draft.track),
    recipients: [{ memberId: "preview-one", name: "Alex Sample", email: "alex@example.test", eligible: true, reason: null }, { memberId: "preview-two", name: "Jordan Sample", email: "jordan@example.test", eligible: false, reason: "Membership email updates are turned off." }],
    warnings: ["Preview only. Foundations and founder tests use confirmed invitations. Other Membership and Circle calls use their eligible call audience."] };
}

export default function OperatorEmailAutomations({ preview = false }: { preview?: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(preview ? SAMPLE_OVERVIEW : null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [template, setTemplate] = useState<ResendEmailTemplate | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [previewStage, setPreviewStage] = useState(0);
  const [pending, setPending] = useState<string | null>(preview ? null : "loading");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const event = overview?.events.find(item => item.id === draft.eventId);
  const targets = template ? [...template.variables.filter(variable => variable.type === "string").map(variable => ({ value: `variable:${variable.key}`, label: `${variable.key} · template variable` })), ...template.fields.map(field => ({ value: `copy:${field.key}`, label: `${field.label} · template text` }))] : [];
  const eligibleCount = review?.recipients.filter(recipient => recipient.eligible).length ?? 0;
  const shownPreview = review?.previews?.[previewStage] ?? review?.preview;
  const expired = Boolean(review?.expiresAt && Date.parse(review.expiresAt) <= Date.now());

  useEffect(() => {
    mounted.current = true;
    if (preview) return () => { mounted.current = false; };
    const controller = new AbortController();
    busy.current = true;
    request<Overview>(API, undefined, controller.signal).then(result => { if (mounted.current) setOverview(result); }).catch(error => {
      if (mounted.current && !controller.signal.aborted) { setMessage(error instanceof Error ? error.message : "Automations could not be loaded."); setFailed(true); }
    }).finally(() => { if (mounted.current && !controller.signal.aborted) { busy.current = false; setPending(null); } });
    return () => { mounted.current = false; controller.abort(); };
  }, [preview]);

  function change(update: Partial<Draft>) {
    if (busy.current) return;
    setDraft(current => ({ ...current, ...update })); setReview(null); setMessage(""); setFailed(false);
  }
  async function perform(label: string, action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(label); setMessage(""); setFailed(false);
    try { await action(); }
    catch (error) { if (mounted.current) { setMessage(error instanceof Error ? error.message : "The change could not be saved."); setFailed(true); } }
    finally { busy.current = false; if (mounted.current) setPending(null); }
  }
  async function refresh() {
    await perform("loading", async () => {
      if (preview) return;
      const result = await request<Overview>(API);
      if (mounted.current) { setOverview(result); setReview(null); }
    });
  }
  async function chooseTemplate(id: string) {
    if (busy.current) return;
    setReview(null); setTemplate(null); setDraft(current => ({ ...current, templateId: id, templateVersion: "", bodyTarget: "", headingTarget: undefined, bindings: {}, copy: undefined }));
    if (!id) return;
    await perform("template", async () => {
      const selected = preview ? SAMPLE_TEMPLATE : (await request<{ template: ResendEmailTemplate }>(`/api/ops/emails/resend/templates/${encodeURIComponent(id)}`)).template;
      if (!mounted.current) return;
      if (selected.campaignOnly) throw new Error("Choose an individual email template. Campaign-only templates cannot be used for these reminders.");
      if (selected.status !== "published") throw new Error("Publish this design in Resend before using it for an automation.");
      const bindings = Object.fromEntries(selected.variables.map(variable => [variable.key, { source: "literal" as const, value: variable.fallbackValue == null ? "" : String(variable.fallbackValue) }]));
      const copy = Object.fromEntries(selected.fields.map(field => [field.key, field.value]));
      setTemplate(selected); setDraft(current => ({ ...current, templateId: selected.id, templateVersion: selected.version, bindings, copy }));
    });
  }
  async function reviewDraft(e: FormEvent) {
    e.preventDefault();
    if (!event || !template || !draft.bodyTarget || draft.bodyTarget === draft.headingTarget || overview?.setupRequired) return;
    await perform("review", async () => {
      setReview(null);
      const copy = Object.fromEntries(template.fields.flatMap(field => {
        const value = draft.copy?.[field.key];
        return ![draft.bodyTarget, draft.headingTarget].includes(`copy:${field.key}`) && value !== undefined && value !== field.value ? [[field.key, value]] : [];
      }));
      const reviewedDraft = { ...draft, copy: Object.keys(copy).length ? copy : undefined, bindings: Object.fromEntries(Object.entries(draft.bindings).filter(([key]) => ![draft.bodyTarget, draft.headingTarget].includes(`variable:${key}`))) };
      const result = preview ? sampleReview(reviewedDraft, event, template) : await request<Review>(API, { action: "preview", draft: reviewedDraft });
      if (mounted.current) { setReview(result); setPreviewStage(0); }
    });
  }
  async function activate() {
    if (preview || !review || expired || !eligibleCount || !review.occurrences.length || overview?.setupRequired) return;
    await perform("activate", async () => {
      const token = review.reviewToken;
      setReview(null);
      await request(API, { action: "activate", reviewToken: token });
      if (!mounted.current) return;
      setMessage("Automation activated for future reminders. Earlier stages will not be sent.");
      try { setOverview(await request<Overview>(API)); }
      catch { setMessage("Automation activated. Refresh the list to see its latest status."); }
    });
  }
  async function pause(plan: Plan) {
    if (preview) return;
    await perform(`pause:${plan.id}`, async () => {
      await request(API, { action: "pause", id: plan.id, revision: plan.revision });
      if (!mounted.current) return;
      setReview(null); setOverview(current => current ? { ...current, plans: current.plans.map(item => item.id === plan.id ? { ...item, active: false } : item) } : current);
      setMessage("Automation paused. Future reminders will not be sent by this plan.");
      try { setOverview(await request<Overview>(API)); }
      catch { setMessage("Automation paused. Refresh the list to see its latest status."); }
    });
  }

  return <OperatorPageFrame title="Email automations">
    <OperatorMessagesTabs active="automations" />
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><h2 className="operator-page-heading">Email automations</h2><p className="mt-3 text-sm leading-relaxed text-[color:var(--operator-muted)]">Prepare reminders for a scheduled call, review its eligible audience, then activate. Each plan belongs to one event.</p></div><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} onClick={() => void refresh()} type="button">Refresh</button></header>
    {preview ? <p className="operator-emphasis mb-5 p-4 text-sm" data-operator-tone="wait">Preview workspace. Events, designs, and recipients below are samples. Nothing is saved or sent.</p> : null}
    {overview && (!overview.configuration.enabled || !overview.configuration.ready || overview.setupRequired) ? <section className="operator-emphasis mb-5 space-y-2 p-4 text-sm" data-operator-tone="wait" aria-label="Automation readiness"><h3 className="font-semibold">{overview.setupRequired ? "Automation setup is required" : !overview.configuration.enabled ? "Automatic delivery is paused" : "Delivery setup is incomplete"}</h3><p>{overview.setupRequired ? "The automation service needs setup before a plan can be reviewed or activated." : !overview.configuration.enabled ? "You can prepare and activate plans. No automated emails will leave until automatic delivery is enabled." : "You can prepare plans, but delivery will wait until the email service is ready."}</p></section> : null}
    {message ? <p className={`mb-5 break-words text-sm ${failed ? "text-[var(--operator-danger)]" : "text-[color:var(--operator-muted)]"}`} role={failed ? "alert" : "status"}>{message}</p> : null}
    {!overview ? <p className="operator-bento-card text-sm" role="status">{pending ? "Loading automations…" : "Automations are unavailable. Refresh to try again."}</p> : <>
      <section className="operator-bento-card mb-5" aria-labelledby="automation-plans-heading"><h3 className="text-lg font-semibold" id="automation-plans-heading">Configured calls</h3>{overview.plans.length ? <ul className="mt-4 divide-y divide-[color:var(--operator-ink)]/15">{overview.plans.map(plan => {
        const deliveryReviewCount = (plan.delivery?.failed ?? 0) + (plan.delivery?.manualReview ?? 0);
        const callChanged = /^Call changed\b/i.test(plan.attention ?? "");
        return <li className="flex flex-wrap items-start justify-between gap-4 py-4" key={plan.id}><div className="min-w-0"><p className="break-words text-sm font-semibold">{overview.events.find(item => item.id === plan.eventId)?.title ?? KINDS.find(item => item.value === plan.kind)?.label ?? "Scheduled call"}</p><p className="mt-1 break-words text-xs text-[color:var(--operator-muted)]">{plan.track === "founder_test" ? "Founder test" : "Members"} · {plan.templateName}</p><p className="mt-2 text-xs">{callChanged ? "Needs review" : plan.active ? overview.configuration.enabled && overview.configuration.ready ? "Active" : "Active · delivery paused" : "Paused"}</p>
          {plan.delivery ? <p className="mt-2 text-xs text-[color:var(--operator-muted)]">{plan.delivery.sent} sent · {plan.delivery.pending} waiting · {deliveryReviewCount} need review</p> : null}
          {plan.attention ? <p className="mt-2 max-w-xl break-words text-sm text-[var(--operator-danger)]">{plan.attention}</p> : null}
          {deliveryReviewCount > 0 ? <Link className="mt-1 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/ops/messages?mode=emails">Check Resend delivery history ↗</Link> : null}
        </div>{plan.active ? <button className={OPERATOR_BUTTON_CLASS} disabled={preview || !!pending} onClick={() => void pause(plan)} type="button">{pending === `pause:${plan.id}` ? "Pausing…" : "Pause automation"}</button> : null}</li>;
      })}</ul> : <p className="mt-3 text-sm text-[color:var(--operator-muted)]">No calls have an automation yet.</p>}<p className="mt-3 text-xs leading-relaxed text-[color:var(--operator-muted)]">Changing a call’s time, title, or audience requires a fresh review. To revise or resume a plan, configure that event again below.</p></section>
      <form className="space-y-5" onSubmit={reviewDraft}>
        <fieldset className="operator-bento-card min-w-0" disabled={!!pending || overview.setupRequired}><legend className="sr-only">Choose a call and its design</legend><h3 className="text-lg font-semibold">Set up a call</h3><div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
          <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-event">Scheduled event<select className={OPERATOR_FIELD_CLASS} id="cadence-event" required value={draft.eventId} onChange={e => change({ eventId: e.target.value })}><option value="">Choose an actual event</option>{overview.events.map(item => <option key={item.id} value={item.id}>{item.title} · {dateLabel(item.startsAt, item.timeZone)}</option>)}</select></label>
          <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-kind">Call type<select className={OPERATOR_FIELD_CLASS} id="cadence-kind" value={draft.kind} onChange={e => change({ kind: e.target.value as Kind })}>{KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-track">Cadence<select className={OPERATOR_FIELD_CLASS} id="cadence-track" value={draft.track} onChange={e => change({ track: e.target.value as Track })}><option value="members">Members</option><option value="founder_test">October founder test</option></select></label>
          <label className="block min-w-0 text-sm font-medium" htmlFor="cadence-template">Resend design<select className={OPERATOR_FIELD_CLASS} id="cadence-template" required value={draft.templateId} onChange={e => void chooseTemplate(e.target.value)}><option value="">Choose an individual email design</option>{overview.templates.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === "draft" ? " · draft" : ""}</option>)}</select></label>
        </div><p className="mt-4 text-xs leading-relaxed text-[color:var(--operator-muted)]">Foundations and founder tests use confirmed invitations. Open Membership calls use eligible members; Circle calls use the current members of that Circle. Cancellations and reminder preferences are respected. Choosing a cadence does not grant anyone call access.</p>{event && !preview ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`/ops/experiences/${encodeURIComponent(event.id)}`}>Review the event and its audience ↗</Link> : null}{!overview.events.length ? <p className="mt-3 text-sm">Create and publish a call in <Link className="underline underline-offset-4" href="/ops/experiences">Events</Link> first.</p> : null}{!overview.templates.length ? <p className="mt-3 text-sm">No Resend templates are available. Add an individual email design in Resend, then refresh.</p> : null}</fieldset>
        {template ? <fieldset className="operator-bento-card min-w-0" disabled={!!pending}><legend className="sr-only">Connect the design’s editable fields</legend><h3 className="text-lg font-semibold">Connect the message to your design</h3><p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">The approved cadence supplies each reminder’s subject and message. Choose where that message appears in this template.</p><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="block min-w-0 text-sm font-medium" htmlFor="cadence-body">Message area<select className={OPERATOR_FIELD_CLASS} id="cadence-body" required value={draft.bodyTarget} onChange={e => change({ bodyTarget: e.target.value })}><option value="">Choose the main message area</option>{targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label><label className="block min-w-0 text-sm font-medium" htmlFor="cadence-heading">Heading area (optional)<select className={OPERATOR_FIELD_CLASS} id="cadence-heading" value={draft.headingTarget ?? ""} onChange={e => change({ headingTarget: e.target.value || undefined })}><option value="">Keep the template heading</option>{targets.filter(target => target.value !== draft.bodyTarget).map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label></div>{draft.bodyTarget && draft.bodyTarget === draft.headingTarget ? <p className="mt-3 text-sm text-[var(--operator-danger)]" role="alert">Choose different areas for the heading and message.</p> : null}
          {template.variables.filter(variable => ![draft.bodyTarget, draft.headingTarget].includes(`variable:${variable.key}`)).map(variable => { const binding = draft.bindings[variable.key] ?? { source: "literal", value: "" }; return <div className="mt-5 grid gap-3 border-t border-[color:var(--operator-ink)]/15 pt-4 md:grid-cols-2" key={variable.key}><label className="block min-w-0 text-sm font-medium" htmlFor={`cadence-source-${variable.key}`}>{variable.key}<select className={OPERATOR_FIELD_CLASS} id={`cadence-source-${variable.key}`} value={binding.source} onChange={e => change({ bindings: { ...draft.bindings, [variable.key]: { source: e.target.value as Source, ...(e.target.value === "literal" ? { value: binding.value ?? "" } : {}) } } })}>{SOURCES.filter(source => variable.type !== "number" || source.value === "literal").map(source => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label>{binding.source === "literal" ? <label className="block min-w-0 text-sm font-medium" htmlFor={`cadence-value-${variable.key}`}>Fixed value<input className={OPERATOR_FIELD_CLASS} id={`cadence-value-${variable.key}`} maxLength={2000} type={variable.type === "number" ? "number" : "text"} value={binding.value ?? ""} onChange={e => change({ bindings: { ...draft.bindings, [variable.key]: { source: "literal", value: e.target.value } } })} /></label> : <p className="self-end pb-3 text-xs leading-relaxed text-[color:var(--operator-muted)]">Filled separately for the recipient and their scheduled call.</p>}</div>; })}
          {template.fields.some(field => ![draft.bodyTarget, draft.headingTarget].includes(`copy:${field.key}`)) ? <section className="mt-5 space-y-4 border-t border-[color:var(--operator-ink)]/15 pt-4" aria-labelledby="cadence-template-text-heading"><div><h4 className="text-sm font-semibold" id="cadence-template-text-heading">Other template text</h4><p className="mt-2 text-xs leading-relaxed text-[color:var(--operator-muted)]">Edit the remaining text for this automation. You can clear a duplicate greeting or replace a sample signature. These changes leave the saved Resend design unchanged.</p></div>{template.fields.map((field, index) => ![draft.bodyTarget, draft.headingTarget].includes(`copy:${field.key}`) ? <label className="block min-w-0 text-sm font-medium" htmlFor={`cadence-copy-${index}`} key={field.key}>{field.label}<textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} id={`cadence-copy-${index}`} maxLength={12000} rows={3} value={draft.copy?.[field.key] ?? field.value} onChange={e => change({ copy: { ...draft.copy, [field.key]: e.target.value } })} /></label> : null)}</section> : null}
          <p className="mt-4 text-xs leading-relaxed text-[color:var(--operator-muted)]">Check the complete rendered email before activating. The selected message and heading areas are filled by the cadence.</p>
        </fieldset> : null}
        <button className={OPERATOR_BUTTON_CLASS} disabled={!!pending || !template || !event || !draft.bodyTarget || draft.bodyTarget === draft.headingTarget || overview.setupRequired} type="submit">{pending === "review" ? "Checking recipients…" : "Review automation"}</button>
      </form>
      {review ? <section className="mt-7 space-y-5" aria-labelledby="automation-review-heading"><header><h3 className="text-xl font-semibold" id="automation-review-heading">Review before activating</h3><p className="mt-2 text-sm text-[color:var(--operator-muted)]">{event?.title} · {template?.name}</p>{review.expiresAt ? <p className="mt-2 text-xs text-[color:var(--operator-muted)]">Review expires {dateLabel(review.expiresAt, event?.timeZone)}. Changes to this setup require another review.</p> : null}</header>
        <div className="grid min-w-0 gap-5 xl:grid-cols-2"><div className="min-w-0 space-y-5"><section className="operator-bento-card"><h4 className="font-semibold">Scheduled reminders</h4><p className="mt-2 text-xs text-[color:var(--operator-muted)]">Times shown in {event?.timeZone ?? "America/Denver"}. Only future stages can be activated.</p><ul className="mt-3 space-y-3">{review.occurrences.map(occurrence => <li className="break-words text-sm" key={`${occurrence.stage}:${occurrence.dueAt}`}><p className="font-medium capitalize">{stageLabel(occurrence.stage)}</p><p className="mt-1">{dateLabel(occurrence.dueAt, event?.timeZone)}</p><p className="mt-1 text-xs text-[color:var(--operator-muted)]">Expires {dateLabel(occurrence.expiresAt, event?.timeZone)}</p></li>)}</ul>{!review.occurrences.length ? <p className="mt-3 text-sm">No future reminders are available for this event.</p> : null}</section>
          <section className="operator-bento-card"><h4 className="font-semibold">Recipients</h4><p className="mt-2 text-sm">{eligibleCount} eligible · {review.recipients.length - eligibleCount} excluded</p><p className="mt-2 text-xs leading-relaxed text-[color:var(--operator-muted)]">Eligibility and communication choices are checked again before each delivery.</p>{!review.recipients.length ? <p className="mt-3 text-sm">No recipients currently qualify for this call. Check its audience, membership access, and reminder preferences. Foundations and founder tests also need confirmed invitations in Events.</p> : <ul className="mt-3 max-h-96 space-y-3 overflow-y-auto">{review.recipients.map(recipient => <li className="break-words border-t border-[color:var(--operator-ink)]/15 pt-3 text-sm" key={recipient.memberId}><p className="font-medium">{recipient.name || "Member"}</p><p className="break-all text-xs text-[color:var(--operator-muted)]">{recipient.email}</p><p className={`mt-1 text-xs ${recipient.eligible ? "text-[var(--operator-success-text)]" : "text-[color:var(--operator-muted)]"}`}>{recipient.eligible ? "Eligible" : `Excluded: ${recipient.reason || "Not eligible for this reminder."}`}</p></li>)}</ul>}</section></div>
          <section className="operator-glass min-w-0 overflow-hidden" aria-label="Automation email preview"><div className="border-b border-[color:var(--operator-ink)]/15 p-4"><h4 className="text-sm font-semibold">{review.previews?.length ? "Email preview" : "Example email"}</h4>{review.previews && review.previews.length > 1 ? <label className="mt-3 block text-sm" htmlFor="cadence-preview-stage">Reminder<select className={OPERATOR_FIELD_CLASS} id="cadence-preview-stage" value={previewStage} onChange={e => setPreviewStage(Number(e.target.value))}>{review.previews.map((item, index) => <option key={item.stage} value={index}>{stageLabel(item.stage)}</option>)}</select></label> : null}<p className="mt-3 break-words text-sm font-semibold">{shownPreview?.subject}</p></div>{shownPreview ? <iframe className="h-[540px] w-full border-0 bg-white" title="Automation email design" sandbox="" referrerPolicy="no-referrer" srcDoc={safePreview(shownPreview.html)} /> : null}</section></div>
        {review.warnings.length ? <div className="operator-emphasis p-4 text-sm" data-operator-tone="wait"><ul className="space-y-2">{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
        <div className="operator-bento-card"><p className="max-w-2xl text-sm leading-relaxed">Activating allows future reminders to be sent automatically to this call’s eligible audience. Past reminders are skipped. You can pause this plan at any time.</p>{!overview.configuration.enabled || !overview.configuration.ready ? <p className="mt-3 text-sm font-medium">Delivery is currently paused. An activated plan will wait for automatic delivery to be enabled and ready.</p> : null}<div className="mt-4 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={preview || !!pending || !eligibleCount || !review.occurrences.length || expired || overview.setupRequired} onClick={() => void activate()} type="button">{pending === "activate" ? "Activating…" : preview ? "Activation off in preview" : "Activate automation"}</button><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} onClick={() => setReview(null)} type="button">Back to setup</button></div>{expired ? <p className="mt-3 text-sm text-[var(--operator-danger)]" role="alert">This review has expired. Review the setup again before activating.</p> : null}</div>
      </section> : null}
      <section className="operator-bento-card mt-7" aria-labelledby="inactive-automations-heading"><h3 className="text-lg font-semibold" id="inactive-automations-heading">Not active yet</h3><p className="mt-2 text-sm text-[color:var(--operator-muted)]">Unfinished protocols stay off until their rules and copy are approved.</p><ul className="mt-4 space-y-4">{overview.inactive.map(item => <li key={item.title}><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-sm leading-relaxed text-[color:var(--operator-muted)]">{item.reason}</p></li>)}</ul></section>
    </>}
  </OperatorPageFrame>;
}
