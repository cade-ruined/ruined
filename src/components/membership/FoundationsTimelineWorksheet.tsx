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
type EditorStep = "moment" | "meaning";
function Arrow({ back = false }: { back?: boolean }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" style={back ? { transform: "rotate(180deg)" } : undefined}><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Check() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Lock() {
  return <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5"/></svg>;
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
  const [step, setStep] = useState<EditorStep>(timeline.entries.length ? "meaning" : "moment");
  const [search, setSearch] = useState("");
  const [promptIndex, setPromptIndex] = useState<number | null>(null);
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
  const yearInput = useRef<HTMLInputElement>(null);
  const meaningInput = useRef<HTMLTextAreaElement>(null);
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
  const matchingEntries = timeline.entries.filter(entry => `${entry.title} ${formatTimelineDate(entry, true)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedIndex = timeline.entries.findIndex(entry => entry.id === editingId);
  const nextMoment = selectedIndex >= 0 ? timeline.entries[selectedIndex + 1] : undefined;

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
    setStep(entry ? "meaning" : "moment"); setPromptIndex(null);
    window.requestAnimationFrame(() => (entry ? meaningInput.current : titleInput.current)?.focus({ preventScroll: true }));
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
    setUncertain(recoveryDraft.wasPending); setStep(recoveryDraft.form.title ? "meaning" : "moment"); dismissRecovery(); setStatus("Your unfinished moment is restored.");
  }
  function showMeaning() {
    if (!/^\d{4}$/.test(form.year) || Number(form.year) < 1900 || Number(form.year) > 2200) {
      setStep("moment"); setError("Add a four-digit year between 1900 and 2200.");
      window.requestAnimationFrame(() => yearInput.current?.focus({ preventScroll: true })); return;
    }
    if (!form.title.trim()) { setStep("moment"); setError("Give this moment a short title."); window.requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true })); return; }
    setStep("meaning"); setError("");
    window.requestAnimationFrame(() => meaningInput.current?.focus({ preventScroll: true }));
  }
  async function submitStep(event: FormEvent) {
    if (step === "moment") { event.preventDefault(); if (!disabled) showMeaning(); return; }
    await save(event);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || needsReview || !dirty) return;
    if (!/^\d{4}$/.test(form.year) || Number(form.year) < 1900 || Number(form.year) > 2200) { setStep("moment"); setError("Add a four-digit year between 1900 and 2200."); window.requestAnimationFrame(() => yearInput.current?.focus({ preventScroll: true })); return; }
    if (!form.title.trim()) { setStep("moment"); setError("Add what happened in a short title."); window.requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true })); return; }
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

  return <article className={styles.experience}>
    <header className={styles.header}>
      <div><Link className={styles.back} href="/my/foundations/timeline"><Arrow back /> Full timeline</Link><h1>Your story.<span> In perspective.</span></h1><p>One moment. A little more understanding.</p></div>
      <div className={styles.headerActions}>
        <span className={styles.private}><Lock /> {preview ? "Preview" : "Only you"}</span>
        <details className={styles.options}><summary aria-label="Timeline options"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></summary><div><button onClick={downloadDraft}>Download copy</button><button disabled={pending} onClick={() => void loadLatest()}>Load latest moments</button></div></details>
      </div>
    </header>
    {recoveryDraft ? <aside className={styles.recovery}><div><h2>Pick up where you left off.</h2><p>Your unfinished moment is here.</p></div><button onClick={restore}>Restore draft</button><button onClick={dismissRecovery}>Discard recovered draft</button></aside> : null}
    <div className={styles.workspace}>
      <aside className={styles.moments} aria-label="Your saved timeline moments">
        <div className={styles.railHeading}><h2>Your moments <span>{timeline.entries.length}</span></h2><button className={styles.add} disabled={disabled} onClick={() => open()} aria-label="Add a moment"><span aria-hidden="true">+</span></button></div>
        {timeline.entries.length > 6 ? <input className={styles.search} type="search" aria-label="Find a moment" placeholder="Find a moment…" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(40); }} /> : null}
        {!timeline.entries.length ? <div className={styles.empty}><span aria-hidden="true">↗</span><p>A beginning.<br />A turning point.<br />Anything that stayed.</p><button disabled={disabled} onClick={() => open()}>Add your first moment <Arrow /></button></div> : null}
        {timeline.entries.length > 0 && !matchingEntries.length ? <p className={styles.noResults}>No moments found.</p> : null}
        <ol>{matchingEntries.slice(0, visibleCount).map(entry => <li key={entry.id}><button className={styles.momentCard} data-color={entry.position % 4} disabled={pending || Boolean(recoveryDraft)} aria-current={editingId === entry.id ? "true" : undefined} onClick={() => open(entry)}>
          <span className={styles.cardTop}><time>{formatTimelineDate(entry)}</time>{entry.meaning?.trim() ? <span className={styles.check} aria-label="Meaning added"><Check /></span> : <span className={styles.cardDot} aria-hidden="true" />}</span>
          <strong>{entry.title}</strong><span className={styles.cardBottom}>{editingId === entry.id ? "Exploring now" : "Explore moment"}<Arrow /></span>
        </button></li>)}</ol>
        {visibleCount < matchingEntries.length ? <button className={styles.more} onClick={() => setVisibleCount(count => count + 40)}>Show more moments</button> : null}
        <div className={styles.progress}><div><span>{reflected} of {timeline.entries.length} explored</span><span>Foundations 01</span></div><progress max={Math.max(1, timeline.entries.length)} value={reflected} aria-label="Moments with a saved meaning" /></div>
      </aside>
      <form ref={formElement} className={styles.editor} onSubmit={submitStep} noValidate>
        <div className={styles.editorTop}>
          <nav className={styles.steps} aria-label="Explore a moment"><button type="button" aria-pressed={step === "moment"} onClick={() => setStep("moment")}><span>1</span> The moment</button><button type="button" aria-pressed={step === "meaning"} onClick={showMeaning}><span>2</span> The meaning</button></nav>
          <span className={styles.stepCount}>{step === "moment" ? "01" : "02"} / 02</span>
        </div>
        <section className={styles.momentPanel} hidden={step !== "moment"} aria-label="The moment">
          <div className={styles.panelHeading}><span className={styles.overline}>{editingId ? "THE EXPERIENCE" : "A NEW CHAPTER"}</span><label htmlFor="foundation-event">What happened?</label></div>
          <input className={styles.titleInput} ref={titleInput} id="foundation-event" maxLength={200} required disabled={disabled} value={form.title} onChange={event => change("title", event.target.value)} placeholder="Give this moment a name…" />
          <div className={styles.date}><label>Year<input ref={yearInput} inputMode="numeric" maxLength={4} required disabled={disabled} value={form.year} onChange={event => change("year", event.target.value)} placeholder="2019" /></label><label>Month <span>(optional)</span><select disabled={disabled} value={form.month} onChange={event => change("month", event.target.value)}><option value="">Year only</option>{TIMELINE_MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></label></div>
          <details className={styles.details}><summary>Add a little context <span>optional</span></summary><label className={styles.srOnly} htmlFor="foundation-details">Details (optional)</label><textarea id="foundation-details" rows={3} maxLength={Math.max(4000, selected?.details?.length ?? 0)} disabled={disabled} value={form.details} onChange={event => change("details", event.target.value)} placeholder="What do you remember?" /></details>
          <details className={styles.memoryHelp}><summary>Need a starting point?</summary><p>Family · Relationships · Success · Failure · Work · Money · Health · Beliefs · Important people · Decisions · Change · Loss · Pride · Shame</p></details>
        </section>
        <section className={styles.meaningPanel} hidden={step !== "meaning"} aria-label="The meaning">
          <div className={styles.momentContext}><div><span className={styles.yearPill}>{form.year || "Your moment"}</span><h2>{form.title || "A moment that stayed with you"}</h2></div><button type="button" className={styles.editMoment} onClick={() => setStep("moment")} aria-label="Edit this moment"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button></div>
          <div className={styles.reflection}>
            <span className={styles.overline}>THE STORY I CARRIED</span>
            <label htmlFor="foundation-meaning">What did I<br className={styles.desktopBreak} /> make it mean?</label>
            <textarea ref={meaningInput} id="foundation-meaning" rows={4} maxLength={4000} disabled={disabled} value={form.meaning ?? ""} onChange={event => change("meaning", event.target.value)} placeholder="I started to believe…" />
            <details className={styles.promptHelp}><summary>Need a prompt?</summary><div className={styles.promptChips}>{["About me", "Other people", "Life", "My beliefs"].map((label, index) => <button key={label} type="button" aria-pressed={promptIndex === index} onClick={() => setPromptIndex(index)}>{label}</button>)}</div>{promptIndex !== null ? <p role="status">{PROMPTS[promptIndex]}</p> : null}</details>
          </div>
        </section>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {needsReview ? <aside className={styles.review}><h2>Review before saving.</h2>{!reviewLoaded ? <button disabled={pending} type="button" onClick={() => void loadLatest()}>Load latest saved moments</button> : <>
          {selected ? <><p>Currently saved: <strong>{selected.title}</strong> · {formatTimelineDate(selected)}</p><p className={styles.savedText}>{selected.details || "No details added."}</p><p className={styles.savedText}>Meaning: {selected.meaning || "No meaning added."}</p><button type="button" onClick={keepDraft}>Keep my draft for this moment</button></> : uncertain ? <p>The save may have reached your timeline. Download your draft, then discard it here and open the matching saved moment above. Review the list before adding it again.</p> : <><p>This moment is no longer on your timeline.</p><button type="button" onClick={keepDraft}>Keep draft as a new moment</button></>}
        </>}</aside> : null}
        <div className={styles.saveRow}>
          <div className={styles.saveState}><span className={styles.stateDot} data-dirty={dirty || needsReview} aria-hidden="true" />{pending ? "Saving…" : needsReview ? "Review needed" : dirty ? "Unsaved changes" : !allowEdit ? "Read only" : preview ? "Preview only" : !selected ? "New moment" : "Saved to your timeline"}</div>
          <div className={styles.saveActions}>{dirty || needsReview ? <button className={styles.discard} type="button" disabled={pending} onClick={() => ask({ kind: "discard" })} aria-label="Discard draft">Discard</button> : null}{step === "moment" ? <button className={styles.save} type="button" disabled={pending || Boolean(recoveryDraft)} onClick={event => { event.preventDefault(); showMeaning(); }}>Continue <Arrow /></button> : <button className={styles.save} type="submit" disabled={disabled || !dirty || needsReview} aria-label={preview ? "Save in preview" : "Save to my timeline"}>{pending ? "Saving…" : "Save moment"}{pending ? null : <Check />}</button>}</div>
        </div>
        <p className={styles.srOnly} role="status">{status}</p>
        <div className={styles.afterword}><span>No need to change the story yet.</span>{nextMoment && !dirty && !needsReview ? <button type="button" disabled={pending || Boolean(recoveryDraft)} onClick={() => open(nextMoment)}>Next moment <Arrow /></button> : null}</div>
      </form>
    </div>
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby="foundation-confirm-title" onCancel={event => { event.preventDefault(); setConfirmation(null); }}>
      <h2 id="foundation-confirm-title">{confirmation?.kind === "leave" ? "Leave this moment?" : "Discard this draft?"}</h2><p>{confirmation?.kind === "leave" ? preview ? "This is a preview. Leaving will reset the examples and unfinished writing." : memberNavigation ? "You have unsaved writing. Stay to save it to your timeline. Your draft stays available while you move around the member area." : "Leaving the member area will lose this unfinished draft. Stay to save it to your timeline first." : "Your saved timeline will stay as it is. Only these unfinished changes will be discarded."}</p><div><button ref={cancelButton} type="button" onClick={() => setConfirmation(null)}>Keep writing</button><button type="button" onClick={confirm}>{confirmation?.kind === "leave" ? !preview && memberNavigation ? "Leave with draft" : "Leave without saving" : "Discard draft"}</button></div>
    </dialog>
  </article>;
}
