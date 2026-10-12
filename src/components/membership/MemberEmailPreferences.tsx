"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { SUPPORT_ACTION_CLASS } from "@/components/support/supportStyles";
import { MEMBER_EMAIL_UPDATES_NOTICE, MEMBER_COMMUNICATION_NOTICE_VERSION } from "@/lib/membership/member-communication-preferences-model";
import type { MemberEmailPreferenceSnapshot } from "@/lib/membership/member-email-preferences-service";

const API = "/api/my/communication-preferences";
export default function MemberEmailPreferences({ preview = false }: { preview?: boolean }) {
  const [saved, setSaved] = useState<MemberEmailPreferenceSnapshot | null>(preview ? { email: null, revision: "preview", noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION } : null);
  const [email, setEmail] = useState(false);
  const [pending, setPending] = useState(!preview);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false), mounted = useRef(true);
  async function read(signal?: AbortSignal) {
    const response = await fetch(API, { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Email preferences could not be loaded.");
    if (mounted.current && !signal?.aborted) { setSaved(result); setEmail(result.email === true); setConflict(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (preview) return () => { mounted.current = false; };
    const controller = new AbortController(); busy.current = true;
    read(controller.signal).catch(reason => { if (!controller.signal.aborted && mounted.current) { setError(true); setMessage(reason instanceof Error ? reason.message : "Email preferences could not be loaded."); } })
      .finally(() => { if (!controller.signal.aborted && mounted.current) { busy.current = false; setPending(false); } });
    return () => { mounted.current = false; controller.abort(); };
    // Loading is tied to the workspace mode; checkbox changes never reload or save.
  }, [preview]);
  async function reload() {
    if (preview || busy.current) return;
    busy.current = true; setPending(true); setMessage(""); setError(false);
    try { await read(); }
    catch (reason) { if (mounted.current) { setError(true); setMessage(reason instanceof Error ? reason.message : "Email preferences could not be loaded."); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (preview || busy.current || !saved || conflict) return;
    busy.current = true; setPending(true); setMessage(""); setError(false);
    try {
      const response = await fetch(API, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, expectedRevision: saved.revision, noticeVersion: saved.noticeVersion }) });
      const result = await response.json();
      if (!mounted.current) return;
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(result.error || "Your email preference could not be saved."); }
      setSaved(result); setEmail(result.email === true); setMessage(result.email ? "Email reminders are on." : "Email reminders are off.");
    } catch (reason) { if (mounted.current) { setError(true); setMessage(reason instanceof Error ? reason.message : "Your email preference could not be saved."); } }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return <section aria-labelledby="account-email-reminders" className="rounded-[4px] bg-[var(--member-soft)] p-5 sm:p-6 lg:col-span-2" id="email-reminders">
    <h2 className="![font-family:var(--font-cadehandy2)] text-2xl text-[var(--member-red)]" id="account-email-reminders">Email reminders</h2>
    <p className="mt-3 text-sm leading-relaxed text-[var(--member-muted)]">Optional updates about your membership and upcoming calls. You can change your choice here at any time.</p>
    {preview ? <p className="mt-3 text-sm text-[var(--member-muted)]">Preview only. Your preference will not be saved.</p> : null}
    <form className="mt-5 space-y-4" onSubmit={save}>
      <label className="flex min-h-11 items-start gap-3 text-base leading-relaxed" htmlFor="member-email-reminders"><input className="mt-1 size-5 shrink-0 accent-[var(--member-ink)]" id="member-email-reminders" type="checkbox" checked={email} disabled={pending || !saved || conflict} onChange={event => { setEmail(event.currentTarget.checked); setMessage(""); setError(false); }} /><span>{MEMBER_EMAIL_UPDATES_NOTICE}</span></label>
      {message ? <p className={`text-sm leading-relaxed ${error ? "text-[var(--member-red)]" : "text-[var(--member-muted)]"}`} role={error ? "alert" : "status"}>{message}</p> : null}
      <div className="flex flex-wrap gap-3"><button className={SUPPORT_ACTION_CLASS} disabled={preview || pending || !saved || conflict || saved.email === email} type="submit">{pending ? "Loading…" : "Save email preference"}</button>{!preview && (conflict || !saved && !pending) ? <button className={SUPPORT_ACTION_CLASS} type="button" disabled={pending} onClick={() => void reload()}>Reload preference</button> : null}</div>
    </form>
  </section>;
}
