"use client";

import { useEffect, useRef, useState } from "react";
import { CADE_MANUAL_TEMPLATES, findManualCommunicationTemplate, manualCommunicationDraftIssue } from "@/lib/communications/cade-communications";
import type { ResendEmailEdits, ResendEmailTemplate } from "@/lib/communications/resend-email-model";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "./operatorStyles";

export default function OperatorManualCommunicationTemplate({ template, edits, onApply, disabled = false, preview = false, onDirtyChange, onPendingChange }: {
  template: ResendEmailTemplate | null; edits: ResendEmailEdits;
  onApply: (edits: ResendEmailEdits) => void; disabled?: boolean; preview?: boolean; onDirtyChange?: (dirty:boolean) => void; onPendingChange?: (pending:boolean) => void;
}) {
  const [base, setBase] = useState({subject:"",body:""});
  const [imported, setImported] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [templatePending, setTemplatePending] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const selection = useRef(0);
  const saving = useRef(false);
  const [id, setId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [destination, setDestination] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = !imported && (subject !== base.subject || body !== base.body);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange?.(templatePending); return () => onPendingChange?.(false); }, [templatePending, onPendingChange]);
  const selected = findManualCommunicationTemplate(id);
  const options = template ? [
    ...template.variables.filter(item => item.type === "string").map(item => ({ key: `variable:${item.key}`, label: `Variable · ${item.key}` })),
    ...template.fields.map(item => ({ key: `copy:${item.key}`, label: item.label })),
  ] : [];
  function select(nextId: string) {
    const next = findManualCommunicationTemplate(nextId);
    setId(next?.id ?? ""); setSubject(next?.subject ?? ""); setBody(next?.body ?? ""); setBase({subject:next?.subject ?? "",body:next?.body ?? ""}); setImported(false);
    setConfirmed(false); setMessage(""); setRevision(null); setTemplateError("");
  }
  useEffect(() => { select(new URLSearchParams(window.location.search).get("manualTemplate") ?? ""); }, []);
  useEffect(() => {
    if (!id || preview) return;
    const controller = new AbortController(), current = ++selection.current;
    setTemplatePending(true); setTemplateError("");
    void fetch(`/api/ops/messages/templates?key=${encodeURIComponent(`manual:${id}`)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Saved template copy is unavailable.");
      if (current === selection.current && !controller.signal.aborted) { setSubject(value.subject); setBody(value.body); setBase({subject:value.subject,body:value.body}); setImported(false); setRevision(value.revision); setConfirmed(false); }
    }).catch(failure => { if (!controller.signal.aborted) setTemplateError(failure.message); }).finally(() => { if (current === selection.current) setTemplatePending(false); });
    return () => controller.abort();
  }, [id, preview]);
  async function saveTemplate() {
    if (!selected || revision === null || saving.current || templatePending || preview) return;
    saving.current = true; setTemplatePending(true); setTemplateError(""); setMessage("");
    try {
      const response = await fetch("/api/ops/messages/templates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: `manual:${selected.id}`, subject, body, revision }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Template copy could not be saved.");
      setRevision(value.revision); setSubject(value.subject); setBody(value.body); setBase({subject:value.subject,body:value.body}); setImported(false); setMessage("Reusable template saved. Future drafts start with this copy. Existing drafts and scheduled messages are unchanged.");
    } catch (failure) { setTemplateError(failure instanceof Error ? failure.message : "Template copy could not be saved."); }
    finally { saving.current = false; setTemplatePending(false); }
  }
  const issue = selected ? manualCommunicationDraftIssue(subject, body, selected.channel) : null;
  function apply() {
    if (!selected || !template || issue || !confirmed || !options.some(item => item.key === destination)) return;
    const [kind, ...parts] = destination.split(":");
    const key = parts.join(":");
    onApply({ ...edits, subject: subject.trim(), signOff: null,
      ...(kind === "variable" ? { values: { ...edits.values, [key]: body.trim() } } : { copy: { ...edits.copy, [key]: body.trim() } }),
    });
    setImported(true);
    setMessage("Copy added to the draft. Review every other text field, the full design and the recipients before sending.");
  }
  async function copyText() {
    if (issue || !confirmed) return;
    try { await navigator.clipboard.writeText(body.trim()); setMessage("Text copied. Nothing was sent. Use only the approved SMS channel and permitted recipients."); }
    catch { setMessage("Copy is unavailable here. Select the text above and copy it manually."); }
  }
  return <section className="operator-glass mb-5 space-y-4 p-5" aria-label="Approved manual communication templates">
    <div><h3 className="font-semibold">Approved one-off copy</h3><p className="mt-1 text-sm text-[color:var(--operator-muted)]">Choose the message, fill in its details, then use your Resend design and existing recipient review. No recurring send is created.</p></div>
    <label className="block text-sm" htmlFor="manual-communication-template">Message<select className={OPERATOR_FIELD_CLASS} id="manual-communication-template" disabled={disabled || templatePending || dirty} value={id} onChange={event => select(event.target.value)}><option value="">Choose approved copy</option>{CADE_MANUAL_TEMPLATES.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    {templatePending ? <p className="text-sm" role="status">Loading or saving reusable copy…</p> : null}
    {templateError ? <p className="text-sm text-[var(--operator-danger)]" role="alert">{templateError}</p> : null}
    {selected ? <fieldset disabled={disabled || templatePending} className="min-w-0 space-y-4">
      <p className="text-sm leading-relaxed text-[color:var(--operator-muted)]">{selected.dependency}</p>
      {selected.channel === "emails" ? <label className="block text-sm" htmlFor="manual-communication-subject">Subject<input className={OPERATOR_FIELD_CLASS} id="manual-communication-subject" maxLength={200} value={subject} onChange={event => { setSubject(event.target.value); setImported(false); setConfirmed(false); setMessage(""); }} /></label> : null}
      <label className="block text-sm" htmlFor="manual-communication-body">{selected.channel === "texts" ? "Text message" : "Email copy"}<textarea className={`${OPERATOR_FIELD_CLASS} resize-y leading-relaxed`} id="manual-communication-body" rows={selected.channel === "texts" ? 4 : 12} maxLength={12000} value={body} onChange={event => { setBody(event.target.value); setImported(false); setConfirmed(false); setMessage(""); }} /></label>
      <div className="flex flex-wrap items-center gap-3"><button className={OPERATOR_BUTTON_CLASS} type="button" disabled={preview || revision === null || templatePending || !body.trim() || (selected.channel === "emails" && !subject.trim())} onClick={() => void saveTemplate()}>Save reusable template</button><p className="text-xs text-[color:var(--operator-muted)]">Saving updates the starting copy for future drafts. Keep placeholders in the reusable template; fill them before adding copy to an outgoing draft.</p></div>
      {dirty ? <button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => { setSubject(base.subject); setBody(base.body); setConfirmed(false); setImported(false); setMessage(""); }}>Discard copy edits</button> : null}
      {issue ? <p className="text-sm text-[color:var(--operator-muted)]">{issue}</p> : null}
      <label className="flex items-start gap-3 text-sm leading-relaxed"><input className="mt-1" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I checked the actual dates, links, recipients and any benefits promised in this message. Optional instructions are filled in or removed.</span></label>
      {selected.channel === "emails" ? template ? <>
        <label className="block text-sm" htmlFor="manual-communication-destination">Where should the message go?<select className={OPERATOR_FIELD_CLASS} id="manual-communication-destination" value={options.some(item => item.key === destination) ? destination : ""} onChange={event => setDestination(event.target.value)}><option value="">Choose the design’s body text field</option>{options.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <p className="text-xs leading-relaxed text-[color:var(--operator-muted)]">Only the subject and selected text field are replaced. Layout, images, links and other copy stay in place. Check them in the preview. The extra handwritten sign-off is removed because this copy already includes its closing.</p>
        <button className={OPERATOR_BUTTON_CLASS} type="button" disabled={!!issue || !confirmed || !options.some(item => item.key === destination)} onClick={apply}>Add copy to this draft</button>
      </> : <p className="text-sm">Choose a Resend design below, then select its body field to add this copy.</p> : <button className={OPERATOR_BUTTON_CLASS} type="button" disabled={!!issue || !confirmed} onClick={() => void copyText()}>Copy reviewed text</button>}
      {message ? <p className="text-sm leading-relaxed" role="status">{message}</p> : null}
    </fieldset> : null}
  </section>;
}
