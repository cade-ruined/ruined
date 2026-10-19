"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import OperatorEmailAutomationManager, { type AutomationFilter, type AutomationSelection } from "@/components/platform/OperatorEmailAutomationManager";
import OperatorEmailAutomationEditor, { suggestedCadenceDesignConnections } from "./OperatorEmailAutomationEditor";
import { DEFAULT_AUTOMATION_VIEW_OPTIONS, type AutomationViewOptions, type AutomationSection } from "@/lib/communications/email-automation-view";
import { normalizeAutomationView, readAutomationNavigation, writeAutomationNavigation } from "@/lib/communications/email-automation-navigation";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import { CADENCE_STAGE_LABELS, cadenceOccurrences, type CadenceEvent, type CadenceKind, type CadenceStage } from "@/lib/communications/member-email-cadence-model";
import { cadenceCopy, cadenceMessagesValidationError } from "@/lib/communications/member-email-cadence-copy";
import { cadenceManagementDescriptions, type CadenceManagementDetail, type CadenceManagementOverview, type CadenceManagementPlanSummary, type CadenceManagementSequenceSummary } from "@/lib/communications/member-email-cadence-management";
import type { CadenceDraft } from "@/lib/communications/member-email-cadence-types";
import type { ResendEmailTemplate } from "@/lib/communications/resend-email-model";

type Kind = CadenceKind;
type Event = CadenceEvent;
type Plan = CadenceManagementPlanSummary;
type Sequence = CadenceManagementSequenceSummary;
type Overview = CadenceManagementOverview;
type Draft = CadenceDraft;
type Preview = { html: string; subject: string; text: string };
type Review = {
  reviewToken: string; expiresAt?: string; preview: Preview; previews?: Array<Preview & { stage: string }>;
  scope?: "event" | "sequence";
  matchingEvents?: Array<Pick<Event, "id" | "title" | "startsAt" | "timeZone">>;
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
  plans: [], sequences: [], templates: [SAMPLE_TEMPLATE], configuration: { enabled: true, ready: true, activatedAt: "2026-10-01T00:00:00Z" }, setupRequired: false, warnings: [], managedElsewhere: [
    { id: "registration", title: "Welcome and profile-ready emails", state: "configured", statusLabel: "Sample · configured", trigger: "A completed registration queues a welcome. Releasing profile access queues the profile-ready email.", timing: "Once per milestone. Pending messages are checked every five minutes.", recipients: "The registered member at their current verified email address, after readiness checks.", management: { href: "/ops/registrations", label: "Open registrations" }, controlBoundary: "Registrations manages profile release and shows delivery status. Copy and the delivery switch are maintained separately from call reminders." },
    { id: "renewal", title: "Membership renewal notices", state: "paused", statusLabel: "Sample · paused", trigger: "An eligible annual membership approaches renewal, or a monthly membership approaches the end of its initial term.", timing: "40 and 20 days before the renewal or initial term ends. Checked daily at 13:00 UTC.", recipients: "The membership customer after current billing and renewal checks.", management: { href: "/ops/access-billing", label: "Review billing services" }, controlBoundary: "Rules, copy, and the delivery switch belong to the billing workflow. This page does not change charges or renewal terms." },
    { id: "work_digest", title: "Operations work summary", state: "incomplete", statusLabel: "Sample · setup incomplete", trigger: "A scheduled summary of the operations work queue.", timing: "This sample uses 10:00 a.m. and 3:00 p.m. Mountain time, following daylight saving time.", recipients: "One designated operations administrator with active access and a verified email address.", management: { href: "/ops/work", label: "Open work queue" }, controlBoundary: "The work queue controls the included tasks. The recipient, timing, and delivery switch are maintained separately from member reminders." },
  ],
  inactive: [
    { title: "Missed calls and unfinished work", reason: "Completion rules, catch-up instructions, and deadlines need approval." },
    { title: "Foundations completion and Circle reveal", reason: "These will be connected to verified completion and an approved Circle assignment." },
    { title: "Birthdays, anniversaries, and promotions", reason: "Timing, approved offers, and the appropriate communication permissions need setup." },
  ],
};
const blankDraft = (): Draft => ({ scope: "sequence", eventId: "", kind: "foundations_01", track: "members", templateId: "", templateVersion: "", bodyTarget: "", bindings: {} });
function exampleEvent(kind: Kind): Event {
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  start.setUTCHours(22, 0, 0, 0);
  return { id: "preview-example", title: `${KINDS.find(item => item.value === kind)?.label ?? "Member call"} — example call`, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 90 * 60 * 1000).toISOString(), timeZone: "America/Denver" };
}
function dateLabel(value: string, timeZone = "America/Denver") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  try { return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date)} · ${timeZone}`; }
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
  const occurrences = cadenceOccurrences(event, draft.kind, draft.track);
  const previews = occurrences.map(occurrence => {
    const copy = cadenceCopy({ event, kind: draft.kind, track: draft.track, stage: occurrence.stage, memberName: "Alex Sample", siteUrl: "https://members.example.test", message: draft.messages?.[occurrence.stage] });
    const fields = template.fields.map(field => ({
      heading: `copy:${field.key}` === draft.headingTarget,
      value: `copy:${field.key}` === draft.bodyTarget ? copy.body : `copy:${field.key}` === draft.headingTarget ? copy.heading : draft.copy?.[field.key] ?? field.value,
    }));
    if (draft.headingTarget?.startsWith("variable:")) fields.unshift({ heading: true, value: copy.heading });
    if (draft.bodyTarget.startsWith("variable:")) fields.push({ heading: false, value: copy.body });
    const text = fields.map(field => field.value).filter(Boolean).join("\n\n");
    const html = fields.filter(field => field.value).map(field => field.heading ? `<h1 style="overflow-wrap:anywhere">${escaped(field.value)}</h1>` : `<p style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7">${escaped(field.value)}</p>`).join("");
    return { stage: occurrence.stage, subject: copy.subject, text, html: `<html><head></head><body style="margin:0;padding:24px;background:#e5e0d5;color:#2a2a2a;font-family:Arial,sans-serif"><p>RU/NED · SAMPLE</p>${html}</body></html>` };
  });
  return { reviewToken: "preview-only", scope: draft.scope ?? "event", matchingEvents: draft.scope === "sequence" && draft.eventId ? [event] : [], preview: previews[0] ?? { subject: "Reminder preview", text: "No reminder stages available.", html: "<p>No reminder stages available.</p>" }, previews, occurrences,
    recipients: draft.eventId ? [{ memberId: "preview-one", name: "Alex Sample", email: "alex@example.test", eligible: true, reason: null }, { memberId: "preview-two", name: "Jordan Sample", email: "jordan@example.test", eligible: false, reason: "Membership email updates are turned off." }] : [],
    warnings: ["Preview only. Foundations and founder tests use confirmed invitations. Other Membership and Circle calls use their eligible call audience."] };
}

const SAMPLE_COUNTS = { sent: 1, pending: 0, failed: 0, manualReview: 0, cancelled: 0 };
function sampleOverview(): Overview {
  const events = SAMPLE_OVERVIEW.events;
  const sequences: Sequence[] = [
    { id: "sample-sequence-members", kind: "foundations_01", track: "members", active: true, revision: 2, templateName: SAMPLE_TEMPLATE.name, updatedAt: "2026-10-12T18:00:00Z", title: "Foundations 01 · Members", status: "upcoming", attention: "", ...cadenceManagementDescriptions("foundations_01", "members"), nextReminder: { ...cadenceOccurrences(events[1], "foundations_01", "members")[0], eventId: events[1].id, eventTitle: events[1].title, timeZone: events[1].timeZone }, delivery: SAMPLE_COUNTS, matchingCallCount: 1 },
    { id: "sample-sequence-founders", kind: "foundations_03", track: "founder_test", active: false, revision: 1, templateName: SAMPLE_TEMPLATE.name, updatedAt: "2026-10-12T18:00:00Z", title: "Foundations 03 · Founder test", status: "paused", attention: "", ...cadenceManagementDescriptions("foundations_03", "founder_test"), nextReminder: null, delivery: { ...SAMPLE_COUNTS, sent: 0 }, matchingCallCount: 1 },
  ];
  const plans: Plan[] = events.map((event, index) => { const sequence = sequences[index === 0 ? 1 : 0]; return { ...sequence, id: `sample-plan-${event.id}`, eventId: event.id, title: event.title, sequenceId: sequence.id, delivery: { ...SAMPLE_COUNTS, sent: 0 }, attention: sequence.active ? "" : "Sequence paused. Its inherited reminders are paused too." }; });
  return { ...SAMPLE_OVERVIEW, sequences, plans, recentDeliveries: [{id:"sample-activity",planId:plans[1].id,eventId:events[1].id,eventTitle:events[1].title,sequenceId:sequences[0].id,kind:"foundations_01",track:"members",stage:"orientation",dueAt:"2026-10-12T18:00:00Z",updatedAt:"2026-10-12T18:01:00Z",sentAt:"2026-10-12T18:01:00Z",status:"sent",recipientCount:2,counts:{sent:2,pending:0,sending:0,failed:0,cancelled:0,manual_review:0},reason:"Sample provider acceptance. No real email was sent."}] };
}
function sampleDetail(overview: Overview, selection: AutomationSelection, checkedEventId?: string): CadenceManagementDetail {
  const item = selection.scope === "sequence" ? overview.sequences.find(value => value.id === selection.id) : overview.plans.find(value => value.id === selection.id);
  if (!item) throw new Error("This sample automation is unavailable.");
  const plans = selection.scope === "sequence" ? overview.plans.filter(plan => plan.sequenceId === item.id) : overview.plans.filter(plan => plan.id === item.id);
  const calls = plans.flatMap(plan => { const event = overview.events.find(value => value.id === plan.eventId); return event ? [{ ...event, planId: plan.id, revision: plan.revision, active: plan.active, status: plan.status, attention: plan.attention, nextReminder: plan.nextReminder, delivery: plan.delivery }] : []; });
  const event = calls.find(call => call.id === checkedEventId) ?? calls[0] ?? exampleEvent(item.kind);
  const draft: Draft = { scope: selection.scope, eventId: selection.scope === "event" ? event.id : "", kind: item.kind, track: item.track, templateId: SAMPLE_TEMPLATE.id, templateVersion: SAMPLE_TEMPLATE.version, bodyTarget: "copy:body", headingTarget: "copy:heading", bindings: { MEMBER_NAME: { source: "member_name" }, CALL_URL: { source: "call_url" } }, copy: { greeting: "", signature: "RU/NED" } };
  const reviewed = sampleReview({ ...draft, eventId: event.id }, event, SAMPLE_TEMPLATE);
  return { scope: selection.scope, id: item.id, revision: item.revision, active: item.active, title: item.title, status: item.status, draft, template: SAMPLE_TEMPLATE, configuration: overview.configuration, timingSummary: item.timingSummary, audienceSummary: item.audienceSummary, inheritanceSummary: item.inheritanceSummary, nextReminder: item.nextReminder, calls, selectedEventId: event.id, previewIsExample: true,
    previews: (reviewed.previews ?? []).map(item => ({ ...item, stage: item.stage as CadenceStage })), occurrences: reviewed.occurrences.map(occurrence => ({ ...occurrence, stage: occurrence.stage as CadenceStage })), recipients: reviewed.recipients.map(recipient => ({ ...recipient, reason: recipient.reason ?? "" })), recipientsChecked: true, recentDeliveries: selection.scope === "sequence" && item.active ? [{ id: "sample-delivery", eventId: "sample-earlier-call", eventTitle: "Foundations 01 — earlier sample call", stage: "orientation", status: "sent", dueAt: "2026-10-12T18:00:00Z", updatedAt: "2026-10-12T18:01:00Z", sentAt: "2026-10-12T18:01:00Z", reason: "Sample provider acceptance. No real email was sent." }] : [], warnings: ["Sample workspace. These designs, calls, recipients, and delivery records are fictional. Activation and sending are disabled."] };
}

export default function OperatorEmailAutomations({ preview = false }: { preview?: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(preview ? sampleOverview() : null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [template, setTemplate] = useState<ResendEmailTemplate | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [previewStage, setPreviewStage] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [detail, setDetail] = useState<CadenceManagementDetail | null>(null);
  const [selection, setSelection] = useState<AutomationSelection | null>(null);
  const [detailStage, setDetailStage] = useState(0);
  const [recipientEventId, setRecipientEventId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const [viewOptions, setViewOptions] = useState<AutomationViewOptions>({...DEFAULT_AUTOMATION_VIEW_OPTIONS,track:"members"});
  const [section, setSection] = useState<AutomationSection>("upcoming");
  const [editorStage, setEditorStage] = useState<CadenceStage>("day_before");
  const [navigationReady, setNavigationReady] = useState(false);
  const initialNavigation = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, setPending] = useState<string | null>(preview ? null : "loading");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const navigationTarget = useRef<string | null>(null);
  const allowNavigation = useRef(false);
  const event = overview?.events.find(item => item.id === draft.eventId);
  const sequenceScope = draft.scope === "sequence";
  const reviewingSequence = review?.scope === "sequence";
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

  useEffect(() => {
    if (!editorOpen || typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => {
      if ((dirty || busy.current) && !allowNavigation.current) { event.preventDefault(); event.returnValue = ""; }
    };
    const guard = (event: MouseEvent) => {
      if ((!dirty && !busy.current) || allowNavigation.current || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(destination.protocol) || (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash)) return;
      event.preventDefault(); event.stopPropagation();
      if (busy.current) { setMessage("Wait for the current automation action to finish before leaving."); return; }
      navigationTarget.current = destination.href; setConfirmDiscard(true);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guard, true); };
  }, [dirty, editorOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const heading = document.getElementById(editorOpen ? "automation-editor-heading" : "automation-detail-heading");
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: "auto" });
  }, [editorOpen, detail?.id]);

  useEffect(() => {
    if (!review || typeof document === "undefined") return;
    const heading = document.getElementById("automation-review-heading");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [review]);

  useEffect(() => {
    if (!confirmDiscard || typeof document === "undefined") return;
    const confirmation = document.getElementById("automation-discard-confirmation");
    confirmation?.focus({ preventScroll: true });
    confirmation?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [confirmDiscard]);

  // Keep direct links to individual emails and restore the browsing context on reload/back.
  useEffect(() => {
    if (typeof window === "undefined" || !overview || pending || initialNavigation.current) return;
    initialNavigation.current = true;
    const saved = readAutomationNavigation(window.location.search);
    setSection(saved.section); setQuery(saved.query); setFilter(saved.filter); setViewOptions(saved.options);
    setNavigationReady(true);
    if (saved.selection) void openDetail(saved.selection,saved.eventId);
    // Loading the overview is the only initialization dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview,pending]);
  useEffect(() => {
    if (typeof window === "undefined" || !navigationReady || pending || editorOpen) return;
    const search = writeAutomationNavigation(window.location.search,{section,query,filter,options:viewOptions,
      selection: selection ? {...selection,stage:detail?.previews[detailStage]?.stage} : null,eventId:recipientEventId || undefined});
    const destination = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    if (destination !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state,"",destination);
  },[navigationReady,pending,editorOpen,section,query,filter,viewOptions,selection,detail,detailStage,recipientEventId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const restore = () => {
      if (busy.current || editorOpen) return;
      const saved = readAutomationNavigation(window.location.search);
      setSection(saved.section);setQuery(saved.query);setFilter(saved.filter);setViewOptions(saved.options);
      if (saved.selection) void openDetail(saved.selection,saved.eventId);
      else {setDetail(null);setSelection(null);}
    };
    window.addEventListener("popstate",restore);
    return () => window.removeEventListener("popstate",restore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[overview,editorOpen,selection,detail,detailStage]);

  function change(update: Partial<Draft>) {
    if (busy.current) return;
    setDraft(current => ({ ...current, ...update })); setDirty(true); setReview(null); setMessage(""); setFailed(false);
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
      if (mounted.current) { setOverview(result); setReview(null);
        if (selection) {
          const params = new URLSearchParams({scope:selection.scope,id:selection.id});
          if (recipientEventId) params.set("eventId",recipientEventId);
          const updated = await request<CadenceManagementDetail>(`${API}?${params}`);
          if (mounted.current) { const stage = detail?.previews[detailStage]?.stage; setDetail(updated); setDetailStage(Math.max(0,updated.previews.findIndex(item => item.stage === stage))); }
        } }
    });
  }
  async function chooseTemplate(id: string) {
    if (busy.current) return;
    setDirty(true); setReview(null); setTemplate(null); setDraft(current => ({ ...current, templateId: id, templateVersion: "", bodyTarget: "", headingTarget: undefined, bindings: {}, copy: undefined }));
    if (!id) return;
    await perform("template", async () => {
      const selected = preview ? SAMPLE_TEMPLATE : (await request<{ template: ResendEmailTemplate }>(`/api/ops/emails/resend/templates/${encodeURIComponent(id)}`)).template;
      if (!mounted.current) return;
      if (selected.campaignOnly) throw new Error("Choose an individual email template. Campaign-only templates cannot be used for these reminders.");
      if (selected.status !== "published") throw new Error("Publish this design in Resend before using it for an automation.");
      const connections = suggestedCadenceDesignConnections(selected);
      setTemplate(selected); setDraft(current => ({ ...current, templateId: selected.id, templateVersion: selected.version, ...connections }));
    });
  }
  async function reviewDraft(e: FormEvent) {
    e.preventDefault();
    const messageError = cadenceMessagesValidationError(draft.messages);
    if (messageError) {setMessage(messageError);setFailed(true);return;}
    if ((!sequenceScope && !event) || !template || !draft.bodyTarget || draft.bodyTarget === draft.headingTarget || overview?.setupRequired) return;
    await perform("review", async () => {
      setReview(null);
      const copy = Object.fromEntries(template.fields.flatMap(field => {
        const value = draft.copy?.[field.key];
        return ![draft.bodyTarget, draft.headingTarget].includes(`copy:${field.key}`) && value !== undefined && value !== field.value ? [[field.key, value]] : [];
      }));
      const reviewedDraft = { ...draft, copy: Object.keys(copy).length ? copy : undefined, bindings: Object.fromEntries(Object.entries(draft.bindings).filter(([key]) => ![draft.bodyTarget, draft.headingTarget].includes(`variable:${key}`))) };
      const result = preview ? sampleReview(reviewedDraft, event ?? exampleEvent(draft.kind), template) : await request<Review>(API, { action: "preview", draft: reviewedDraft });
      if (mounted.current) { setReview(result); setPreviewStage(Math.max(0,result.previews?.findIndex(item => item.stage === editorStage) ?? 0)); }
    });
  }
  async function activate() {
    if (preview || !review || expired || (!reviewingSequence && (!eligibleCount || !review.occurrences.length)) || overview?.setupRequired) return;
    await perform("activate", async () => {
      const token = review.reviewToken;
      setReview(null);
      await request(API, { action: "activate", reviewToken: token });
      if (!mounted.current) return;
      setEditorOpen(false); setDirty(false); setDetail(null); setSelection(null);
      setMessage(reviewingSequence ? "Sequence activated for matching published calls, including future calls. Earlier stages will not be sent." : "Automation activated for future reminders. Earlier stages will not be sent.");
      try { setOverview(await request<Overview>(API)); }
      catch { setMessage(`${reviewingSequence ? "Sequence" : "Automation"} activated. Refresh the list to see its latest status.`); }
    });
  }
  async function pause(plan: Plan) {
    if (preview) return;
    await perform(`pause:${plan.id}`, async () => {
      await request(API, { action: "pause", id: plan.id, revision: plan.revision });
      if (!mounted.current) return;
      setDetail(null); setSelection(null); setReview(null); setOverview(current => current ? { ...current,
        plans: current.plans.map(item => item.id === plan.id ? { ...item, active: false, status: "paused" } : item),
        upcoming: current.upcoming?.map(item => item.planId === plan.id ? { ...item, active: false, status: "paused" } : item),
      } : current);
      setMessage("Automation paused. Future reminders will not be sent by this plan.");
      try { setOverview(await request<Overview>(API)); }
      catch { setMessage("Automation paused. Refresh the list to see its latest status."); }
    });
  }
  async function pauseSequence(sequence: Sequence) {
    if (preview) return;
    await perform(`pause-sequence:${sequence.id}`, async () => {
      await request(API, { action: "pause_sequence", id: sequence.id, revision: sequence.revision });
      if (!mounted.current) return;
      setDetail(null); setSelection(null); setReview(null); setOverview(current => current ? { ...current,
        sequences: current.sequences?.map(item => item.id === sequence.id ? { ...item, active: false, status: "paused" } : item),
        plans: current.plans.map(item => item.sequenceId === sequence.id ? { ...item, active: false, status: "paused" } : item),
        upcoming: current.upcoming?.map(item => item.sequenceId === sequence.id ? { ...item, active: false, status: "paused" } : item),
      } : current);
      setMessage("Sequence paused. Its inherited call reminders are paused too.");
      try { setOverview(await request<Overview>(API)); }
      catch { setMessage("Sequence and its inherited reminders paused. Refresh the list to see their latest status."); }
    });
  }

  async function openDetail(next: AutomationSelection, actualEventId?: string) {
    if (busy.current || !overview) return;
    await perform(actualEventId ? "recipients" : "detail", async () => {
      if (actualEventId) setDetail(current => current ? {...current, recipientsChecked: false, recipients: []} : current);
      const params = new URLSearchParams({ scope: next.scope, id: next.id });
      if (actualEventId) params.set("eventId", actualEventId);
      const result = preview ? sampleDetail(overview, next, actualEventId) : await request<CadenceManagementDetail>(`${API}?${params}`);
      if (!mounted.current) return;
      const stage = next.stage ?? (selection?.id === next.id && selection.scope === next.scope ? detail?.previews[detailStage]?.stage : undefined);
      setDetail(result); setSelection({scope:next.scope,id:next.id}); setDetailStage(Math.max(0,result.previews.findIndex(item => item.stage === stage))); setRecipientEventId(result.selectedEventId ?? "");
    });
  }
  function changeSection(value: AutomationSection) {
    const normalized = normalizeAutomationView(value,filter,viewOptions);
    setSection(value);setFilter(normalized.filter);setViewOptions(normalized.options);setDetail(null);setSelection(null);
  }
  function newAutomation() {
    if (busy.current) return;
    setDetail(null); setSelection(null); navigationTarget.current = null;
    setEditorStage("day_before"); setDraft(blankDraft()); setTemplate(null); setReview(null); setEditorOpen(true); setEditingLabel(null); setDirty(false); setConfirmDiscard(false); setMessage("");
  }
  function editSaved() {
    if (busy.current || !detail) return;
    setDraft({ ...detail.draft, scope: detail.scope, eventId: detail.selectedEventId ?? detail.draft.eventId, bindings: { ...detail.draft.bindings }, copy: { ...Object.fromEntries(detail.template.fields.map(field => [field.key, field.value])), ...detail.draft.copy } });
    setEditorStage(detail.previews[detailStage]?.stage ?? "day_before");
    setTemplate(detail.template); setReview(null); setPreviewStage(0); setEditingLabel(detail.title); setEditorOpen(true); setDirty(false); setConfirmDiscard(false); setMessage("");
  }
  function closeEditor(discard = false) {
    if (busy.current) return;
    if (!discard) navigationTarget.current = null;
    if (dirty && !discard) { setConfirmDiscard(true); return; }
    if (discard && navigationTarget.current) { allowNavigation.current = true; window.location.assign(navigationTarget.current); return; }
    setEditorOpen(false); setDirty(false); setReview(null); setConfirmDiscard(false); setMessage("");
  }
  function pauseSelected() {
    if (!detail || !overview) return;
    if (detail.scope === "sequence") { const item = overview.sequences.find(value => value.id === detail.id); if (item) void pauseSequence(item); }
    else { const item = overview.plans.find(value => value.id === detail.id); if (item) void pause(item); }
  }

  return <OperatorPageFrame title="Automated emails">
    <OperatorMessagesTabs active="automations" />
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><p className="text-xs uppercase tracking-[0.14em] text-[color:var(--operator-muted)]">Communications / automatic reminders</p><h2 className="operator-page-heading mt-2">Automated emails</h2><p className="mt-3 text-sm leading-relaxed text-[color:var(--operator-muted)]">See what’s sending next, review your emails, and check delivery activity.</p></div><div className="flex flex-wrap gap-3">{editorOpen ? <button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} onClick={() => closeEditor()} type="button">{editingLabel && detail ? detail.scope === "sequence" ? "Back to sequence" : "Back to call" : "Back to automations"}</button> : <><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending || overview?.setupRequired} onClick={newAutomation} type="button">New automation</button><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} onClick={() => void refresh()} type="button">Refresh</button></>}</div></header>
    {preview ? <p className="operator-emphasis mb-5 p-4 text-sm" data-operator-tone="wait">Preview workspace. Events, designs, and recipients below are samples. Nothing is saved or sent.</p> : null}
    {overview && (!overview.configuration.enabled || !overview.configuration.ready || overview.setupRequired) ? <section className="operator-emphasis mb-5 space-y-2 p-4 text-sm" data-operator-tone="wait" aria-label="Automation readiness"><h3 className="font-semibold">{overview.setupRequired ? "Automation setup is required" : !overview.configuration.enabled ? "Automatic delivery is paused" : "Delivery setup is incomplete"}</h3><p>{overview.setupRequired ? "The automation service needs setup before a plan can be reviewed or activated." : !overview.configuration.enabled ? "You can prepare and activate plans. No automated emails will leave until automatic delivery is enabled." : "You can prepare plans, but delivery will wait until the email service is ready."}</p></section> : null}
    {message ? <p className={`mb-5 break-words text-sm ${failed ? "text-[var(--operator-danger)]" : "text-[color:var(--operator-muted)]"}`} role={failed ? "alert" : "status"}>{message}</p> : null}
    {!overview ? <p className="operator-bento-card text-sm" role="status">{pending ? "Loading automations…" : "Automations are unavailable. Refresh to try again."}</p> : <>
      {!editorOpen ? <OperatorEmailAutomationManager overview={overview} detail={detail} selection={selection} section={section} onSection={changeSection} query={query} filter={filter} viewOptions={viewOptions} onViewOptions={setViewOptions} onResetView={() => { setQuery(""); setFilter("all"); setViewOptions({...DEFAULT_AUTOMATION_VIEW_OPTIONS,track:"members"}); }} previewStage={detailStage} recipientEventId={recipientEventId} pending={pending} preview={preview} onQuery={setQuery} onFilter={setFilter} onSelect={next => void openDetail(next)} onStage={setDetailStage} onRecipientEvent={value => { if (selection) void openDetail(selection,value); }} onInspectRecipients={() => { if (selection && recipientEventId) void openDetail(selection, recipientEventId); }} onEdit={editSaved} onPause={pauseSelected} onClose={() => { setDetail(null); setSelection(null); }} /> : <>
      <section className="operator-bento-card mb-5"><p className="text-xs uppercase tracking-[0.12em] text-[color:var(--operator-muted)]">{editingLabel ? "Revise approved setup" : "New automation"}</p><h3 className="mt-2 scroll-mt-24 break-words text-xl font-semibold outline-none" id="automation-editor-heading" tabIndex={-1}>{editingLabel ?? "Choose a call and its design"}</h3><p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">{editingLabel ? "Edit the message, then preview the complete email before activating your changes." : "Reminder timing follows the approved cadence. This setup controls the design and which calls inherit it."}</p></section>
      {confirmDiscard ? <section className="operator-emphasis mb-5 scroll-mt-24 p-4 outline-none" data-operator-tone="wait" role="alert" id="automation-discard-confirmation" tabIndex={-1}><p className="text-sm">Discard the changes to this setup?</p><div className="mt-3 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => { navigationTarget.current = null; setConfirmDiscard(false); }}>Keep editing</button><button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => closeEditor(true)}>Discard changes</button></div></section> : null}
      <OperatorEmailAutomationEditor draft={draft} template={template} overview={overview} pending={pending} editing={Boolean(editingLabel)} preview={preview} initialStage={editorStage} onStage={setEditorStage} onDraft={change} onSelectTemplate={chooseTemplate} onReview={reviewDraft} />
      {review ? <section className="mt-7 space-y-5" aria-labelledby="automation-review-heading"><header><h3 className="scroll-mt-24 text-xl font-semibold outline-none" id="automation-review-heading" tabIndex={-1}>Review before activating</h3><p className="mt-2 text-sm text-[color:var(--operator-muted)]">{reviewingSequence ? `${KINDS.find(item => item.value === draft.kind)?.label ?? "Member call"} · ${draft.track === "founder_test" ? "Founder test" : "Members"}` : event?.title} · {template?.name}</p>{reviewingSequence ? <p className="mt-2 text-xs text-[color:var(--operator-muted)]">{event ? `Example call: ${event.title}.` : "The email and timing below use a representative future call."}</p> : null}{review.expiresAt ? <p className="mt-2 text-xs text-[color:var(--operator-muted)]">Review expires {dateLabel(review.expiresAt, event?.timeZone)}. Changes to this setup require another review.</p> : null}</header>
        {reviewingSequence ? <section className="operator-bento-card" aria-labelledby="cadence-matching-calls-heading"><h4 className="font-semibold" id="cadence-matching-calls-heading">Matching published calls</h4><p className="mt-2 text-xs leading-relaxed text-[color:var(--operator-muted)]">Each matching call uses its own qualified audience. Individual overrides and paused calls retain their settings.</p>{review.matchingEvents?.length ? <ul className="mt-3 space-y-3">{review.matchingEvents.map(item => <li className="break-words text-sm" key={item.id}>{preview ? <p className="font-medium">{item.title}</p> : <Link className="font-medium underline underline-offset-4" href={`/ops/experiences/${encodeURIComponent(item.id)}`}>{item.title} ↗</Link>}<p className="mt-1 text-xs text-[color:var(--operator-muted)]">{dateLabel(item.startsAt, item.timeZone)}</p></li>)}</ul> : <p className="mt-3 text-sm">No matching calls are scheduled yet. The sequence can be approved now and will apply when matching calls are published.</p>}</section> : null}
        <div className="grid min-w-0 gap-5 xl:grid-cols-2"><div className="min-w-0 space-y-5"><section className="operator-bento-card"><h4 className="font-semibold">{reviewingSequence ? "Example reminder timing" : "Scheduled reminders"}</h4><p className="mt-2 text-xs text-[color:var(--operator-muted)]">Times shown in {event?.timeZone ?? "America/Denver"}. {reviewingSequence ? "Timing is calculated separately from each call’s scheduled time." : "Only future stages can be activated."}</p><ul className="mt-3 space-y-3">{review.occurrences.map(occurrence => <li className="break-words text-sm" key={`${occurrence.stage}:${occurrence.dueAt}`}><p className="font-medium capitalize">{stageLabel(occurrence.stage)}</p><p className="mt-1">{dateLabel(occurrence.dueAt, event?.timeZone)}</p><p className="mt-1 text-xs text-[color:var(--operator-muted)]">Expires {dateLabel(occurrence.expiresAt, event?.timeZone)}</p></li>)}</ul>{!review.occurrences.length ? <p className="mt-3 text-sm">{reviewingSequence ? "There are no remaining reminder times for this example. Future matching calls use the approved sequence." : "No future reminders are available for this event."}</p> : null}</section>
          <section className="operator-bento-card"><h4 className="font-semibold">{reviewingSequence ? "Example call recipients" : "Recipients"}</h4><p className="mt-2 text-sm">{eligibleCount} eligible · {review.recipients.length - eligibleCount} excluded</p><p className="mt-2 text-xs leading-relaxed text-[color:var(--operator-muted)]">{reviewingSequence ? "These recipients belong to the example call only. Future calls resolve their own audience, and members joining later receive only future stages. " : ""}Eligibility and communication choices are checked again before each delivery.</p>{!review.recipients.length ? <p className="mt-3 text-sm">{reviewingSequence ? "No recipients are included in this example. You can approve the sequence before its future audience is known." : "No recipients currently qualify for this call. Check its audience, membership access, and reminder preferences. Foundations and founder tests also need confirmed invitations in Events."}</p> : <ul className="mt-3 max-h-96 space-y-3 overflow-y-auto">{review.recipients.map(recipient => <li className="break-words border-t border-[color:var(--operator-ink)]/15 pt-3 text-sm" key={recipient.memberId}><p className="font-medium">{recipient.name || "Member"}</p><p className="break-all text-xs text-[color:var(--operator-muted)]">{recipient.email}</p><p className={`mt-1 text-xs ${recipient.eligible ? "text-[var(--operator-success-text)]" : "text-[color:var(--operator-muted)]"}`}>{recipient.eligible ? "Eligible" : `Excluded: ${recipient.reason || "Not eligible for this reminder."}`}</p></li>)}</ul>}</section></div>
          <section className="operator-glass min-w-0 overflow-hidden" aria-label="Automation email preview"><div className="border-b border-[color:var(--operator-ink)]/15 p-4"><h4 className="text-sm font-semibold">{review.previews?.length ? "Email preview" : "Example email"}</h4>{review.previews ? <div className="mt-3 flex flex-wrap gap-2" aria-label="Review reminder emails">{review.previews.map((item,index) => <button className="min-h-11 border border-[color:var(--operator-line)] px-3 py-2 text-xs aria-pressed:bg-[var(--operator-surface-muted)]" type="button" key={item.stage} aria-pressed={previewStage === index} onClick={() => setPreviewStage(index)}>{stageLabel(item.stage)}</button>)}</div> : null}<p className="mt-3 break-words text-sm font-semibold">{shownPreview?.subject}</p></div>{shownPreview ? <iframe className="h-[540px] w-full border-0 bg-white" title="Automation email design" sandbox="" referrerPolicy="no-referrer" srcDoc={safePreview(shownPreview.html)} /> : null}</section></div>
        {review.warnings.length ? <div className="operator-emphasis p-4 text-sm" data-operator-tone="wait"><ul className="space-y-2">{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
        <div className="operator-bento-card"><p className="max-w-2xl text-sm leading-relaxed">{reviewingSequence ? "Activating approves this sequence for current and future published calls with the selected call type and cadence. Each call sends only to its qualified audience. Individual overrides and paused calls stay unchanged. Members joining later receive only future stages. Pausing the sequence stops its inherited reminders." : "Activating allows future reminders to be sent automatically to this call’s eligible audience. Past reminders are skipped. You can pause this plan at any time."}</p>{!overview.configuration.enabled || !overview.configuration.ready ? <p className="mt-3 text-sm font-medium">Delivery is currently paused. {reviewingSequence ? "An activated sequence" : "An activated plan"} will wait for automatic delivery to be enabled and ready.</p> : null}<div className="mt-4 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={preview || !!pending || (!reviewingSequence && (!eligibleCount || !review.occurrences.length)) || expired || overview.setupRequired} onClick={() => void activate()} type="button">{pending === "activate" ? "Activating…" : preview ? "Activation off in preview" : reviewingSequence ? "Activate sequence" : "Activate automation"}</button><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} onClick={() => setReview(null)} type="button">Back to setup</button></div>{expired ? <p className="mt-3 text-sm text-[var(--operator-danger)]" role="alert">This review has expired. Review the setup again before activating.</p> : null}</div>
      </section> : null}
      </>}
      {overview.warnings?.length ? <aside className="operator-emphasis mt-5 p-4 text-sm leading-relaxed" data-operator-tone="wait" aria-label="Automation service notes"><ul className="space-y-2">{overview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></aside> : null}
    </>}
  </OperatorPageFrame>;
}
