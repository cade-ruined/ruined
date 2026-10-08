"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { MemberTimelineEntry, MemberTimelineSnapshot } from "@/lib/membership/model";
import { TIMELINE_EXAMPLES, TIMELINE_MONTHS, formatTimelineDate, fromMemberTimelineEntries, timelineFormIsDirty, toTimelineSaveEntries, type TimelineFormValue } from "./timeline-model";
import { createTimelinePersistenceAdapter, TimelineConflictError, TimelineSaveUncertainError } from "./timeline-persistence";
import useTimelineDraftGuard from "./useTimelineDraftGuard";
import styles from "./foundations-timeline-worksheet.module.css";

const EMPTY = { year: "", month: "", title: "", details: "", meaning: "" };
const PROMPTS = ["What did this mean about me?", "What did this mean about other people?", "What did this mean about life?", "What did I begin believing because of it?"];
function formFor(entry?: MemberTimelineEntry): TimelineFormValue {
  return entry ? { year: String(entry.year), month: entry.month ? String(entry.month) : "", title: entry.title, details: entry.details ?? "", meaning: entry.meaning ?? "" } : { ...EMPTY };
}
type Confirmation = { kind: "discard" } | { kind: "leave"; url: string };

export default function FoundationsTimelineWorksheet({ initialTimeline, preview = false, writable, ownerId }: {
  initialTimeline: MemberTimelineSnapshot; preview?: boolean; writable: boolean; ownerId?: string;
}) {
  const router = useRouter();
  const [timeline, setTimeline] = useState<MemberTimelineSnapshot>(() => preview ? {
    ...initialTimeline, completedAt: null, entries: TIMELINE_EXAMPLES.map(entry => ({
      id: entry.clientKey, year: entry.year, month: entry.month ?? null, position: entry.position,
      title: entry.title, details: entry.details, meaning: null,
    })),
  } : initialTimeline);
  const [editingId, setEditingId] = useState<string | null>(timeline.entries[0]?.id ?? null);
  const [form, setForm] = useState(() => formFor(timeline.entries[0]));
  const [baseline, setBaseline] = useState(() => formFor(timeline.entries[0]));
  const [pending, setPending] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [visibleCount, setVisibleCount] = useState(40);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const allowEdit = writable || preview;
  const dirty = timelineFormIsDirty(form, baseline);
  const selected = timeline.entries.find(entry => entry.id === editingId);
  const adapter = useMemo(() => createTimelinePersistenceAdapter({ preview, writable, ownerId }), [preview, writable, ownerId]);
  const { recoveryDraft, dismissRecovery, clearDraft } = useTimelineDraftGuard({
    enabled: allowEdit, scope: "foundations-01", dirty, pending: pending || uncertain, form, baseline,
    editingEntryId: editingId, revision: timeline.revision,
    onNavigate: url => ask({ kind: "leave", url }),
  });
  const disabled = !allowEdit || pending || Boolean(recoveryDraft);
  const memberNavigation = confirmation?.kind === "leave" && (() => {
    const path = new URL(confirmation.url).pathname;
    return path === "/my" || (path.startsWith("/my/") && path !== "/my/access");
  })();
  const reflected = timeline.entries.filter(entry => entry.meaning?.trim()).length;

  useEffect(() => {
    if (confirmation) { dialog.current?.showModal(); cancelButton.current?.focus(); }
    else { dialog.current?.close(); trigger.current?.focus(); }
  }, [confirmation]);

  function ask(action: Confirmation) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(action);
  }
  function open(entry?: MemberTimelineEntry) {
    if (pending) return;
    if (dirty || needsReview) {
      setError("Save or discard this draft before opening another moment.");
      formElement.current?.scrollIntoView({ block: "center" });
      return;
    }
    clearDraft();
    setEditingId(entry?.id ?? null); setForm(formFor(entry)); setBaseline(formFor(entry)); setError(""); setStatus("");
    window.requestAnimationFrame(() => titleInput.current?.focus());
  }
  function discard() {
    clearDraft(); setForm(formFor(selected)); setBaseline(formFor(selected));
    setNeedsReview(false); setReviewLoaded(false); setUncertain(false); setError(""); setStatus("Draft discarded. Your saved moments are unchanged.");
  }
  function confirm() {
    if (!confirmation) return;
    const action = confirmation; setConfirmation(null);
    if (action.kind === "discard") discard();
    else {
      // The guard keeps an account-scoped checkpoint for in-app return.
      if (new URL(action.url).origin === window.location.origin) router.push(action.url);
      else window.location.assign(action.url);
    }
  }
  function change(field: keyof TimelineFormValue, value: string) {
    setForm(current => ({ ...current, [field]: value })); setStatus("");
  }
  function restore() {
    if (!recoveryDraft) return;
    setEditingId(recoveryDraft.editingEntryId); setForm(recoveryDraft.form); setBaseline(recoveryDraft.baseline);
    setNeedsReview(recoveryDraft.wasPending || recoveryDraft.revision !== timeline.revision);
    setUncertain(recoveryDraft.wasPending); dismissRecovery(); setStatus("Your unfinished moment is restored.");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || needsReview || !dirty) return;
    if (!/^\d{4}$/.test(form.year) || Number(form.year) < 1900 || Number(form.year) > 2200) { setError("Add a four-digit year between 1900 and 2200."); return; }
    if (!form.title.trim()) { setError("Add what happened in a short title."); titleInput.current?.focus(); return; }
    if (editingId && !selected) { setNeedsReview(true); setError("This moment is no longer on your timeline. Review the latest moments before saving."); return; }
    setPending(true); setError("");
    const entry = { clientKey: editingId ?? "new", createdOrder: selected?.position ?? timeline.entries.length + 1,
      position: selected?.position ?? timeline.entries.length + 1, id: editingId, year: Number(form.year), month: form.month ? Number(form.month) : null,
      title: form.title, details: form.details, meaning: form.meaning ?? "" };
    const entries = fromMemberTimelineEntries(timeline.entries);
    const next = selected ? entries.map(item => item.id === editingId ? entry : item) : [...entries, entry];
    try {
      const saved = await adapter.save(toTimelineSaveEntries(next), timeline);
      const savedEntry = selected ? saved.entries.find(item => item.id === editingId) : saved.entries.find(item => !timeline.entries.some(old => old.id === item.id));
      if (!savedEntry) throw new TimelineSaveUncertainError("The save response could not be matched. Load the latest moments before trying again.");
      clearDraft(); setTimeline(saved); setEditingId(savedEntry.id); setForm(formFor(savedEntry)); setBaseline(formFor(savedEntry));
      setStatus(preview ? "Saved in this preview only. Refreshing resets these examples." : "Saved to your private timeline.");
    } catch (caught) {
      const ambiguous = caught instanceof TimelineSaveUncertainError;
      setNeedsReview(ambiguous || caught instanceof TimelineConflictError); setReviewLoaded(false); setUncertain(ambiguous);
      setError(caught instanceof Error ? caught.message : "Your moment could not be saved. Your draft is still here.");
    } finally { setPending(false); }
  }
  async function loadLatest() {
    setPending(true); setError("");
    try {
      const latest = await adapter.load(timeline);
      setTimeline(latest);
      if (!dirty && !needsReview) {
        const entry = latest.entries.find(item => item.id === editingId) ?? latest.entries[0];
        setEditingId(entry?.id ?? null); setForm(formFor(entry)); setBaseline(formFor(entry));
        setStatus("Your latest saved moments are loaded.");
      } else {
        setNeedsReview(true); setReviewLoaded(true);
        setStatus("Latest moments loaded. Your draft is still here. Review before saving.");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The latest timeline could not be loaded."); }
    finally { setPending(false); }
  }
  function keepDraft() {
    if (uncertain && !selected) return;
    setBaseline(formFor(selected)); setNeedsReview(false); setReviewLoaded(false); setUncertain(false);
    if (!selected) setEditingId(null);
    setError(""); setStatus("Draft kept. Save when you are ready.");
  }
  function downloadDraft() {
    const blob = new Blob([JSON.stringify({ title: "Ruined Timeline · Foundations 01", savedMoments: timeline.entries, unfinishedMoment: dirty || needsReview ? { id: editingId, ...form } : null }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "ruined-foundations-01-timeline.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <article className={styles.worksheet}>
    <nav className={styles.navigation} aria-label="Worksheet navigation"><Link href="/my/foundations/timeline">← Your full timeline</Link><span>FOUNDATIONS / 01</span></nav>
    <header className={styles.header}>
      <p className={styles.eyebrow}>YOUR STORY, AS YOU REMEMBER IT</p>
      <h1>Your Ruined Timeline.<span>What happened. What you made it mean.</span></h1>
      <div className={styles.lifeLine}><span>Birth</span><i aria-hidden="true" /><span>Today</span></div>
      <p className={styles.introduction}>Begin with the moments already here. Add what’s missing. Then notice the meaning you gave each experience.</p>
      <p className={styles.connection}>{preview ? "Preview examples · Changes stay in this tab and reset on refresh." : "These are the same private moments in your timeline. Each save updates the original entry."}</p>
    </header>
    <details className={styles.guidance}><summary>A little help remembering</summary><div>
      <section><h2>Look across your life.</h2><p>Family · Relationships · Success · Failure · Business / career · Money · Health · Identity / beliefs · Important people · Major decisions · Transitions · Loss · Pride · Shame</p></section>
      <section><h2>Notice the meaning.</h2><ul>{PROMPTS.map(prompt => <li key={prompt}>{prompt}</li>)}</ul></section>
    </div></details>
    {recoveryDraft ? <aside className={styles.recovery}><h2>You have an unfinished moment.</h2><p>Your draft was kept while you moved around the member area.</p><button onClick={restore}>Restore draft</button><button onClick={dismissRecovery}>Discard recovered draft</button></aside> : null}
    <div className={styles.tools}><p>{timeline.entries.length} moments <span> / {reflected} with meaning</span></p><div><button onClick={downloadDraft}>Download copy</button><button disabled={pending} onClick={() => void loadLatest()}>Load latest moments</button></div></div>
    <div className={styles.workspace}>
      <aside className={styles.moments} aria-label="Your saved timeline moments">
        <button className={styles.add} disabled={disabled} onClick={() => open()}>+ Add a moment</button>
        {!timeline.entries.length ? <p className={styles.empty}>Start anywhere. You can fill in the spaces later.</p> : null}
        <ol>{timeline.entries.slice(0, visibleCount).map(entry => <li key={entry.id}><button disabled={pending || Boolean(recoveryDraft)} aria-current={editingId === entry.id ? "true" : undefined} onClick={() => open(entry)}>
          <span>{formatTimelineDate(entry)}</span><strong>{entry.title}</strong><small>{entry.meaning?.trim() ? "Meaning added" : "Notice the meaning"}</small>
        </button></li>)}</ol>
        {visibleCount < timeline.entries.length ? <button onClick={() => setVisibleCount(count => count + 40)}>Show more moments</button> : null}
      </aside>
      <form ref={formElement} className={styles.editor} onSubmit={save}>
        <p className={styles.eyebrow}>{editingId ? "RETURN TO A MOMENT" : "ADD TO YOUR STORY"}</p>
        <div className={styles.date}><label>Year<input inputMode="numeric" maxLength={4} required disabled={disabled} value={form.year} onChange={event => change("year", event.target.value)} placeholder="2019" /></label><label>Month <span>(optional)</span><select disabled={disabled} value={form.month} onChange={event => change("month", event.target.value)}><option value="">Year only</option>{TIMELINE_MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></label></div>
        <label className={styles.question} htmlFor="foundation-event">What happened?</label>
        <input ref={titleInput} id="foundation-event" maxLength={200} required disabled={disabled} value={form.title} onChange={event => change("title", event.target.value)} placeholder="A short title for this moment" />
        <label className={styles.detailsLabel} htmlFor="foundation-details">Details <span>(optional)</span></label>
        <textarea id="foundation-details" rows={3} maxLength={Math.max(4000, selected?.details?.length ?? 0)} disabled={disabled} value={form.details} onChange={event => change("details", event.target.value)} placeholder="The experience, as you remember it." />
        <div className={styles.meaning}><label className={styles.question} htmlFor="foundation-meaning">What did I make it mean?</label><p>The story you attached to what happened. You don’t need to change it yet.</p><textarea id="foundation-meaning" rows={5} maxLength={4000} disabled={disabled} value={form.meaning ?? ""} onChange={event => change("meaning", event.target.value)} placeholder="I decided that…" /></div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {needsReview ? <aside className={styles.review}><h2>Review before saving.</h2>{!reviewLoaded ? <button disabled={pending} type="button" onClick={() => void loadLatest()}>Load latest saved moments</button> : <>
          {selected ? <><p>Currently saved: <strong>{selected.title}</strong> · {formatTimelineDate(selected)}</p><p className={styles.savedText}>{selected.details || "No details added."}</p><p className={styles.savedText}>Meaning: {selected.meaning || "No meaning added."}</p><button type="button" onClick={keepDraft}>Keep my draft for this moment</button></> : uncertain ? <p>The save may have reached your timeline. Download your draft, then discard it here and open the matching saved moment above. Review the list before adding it again.</p> : <><p>This moment is no longer on your timeline.</p><button type="button" onClick={keepDraft}>Keep draft as a new moment</button></>}
        </>}</aside> : null}
        <div className={styles.saveRow}><button className={styles.save} type="submit" disabled={disabled || !dirty || needsReview}>{pending ? "Saving…" : preview ? "Save in preview" : "Save to my timeline"}</button>{dirty || needsReview ? <button type="button" disabled={pending} onClick={() => ask({ kind: "discard" })}>Discard draft</button> : null}</div>
        <p className={styles.status} role="status">{status || (dirty ? "Unsaved changes" : !allowEdit ? "Your timeline is available to read." : !editingId ? "Add a moment when you are ready." : preview ? "Example moment" : "Saved in your private timeline")}</p>
      </form>
    </div>
    <footer className={styles.footer}><p>Finish the timeline between calls. Notice patterns without forcing a lesson.</p><p>In Foundations 02, you’ll return to these same moments.</p></footer>
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby="foundation-confirm-title" onCancel={event => { event.preventDefault(); setConfirmation(null); }}>
      <h2 id="foundation-confirm-title">{confirmation?.kind === "leave" ? "Leave this moment?" : "Discard this draft?"}</h2><p>{confirmation?.kind === "leave" ? preview ? "This is a preview. Leaving will reset the examples and unfinished writing." : memberNavigation ? "You have unsaved writing. Stay to save it to your timeline. Your draft stays available while you move around the member area." : "Leaving the member area will lose this unfinished draft. Stay to save it to your timeline first." : "Your saved timeline will stay as it is. Only these unfinished changes will be discarded."}</p><div><button ref={cancelButton} type="button" onClick={() => setConfirmation(null)}>Keep writing</button><button type="button" onClick={confirm}>{confirmation?.kind === "leave" ? !preview && memberNavigation ? "Leave with draft" : "Leave without saving" : "Discard draft"}</button></div>
    </dialog>
  </article>;
}
