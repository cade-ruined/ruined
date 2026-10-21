"use client";

import { useEffect, useRef, useState } from "react";
import { LIFECYCLE_EMAIL_KEYS, LIFECYCLE_TITLES, isLifecycleKey, type LifecycleEmailKey } from "@/lib/communications/member-lifecycle-email-model";
import { LIFECYCLE_DESCRIPTIONS, type LifecycleEmailItem, type LifecycleEmailOverview } from "@/lib/communications/lifecycle-email-view";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "./operatorStyles";
const API = "/api/ops/messages/lifecycle";
function safePreview(html: string) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`;
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, head => `${head}${policy}`) : `${policy}${html}`;
}
const fieldLabels: Record<string, string> = { reviewUrl: "Approved review link", surveyUrl: "Final check-in form link", foundationsWorkType: "Saved Foundations work to revisit", foundationsWorkLabel: "Work to revisit", foundationsWorkPath: "Member-only work path", fulfillmentMode: "Six-month Artifact fulfillment", calendarYear: "Approved calendar year", closureDetails: "Separate closure / availability periods", returnDate: "Return date", scheduleChanges: "Call changes (enter None if there are no changes)" };
function fields(key: LifecycleEmailKey) {
  if (key === "checkin_30") return ["reviewUrl"];
  if (key === "checkin_90") return ["surveyUrl"];
  if (key === "checkin_6_month") return ["foundationsWorkType", "fulfillmentMode"];
  if (key === "thanksgiving" || key === "christmas") return ["calendarYear", "closureDetails", "returnDate", "scheduleChanges"];
  return [];
}
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " MT" : "None scheduled";
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const result = await fetch(url, { ...init, cache: "no-store" });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error ?? "Lifecycle email settings are unavailable.");
  return data;
}
export default function OperatorLifecycleEmails({ preview = false, onOverview, onDirtyChange }: { preview?: boolean; onOverview: (value: LifecycleEmailOverview | null) => void; onDirtyChange?: (dirty:boolean) => void }) {
  const [refresh, setRefresh] = useState(0);
  const [overview, setOverview] = useState<LifecycleEmailOverview | null>(null);
  const [selected, setSelected] = useState<LifecycleEmailKey | "">("");
  const [detail, setDetail] = useState<LifecycleEmailItem | null>(null);
  const [copy, setCopy] = useState<{subject:string;body:string} | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const saving = useRef(false);
  const dirty = detail && (JSON.stringify(settings) !== JSON.stringify(detail.settings) || !!copy && (copy.subject !== detail.subject || copy.body !== detail.body));
  useEffect(() => { onDirtyChange?.(!!dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("lifecycle");
    if (isLifecycleKey(key)) setSelected(key);
    if (preview) return;
    const controller = new AbortController();
    void request<LifecycleEmailOverview>(API, { signal: controller.signal }).then(value => { setOverview(value); onOverview(value); }).catch(failure => { if (!controller.signal.aborted) { setError(failure.message); onOverview(null); } });
    return () => controller.abort();
  }, [preview, onOverview, refresh]);
  useEffect(() => {
    if (!selected || preview) { setDetail(null); return; }
    const controller = new AbortController();
    const current = ++sequence.current;
    setPending(true); setError(""); setMessage(""); setDetail(null);
    void request<LifecycleEmailItem>(`${API}?key=${selected}`, { signal: controller.signal }).then(value => { if (current === sequence.current) { setDetail(value); setSettings(value.settings); setCopy(typeof value.subject === "string" && typeof value.body === "string" ? {subject:value.subject,body:value.body} : null); } }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (current === sequence.current) setPending(false); });
    return () => controller.abort();
  }, [selected, preview, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigation = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a[href]");
      if (!anchor || event.defaultPrevented || (anchor as HTMLAnchorElement).target === "_blank") return;
      event.preventDefault(); setError("Save or discard the lifecycle settings before leaving this page.");
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigation, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigation, true); };
  }, [dirty]);
  async function save(enabled: boolean) {
    if (!detail || pending || preview || saving.current) return;
    saving.current = true;
    const key = detail.key;
    setPending(true); setError(""); setMessage("");
    try {
      await request(API, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, enabled, settings, revision: detail.revision, ...(copy ?? {}) }) });
      const [next, current] = await Promise.all([request<LifecycleEmailOverview>(API), request<LifecycleEmailItem>(`${API}?key=${key}`)]);
      setOverview(next); onOverview(next); setDetail(current); setSettings(current.settings); setCopy(typeof current.subject === "string" && typeof current.body === "string" ? {subject:current.subject,body:current.body} : null); setMessage(enabled ? "Settings saved and this email enabled. Delivery still checks current eligibility and timing." : "Settings saved. This email is paused.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Settings could not be saved."); }
    finally { saving.current = false; setPending(false); }
  }
  return <section id="lifecycle-emails" className="operator-glass mt-6 scroll-mt-24 space-y-4 p-5" aria-labelledby="lifecycle-heading" data-operator-dirty={!!dirty} data-operator-pending={pending}>
    <div><h3 id="lifecycle-heading" className="font-semibold">Birthdays, holidays and member milestones</h3><p className="mt-1 text-sm text-[color:var(--operator-muted)]">Review the actual settings and missing decisions. Enabling a message does not grant permission to email anyone or replay old milestones.</p></div>
    <button className={OPERATOR_BUTTON_CLASS} type="button" disabled={preview || pending || !!dirty} onClick={() => setRefresh(value => value + 1)}>Refresh lifecycle status</button>
    {overview?.setupRequired || overview?.deliveryEnabled === false ? <p className="text-sm" role="status">{overview.setupRequired ? "Lifecycle delivery needs setup. Settings can be reviewed, but no email will send until setup is complete." : "Lifecycle delivery is paused globally. An enabled message waits for delivery to be turned on; dates below show potential timing only."}</p> : null}
    {preview ? <p className="text-sm">Lifecycle settings require the live admin workspace. No status is simulated as enabled.</p> : null}
    <label className="block text-sm" htmlFor="lifecycle-message">Message<select id="lifecycle-message" className={OPERATOR_FIELD_CLASS} value={selected} disabled={pending || !!dirty} onChange={event => setSelected(event.target.value as LifecycleEmailKey | "")}><option value="">Choose a lifecycle email</option>{LIFECYCLE_EMAIL_KEYS.map(key => { const item = overview?.items.find(value => value.key === key); return <option key={key} value={key}>{LIFECYCLE_TITLES[key]}{item ? ` · ${!item.ready ? "Held" : item.enabled ? "Enabled" : "Ready to enable"}` : ""}</option>; })}</select></label>
    {pending ? <p className="text-sm" role="status">Loading or saving settings…</p> : null}
    {error ? <p className="text-sm text-[var(--operator-danger)]" role="alert">{error}</p> : null}
    {message ? <p className="text-sm" role="status">{message}</p> : null}
    {overview?.closures?.length ? <details className="text-sm"><summary className="cursor-pointer py-2">Annual closure calendar</summary><ul className="mt-2 space-y-2">{overview.closures.map(item => <li key={item.title}><strong>{item.title}</strong> · {item.start}{item.end !== item.start ? ` through ${item.end}` : ""}</li>)}</ul><p className="mt-2 text-[color:var(--operator-muted)]">These are separate closure periods. Confirm the year’s call changes before enabling holiday emails.</p></details> : null}
    {detail ? <div className="space-y-4">
      <p className="font-medium">{!detail.ready ? "Held — dependencies remain" : overview?.setupRequired ? "Setup required" : detail.enabled && overview?.deliveryEnabled === false ? "Enabled · delivery paused" : detail.enabled ? "Enabled" : "Copy approved · ready to enable"}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-[color:var(--operator-muted)]">Trigger</dt><dd>{LIFECYCLE_DESCRIPTIONS[detail.key].trigger}</dd></div><div><dt className="text-[color:var(--operator-muted)]">Timing</dt><dd>{LIFECYCLE_DESCRIPTIONS[detail.key].timing}</dd></div><div><dt className="text-[color:var(--operator-muted)]">Audience</dt><dd>{LIFECYCLE_DESCRIPTIONS[detail.key].audience}</dd></div><div><dt className="text-[color:var(--operator-muted)]">Current eligible members</dt><dd>{detail.eligible}</dd></div><div><dt className="text-[color:var(--operator-muted)]">Next due</dt><dd>{date(detail.nextDueAt)}</dd></div><div><dt className="text-[color:var(--operator-muted)]">Last sent</dt><dd>{detail.lastSentAt ? date(detail.lastSentAt) : "No delivery recorded"}</dd></div></dl>
      {detail.missing.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{detail.missing.map(value => <li key={value}>{value}</li>)}</ul> : null}
      <fieldset disabled={pending} className="space-y-3">{fields(detail.key).map(key => <label key={key} className="block text-sm" htmlFor={`lifecycle-${key}`}>{fieldLabels[key]}{key === "foundationsWorkType" ? <select id={`lifecycle-${key}`} className={OPERATOR_FIELD_CLASS} value={settings.foundationsWorkType ?? ""} onChange={event => { const chosen = event.target.value === "timeline"; setSettings(current => ({ ...current, foundationsWorkType: chosen ? "timeline" : "", foundationsWorkLabel: chosen ? "created your Timeline" : "", foundationsWorkPath: chosen ? "/my/foundations/timeline" : "" })); }}><option value="">Choose the approved work</option><option value="timeline">Timeline · completed work with member revisit access</option></select> : key === "fulfillmentMode" ? <select id={`lifecycle-${key}`} className={OPERATOR_FIELD_CLASS} value={settings[key] ?? ""} onChange={event => setSettings(current => ({ ...current, [key]: event.target.value }))}><option value="">Choose the approved decision</option><option value="none">No fulfillment task required</option><option value="task">Create a fulfillment task</option></select> : <textarea id={`lifecycle-${key}`} className={OPERATOR_FIELD_CLASS} rows={key === "closureDetails" || key === "scheduleChanges" ? 3 : 1} maxLength={2000} value={settings[key] ?? ""} onChange={event => setSettings(current => ({ ...current, [key]: event.target.value }))} />}</label>)}</fieldset>
      {copy ? <fieldset disabled={pending} className="space-y-3"><legend className="mb-2 font-medium">Editable email copy</legend><p className="text-xs leading-relaxed text-[color:var(--operator-muted)]">Approved copy can be revised. Saving pauses this message until its updated preview is reviewed and re-enabled. Editing copy does not remove its recipient, benefit or completion requirements.</p><label className="block text-sm" htmlFor="lifecycle-subject">Subject<input className={OPERATOR_FIELD_CLASS} id="lifecycle-subject" maxLength={200} value={copy.subject} onChange={event => setCopy(current => current && ({...current,subject:event.target.value}))} /></label><label className="block text-sm" htmlFor="lifecycle-body">Message<textarea className={`${OPERATOR_FIELD_CLASS} resize-y leading-relaxed`} id="lifecycle-body" rows={12} maxLength={12000} value={copy.body} onChange={event => setCopy(current => current && ({...current,body:event.target.value}))} /></label>{detail.tokens?.length ? <p className="break-words text-xs text-[color:var(--operator-muted)]">Available dynamic fields: {detail.tokens.join(", ")}. Keep these exactly as shown where current member or schedule information belongs.</p> : null}</fieldset> : null}
      {detail.key === "checkin_6_month" && settings.foundationsWorkType === "timeline" ? <p className="text-xs text-[color:var(--operator-muted)]">Uses “created your Timeline” and /my/foundations/timeline. Each recipient must have completed their Timeline and still have access. Other work remains held until its saved content and access are connected.</p> : null}
      <div className="flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} type="button" disabled={pending || preview} onClick={() => void save(false)}>{detail.enabled ? "Pause and save" : "Save without enabling"}</button><button className={OPERATOR_BUTTON_CLASS} type="button" disabled={pending || preview || !detail.ready || !!dirty} onClick={() => void save(true)}>{detail.enabled ? "Keep enabled" : "Enable this email"}</button>{dirty ? <button className={OPERATOR_BUTTON_CLASS} type="button" disabled={pending} onClick={() => { setSettings(detail.settings); setCopy(typeof detail.subject === "string" && typeof detail.body === "string" ? {subject:detail.subject,body:detail.body} : null); }}>Discard changes</button> : null}</div>
      {dirty ? <p className="text-xs text-[color:var(--operator-muted)]">Save your changes without enabling, then review the updated readiness and preview before enabling.</p> : null}
      {detail.preview ? <details className="operator-glass p-4"><summary className="cursor-pointer font-medium">Preview saved copy · {detail.preview.subject}</summary><p className="mt-2 text-xs text-[color:var(--operator-muted)]">This preview uses the saved settings. Actual member details are inserted at delivery.</p><iframe className="mt-3 h-[600px] w-full border-0 bg-white" title={`${detail.title} saved email preview`} sandbox="" referrerPolicy="no-referrer" srcDoc={safePreview(detail.preview.html)} /><details className="mt-3 text-sm"><summary>Plain text</summary><p className="whitespace-pre-wrap">{detail.preview.text}</p></details></details> : <p className="text-sm text-[color:var(--operator-muted)]">Preview becomes available when the required decisions and sending design are ready.</p>}
      {overview?.recent.filter(item => item.key === detail.key).length ? <details><summary className="cursor-pointer text-sm">Recent delivery activity</summary><ul className="mt-2 space-y-2 text-sm">{overview.recent.filter(item => item.key === detail.key).map(item => <li key={item.id}>{item.status} · {date(item.sentAt ?? item.dueAt)}{item.error ? ` · ${item.error}` : ""}</li>)}</ul></details> : null}
    </div> : null}
  </section>;
}
