"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import OperatorDialog from "@/components/platform/OperatorDialog";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
import { ADMIN_EMAIL_MAX_RECIPIENTS, isAdminEmailAddress, type AdminEmailContent, type AdminEmailDraft, type AdminEmailPreview } from "@/lib/communications/admin-email-model";

type EmailConfiguration = {
  aiReady: boolean;
  deliveryReady: boolean;
  marketingReady: boolean;
  missing: string[];
};

type PendingAction = "generate" | "save" | "review" | "send" | "refresh" | null;
const SECONDARY_BUTTON = "inline-flex min-h-11 items-center justify-center rounded-[4px] border border-black/25 px-4 py-2 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40";
const EMPTY_CONTENT: AdminEmailContent = { subject: "", preheader: "", body: "", purpose: "marketing", audience: "individual", recipients: [] };

function addresses(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

function contentOf(draft: AdminEmailDraft): AdminEmailContent {
  return { subject: draft.subject, preheader: draft.preheader, body: draft.body, purpose: draft.purpose, audience: draft.audience, recipients: draft.recipients };
}

function audienceLabel(draft: AdminEmailContent): string {
  if (draft.audience === "updates") return "Ruined updates";
  if (draft.audience === "members") return draft.purpose === "marketing" ? "Subscribed members" : "Registered members";
  return draft.recipients.length === 1 ? "Individual email" : "Individual recipients";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function deliveryLabel(draft: AdminEmailDraft): string {
  if (draft.status === "draft") return "Draft";
  const counts = draft.deliveryCounts;
  if (counts.manual_review > 0) return "Needs review";
  if (counts.pending + counts.sending > 0) return "Sending";
  if (counts.failed > 0) return "Some sends failed";
  if (counts.sent === 0 && counts.skipped > 0) return "Not sent";
  return "Sent";
}

async function emailRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error || "The email service could not be reached. Please try again.");
  return result;
}

function EmailPreview({ content }: { content: Pick<AdminEmailContent, "subject" | "preheader" | "body" | "purpose"> }) {
  return <div className="min-w-0 overflow-hidden rounded-[5px] border border-black/15 bg-[var(--color-shop)]">
    <div className="border-b border-black/10 px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/45">Subject</p>
      <p className="mt-1 break-words text-sm font-semibold">{content.subject || "Your subject goes here"}</p>
      <p className="mt-1 break-words text-xs leading-relaxed text-black/50">{content.preheader || "Preview text appears beside the subject in an inbox."}</p>
    </div>
    <div className="px-5 py-6 sm:px-6">
      <p className="whitespace-pre-wrap break-words text-sm leading-[1.8] text-black/80">{content.body || "Write a draft to see your message here."}</p>
      {content.purpose === "marketing" ? <p className="mt-8 border-t border-black/10 pt-4 text-xs leading-relaxed text-black/50">An unsubscribe link and Ruined’s mailing address are added when this email is sent.</p> : null}
    </div>
  </div>;
}

export default function OperatorEmailComposer({
  drafts: initialDrafts,
  configuration: initialConfiguration,
  preview = false,
}: {
  drafts: AdminEmailDraft[];
  configuration: EmailConfiguration;
  preview?: boolean;
}) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [content, setContent] = useState<AdminEmailContent>({ ...EMPTY_CONTENT });
  const [recipientInput, setRecipientInput] = useState("");
  const [selected, setSelected] = useState<AdminEmailDraft | null>(null);
  const [prompt, setPrompt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const pendingRef = useRef(false);
  const [review, setReview] = useState<AdminEmailPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [switchTarget, setSwitchTarget] = useState<{ draft: AdminEmailDraft | null } | null>(null);
  const [historyFilter, setHistoryFilter] = useState<"all" | "draft" | "queued">("all");
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const readOnly = selected?.status === "queued";
  const busy = pending !== null;
  const deliveryReady = configuration.deliveryReady && (content.purpose !== "marketing" || configuration.marketingReady);
  const hasInFlightDelivery = drafts.some((draft) => draft.status === "queued" && draft.deliveryCounts.pending + draft.deliveryCounts.sending > 0);

  useEffect(() => {
    if (!dirty) return;
    function preventLoss(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [error]);

  const refreshHistory = useCallback(async (quiet = false) => {
    if (preview || pendingRef.current) return;
    pendingRef.current = true;
    if (!quiet) { setPending("refresh"); setError(""); setNotice(""); }
    try {
      const result = await emailRequest<{ drafts: AdminEmailDraft[]; configuration: EmailConfiguration }>("/api/ops/emails");
      setDrafts(result.drafts);
      setConfiguration(result.configuration);
      setSelected((current) => current?.status === "queued" ? result.drafts.find((item) => item.id === current.id) ?? current : current);
      if (!quiet) setNotice("Email history updated.");
    } catch (failure) {
      if (!quiet) setError(failure instanceof Error ? failure.message : "Email history could not be refreshed.");
    } finally {
      pendingRef.current = false;
      if (!quiet) setPending(null);
    }
  }, [preview]);

  useEffect(() => {
    if (preview || !hasInFlightDelivery) return;
    const interval = window.setInterval(() => { void refreshHistory(true); }, 15_000);
    return () => window.clearInterval(interval);
  }, [hasInFlightDelivery, preview, refreshHistory]);

  function edit(patch: Partial<AdminEmailContent>) {
    setContent((current) => ({ ...current, ...patch }));
    setDirty(true);
    setReview(null);
    setAcknowledged(false);
    setError("");
    setNotice("");
  }

  function remember(draft: AdminEmailDraft) {
    setDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
    setSelected(draft);
    setContent(contentOf(draft));
    setRecipientInput(draft.recipients.join("\n"));
    setDirty(false);
  }

  function openDraft(draft: AdminEmailDraft | null) {
    if (pendingRef.current) return;
    setSelected(draft);
    setContent(draft ? contentOf(draft) : { ...EMPTY_CONTENT });
    setRecipientInput(draft?.recipients.join("\n") ?? "");
    setPrompt("");
    setDirty(false);
    setReview(null);
    setAcknowledged(false);
    setError("");
    setNotice("");
    setSwitchTarget(null);
    requestAnimationFrame(() => {
      document.getElementById("email-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
      subjectRef.current?.focus({ preventScroll: true });
    });
  }

  function requestOpen(draft: AdminEmailDraft | null) {
    if (pendingRef.current) return;
    if (dirty) setSwitchTarget({ draft });
    else openDraft(draft);
  }

  function begin(action: Exclude<PendingAction, null>): boolean {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(action);
    setError("");
    setNotice("");
    return true;
  }

  function finish() { pendingRef.current = false; setPending(null); }

  async function generate() {
    if (!prompt.trim() || readOnly || !begin("generate")) return;
    try {
      if (preview) {
        const sample = content.body.trim() ? {
          subject: content.subject || "A note from Ruined",
          preheader: content.preheader || "A little space for what matters.",
          body: `${content.body}\n\n[Preview revision. In the live composer, ChatGPT applies your instructions here.]`,
        } : {
          subject: "Make room for what matters",
          preheader: "A note from Ruined.",
          body: "There is value in making room. For the work. For the people around it. For what comes next.\n\nWe’ll share the details soon.\n\nRuined",
        };
        edit(sample);
        setNotice("Sample draft added. ChatGPT is not called in preview.");
      } else {
        const result = await emailRequest<{ draft: Pick<AdminEmailContent, "subject" | "preheader" | "body"> }>("/api/ops/emails/generate", {
          prompt: prompt.trim(),
          ...(content.subject.trim() || content.body.trim() ? { currentDraft: { subject: content.subject, preheader: content.preheader, body: content.body } } : {}),
        });
        edit(result.draft);
        setNotice("Draft ready. Check names, dates, links, and claims before saving.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "ChatGPT could not create the draft.");
    } finally { finish(); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !begin("save")) return;
    try {
      const next: AdminEmailContent = {
        ...content,
        subject: content.subject.trim(),
        preheader: content.preheader.trim(),
        body: content.body.trim(),
        recipients: content.audience === "individual" ? addresses(recipientInput) : [],
      };
      if (!next.subject || !next.body) throw new Error("Add a subject and message before saving.");
      if (next.audience === "individual" && !next.recipients.length) throw new Error("Add at least one recipient email address.");
      if (next.recipients.some((email) => !isAdminEmailAddress(email))) throw new Error("Check the recipient addresses. Enter one email per line, or separate them with commas.");
      if (next.recipients.length > ADMIN_EMAIL_MAX_RECIPIENTS) throw new Error(`Add up to ${ADMIN_EMAIL_MAX_RECIPIENTS} recipients per email.`);
      if (preview) {
        const now = new Date().toISOString();
        remember({ ...next, id: selected?.id ?? `preview-${crypto.randomUUID()}`, version: (selected?.version ?? 0) + 1, status: "draft", createdAt: selected?.createdAt ?? now, updatedAt: now, queuedAt: null, recipientCount: 0, deliveryCounts: { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0, manual_review: 0 } });
        setNotice("Preview draft saved for this visit only.");
      } else {
        const result = await emailRequest<{ draft: AdminEmailDraft }>("/api/ops/emails", { ...next, ...(selected ? { draftId: selected.id, expectedVersion: selected.version } : {}) });
        remember(result.draft);
        setNotice("Draft saved. Review the recipients before sending.");
      }
      setReview(null);
      setAcknowledged(false);
      requestAnimationFrame(() => reviewButtonRef.current?.focus());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The draft could not be saved.");
    } finally { finish(); }
  }

  async function reviewRecipients() {
    if (!selected || dirty || readOnly || !begin("review")) return;
    try {
      if (preview) {
        const recipients = selected.audience === "individual"
          ? selected.recipients.map((email) => ({ email, name: "Preview recipient" }))
          : [{ email: "alex@example.test", name: "Alex — sample recipient" }, { email: "jordan@example.test", name: "Jordan — sample recipient" }];
        setReview({ draftId: selected.id, version: selected.version, recipientHash: "preview-only", recipientCount: recipients.length, recipients, excludedCount: 0 });
      } else {
        const result = await emailRequest<{ review: AdminEmailPreview }>(`/api/ops/emails/${encodeURIComponent(selected.id)}/review`, { expectedVersion: selected.version });
        setReview(result.review);
      }
      setAcknowledged(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The recipients could not be checked.");
    } finally { finish(); }
  }

  async function send() {
    if (preview || !review || !selected || dirty || !acknowledged || !deliveryReady || review.recipientCount === 0 || !begin("send")) return;
    try {
      const result = await emailRequest<{ draft: AdminEmailDraft }>(`/api/ops/emails/${encodeURIComponent(selected.id)}/send`, {
        expectedVersion: review.version,
        recipientHash: review.recipientHash,
        recipientCount: review.recipientCount,
      });
      remember(result.draft);
      setReview(null);
      setAcknowledged(false);
      setNotice(`Queued for ${result.draft.recipientCount.toLocaleString()} ${result.draft.recipientCount === 1 ? "recipient" : "recipients"}. Delivery progress appears in email history.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sending could not be confirmed. Refresh email history before trying again.");
      setReview(null);
      setAcknowledged(false);
    } finally { finish(); }
  }

  const visibleHistory = drafts.filter((draft) => historyFilter === "all" || draft.status === historyFilter);

  return <OperatorPageFrame title="Messages">
    <OperatorMessagesTabs active="emails" />
    <header className="operator-record-header mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="operator-page-heading">Emails</h2><p className="mt-2 max-w-lg text-sm leading-relaxed text-black/60">Write with ChatGPT, make it yours, then send to one person or an audience.</p></div>
      <button className={SECONDARY_BUTTON} disabled={busy} onClick={() => requestOpen(null)} type="button">New email</button>
    </header>

    {preview ? <p className="mb-5 rounded-[4px] bg-black/5 px-4 py-3 text-sm leading-relaxed text-black/65" role="status">Preview workspace. Drafts stay in this visit. ChatGPT and email sending are off.</p> : null}
    {!preview && (!configuration.aiReady || !configuration.deliveryReady || !configuration.marketingReady) ? <div className="mb-5 rounded-[4px] border border-black/15 px-4 py-3 text-sm leading-relaxed">
      <p className="font-semibold">Email setup is incomplete.</p>
      <p className="mt-1 text-black/60">{!configuration.aiReady ? "ChatGPT drafting is unavailable. You can write and save manually. " : ""}{!configuration.deliveryReady ? "Sending is unavailable until the email service is configured. " : !configuration.marketingReady ? "Marketing emails need a mailing address and unsubscribe configuration before sending." : ""}</p>
    </div> : null}

    <div className="mb-4 empty:hidden" aria-live="polite" aria-atomic="true">{notice ? <p className="rounded-[4px] bg-black/5 px-4 py-3 text-sm leading-relaxed">{notice}</p> : null}</div>
    {error ? <p className="mb-4 scroll-mt-28 rounded-[4px] border border-[var(--color-poster)]/35 bg-[var(--color-poster)]/5 px-4 py-3 text-sm leading-relaxed" ref={errorRef} role="alert">{error}</p> : null}

    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.8fr)]" id="email-workspace">
      <section aria-label="Email composer" className="min-w-0 scroll-mt-28">
        {readOnly ? <div className="operator-bento-card mb-4">
          <p className="text-sm font-semibold">{deliveryLabel(selected)}</p>
          <p className="mt-1 text-sm leading-relaxed text-black/60">This email has been queued and can no longer be edited. Start a new email for another message.</p>
        </div> : <section className="operator-bento-card mb-4" aria-labelledby="email-ai-title">
          <div className="flex items-baseline justify-between gap-3"><h3 id="email-ai-title" className="text-base font-semibold">Write with ChatGPT</h3><span className="text-xs text-black/45">{content.body ? "Refine your draft" : "Start with a direction"}</span></div>
          <label className="mt-3 block text-sm" htmlFor="email-prompt">{content.body ? "What should change?" : "What do you want to say?"}</label>
          <textarea className={`${OPERATOR_FIELD_CLASS} min-h-28 resize-y`} disabled={busy || (!preview && !configuration.aiReady)} id="email-prompt" maxLength={6000} onChange={(event) => setPrompt(event.target.value)} placeholder={content.body ? "Make it shorter. Keep the opening and the date. End with a direct invitation." : "Who is this for, what should they know, and what should they do next? Include the facts, dates, and links to use."} rows={4} value={prompt} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xs text-xs leading-relaxed text-black/55">{content.body ? "Your current draft is included. Review the result before saving." : "ChatGPT drafts the words. You choose the recipients and approve the send."}</p>
            <button className={OPERATOR_BUTTON_CLASS} disabled={busy || !prompt.trim() || (!preview && !configuration.aiReady)} onClick={() => void generate()} type="button">{pending === "generate" ? "Writing…" : preview ? content.body ? "Try sample revision" : "Try sample draft" : content.body ? "Revise draft" : "Create draft"}</button>
          </div>
        </section>}

        <form onSubmit={(event) => void save(event)} className="operator-bento-card" aria-label="Edit email draft" data-operator-dirty={dirty} data-operator-pending={busy}>
          <div className="mb-5 flex items-baseline justify-between gap-3"><h3 className="text-base font-semibold">{readOnly ? "Email details" : "Your draft"}</h3><span className="text-xs text-black/45">{readOnly ? deliveryLabel(selected) : dirty ? "Unsaved changes" : selected ? "Saved" : "Not saved"}</span></div>
          <fieldset disabled={busy || readOnly} className="min-w-0 space-y-5">
            <legend className="sr-only">Email audience and content</legend>
            <div>
              <p className="text-sm font-medium" id="email-target-label">Send to</p>
              <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-labelledby="email-target-label">
                <button aria-pressed={content.audience === "individual"} className={`${SECONDARY_BUTTON} ${content.audience === "individual" ? "border-black bg-black/[0.07]" : ""}`} onClick={() => edit({ audience: "individual" })} type="button">Individual emails</button>
                <button aria-pressed={content.audience !== "individual"} className={`${SECONDARY_BUTTON} ${content.audience !== "individual" ? "border-black bg-black/[0.07]" : ""}`} onClick={() => edit({ audience: "updates", purpose: "marketing" })} type="button">Audience campaign</button>
              </div>
            </div>
            {content.audience === "individual" ? <label className="block text-sm font-medium" htmlFor="email-recipients">Recipient emails
              <textarea autoCapitalize="none" autoCorrect="off" className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} id="email-recipients" maxLength={20000} onChange={(event) => { setRecipientInput(event.target.value); edit({}); }} placeholder="name@example.com" required rows={3} spellCheck={false} value={recipientInput} aria-describedby="email-recipient-help" />
              <span className="mt-2 block text-xs font-normal leading-relaxed text-black/55" id="email-recipient-help">Up to {ADMIN_EMAIL_MAX_RECIPIENTS} addresses, one per line or separated by commas. Each recipient receives their own email.</span>
            </label> : <label className="block text-sm font-medium" htmlFor="email-audience">Audience
              <select className={OPERATOR_FIELD_CLASS} id="email-audience" onChange={(event) => edit({ audience: event.target.value as "updates" | "members", ...(event.target.value === "updates" ? { purpose: "marketing" as const } : {}) })} value={content.audience}>
                <option value="updates">Ruined updates — confirmed subscribers</option><option value="members">Registered members</option>
              </select>
            </label>}
            <div>
              <label className="block text-sm font-medium" htmlFor="email-purpose">Email purpose
                <select className={OPERATOR_FIELD_CLASS} disabled={content.audience === "updates" || busy || readOnly} id="email-purpose" onChange={(event) => edit({ purpose: event.target.value as AdminEmailContent["purpose"] })} value={content.purpose}>
                  <option value="marketing">Marketing / brand update</option><option value="service">Service / member support</option>
                </select>
              </label>
              <p className="mt-2 text-xs leading-relaxed text-black/55">{content.purpose === "marketing" ? "Only confirmed subscribers are eligible. Unsubscribed addresses are excluded and an unsubscribe link is included." : "For registered members’ requested support and essential membership information. Promotions and brand campaigns belong under Marketing."}</p>
            </div>
            <label className="block text-sm font-medium" htmlFor="email-subject">Subject
              <input className={OPERATOR_FIELD_CLASS} id="email-subject" maxLength={200} onChange={(event) => edit({ subject: event.target.value })} placeholder="A clear reason to open" ref={subjectRef} required type="text" value={content.subject} />
            </label>
            <label className="block text-sm font-medium" htmlFor="email-preheader">Inbox preview <span className="font-normal text-black/45">(optional)</span>
              <input className={OPERATOR_FIELD_CLASS} id="email-preheader" maxLength={200} onChange={(event) => edit({ preheader: event.target.value })} placeholder="The line beside the subject" type="text" value={content.preheader} />
            </label>
            <label className="block text-sm font-medium" htmlFor="email-body">Message
              <textarea className={`${OPERATOR_FIELD_CLASS} min-h-72 resize-y leading-relaxed`} id="email-body" maxLength={12000} onChange={(event) => edit({ body: event.target.value })} placeholder="Write directly, or use ChatGPT to make a first draft." required rows={12} value={content.body} />
            </label>
          </fieldset>
          {!readOnly ? <div className="mt-5 border-t border-black/10 pt-5">
            <div className="flex flex-wrap gap-3">
              <button className={SECONDARY_BUTTON} disabled={busy || (!dirty && !!selected)} type="submit">{pending === "save" ? "Saving…" : "Save draft"}</button>
              <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={busy || dirty || !selected} id="review-email-recipients" onClick={() => void reviewRecipients()} ref={reviewButtonRef} type="button">{pending === "review" ? "Checking recipients…" : "Review recipients"}</button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-black/55">{dirty || !selected ? "Save the draft to review its exact recipients." : "Review the message and recipient list before sending."}</p>
          </div> : null}
        </form>
      </section>
      <aside className="min-w-0 xl:sticky xl:top-28" aria-label="Email content preview">
        <div className="mb-3 flex items-baseline justify-between gap-3"><h3 className="text-sm font-semibold">Message preview</h3><span className="text-xs text-black/45">Content only</span></div>
        <EmailPreview content={content} />
        <p className="mt-3 text-xs leading-relaxed text-black/50">Formatting can vary between inboxes. Check every link and detail before sending.</p>
      </aside>
    </div>

    <section className="mt-9 border-t border-black/15 pt-6" aria-labelledby="email-history-title">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold" id="email-history-title">{preview ? "Preview drafts" : "Email history"}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="email-history-filter">Filter email history</label>
          <select className="min-h-11 rounded-[4px] border border-black/20 bg-transparent px-3 text-sm" id="email-history-filter" onChange={(event) => setHistoryFilter(event.target.value as typeof historyFilter)} value={historyFilter}><option value="all">All emails</option><option value="draft">Drafts</option><option value="queued">Sent / queued</option></select>
          {!preview ? <button className={SECONDARY_BUTTON} disabled={busy} onClick={() => void refreshHistory()} type="button">{pending === "refresh" ? "Refreshing…" : "Refresh status"}</button> : null}
        </div>
      </header>
      {visibleHistory.length ? <ul className="space-y-3">{visibleHistory.map((draft) => <li key={draft.id} className={`operator-bento-card flex flex-wrap items-start justify-between gap-4 ${selected?.id === draft.id ? "ring-1 ring-black/25" : ""}`}>
        <div className="min-w-0 flex-1 basis-56">
          <p className="break-words text-sm font-semibold">{draft.subject}</p>
          <p className="mt-1 text-xs leading-relaxed text-black/55">{audienceLabel(draft)} · {formatDate(draft.updatedAt)}</p>
          {draft.status === "queued" ? <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-relaxed text-black/60">
            <span>{draft.deliveryCounts.sent} sent</span>
            {draft.deliveryCounts.pending + draft.deliveryCounts.sending > 0 ? <span>{draft.deliveryCounts.pending + draft.deliveryCounts.sending} pending</span> : null}
            {draft.deliveryCounts.failed > 0 ? <span>{draft.deliveryCounts.failed} failed</span> : null}
            {draft.deliveryCounts.skipped > 0 ? <span>{draft.deliveryCounts.skipped} excluded</span> : null}
            {draft.deliveryCounts.manual_review > 0 ? <span>{draft.deliveryCounts.manual_review} need delivery review</span> : null}
          </div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-4"><span className="rounded-[3px] bg-black/5 px-2.5 py-1.5 text-xs">{deliveryLabel(draft)}</span><button className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40" disabled={busy || (selected?.id === draft.id && selected.version === draft.version && selected.status === draft.status)} onClick={() => requestOpen(draft)} type="button">{selected?.id === draft.id ? selected.version !== draft.version || selected.status !== draft.status ? "Load latest" : "Open" : draft.status === "draft" ? "Edit draft" : "View email"}<span className="sr-only">: {draft.subject}</span></button></div>
      </li>)}</ul> : <p className="rounded-[5px] border border-dashed border-black/20 px-5 py-8 text-sm text-black/55">{drafts.length ? "No emails in this view." : "Saved drafts and sending progress will appear here."}</p>}
      {!preview && drafts.some((draft) => draft.deliveryCounts.manual_review > 0) ? <p className="mt-3 text-xs leading-relaxed text-black/60">A delivery needs review when the email provider’s response could not be confirmed. Check the provider before sending that message again.</p> : null}
    </section>

    {review && selected ? <OperatorDialog open title="Review email" pending={pending === "send"} onClose={() => { setReview(null); setAcknowledged(false); }} returnFocusId="review-email-recipients">
      <p className="mb-5 text-sm leading-relaxed text-black/60">{preview ? "This is a preview. No email can be sent." : "Confirm the message and everyone who will receive it. Sending cannot be undone."}</p>
      <div className="grid min-w-0 items-start gap-5 md:grid-cols-2">
        <section className="min-w-0" aria-label="Reviewed recipient list">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold">{review.recipientCount.toLocaleString()} {review.recipientCount === 1 ? "recipient" : "recipients"}</h3><span className="text-xs text-black/55">{audienceLabel(selected)}</span></div>
          {review.recipientCount > 0 ? <ul className="max-h-72 divide-y divide-black/10 overflow-y-auto rounded-[4px] border border-black/15 px-4">{review.recipients.map((recipient) => <li className="py-3" key={recipient.email}>{recipient.name ? <p className="break-words text-xs text-black/55">{recipient.name}</p> : null}<p className="break-all text-sm">{recipient.email}</p></li>)}</ul> : <p className="rounded-[4px] border border-black/15 p-4 text-sm leading-relaxed">No eligible recipients. Update the audience or check their subscription status.</p>}
          {review.excludedCount > 0 ? <p className="mt-3 text-xs leading-relaxed text-black/60">{review.excludedCount.toLocaleString()} {review.excludedCount === 1 ? "address was" : "addresses were"} excluded from this audience.</p> : null}
          <p className="mt-3 text-xs leading-relaxed text-black/55">Each recipient receives a separate email. Eligibility is checked again before delivery.</p>
        </section>
        <section className="min-w-0" aria-label="Final email content"><h3 className="mb-3 text-base font-semibold">Final message</h3><EmailPreview content={contentOf(selected)} /></section>
      </div>
      <div className="mt-6 border-t border-black/15 pt-5">
        <label className="flex items-start gap-3 text-sm leading-relaxed"><input checked={acknowledged} className="mt-1 h-4 w-4 shrink-0 accent-black" disabled={busy || review.recipientCount === 0} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" /><span>I reviewed the message and all {review.recipientCount.toLocaleString()} {review.recipientCount === 1 ? "recipient" : "recipients"}.</span></label>
        {!deliveryReady && !preview ? <p className="mt-3 text-sm text-black/60">Sending is unavailable until {content.purpose === "marketing" && configuration.deliveryReady ? "marketing email setup is complete" : "the email service is configured"}.</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={busy || preview || !acknowledged || !deliveryReady || review.recipientCount === 0} onClick={() => void send()} type="button">{pending === "send" ? "Queuing email…" : preview ? "Sending off in preview" : `Send to ${review.recipientCount.toLocaleString()} ${review.recipientCount === 1 ? "recipient" : "recipients"}`}</button>
          <button className={SECONDARY_BUTTON} disabled={busy} onClick={() => { setReview(null); setAcknowledged(false); }} type="button">Back to draft</button>
        </div>
      </div>
    </OperatorDialog> : null}

    {switchTarget ? <OperatorDialog open title="Unsaved email" onClose={() => setSwitchTarget(null)}>
      <p className="mb-5 text-sm leading-relaxed">This draft has unsaved changes. Keep editing to save them, or discard the changes to {switchTarget.draft ? "open the other email" : "start a new email"}.</p>
      <div className="flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} onClick={() => setSwitchTarget(null)} type="button">Keep editing</button><button className={SECONDARY_BUTTON} onClick={() => openDraft(switchTarget.draft)} type="button">Discard changes</button></div>
    </OperatorDialog> : null}
  </OperatorPageFrame>;
}
