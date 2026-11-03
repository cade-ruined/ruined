"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MEMBER_SMS_ONE_OFF_INPUT_LIMIT, renderMemberSmsOneOffBody,
  type MemberSmsOneOffConfiguration, type MemberSmsOneOffRecipient, type MemberSmsOneOffReview,
  type MemberSmsOneOffReviewResponse, type MemberSmsOneOffSearch, type MemberSmsOneOffSendResult,
} from "@/lib/communications/member-sms-one-off-model";
import { OPERATOR_BUTTON_CLASS } from "./operatorStyles";
import styles from "./OperatorSmsOneOffComposer.module.css";

const API = "/api/ops/messages/texts/one-off";
const SAMPLE_RECIPIENT: MemberSmsOneOffRecipient = { memberId: "00000000-0000-4000-8000-000000000001", name: "Alex Example", maskedPhone: "••• ••• 0100", sharedPhone: false, consentState: "opted_in" };
const SAMPLE_CONFIGURATION: MemberSmsOneOffConfiguration = { enabled: false, ready: false, issues: [] };
type Phase = "edit" | "reviewing" | "review" | "sending" | "result";
type Props = { open: boolean; preview?: boolean; onClose: () => void; onActivity: () => void; onBusyChange?: (busy: boolean) => void };
class OneOffHttpError extends Error { constructor(readonly status: number, message: string, readonly sendStarted?: false) { super(message); } }

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => null) as (T & { error?: string; sendStarted?: boolean }) | null;
  if (!response.ok || !result) throw new OneOffHttpError(response.status, typeof result?.error === "string" ? result.error : "The request could not be completed. Please try again.", result?.sendStarted === false ? false : undefined);
  return result;
}

export default function OperatorSmsOneOffComposer({ open, preview = false, onClose, onActivity, onBusyChange }: Props) {
  const [phase, setPhase] = useState<Phase>("edit"), [query, setQuery] = useState(""), [message, setMessage] = useState("");
  const [recipient, setRecipient] = useState<MemberSmsOneOffRecipient | null>(null);
  const [search, setSearch] = useState<MemberSmsOneOffSearch | null>(null), [searching, setSearching] = useState(false);
  const [configuration, setConfiguration] = useState<MemberSmsOneOffConfiguration | null>(null);
  const [review, setReview] = useState<MemberSmsOneOffReview | null>(null), [result, setResult] = useState<(MemberSmsOneOffSendResult & { rejectedBeforeSending?: boolean }) | null>(null);
  const [error, setError] = useState(""), [now, setNow] = useState(Date.now());
  const busy = useRef(false), mounted = useRef(true), reviewRequestId = useRef<string | null>(null), sentReviewId = useRef<string | null>(null), searchController = useRef<AbortController | null>(null);
  let body = "", inputIssue = "";
  if (message.trim()) { try { body = renderMemberSmsOneOffBody(message); } catch (failure) { inputIssue = failure instanceof Error ? failure.message : "Check the message."; } }
  const expired = Boolean(review && Date.parse(review.expiresAt) <= now);
  const sending = phase === "sending";

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; searchController.current?.abort(); }; }, []);
  useEffect(() => { onBusyChange?.(sending); return () => onBusyChange?.(false); }, [sending, onBusyChange]);
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    document.getElementById("sms-one-off-heading")?.focus({ preventScroll: true });
  }, [open, phase]);
  useEffect(() => {
    if (phase !== "review" || typeof window === "undefined") return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (!sending || typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sending]);

  function invalidateReview() { reviewRequestId.current = null; setReview(null); setError(""); }
  function select(next: MemberSmsOneOffRecipient) { if (busy.current) return; setRecipient(next); invalidateReview(); }
  async function findRecipients(event: FormEvent) {
    event.preventDefault();
    if (busy.current || query.trim().length < 2 || query.trim().length > 80) return;
    searchController.current?.abort(); const controller = new AbortController(); searchController.current = controller;
    setSearching(true); setSearch(null); setError("");
    try {
      const found = preview ? { recipients: /alex|example/i.test(query) ? [SAMPLE_RECIPIENT] : [], hasMore: false, configuration: SAMPLE_CONFIGURATION }
        : await readResponse<MemberSmsOneOffSearch>(await fetch(`${API}/recipients?q=${encodeURIComponent(query.trim())}`, { method: "GET", cache: "no-store", signal: controller.signal }));
      if (!mounted.current || controller.signal.aborted) return;
      setSearch(found); setConfiguration(found.configuration);
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Members could not be loaded."); }
    finally { if (mounted.current && !controller.signal.aborted) setSearching(false); }
  }
  async function prepareReview(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !recipient || !body || inputIssue || phase !== "edit") return;
    busy.current = true; setPhase("reviewing"); setError("");
    try {
      reviewRequestId.current ??= crypto.randomUUID();
      const prepared = preview ? { review: { id: "sample-review", recipient, body, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), status: "reviewed" as const }, configuration: SAMPLE_CONFIGURATION }
        : await readResponse<MemberSmsOneOffReviewResponse>(await fetch(`${API}/review`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: recipient.memberId, message, requestId: reviewRequestId.current }) }));
      if (!mounted.current) return;
      if (prepared.review.recipient.memberId !== recipient.memberId || prepared.review.body !== body) throw new Error("The recipient or wording changed. Return to the draft and review it again.");
      setReview(prepared.review); setConfiguration(prepared.configuration); setNow(Date.now()); setPhase("review");
    } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : "The text could not be prepared for review."); setPhase("edit"); } }
    finally { busy.current = false; }
  }
  async function sendReviewedText() {
    if (busy.current || preview || !review || sentReviewId.current === review.id || phase !== "review" || !configuration?.enabled || !configuration.ready) return;
    if (Date.parse(review.expiresAt) <= Date.now()) { setNow(Date.now()); setError("This review has expired. Review the draft again before sending."); return; }
    sentReviewId.current = review.id; busy.current = true; setPhase("sending"); setError("");
    try {
      const sent = await readResponse<MemberSmsOneOffSendResult>(await fetch(`${API}/send`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: review.id, confirm: true }) }));
      if (mounted.current) { setResult(sent); setPhase("result"); }
    } catch (failure) {
      if (mounted.current) {
        const rejectedBeforeSending = failure instanceof OneOffHttpError && failure.sendStarted === false;
        setResult({ reviewId: review.id, status: rejectedBeforeSending ? "blocked" : "unknown", rejectedBeforeSending, attemptId: null, deliveryStatus: null, message: rejectedBeforeSending ? failure.message : "The send result could not be confirmed. Check Activity before taking any further action. Do not resend this message." });
        setPhase("result");
      }
    } finally { busy.current = false; }
  }
  function editReview() { if (busy.current) return; invalidateReview(); setResult(null); setPhase("edit"); }
  function done() {
    if (busy.current) return;
    if (result?.status === "accepted" || result?.status === "blocked") { setPhase("edit"); setRecipient(null); setMessage(""); setQuery(""); setSearch(null); setResult(null); invalidateReview(); }
    onClose();
  }
  if (!open) return null;
  return <section className={`operator-glass ${styles.composer}`} aria-label="Send a member text" aria-busy={phase === "reviewing" || sending}>
    <header className={styles.header}><div><h3 id="sms-one-off-heading" tabIndex={-1}>{phase === "review" || sending ? "Review this text" : phase === "result" ? "Text result" : "Send a text"}</h3><p>Send a membership or service message to one member with current text-message consent.</p></div><button className={styles.close} type="button" disabled={busy.current} onClick={phase === "result" ? done : onClose}>{phase === "result" ? "Close" : "Back to texts"}</button></header>
    {preview ? <p className={styles.note}>Sample workspace. Search Alex Example to try the flow. Nothing is saved or sent.</p> : null}
    {error ? <p className={styles.alert} role="alert">{error}</p> : null}
    {configuration && !preview && (!configuration.enabled || !configuration.ready) ? <p className={styles.alert}>{configuration.issues.length ? configuration.issues.join(" ") : "Text sending is paused or needs setup. You can prepare a draft, but it cannot be sent yet."}</p> : null}
    {phase === "edit" || phase === "reviewing" ? <div className={styles.content}>
      <div><p className={styles.sectionLabel}>Recipient</p>{recipient ? <div className={styles.selected}><div><strong>{recipient.name}</strong><span>{recipient.maskedPhone} · Opted in{recipient.sharedPhone ? " · Shared number" : ""}</span></div><button type="button" className={styles.textButton} disabled={phase === "reviewing"} onClick={() => { setRecipient(null); setSearch(null); invalidateReview(); }}>Change member</button></div> : <>
        <form className={styles.search} onSubmit={findRecipients}><div className={styles.field}><label htmlFor="sms-one-off-search">Find a member</label><input id="sms-one-off-search" type="search" maxLength={80} value={query} onChange={event => { searchController.current?.abort(); setSearching(false); setQuery(event.currentTarget.value); setSearch(null); }} placeholder="Search member names" autoComplete="off" /></div><button className={OPERATOR_BUTTON_CLASS} type="submit" disabled={searching || query.trim().length < 2}>{searching ? "Searching…" : "Search"}</button></form>
        <p className={styles.note}>Only members currently eligible for texts appear here. Mobile numbers stay masked.</p>
        {search ? <>{search.recipients.length ? <ul className={styles.recipients}>{search.recipients.map(item => <li key={item.memberId}><button type="button" aria-label={`Choose ${item.name}, ${item.maskedPhone}`} onClick={() => select(item)}><span><strong>{item.name}</strong><small>{item.maskedPhone} · Opted in</small></span><span aria-hidden="true">→</span></button></li>)}</ul> : <p className={styles.note} role="status">No eligible opted-in members match this search.</p>}{search.hasMore ? <p className={styles.note}>More members match. Refine the name to find the right person.</p> : null}</> : null}
      </>}
      <form className={styles.message} onSubmit={prepareReview}><div className={styles.field}><label htmlFor="sms-one-off-message">Message</label><textarea id="sms-one-off-message" maxLength={MEMBER_SMS_ONE_OFF_INPUT_LIMIT} value={message} disabled={phase === "reviewing"} onChange={event => { setMessage(event.currentTarget.value); invalidateReview(); }} placeholder="Write the membership update or service message." aria-describedby="sms-one-off-count sms-one-off-footer-note" /></div><p id="sms-one-off-count" className={styles.counter}>{message.length} / {MEMBER_SMS_ONE_OFF_INPUT_LIMIT} message characters{body ? ` · ${body.length} total` : ""}</p><p id="sms-one-off-footer-note" className={styles.note}>Ruined identification and STOP / HELP instructions are included automatically, exactly as shown in the preview.</p>{inputIssue ? <p className={styles.alert} role="alert">{inputIssue}</p> : null}<div className={styles.actions}><button className={styles.primary} type="submit" disabled={!recipient || !body || Boolean(inputIssue) || phase === "reviewing"}>{phase === "reviewing" ? "Preparing review…" : "Review text"}</button></div></form>
      </div><aside className={styles.preview} aria-label="Text preview"><p className={styles.eyebrow}>Full text preview</p>{body ? <p className={styles.body}>{body}</p> : <p className={styles.previewEmpty}>Your complete text will appear here as you write.</p>}<p className={styles.note}>Reviewing prepares the text. Sending happens only after the separate confirmation.</p></aside>
    </div> : phase === "review" || sending ? <div className={styles.review}>
      <dl><div><dt>To</dt><dd>{review?.recipient.name}<br />{review?.recipient.maskedPhone}</dd></div><div><dt>When</dt><dd>Now, after you select Send text.</dd></div></dl>{review?.recipient.sharedPhone ? <p className={styles.note}>This mobile number is also linked to another member.</p> : null}<div className={styles.preview}><p className={styles.eyebrow}>Exact text to send</p><p className={styles.body}>{review?.body}</p></div><p className={styles.note}>One text to this member. Their current consent and phone are checked again before sending.</p>{expired ? <p className={styles.alert} role="status">This review has expired. Return to the draft and review it again.</p> : null}
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={preview || sending || expired || !configuration?.enabled || !configuration.ready} onClick={() => void sendReviewedText()}>{preview ? "Sending off in preview" : sending ? "Sending…" : "Send text"}</button><button type="button" className={styles.textButton} disabled={sending} onClick={editReview}>Back to draft</button></div>{sending ? <p className={styles.note} role="status">Waiting for the send result. Keep this page open.</p> : null}
    </div> : result ? <div className={styles.result} role="status"><h3>{result.status === "accepted" ? "Text accepted by Twilio" : result.status === "blocked" ? "Text was not sent" : result.status === "duplicate" ? "This text already has a send record" : "Send result unconfirmed"}</h3><p>{result.message}</p>{result.status === "accepted" ? <p>Acceptance is not delivery confirmation. Activity shows the latest carrier result.</p> : result.status === "unknown" || result.status === "duplicate" ? <p>Check the existing Activity record. This message will not be automatically resent.</p> : null}{review ? <div className={styles.preview}><p className={styles.eyebrow}>{review.recipient.name} · {review.recipient.maskedPhone}</p><p className={styles.body}>{review.body}</p></div> : null}<div className={styles.actions}>{!result.rejectedBeforeSending ? <button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => { if (result.status === "accepted" || result.status === "blocked") done(); onActivity(); }}>View Activity</button> : null}{result.status === "blocked" ? <button className={OPERATOR_BUTTON_CLASS} type="button" onClick={editReview}>Back to draft</button> : null}{result.status === "accepted" || result.status === "blocked" ? <button className={styles.textButton} type="button" onClick={done}>Done</button> : null}</div></div> : null}
  </section>;
}
