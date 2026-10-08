"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import OperatorDialog from "@/components/platform/OperatorDialog";
import OperatorEmailBannerUpload, { renderLocalEmailBanner, type LocalEmailBanner } from "@/components/platform/OperatorEmailBannerUpload";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
import type { ResendEmailEdits, ResendEmailTemplate } from "@/lib/communications/resend-email-model";
import { insertResendEmailBanner, normalizeResendEmailBanner, renderResendEmailTemplate } from "@/lib/communications/resend-email-templates";

type TemplateSummary = { id: string; name: string; status: "draft" | "published"; updatedAt?: string };
type BroadcastSummary = { id: string; name: string; subject?: string; status: string; createdAt: string };
type SentEmail = { id: string; subject: string; to: string[]; lastEvent: string; createdAt: string };
type Overview = {
  templates: TemplateSummary[];
  segments: Array<{ id: string; name: string }>;
  topics: Array<{ id: string; name: string; defaultSubscription: string }>;
  broadcasts: BroadcastSummary[];
  emails: SentEmail[];
  configuration: { connected: boolean; aiReady: boolean; sendingReady: boolean; issues: string[] };
  cursors: { broadcasts: string | null; emails: string | null };
};
export type ResendEmailPreviewCatalog = Pick<Overview, "segments" | "topics"> & { templates: ResendEmailTemplate[] };
type RenderedEmail = { html: string; text?: string; subject: string; from: string };
type BroadcastDetail = BroadcastSummary & { html: string; from: string; segmentId: string; topicId: string | null; previewText: string };
type SendReview = RenderedEmail & {
  id: string; recipientCount: number; recipients: Array<{ email: string; name: string }>; excludedCount: number;
  mode: "individual" | "campaign"; segmentName: string | null; expiresAt: string; broadcastId?: string;
};
type View = "templates" | "broadcasts" | "emails";
type Pending = "loading" | "template" | "generate" | "save" | "review" | "send" | "refresh" | "more" | "upload" | null;
const API = "/api/ops/emails/resend";
const SECONDARY_BUTTON = "inline-flex min-h-11 items-center justify-center rounded-[4px] border border-black/25 px-4 py-2 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40";
const SAMPLE_HTML = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f2f0e9;font-family:Arial,sans-serif;color:#20201e"><main style="max-width:520px;margin:auto;padding:48px 28px"><p style="font-size:11px;letter-spacing:2px">EXAMPLE RESEND TEMPLATE</p><hr style="border:0;border-top:1px solid #b9b6ad;margin:32px 0"><h1 style="font-size:34px;line-height:1.15;font-weight:400">{{HEADLINE}}</h1><p style="font-size:15px;line-height:1.8">Hi {{FIRST_NAME}},</p><p style="font-size:15px;line-height:1.8;white-space:pre-wrap">{{MESSAGE}}</p><hr style="border:0;border-top:1px solid #b9b6ad;margin:40px 0 20px"><p style="font-size:11px;color:#666">Sample design for this preview. No email will be sent.</p></main></body></html>';
const SAMPLE_TEMPLATE: ResendEmailTemplate = {
  id: "sample-template", name: "Example member update", status: "published", version: "sample-v1", hasUnpublishedVersions: false,
  html: SAMPLE_HTML, text: null, subject: "A note for our members", from: "Ruined <hello@example.test>", replyTo: [],
  variables: [{ key: "FIRST_NAME", type: "string", fallbackValue: "there" }],
  fields: [{ key: "headline", label: "Heading", value: "A little room for what matters." }, { key: "message", label: "Message", value: "Here is a short member update. Replace this copy while keeping the template’s layout intact." }],
};
const SAMPLE_OVERVIEW: Overview = {
  templates: [{ id: SAMPLE_TEMPLATE.id, name: SAMPLE_TEMPLATE.name, status: "published" }],
  segments: [{ id: "sample-members", name: "Members — sample segment" }],
  topics: [{ id: "sample-updates", name: "Member updates — sample topic", defaultSubscription: "opt_in" }],
  broadcasts: [], emails: [], configuration: { connected: false, aiReady: false, sendingReady: false, issues: [] },
  cursors: { broadcasts: null, emails: null },
};

function defaultEdits(template: ResendEmailTemplate): ResendEmailEdits {
  return {
    subject: template.subject,
    values: Object.fromEntries(template.variables.map((field) => [field.key, field.fallbackValue == null ? "" : String(field.fallbackValue)])),
    copy: Object.fromEntries(template.fields.map((field) => [field.key, field.value])),
  };
}
function escapeText(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function sampleRender(edits: ResendEmailEdits): RenderedEmail {
  const html = SAMPLE_HTML.replace("{{HEADLINE}}", escapeText(edits.copy.headline ?? "")).replace("{{MESSAGE}}", escapeText(edits.copy.message ?? "")).replace("{{FIRST_NAME}}", escapeText(edits.values.FIRST_NAME ?? "there"));
  const banner = normalizeResendEmailBanner(edits.banner);
  return { subject: edits.subject, from: SAMPLE_TEMPLATE.from, html: banner ? insertResendEmailBanner(html, banner) : html };
}
function previewEdits(edits: ResendEmailEdits, fallbackAlt = false): ResendEmailEdits {
  // Keep an unfinished banner editable without interrupting the rest of the preview.
  // Save and review validate the complete banner through editorPayload instead.
  const banner = fallbackAlt && edits.banner && !edits.banner.alt.trim() ? { ...edits.banner, alt: "Banner preview" } : edits.banner;
  try { return { ...edits, banner: normalizeResendEmailBanner(banner) }; }
  catch { return { ...edits, banner: null }; }
}
function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
function statusLabel(value: string): string { return value.replace(/^email\./, "").replaceAll("_", " "); }
function safePreview(html: string): string {
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\' https:; font-src https: data:; script-src \'none\'; connect-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">';
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (head) => `${head}${policy}`) : `${policy}${html}`;
}
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(typeof result?.error === "string" ? result.error : "Resend could not be reached. Please try again.");
  return result;
}

function DesignPreview({ email, updating = false, error = "", compact = false }: { email: RenderedEmail | null; updating?: boolean; error?: string; compact?: boolean }) {
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  return <section className="min-w-0" aria-label="Email design preview">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Design preview</h3><div className="flex gap-1" role="group" aria-label="Preview width">{(["desktop", "mobile"] as const).map((size) => <button aria-pressed={width === size} className={`min-h-9 rounded-[3px] px-2.5 text-xs capitalize ${width === size ? "bg-black/10" : "text-black/55 hover:bg-black/5"}`} key={size} onClick={() => setWidth(size)} type="button">{size}</button>)}</div></header>
    <div className="overflow-hidden rounded-[5px] border border-black/15 bg-[var(--color-shop)]">
      <div className="border-b border-black/10 px-4 py-3"><p className="break-words text-xs text-black/55">{email?.from || "Template sender"}</p><p className="mt-1 break-words text-sm font-semibold">{email?.subject || "Email subject"}</p></div>
      <div className="bg-black/5 p-2">
        {email ? <iframe className={`mx-auto block w-full border-0 bg-white ${compact ? "h-[440px]" : "h-[480px] sm:h-[690px]"} ${width === "mobile" ? "max-w-[375px]" : ""}`} referrerPolicy="no-referrer" sandbox="" srcDoc={safePreview(email.html)} title="Rendered email template" /> : <p className="px-5 py-16 text-center text-sm text-black/55">Preparing the template preview…</p>}
      </div>
    </div>
    <p aria-live="polite" className={`mt-2 text-xs leading-relaxed ${error ? "text-[var(--color-poster)]" : "text-black/50"}`}>{error || (updating ? "Updating preview…" : "The Resend design is preserved. Appearance can vary between inboxes.")}</p>
  </section>;
}

export default function OperatorEmailComposer({ preview = false, previewCatalog }: { preview?: boolean; previewCatalog?: ResendEmailPreviewCatalog | null }) {
  const [overview, setOverview] = useState<Overview | null>(preview ? previewCatalog ? { ...SAMPLE_OVERVIEW, ...previewCatalog } : SAMPLE_OVERVIEW : null);
  const [view, setView] = useState<View>("templates");
  const [template, setTemplate] = useState<ResendEmailTemplate | null>(null);
  const [edits, setEdits] = useState<ResendEmailEdits>({ subject: "", values: {}, copy: {} });
  const [undo, setUndo] = useState<ResendEmailEdits | null>(null);
  const [mode, setMode] = useState<"individual" | "campaign">("individual");
  const [recipient, setRecipient] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const pendingRef = useRef(false);
  const selectionRef = useRef(0);
  const previewSequenceRef = useRef(0);
  const allowNavigationRef = useRef(false);
  const [confirm, setConfirm] = useState<{ description: string; action: () => void } | null>(null);
  const [rendered, setRendered] = useState<RenderedEmail | null>(null);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<SendReview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [broadcast, setBroadcast] = useState<BroadcastDetail | null>(null);
  const [savedBroadcast, setSavedBroadcast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [localBanner, setLocalBanner] = useState<LocalEmailBanner | null>(null);
  const busy = pending !== null;
  let bannerHint = "";
  if (edits.banner) {
    try { normalizeResendEmailBanner(preview && localBanner ? { ...edits.banner, url: "https://banner-preview.example.com/local.png" } : edits.banner); }
    catch (failure) { bannerHint = failure instanceof Error ? failure.message : "Complete the image details to preview the banner."; }
  }

  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [error]);
  useEffect(() => {
    function preventLoss(event: BeforeUnloadEvent) { if ((dirty || pendingRef.current) && !allowNavigationRef.current) event.preventDefault(); }
    function guardNavigation(event: MouseEvent) {
      if ((!dirty && !pendingRef.current) || allowNavigationRef.current || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(destination.protocol) || (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash)) return;
      event.preventDefault(); event.stopPropagation();
      if (pendingRef.current) { setNotice("Wait for the current email action to finish before leaving."); return; }
      setConfirm({ description: "Leave this email and discard the unsaved changes?", action: () => { allowNavigationRef.current = true; window.location.assign(destination.href); } });
    }
    window.addEventListener("beforeunload", preventLoss);
    document.addEventListener("click", guardNavigation, true);
    return () => { window.removeEventListener("beforeunload", preventLoss); document.removeEventListener("click", guardNavigation, true); };
  }, [dirty]);

  const loadOverview = useCallback(async (initial = false) => {
    if (preview || pendingRef.current) return;
    pendingRef.current = true;
    setPending(initial ? "loading" : "refresh"); setError("");
    try { setOverview(await request<Overview>(API)); if (!initial) setNotice("Templates, audiences, and history refreshed from Resend."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Resend could not be loaded."); }
    finally { pendingRef.current = false; setPending(null); }
  }, [preview]);
  useEffect(() => { void loadOverview(true); }, [loadOverview]);

  useEffect(() => {
    if (!template) return;
    const controller = new AbortController();
    const sequence = ++previewSequenceRef.current;
    const timer = window.setTimeout(async () => {
      setPreviewUpdating(true); setPreviewError("");
      try {
        const visibleEdits = previewEdits(preview && localBanner ? { ...edits, banner: null } : edits, true);
        const result = preview ? previewCatalog ? renderResendEmailTemplate(template, visibleEdits, { campaign: mode === "campaign" }) : sampleRender(visibleEdits) : await request<RenderedEmail>(`${API}/preview`, { templateId: template.id, templateVersion: template.version, edits: visibleEdits, mode }, controller.signal);
        if (preview && localBanner) result.html = renderLocalEmailBanner(result.html, localBanner, edits.banner);
        if (sequence === previewSequenceRef.current && !controller.signal.aborted) setRendered(result);
      } catch (failure) {
        if (!controller.signal.aborted && sequence === previewSequenceRef.current) setPreviewError(failure instanceof Error ? failure.message : "The updated preview could not be loaded.");
      } finally { if (!controller.signal.aborted && sequence === previewSequenceRef.current) setPreviewUpdating(false); }
    }, 450);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [edits, localBanner, mode, preview, previewCatalog, template]);

  useEffect(() => {
    if (!review) return;
    const remaining = new Date(review.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timeout = window.setTimeout(() => { setReview(null); setAcknowledged(false); setError("This review expired. Review the recipients again before sending."); }, Math.max(0, remaining));
    return () => window.clearTimeout(timeout);
  }, [review]);

  function begin(action: Exclude<Pending, null>): boolean {
    if (pendingRef.current) return false;
    pendingRef.current = true; setPending(action); setError(""); setNotice(""); return true;
  }
  function finish() { pendingRef.current = false; setPending(null); }
  function change() { setDirty(true); setReview(null); setAcknowledged(false); setSavedBroadcast(null); setError(""); setNotice(""); }
  function changeEdits(next: ResendEmailEdits) { setEdits(next); change(); }
  function requestChange(action: () => void, description = "Discard the unsaved changes to this email?") {
    if (pendingRef.current) return;
    if (dirty) setConfirm({ description, action }); else action();
  }
  function resetWorkspace(nextView: View) {
    ++selectionRef.current; ++previewSequenceRef.current;
    setView(nextView); setTemplate(null); setBroadcast(null); setRendered(null); setPreviewError(""); setPreviewUpdating(false);
    setDirty(false); setUndo(null); setReview(null); setAcknowledged(false); setSavedBroadcast(null); setQuery(""); setError(""); setNotice("");
    setLocalBanner(null);
  }
  async function chooseTemplate(id: string) {
    if (!begin("template")) return;
    const selection = ++selectionRef.current;
    try {
      const next = preview ? previewCatalog ? previewCatalog.templates.find((item) => item.id === id) : SAMPLE_TEMPLATE : (await request<{ template: ResendEmailTemplate }>(`${API}/templates/${encodeURIComponent(id)}`)).template;
      if (!next) throw new Error("That template is no longer in this preview. Reload the workspace.");
      if (selection !== selectionRef.current) return;
      const nextEdits = defaultEdits(next);
      setLocalBanner(null);
      if (next.campaignOnly) setMode("campaign");
      setTemplate(next); setEdits(nextEdits); setRendered(preview && !previewCatalog ? sampleRender(nextEdits) : { html: next.html, subject: next.subject, from: next.from });
      setBroadcast(null); setView("templates"); setUndo(null); setPrompt(""); setName(next.name); setSavedBroadcast(null); setDirty(false); setReview(null); setAcknowledged(false); setPreviewError("");
      requestAnimationFrame(() => document.getElementById("resend-composer")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "That template could not be loaded."); }
    finally { finish(); }
  }
  function editorPayload() {
    if (!template) throw new Error("Choose a Resend template first.");
    if (template.campaignOnly && mode === "individual") throw new Error("This design uses Resend campaign personalization. Choose a campaign or an individual-email design.");
    if (!edits.subject.trim()) throw new Error("Add the email subject.");
    if (mode === "individual" && !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient.trim())) throw new Error("Enter one valid recipient email address.");
    if (mode === "campaign" && (!segmentId || !topicId || !name.trim())) throw new Error("Add a campaign name and choose its Resend segment and topic.");
    // Local image bytes stay outside edits and all API payloads, including preview reviews.
    const localOnly = preview && localBanner;
    const validatedBanner = normalizeResendEmailBanner(localOnly && edits.banner ? { ...edits.banner, url: "https://banner-preview.example.com/local.png" } : edits.banner);
    const banner = localOnly ? null : validatedBanner;
    return { templateId: template.id, templateVersion: template.version, edits: { ...edits, banner }, mode, recipients: mode === "individual" ? [recipient.trim().toLowerCase()] : [], segmentId: mode === "campaign" ? segmentId : "", topicId: mode === "campaign" ? topicId : "", name: name.trim() };
  }
  async function generate() {
    if (!template || !prompt.trim() || (preview && previewCatalog) || !begin("generate")) return;
    try {
      const previous = structuredClone(edits);
      const next = preview ? { ...edits, copy: { ...edits.copy, message: "A short update, with room for what matters.\n\nThis is sample copy. In the connected workspace, ChatGPT follows your direction while preserving the template." } } : (await request<{ edits: ResendEmailEdits }>(`${API}/generate`, { templateId: template.id, templateVersion: template.version, edits: previewEdits(edits), mode, prompt: prompt.trim() })).edits;
      changeEdits({ ...next, banner: previous.banner ?? null }); setUndo(previous); setNotice(preview ? "Sample revision applied. ChatGPT was not called." : "Copy updated. Review the wording and links before sending.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "ChatGPT could not revise the copy."); }
    finally { finish(); }
  }
  async function saveBroadcast() {
    if (preview || mode !== "campaign" || !begin("save")) return;
    try {
      const payload = editorPayload();
      const result = await request<{ id: string }>(`${API}/broadcasts`, payload);
      setSavedBroadcast(result.id); setDirty(false); setNotice("Campaign draft saved in Resend. It has not been sent.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The campaign draft could not be saved."); }
    finally { finish(); }
  }
  async function reviewEmail(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!begin("review")) return;
    try {
      const payload = broadcast ? { broadcastId: broadcast.id } : mode === "campaign" && savedBroadcast ? { broadcastId: savedBroadcast } : editorPayload();
      if (preview) {
        const sampleRecipients = mode === "individual" ? [{ email: recipient.trim().toLowerCase(), name: "Preview recipient" }] : [{ email: "alex@example.test", name: "Alex — sample recipient" }, { email: "jordan@example.test", name: "Jordan — sample recipient" }];
        const reviewEdits = localBanner ? { ...edits, banner: null } : edits;
        const previewEmail = previewCatalog && template ? renderResendEmailTemplate(template, reviewEdits, { campaign: mode === "campaign" }) : sampleRender(reviewEdits);
        if (localBanner) previewEmail.html = renderLocalEmailBanner(previewEmail.html, localBanner, edits.banner);
        setReview({ ...previewEmail, id: "preview-review", recipients: sampleRecipients, recipientCount: sampleRecipients.length, excludedCount: 0, mode, segmentName: mode === "campaign" ? overview?.segments.find((segment) => segment.id === segmentId)?.name ?? "Sample segment" : null, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
      } else {
        const result = await request<{ review: SendReview }>(`${API}/review`, payload);
        setReview(result.review);
        if (!broadcast && result.review.mode === "campaign" && result.review.broadcastId) {
          setSavedBroadcast(result.review.broadcastId);
          setDirty(false);
        }
      }
      setAcknowledged(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The email could not be reviewed."); }
    finally { finish(); }
  }
  async function send() {
    if (preview || !review || !acknowledged || !overview?.configuration.sendingReady || !begin("send")) return;
    try {
      const result = await request<{ status: "sent" | "queued" | "unknown"; id: string; message: string }>(`${API}/send`, { reviewId: review.id });
      setReview(null); setAcknowledged(false);
      if (result.status === "unknown") setError(result.message || "Resend’s response could not be confirmed. Check the delivery history before trying again.");
      else { setDirty(false); setNotice(result.message || (result.status === "queued" ? "Campaign queued in Resend." : "Email sent through Resend.")); }
    } catch (failure) {
      setReview(null); setAcknowledged(false);
      setError(failure instanceof Error ? failure.message : "Sending could not be confirmed. Check Resend before trying again.");
    } finally { finish(); }
  }
  async function openBroadcast(id: string) {
    if (!begin("template")) return;
    const selection = ++selectionRef.current;
    try {
      const result = await request<{ broadcast: BroadcastDetail }>(`${API}/broadcasts/${encodeURIComponent(id)}`);
      if (selection !== selectionRef.current) return;
      setLocalBanner(null);
      setBroadcast(result.broadcast); setTemplate(null); setDirty(false); setReview(null); setView("broadcasts"); setPreviewError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The campaign could not be loaded."); }
    finally { finish(); }
  }
  async function loadMore(collection: "broadcasts" | "emails") {
    const cursor = overview?.cursors[collection];
    if (!cursor || !begin("more")) return;
    try {
      if (collection === "broadcasts") {
        const result = await request<{ items: BroadcastSummary[]; nextCursor: string | null }>(`${API}?collection=broadcasts&after=${encodeURIComponent(cursor)}`);
        setOverview((current) => current ? { ...current, broadcasts: [...current.broadcasts, ...result.items.filter((item) => !current.broadcasts.some((existing) => existing.id === item.id))], cursors: { ...current.cursors, broadcasts: result.nextCursor } } : current);
      } else {
        const result = await request<{ items: SentEmail[]; nextCursor: string | null }>(`${API}?collection=emails&after=${encodeURIComponent(cursor)}`);
        setOverview((current) => current ? { ...current, emails: [...current.emails, ...result.items.filter((item) => !current.emails.some((existing) => existing.id === item.id))], cursors: { ...current.cursors, emails: result.nextCursor } } : current);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "More history could not be loaded."); }
    finally { finish(); }
  }

  const templates = overview?.templates.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const broadcasts = overview?.broadcasts.filter((item) => `${item.name} ${item.subject ?? ""} ${item.status}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const emails = overview?.emails.filter((item) => `${item.subject} ${item.to.join(" ")}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const canCompose = preview || !!overview?.configuration.connected;

  return <OperatorPageFrame title="Messages">
    <OperatorMessagesTabs active="emails" />
    <header className="operator-record-header mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="operator-page-heading">Emails</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-black/60">Your Resend templates, audiences, and email history. ChatGPT helps with the words.</p></div>
      <div className="flex flex-wrap gap-2">{template || broadcast ? <button className={SECONDARY_BUTTON} disabled={busy} onClick={() => requestChange(() => resetWorkspace("templates"))} type="button">New email</button> : null}<button className={SECONDARY_BUTTON} disabled={busy || preview} onClick={() => void loadOverview()} type="button">{pending === "refresh" ? "Refreshing…" : "Refresh Resend"}</button></div>
    </header>
    {preview ? <p className="mb-5 rounded-[4px] bg-black/5 px-4 py-3 text-sm leading-relaxed text-black/65" role="status">{previewCatalog ? "Your existing Resend designs and audience names, loaded for preview. Edits stay in this page. ChatGPT, saving, and sending are off." : "Preview workspace. The template and audience below are samples. Resend, ChatGPT, and sending are off."}</p> : null}
    {overview && !preview && overview.configuration.issues.length ? <div className="mb-5 rounded-[4px] border border-black/15 px-4 py-3 text-sm leading-relaxed"><p className="font-semibold">{overview.configuration.connected ? "Some email tools need attention." : "Connect Resend to load your workspace."}</p><ul className="mt-1 space-y-1 text-black/60">{overview.configuration.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
    <div aria-live="polite" aria-atomic="true" className="mb-4 empty:hidden">{notice ? <p className="rounded-[4px] bg-black/5 px-4 py-3 text-sm leading-relaxed">{notice}</p> : null}</div>
    {error ? <p className="mb-4 scroll-mt-28 rounded-[4px] border border-[var(--color-poster)]/35 bg-[var(--color-poster)]/5 px-4 py-3 text-sm leading-relaxed" ref={errorRef} role="alert">{error}</p> : null}
    <nav aria-label="Resend workspace" className="mb-5 flex flex-wrap gap-1 border-b border-black/15 pb-3">{([{ id: "templates", label: "Templates" }, { id: "broadcasts", label: "Campaigns" }, { id: "emails", label: "Sent emails" }] as const).map((item) => <button aria-current={view === item.id ? "page" : undefined} className={`min-h-11 rounded-[4px] px-4 text-sm ${view === item.id ? "bg-black/10 font-semibold" : "text-black/60 hover:bg-black/5"}`} disabled={busy} key={item.id} onClick={() => requestChange(() => resetWorkspace(item.id))} type="button">{item.label}</button>)}</nav>
    {pending === "loading" ? <p className="py-12 text-sm text-black/55" role="status">Loading templates, audiences, and history from Resend…</p> : null}

    {view === "templates" && !template && overview ? <section aria-labelledby="resend-templates-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h3 className="text-lg font-semibold" id="resend-templates-title">Start with your design.</h3><p className="mt-1 text-sm text-black/55">Choose a template from Resend. Its layout, images, and links stay intact.</p></div><a className="min-h-11 py-3 text-sm underline underline-offset-4" href="https://resend.com/templates" rel="noreferrer" target="_blank">Open templates in Resend ↗</a></div>
      <label className="mb-5 block max-w-md text-sm" htmlFor="resend-template-search">Find a template<input className={OPERATOR_FIELD_CLASS} id="resend-template-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search your Resend templates" type="search" value={query} /></label>
      {templates.length ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{templates.map((item) => <li className="operator-bento-card flex flex-col items-start" key={item.id}><span className="mb-6 rounded-[3px] bg-black/5 px-2 py-1 text-xs capitalize text-black/60">{item.status}</span><h4 className="break-words text-base font-semibold leading-snug">{item.name}</h4>{item.updatedAt ? <p className="mt-2 text-xs text-black/45">Updated {dateLabel(item.updatedAt)}</p> : null}<button className={`${SECONDARY_BUTTON} mt-5 w-full`} disabled={busy || !canCompose} onClick={() => requestChange(() => { void chooseTemplate(item.id); })} type="button">{pending === "template" ? "Loading…" : "Use template"}<span className="sr-only">: {item.name}</span></button></li>)}</ul> : <p className="rounded-[4px] border border-dashed border-black/20 p-6 text-sm leading-relaxed text-black/60">{query ? "No templates match this search." : canCompose ? "No templates were found in Resend. Add your design in Resend, then refresh this workspace." : "Your templates will appear here when Resend is connected."}</p>}
    </section> : null}

    {view === "templates" && template ? <section className="scroll-mt-28" id="resend-composer" aria-labelledby="resend-template-title">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs text-black/50">{preview && !previewCatalog ? "Sample template" : "Resend template"}</p><h3 className="break-words text-lg font-semibold" id="resend-template-title">{template.name}</h3><p className="mt-1 text-xs text-black/50">{dirty ? "Unsaved changes" : savedBroadcast ? "Draft saved in Resend" : "Original design loaded"}</p></div><button className={SECONDARY_BUTTON} disabled={busy} onClick={() => requestChange(() => resetWorkspace("templates"))} type="button">Change template</button></header>
      {template.hasUnpublishedVersions ? <p className="mb-4 rounded-[4px] bg-black/5 p-3 text-sm leading-relaxed">This template has unpublished changes in Resend. Review the exact design below before sending.</p> : null}
      {template.campaignOnly ? <p className="mb-4 rounded-[4px] bg-black/5 p-3 text-sm leading-relaxed">This design uses Resend campaign personalization. Choose an audience campaign, or use an individual-email design for a direct message.</p> : null}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form aria-label="Compose with Resend template" className="min-w-0 space-y-4" data-operator-dirty={dirty} data-operator-pending={busy} onSubmit={(event) => void reviewEmail(event)}>
          <fieldset disabled={busy} className="operator-bento-card min-w-0 space-y-4"><legend className="sr-only">Recipients</legend><h4 className="text-base font-semibold">Recipients</h4>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Email delivery type"><button aria-pressed={mode === "individual"} className={`${SECONDARY_BUTTON} ${mode === "individual" ? "border-black bg-black/5" : ""}`} disabled={!!template.campaignOnly} onClick={() => { setMode("individual"); change(); }} type="button">Individual email</button><button aria-pressed={mode === "campaign"} className={`${SECONDARY_BUTTON} ${mode === "campaign" ? "border-black bg-black/5" : ""}`} onClick={() => { setMode("campaign"); change(); }} type="button">Audience campaign</button></div>
            {mode === "individual" ? <label className="block text-sm font-medium" htmlFor="resend-recipient">Recipient email<input autoCapitalize="none" autoCorrect="off" className={OPERATOR_FIELD_CLASS} id="resend-recipient" maxLength={254} onChange={(event) => { setRecipient(event.target.value); change(); }} placeholder="name@example.com" required type="email" value={recipient} /><span className="mt-2 block text-xs font-normal leading-relaxed text-black/55">For a direct message or service email to one person. Use a campaign for marketing audiences.</span></label> : <>
              <label className="block text-sm font-medium" htmlFor="resend-campaign-name">Campaign name<input className={OPERATOR_FIELD_CLASS} id="resend-campaign-name" maxLength={200} onChange={(event) => { setName(event.target.value); change(); }} required type="text" value={name} /><span className="mt-2 block text-xs font-normal text-black/55">Visible in your Resend workspace.</span></label>
              <label className="block text-sm font-medium" htmlFor="resend-segment">Resend segment<select className={OPERATOR_FIELD_CLASS} id="resend-segment" onChange={(event) => { setSegmentId(event.target.value); change(); }} required value={segmentId}><option value="">Choose a segment</option>{overview?.segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select></label>
              <label className="block text-sm font-medium" htmlFor="resend-topic">Subscription topic<select className={OPERATOR_FIELD_CLASS} id="resend-topic" onChange={(event) => { setTopicId(event.target.value); change(); }} required value={topicId}><option value="">Choose a topic</option>{overview?.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select><span className="mt-2 block text-xs font-normal leading-relaxed text-black/55">Resend applies this topic’s subscription preferences and unsubscribe settings.</span></label>
            </>}
          </fieldset>
          <section className="operator-bento-card" aria-labelledby="resend-ai-title"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-base font-semibold" id="resend-ai-title">Refine with ChatGPT</h4><span className="text-xs text-black/45">Copy, within your design</span></div><label className="mt-3 block text-sm" htmlFor="resend-prompt">What should this email say?<textarea className={`${OPERATOR_FIELD_CLASS} min-h-28 resize-y`} disabled={busy || !!(preview && previewCatalog) || (!preview && !overview?.configuration.aiReady)} id="resend-prompt" maxLength={6000} onChange={(event) => setPrompt(event.target.value)} placeholder="Write a short member update. Keep the tone direct. Include these details…" rows={4} value={prompt} /></label><p className="mt-2 text-xs leading-relaxed text-black/55">{preview && previewCatalog ? "ChatGPT is off in preview. Edit the template copy below to try the workspace." : !preview && !overview?.configuration.aiReady ? "ChatGPT is not connected. You can edit the template copy below." : "Only editable words and template values change. The original design stays intact."}</p><div className="mt-3 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={busy || !!(preview && previewCatalog) || !prompt.trim() || (!preview && !overview?.configuration.aiReady)} onClick={() => void generate()} type="button">{pending === "generate" ? "Refining…" : preview && previewCatalog ? "ChatGPT off in preview" : preview ? "Try sample revision" : "Refine copy"}</button>{undo ? <button className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40" disabled={busy} onClick={() => { changeEdits({ ...undo, banner: edits.banner ?? null }); setUndo(null); }} type="button">Undo last revision</button> : null}</div></section>
          <section className="operator-bento-card min-w-0 space-y-4" aria-labelledby="resend-banner-title">
            <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-base font-semibold" id="resend-banner-title">Image banner</h4>{edits.banner ? <button className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40" disabled={busy} id="resend-remove-banner" onClick={() => { setLocalBanner(null); changeEdits({ ...edits, banner: null }); }} type="button">Remove banner</button> : null}</div>
            <p className="text-xs leading-relaxed text-black/55">Add a photo below the existing logo and above the main heading. Upload from your device or use a public HTTPS image URL.</p>
            <OperatorEmailBannerUpload disabled={busy} key={template.id} local={localBanner} onBegin={() => begin("upload")} onFinish={finish} onHosted={(url) => { setLocalBanner(null); changeEdits({ ...edits, banner: { ...(edits.banner ?? { alt: "" }), url } }); }} onLocal={(photo) => { setLocalBanner(photo); changeEdits({ ...edits, banner: edits.banner ?? { url: "", alt: "" } }); }} onCancelLocal={() => { setLocalBanner(null); changeEdits({ ...edits }); }} preview={preview} />
            {edits.banner ? <>
              <label className="block text-sm font-medium" htmlFor="resend-banner-url">Image URL<input autoCapitalize="none" autoCorrect="off" className={OPERATOR_FIELD_CLASS} disabled={busy || !!localBanner} id="resend-banner-url" maxLength={2048} onChange={(event) => { setLocalBanner(null); changeEdits({ ...edits, banner: { ...edits.banner!, url: event.target.value } }); }} pattern="https://.*" placeholder="https://…/image.jpg" required={!localBanner} spellCheck={false} type="url" value={edits.banner.url} /></label>
              <label className="block text-sm font-medium" htmlFor="resend-banner-alt">Image description<input className={OPERATOR_FIELD_CLASS} disabled={busy} id="resend-banner-alt" maxLength={300} onChange={(event) => changeEdits({ ...edits, banner: { ...edits.banner!, alt: event.target.value } })} placeholder="Describe what the image shows" required type="text" value={edits.banner.alt} /><span className="mt-2 block text-xs font-normal leading-relaxed text-black/55">Shown when images are unavailable and read by screen readers.</span></label>
              <label className="block text-sm font-medium" htmlFor="resend-banner-link">Destination URL <span className="font-normal text-black/45">(optional)</span><input autoCapitalize="none" autoCorrect="off" className={OPERATOR_FIELD_CLASS} disabled={busy} id="resend-banner-link" maxLength={2048} onChange={(event) => changeEdits({ ...edits, banner: { ...edits.banner!, linkUrl: event.target.value } })} pattern="https://.*" placeholder="https://…" spellCheck={false} type="url" value={edits.banner.linkUrl ?? ""} /></label>
              {bannerHint ? <p aria-live="polite" className="text-xs leading-relaxed text-black/55" id="resend-banner-hint">{!edits.banner.alt.trim() && (localBanner || edits.banner.url.trim()) ? "Add an image description before reviewing or saving this email." : !edits.banner.url.trim() && !edits.banner.alt.trim() ? "Upload a photo or add its URL, then describe the image. You can keep editing the email." : bannerHint}</p> : null}
            </> : <button className={SECONDARY_BUTTON} disabled={busy} id="resend-add-banner" onClick={() => { changeEdits({ ...edits, banner: { url: "", alt: "" } }); requestAnimationFrame(() => document.getElementById("resend-banner-url")?.focus()); }} type="button">Use image URL</button>}
          </section>
          <fieldset disabled={busy} className="operator-bento-card min-w-0 space-y-5"><legend className="sr-only">Email copy</legend><h4 className="text-base font-semibold">Email copy</h4><label className="block text-sm font-medium" htmlFor="resend-subject">Subject<input className={OPERATOR_FIELD_CLASS} id="resend-subject" maxLength={200} onChange={(event) => changeEdits({ ...edits, subject: event.target.value })} required type="text" value={edits.subject} /></label>
            {template.variables.map((field, index) => <label className="block text-sm font-medium" htmlFor={`resend-variable-${index}`} key={field.key}>{field.key.replaceAll("_", " ")}<input className={OPERATOR_FIELD_CLASS} id={`resend-variable-${index}`} maxLength={6000} onChange={(event) => changeEdits({ ...edits, values: { ...edits.values, [field.key]: event.target.value } })} required={field.fallbackValue == null} step={field.type === "number" ? "any" : undefined} type={field.type === "number" ? "number" : "text"} value={edits.values[field.key] ?? ""} /></label>)}
            {template.fields.map((field, index) => <label className="block text-sm font-medium" htmlFor={`resend-copy-${index}`} key={field.key}>{field.label}<textarea className={`${OPERATOR_FIELD_CLASS} resize-y leading-relaxed`} id={`resend-copy-${index}`} maxLength={12000} onChange={(event) => changeEdits({ ...edits, copy: { ...edits.copy, [field.key]: event.target.value } })} rows={field.value.length > 160 ? 5 : field.value.length > 65 ? 3 : 2} value={edits.copy[field.key] ?? field.value} /></label>)}
            {!template.fields.length && !template.variables.length ? <p className="text-sm leading-relaxed text-black/55">This template has no editable text fields. You can change its subject here or edit its design in Resend.</p> : null}
          </fieldset>
          <div className="operator-bento-card"><div className="flex flex-wrap gap-3">{mode === "campaign" ? <button className={SECONDARY_BUTTON} disabled={busy || preview || !!savedBroadcast || !!previewError} onClick={() => void saveBroadcast()} type="button">{pending === "save" ? "Saving…" : preview ? "Saving off in preview" : savedBroadcast ? "Saved in Resend" : "Save new Resend draft"}</button> : null}<button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={busy || !!previewError || !rendered} id="resend-review-button" type="submit">{pending === "review" ? "Checking recipients…" : "Review & send"}</button></div><p className="mt-3 text-xs leading-relaxed text-black/55">{mode === "campaign" ? "Review prepares a Resend draft. You approve sending separately after checking the recipients." : "Review the exact design and recipient before sending."}</p></div>
        </form>
        <aside className="order-first min-w-0 xl:order-last xl:sticky xl:top-28"><DesignPreview email={rendered} error={previewError} updating={previewUpdating} /></aside>
      </div>
    </section> : null}

    {view === "broadcasts" && overview ? <section aria-labelledby="resend-campaigns-title">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold" id="resend-campaigns-title">Campaigns in Resend</h3><p className="mt-1 text-sm text-black/55">Your existing broadcast drafts and sending history.</p></div><a className="min-h-11 py-3 text-sm underline underline-offset-4" href="https://resend.com/broadcasts" rel="noreferrer" target="_blank">Open campaigns in Resend ↗</a></header>
      {broadcast ? <div className="mb-6 grid items-start gap-5 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]"><div className="operator-bento-card min-w-0"><span className="mb-3 inline-block rounded-[3px] bg-black/5 px-2 py-1 text-xs capitalize">{statusLabel(broadcast.status)}</span><h4 className="break-words text-lg font-semibold">{broadcast.name || broadcast.subject}</h4><p className="mt-3 text-sm text-black/60">{overview.segments.find((segment) => segment.id === broadcast.segmentId)?.name ?? "Resend audience"}</p><p className="mt-4 text-xs leading-relaxed text-black/55">The content is loaded from Resend. Edit this existing campaign in Resend. Some drafts created in the Resend dashboard must also be sent there.</p>{broadcast.status === "draft" ? <button className={`${OPERATOR_PRIMARY_ACTION_CLASS} mt-5`} disabled={busy} id="resend-broadcast-review" onClick={() => void reviewEmail()} type="button">{pending === "review" ? "Checking campaign…" : "Review campaign"}</button> : null}<a className="mt-3 block min-h-11 py-3 text-sm underline underline-offset-4" href="https://resend.com/broadcasts" rel="noreferrer" target="_blank">Open in Resend ↗</a></div><DesignPreview compact email={{ html: broadcast.html, subject: broadcast.subject ?? "", from: broadcast.from }} /></div> : null}
      <label className="mb-4 block max-w-md text-sm" htmlFor="resend-campaign-search">Find a campaign<input className={OPERATOR_FIELD_CLASS} id="resend-campaign-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search campaign name or status" type="search" value={query} /></label>
      {broadcasts.length ? <ul className="space-y-3">{broadcasts.map((item) => <li className="operator-bento-card flex flex-wrap items-start justify-between gap-4" key={item.id}><div className="min-w-0 flex-1 basis-48"><h4 className="break-words text-sm font-semibold">{item.name || item.subject || "Untitled campaign"}</h4>{item.subject && item.subject !== item.name ? <p className="mt-1 break-words text-xs text-black/55">{item.subject}</p> : null}<p className="mt-2 text-xs text-black/45">{dateLabel(item.createdAt)}</p></div><div className="flex items-center gap-3"><span className="rounded-[3px] bg-black/5 px-2 py-1 text-xs capitalize">{statusLabel(item.status)}</span><button className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40" disabled={busy || broadcast?.id === item.id} onClick={() => void openBroadcast(item.id)} type="button">{broadcast?.id === item.id ? "Open" : "View"}<span className="sr-only">: {item.name}</span></button></div></li>)}</ul> : <p className="rounded-[4px] border border-dashed border-black/20 p-6 text-sm text-black/55">{preview ? "Live Resend campaign history is unavailable in preview." : query ? "No campaigns match this search." : "No campaigns were returned by Resend."}</p>}
      {overview.cursors.broadcasts ? <button className={`${SECONDARY_BUTTON} mt-4`} disabled={busy} onClick={() => void loadMore("broadcasts")} type="button">{pending === "more" ? "Loading…" : "Load more campaigns"}</button> : null}
    </section> : null}

    {view === "emails" && overview ? <section aria-labelledby="resend-history-title"><header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold" id="resend-history-title">Sent through Resend</h3><p className="mt-1 text-sm text-black/55">Delivery activity from your connected Resend account.</p></div><a className="min-h-11 py-3 text-sm underline underline-offset-4" href="https://resend.com/emails" rel="noreferrer" target="_blank">Open email activity in Resend ↗</a></header><label className="mb-4 block max-w-md text-sm" htmlFor="resend-email-search">Find an email<input className={OPERATOR_FIELD_CLASS} id="resend-email-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or recipient" type="search" value={query} /></label>
      {emails.length ? <ul className="space-y-3">{emails.map((email) => <li className="operator-bento-card flex flex-wrap items-start justify-between gap-4" key={email.id}><div className="min-w-0 flex-1 basis-48"><h4 className="break-words text-sm font-semibold">{email.subject || "No subject"}</h4><p className="mt-1 break-all text-xs leading-relaxed text-black/55">{email.to.join(", ")}</p><p className="mt-2 text-xs text-black/45">{dateLabel(email.createdAt)}</p></div><span className="rounded-[3px] bg-black/5 px-2.5 py-1.5 text-xs capitalize">{statusLabel(email.lastEvent || "sent")}</span></li>)}</ul> : <p className="rounded-[4px] border border-dashed border-black/20 p-6 text-sm text-black/55">{preview ? "Live email delivery history is unavailable in preview." : query ? "No emails match this search." : "No sent emails were returned by Resend."}</p>}{overview.cursors.emails ? <button className={`${SECONDARY_BUTTON} mt-4`} disabled={busy} onClick={() => void loadMore("emails")} type="button">{pending === "more" ? "Loading…" : "Load more emails"}</button> : null}
    </section> : null}

    {review ? <OperatorDialog open title="Review email" pending={pending === "send"} onClose={() => { setReview(null); setAcknowledged(false); }} returnFocusId={broadcast ? "resend-broadcast-review" : "resend-review-button"}>
      <p className="mb-5 text-sm leading-relaxed text-black/60">{preview ? "Preview review. Audience recipients below are examples; sending is disabled." : "Review the exact design and everyone who will receive it. Sending cannot be undone."}</p>
      <div className="grid min-w-0 items-start gap-5 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]"><section className="min-w-0" aria-label="Reviewed recipients"><h3 className="text-base font-semibold">{review.recipientCount.toLocaleString()} {review.recipientCount === 1 ? "recipient" : "recipients"}</h3>{review.segmentName ? <p className="mt-1 text-sm text-black/55">{review.segmentName}</p> : null}{review.recipients.length ? <ul className="mt-4 max-h-80 divide-y divide-black/10 overflow-y-auto rounded-[4px] border border-black/15 px-3">{review.recipients.map((person) => <li className="py-3" key={person.email}>{person.name ? <p className="break-words text-xs text-black/55">{person.name}</p> : null}<p className="break-all text-sm">{person.email}</p></li>)}</ul> : <p className="mt-4 text-sm text-black/60">No eligible recipients were found.</p>}{review.excludedCount > 0 ? <p className="mt-3 text-xs text-black/55">{review.excludedCount.toLocaleString()} {review.excludedCount === 1 ? "address" : "addresses"} excluded.</p> : null}<p className="mt-3 text-xs leading-relaxed text-black/55">{review.mode === "campaign" ? "Resend applies subscription preferences again when sending." : "This email goes to the recipient shown here."}</p></section><DesignPreview compact email={review} /></div>
      <div className="mt-5 border-t border-black/15 pt-4"><label className="flex items-start gap-3 text-sm leading-relaxed"><input checked={acknowledged} className="mt-1 h-4 w-4 shrink-0 accent-black" disabled={busy || !review.recipientCount} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" /><span>I reviewed the design, copy, and {review.recipientCount === 1 ? "recipient" : `all ${review.recipientCount.toLocaleString()} recipients`}.</span></label>{!preview && !overview?.configuration.sendingReady ? <p className="mt-3 text-sm text-black/60">Sending is unavailable until the Resend connection is ready.</p> : null}<div className="mt-4 flex flex-wrap gap-3"><button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={busy || preview || !acknowledged || !review.recipientCount || !overview?.configuration.sendingReady} onClick={() => void send()} type="button">{pending === "send" ? "Sending through Resend…" : preview ? "Sending off in preview" : `Send to ${review.recipientCount.toLocaleString()} ${review.recipientCount === 1 ? "recipient" : "recipients"}`}</button><button className={SECONDARY_BUTTON} disabled={busy} onClick={() => { setReview(null); setAcknowledged(false); }} type="button">Back to email</button></div></div>
    </OperatorDialog> : null}
    {confirm ? <OperatorDialog open title="Unsaved email" onClose={() => setConfirm(null)}><p className="mb-5 text-sm leading-relaxed">{confirm.description}</p><div className="flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} onClick={() => setConfirm(null)} type="button">Keep editing</button><button className={SECONDARY_BUTTON} onClick={() => { const action = confirm.action; setConfirm(null); setDirty(false); action(); }} type="button">Discard changes</button></div></OperatorDialog> : null}
  </OperatorPageFrame>;
}
