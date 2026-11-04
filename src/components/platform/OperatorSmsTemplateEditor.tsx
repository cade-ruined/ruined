"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  defaultMemberSmsTemplates, memberSmsTemplatePreview, memberSmsTemplateView, MEMBER_SMS_TEMPLATE_MAX_BODY,
  type MemberSmsTemplateId, type MemberSmsTemplateView,
} from "@/lib/communications/member-sms-template-model";
import { OPERATOR_BUTTON_CLASS } from "./operatorStyles";
import styles from "./OperatorSmsTemplateEditor.module.css";

const API = "/api/ops/messages/texts/templates";
type Edit = { id: MemberSmsTemplateId; body: string; enabled: boolean; noticeMinutes: number | null; revision: number };
type Review = { template: MemberSmsTemplateView; preview: string; reviewDigest: string; input: Edit };
type Props = { templateId: MemberSmsTemplateId; preview?: boolean; onClose: () => void; onSaved: () => void; onBusyChange?: (busy: boolean) => void };
const tokenLabels: Record<string, string> = { call_title: "Call title", call_date_time: "Call date and time", call_time: "Call time only", call_link: "Call details link", meeting_link: "Google Meet link" };
class TemplateHttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new TemplateHttpError(response.status, result?.error ?? "The template could not be loaded. Please try again.");
  return result;
}

export default function OperatorSmsTemplateEditor({ templateId, preview = false, onClose, onSaved, onBusyChange }: Props) {
  const [saved, setSaved] = useState<MemberSmsTemplateView | null>(null), [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true), [minutes, setMinutes] = useState("");
  const [pending, setPending] = useState<"loading" | "preview" | "save" | null>("loading");
  const [review, setReview] = useState<Review | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [stale, setStale] = useState(false), [discard, setDiscard] = useState(false);
  const busy = useRef(false), mounted = useRef(true), reviewed = useRef<Review | null>(null), textarea = useRef<HTMLTextAreaElement | null>(null);
  const destination = useRef<string | null>(null), editorUrl = useRef<string | null>(null), loadController = useRef<AbortController | null>(null), allowNavigation = useRef(false);
  const confirmation = templateId === "opt_in_confirmation", dayBefore = templateId === "day_before";
  const noticeMinutes = confirmation ? null : dayBefore ? 1440 : Number(minutes);
  const dirty = Boolean(saved && (body !== saved.body || enabled !== saved.enabled || noticeMinutes !== saved.noticeMinutes));
  const timingIssue = !confirmation && !dayBefore && (!Number.isInteger(noticeMinutes) || Number(noticeMinutes) < 15 || Number(noticeMinutes) > 720) ? "Choose a whole number from 15 to 720 minutes." : "";
  let sample = "", wordingIssue = "";
  if (saved) {
    try { sample = memberSmsTemplatePreview({ ...saved, body, enabled, noticeMinutes }); }
    catch (failure) { wordingIssue = failure instanceof Error ? failure.message : "Check the wording and fields."; }
  }
  function clearReview() { reviewed.current = null; setReview(null); setError(""); setMessage(""); }
  function editBody(value: string) { if (busy.current) return; setBody(value); clearReview(); }
  async function load(preserveDraft = false) {
    if (busy.current) return;
    busy.current = true; setPending("loading"); setError("");
    loadController.current?.abort(); const controller = new AbortController(); loadController.current = controller;
    try {
      const data = preview ? { templates: defaultMemberSmsTemplates().map(config => memberSmsTemplateView(config)) }
        : await readResponse<{ templates: MemberSmsTemplateView[] }>(await fetch(API, { method: "GET", cache: "no-store", signal: controller.signal }));
      if (!mounted.current || controller.signal.aborted) return;
      const current = data.templates.find(item => item.id === templateId);
      if (!current) throw new Error("This text template is unavailable. Refresh and try again.");
      setSaved(current); setStale(false); clearReview();
      if (!preserveDraft) { setBody(current.body); setEnabled(current.enabled); setMinutes(String(current.noticeMinutes ?? "")); }
      else setMessage("Saved version refreshed. Your draft is unchanged. Review it again before saving.");
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Text templates are unavailable."); }
    finally { if (loadController.current === controller) { busy.current = false; if (mounted.current && !controller.signal.aborted) setPending(null); } }
  }
  useEffect(() => {
    mounted.current = true; editorUrl.current = typeof window === "undefined" ? null : window.location.href;
    void load();
    return () => { mounted.current = false; busy.current = false; loadController.current?.abort(); };
    // Each editor is mounted for one template; a new selection starts a fresh draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { onBusyChange?.(dirty || pending !== null); return () => onBusyChange?.(false); }, [dirty, pending, onBusyChange]);
  useEffect(() => { if (typeof document !== "undefined") document.getElementById(discard ? "sms-template-keep-editing" : "sms-template-heading")?.focus({ preventScroll: true }); }, [discard]);
  useEffect(() => {
    if ((!dirty && pending !== "save") || typeof window === "undefined" || typeof document === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => { if (!allowNavigation.current) { event.preventDefault(); event.returnValue = ""; } };
    const guard = (event: MouseEvent) => {
      if (allowNavigation.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      if (busy.current) { setMessage("Wait for the current template action to finish before leaving."); return; }
      destination.current = anchor.href; setDiscard(true);
    };
    const back = () => {
      const target = window.location.href;
      if (!editorUrl.current || target === editorUrl.current) return;
      window.history.pushState(window.history.state, "", editorUrl.current);
      if (busy.current) { setMessage("Wait for the current template action to finish before leaving."); return; }
      destination.current = target; setDiscard(true);
    };
    window.addEventListener("beforeunload", warn); window.addEventListener("popstate", back); document.addEventListener("click", guard, true);
    return () => { window.removeEventListener("beforeunload", warn); window.removeEventListener("popstate", back); document.removeEventListener("click", guard, true); };
  }, [dirty, pending]);
  function close() { if (busy.current) return; destination.current = null; if (dirty) setDiscard(true); else onClose(); }
  function discardChanges() {
    if (busy.current) return;
    const href = destination.current; destination.current = null;
    reviewed.current = null; setReview(null); setDiscard(false);
    if (saved) { setBody(saved.body); setEnabled(saved.enabled); setMinutes(String(saved.noticeMinutes ?? "")); }
    onBusyChange?.(false);
    if (href && typeof window !== "undefined") { allowNavigation.current = true; window.location.assign(href); } else onClose();
  }
  function insertToken(token: string) {
    if (busy.current || !saved?.tokens.includes(token)) return;
    const input = textarea.current, start = input?.selectionStart ?? body.length, end = input?.selectionEnd ?? body.length, field = `{{${token}}}`;
    editBody(body.slice(0, start) + field + body.slice(end));
    input?.focus();
    if (typeof window !== "undefined") window.requestAnimationFrame(() => input?.setSelectionRange(start + field.length, start + field.length));
  }
  async function prepareReview(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !saved || !dirty || stale || timingIssue || wordingIssue || !body.trim()) return;
    const input: Edit = { id: templateId, body, enabled, noticeMinutes, revision: saved.revision };
    busy.current = true; clearReview(); setPending("preview");
    try {
      const result = preview ? { template: memberSmsTemplateView({ ...saved, ...input }), preview: sample, reviewDigest: "sample-only" }
        : await readResponse<Omit<Review, "input">>(await fetch(API, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", ...input }) }));
      if (!mounted.current) return;
      if (result.template.id !== templateId || !result.reviewDigest || !result.preview) throw new Error("The review could not be verified. Review your draft again.");
      const next = { ...result, input }; reviewed.current = next; setReview(next);
    } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : "The draft could not be reviewed."); if (failure instanceof TemplateHttpError && failure.status === 409) setStale(true); } }
    finally { busy.current = false; if (mounted.current) setPending(null); }
  }
  async function save() {
    if (preview || busy.current || !review || reviewed.current !== review || stale) return;
    busy.current = true; setPending("save"); setError("");
    try {
      const result = await readResponse<{ template: MemberSmsTemplateView; preview: string }>(await fetch(API, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", ...review.input, reviewDigest: review.reviewDigest }) }));
      if (!mounted.current) return;
      if (result.template.id !== templateId) throw new Error("The saved version could not be verified.");
      setSaved(result.template); setBody(result.template.body); setEnabled(result.template.enabled); setMinutes(String(result.template.noticeMinutes ?? ""));
      reviewed.current = null; setReview(null); setMessage("Changes saved."); onSaved();
    } catch (failure) {
      if (mounted.current) {
        reviewed.current = null; setReview(null);
        const conflict = failure instanceof TemplateHttpError && failure.status === 409;
        const uncertain = !(failure instanceof TemplateHttpError) || failure.status >= 500;
        setStale(conflict || uncertain);
        setError(conflict ? "This template changed while you were editing. Refresh the saved version; your draft will be kept." : uncertain ? "The save result could not be confirmed. Refresh the saved version before reviewing your draft again." : failure.message);
      }
    } finally { busy.current = false; if (mounted.current) setPending(null); }
  }
  return <section className={`operator-glass ${styles.editor}`} aria-label="Edit automatic text" aria-busy={pending !== null}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Automatic text</p><h3 id="sms-template-heading" tabIndex={-1}>{saved?.title ?? "Edit text"}</h3><p>Review wording and timing before applying changes to future texts.</p></div><button className={styles.textButton} type="button" disabled={pending !== null} onClick={close}>{dirty ? "Cancel edit" : "Back to messages"}</button></header>
    {preview ? <p className={styles.note}>Sample editor. Nothing is saved or sent.</p> : null}
    {error ? <p className={styles.alert} role="alert">{error}</p> : null}
    {message ? <p className={styles.note} role="status">{message}</p> : null}
    {stale ? <div className={styles.recovery}><p>Your draft is still here. Refreshing loads the current saved version without replacing your wording or settings.</p><button className={OPERATOR_BUTTON_CLASS} disabled={pending !== null} type="button" onClick={() => void load(true)}>Refresh saved version</button></div> : null}
    {discard ? <div className={styles.discard} role="alertdialog" aria-labelledby="sms-template-discard-heading"><h4 id="sms-template-discard-heading">Discard unsaved changes?</h4><p>Your current draft has not been saved.</p><div className={styles.actions}><button id="sms-template-keep-editing" className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => { destination.current = null; setDiscard(false); }}>Keep editing</button><button className={styles.textButton} type="button" onClick={discardChanges}>Discard changes</button></div></div> : null}
    {!saved ? <div className={styles.empty}><p role="status">{pending ? "Loading text template…" : "The text template could not be loaded."}</p>{!pending ? <button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => void load()}>Try again</button> : null}</div> : <form onSubmit={prepareReview}>
      <div className={styles.content}><fieldset className={styles.fields} disabled={pending !== null || discard}>
        <div className={styles.field}><label htmlFor="sms-template-body">Message wording</label><textarea ref={textarea} id="sms-template-body" value={body} maxLength={MEMBER_SMS_TEMPLATE_MAX_BODY} onChange={event => editBody(event.currentTarget.value)} aria-describedby="sms-template-fields-note sms-template-count" /></div>
        <p id="sms-template-count" className={styles.counter}>{body.length} / {MEMBER_SMS_TEMPLATE_MAX_BODY} wording characters{sample ? ` · ${sample.length} in sample text` : ""}</p>
        {saved.tokens.length ? <><p id="sms-template-fields-note" className={styles.note}>Insert a field where the real call details should appear. Use Call time only when you do not want the date in the message.</p><div className={styles.tokens} aria-label="Insert call details">{saved.tokens.map(token => <button type="button" key={token} onClick={() => insertToken(token)} title={`Insert {{${token}}}`}>{tokenLabels[token] ?? token}</button>)}</div></> : <p id="sms-template-fields-note" className={styles.note}>This confirmation uses the same wording for each new opt-in.</p>}
        <div className={styles.footer}><p className={styles.eyebrow}>Included in every text</p><p>{saved.footer}</p><small>This disclosure stays in place.</small></div>
        <div className={styles.settings}><h4>Delivery settings</h4>{confirmation ? <p className={styles.note}>Confirmation stays enabled. It follows a new opt-in or is included before a member’s first eligible call reminder.</p> : <><label className={styles.check}><input type="checkbox" checked={enabled} onChange={event => { if (!busy.current) { setEnabled(event.currentTarget.checked); clearReview(); } }} />Enable this reminder</label>{dayBefore ? <p className={styles.note}>24 hours before the call. This is a separate reminder from the shorter call notice.</p> : <div className={styles.field}><label htmlFor="sms-template-minutes">Minutes before the call</label><input id="sms-template-minutes" type="number" inputMode="numeric" min={15} max={720} step={1} value={minutes} onChange={event => { if (!busy.current) { setMinutes(event.currentTarget.value); clearReview(); } }} aria-describedby="sms-template-timing-note" /><p id="sms-template-timing-note" className={styles.note}>15 to 720 minutes. Automatic texts are checked every five minutes.</p></div>}</>}{timingIssue ? <p className={styles.alert} role="alert">{timingIssue}</p> : null}</div>
        <button type="button" className={styles.textButton} onClick={() => editBody(saved.defaultBody)}>Restore default wording</button>
      </fieldset><aside className={styles.preview} aria-label="Automatic text preview"><p className={styles.eyebrow}>{review ? "Reviewed message preview" : confirmation ? "Complete message preview" : "Sample message preview"}</p>{wordingIssue ? <p className={styles.alert} role="alert">{wordingIssue}</p> : <p className={styles.body}>{review?.preview ?? sample}</p>}{!confirmation ? <p className={styles.note}>Sample call: January 15, 2030 at noon, Mountain time. Actual call details replace these fields.</p> : null}<p className={styles.note}>{review ? "This wording and these settings are ready for your final save." : "Review changes to verify the complete text and settings."}</p>{review ? <dl className={styles.facts}><div><dt>Status</dt><dd>{confirmation ? "Always enabled" : review.template.enabled ? "Enabled" : "Off"}</dd></div><div><dt>When</dt><dd>{confirmation ? "After a new opt-in" : dayBefore ? "24 hours before the call" : `${review.template.noticeMinutes} minutes before the call`}</dd></div></dl> : null}</aside></div>
      <div className={styles.actions}>{review ? <button type="button" className={styles.primary} disabled={preview || pending !== null || stale || discard} onClick={() => void save()}>{preview ? "Saving off in sample" : pending === "save" ? "Saving…" : "Save changes"}</button> : <button type="submit" className={styles.primary} disabled={!dirty || pending !== null || stale || Boolean(timingIssue || wordingIssue) || !body.trim() || discard}>{pending === "preview" ? "Preparing review…" : "Review changes"}</button>}<span className={styles.note}>{dirty ? "Unsaved changes" : "Matches the saved version"}</span></div>
      <p className={styles.note}>Saved changes apply to future send windows. Saving does not send a text now.</p>
    </form>}
  </section>;
}
