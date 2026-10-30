"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { MemberTimelineEntry, MemberTimelineSnapshot } from "@/lib/membership/model";
import { TIMELINE_EXAMPLES, TIMELINE_MONTHS, formatTimelineDate, fromMemberTimelineEntries, timelineFormIsDirty, toTimelineSaveEntries, type TimelineFormValue } from "./timeline-model";
import { createTimelinePersistenceAdapter, TimelineConflictError, TimelineSaveUncertainError } from "./timeline-persistence";
import useTimelineDraftGuard from "./useTimelineDraftGuard";
import styles from "./foundations-timeline-worksheet.module.css";

const EMPTY = { year: "", month: "", title: "", details: "", meaning: "", belief: "", presentImpact: "", perspective: "" };
const REFLECTIONS = [
  { field: "meaning", label: "What did I make it mean?", short: "Meaning", chapter: "The meaning I gave it", hint: "What did that moment seem to say about you, other people, or life?", placeholder: "At the time, I took it to mean…" },
  { field: "belief", label: "What did I start believing?", short: "Belief", chapter: "The belief I carried", hint: "Did it become a rule you lived by, a promise, or an expectation?", placeholder: "After that, I began to believe…" },
  { field: "presentImpact", label: "How does it show up now?", short: "Now", chapter: "The echo in my life", hint: "Where do you notice that story in your choices, relationships, or habits today?", placeholder: "I notice it when…" },
  { field: "perspective", label: "What can I see now?", short: "Perspective", chapter: "What I can see from here", hint: "With some distance, what feels clearer, different, or still unresolved?", placeholder: "Looking back from here…" },
] as const;
const STEPS = ["When", "What happened", ...REFLECTIONS.map(item => item.short)];
type EditorStep = number | "review";
function formFor(entry?: MemberTimelineEntry): TimelineFormValue {
  return entry ? { year: String(entry.year), month: entry.month ? String(entry.month) : "", title: entry.title, details: entry.details ?? "", meaning: entry.meaning ?? "", belief: entry.belief ?? "", presentImpact: entry.presentImpact ?? "", perspective: entry.perspective ?? "" } : { ...EMPTY };
}
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

export default function FoundationsTimelineWorksheet({ initialTimeline, preview = false, writable, ownerId, initialEntryId, startNew = false }: {
  initialTimeline: MemberTimelineSnapshot; preview?: boolean; writable: boolean; ownerId?: string; initialEntryId?: string; startNew?: boolean;
}) {
  const router = useRouter();
  const [timeline, setTimeline] = useState<MemberTimelineSnapshot>(() => preview ? {
    ...initialTimeline, completedAt: null, entries: TIMELINE_EXAMPLES.map(entry => ({
      ...entry, id: entry.clientKey, month: entry.month ?? null,
    })),
  } : initialTimeline);
  const initialEntry = startNew && (writable || preview) ? undefined : initialEntryId ? timeline.entries.find(entry => entry.id === initialEntryId) : timeline.entries[0];
  const [missingRequested, setMissingRequested] = useState(!startNew && Boolean(initialEntryId) && !initialEntry);
  const [editingId, setEditingId] = useState<string | null>(initialEntry?.id ?? null);
  const [form, setForm] = useState(() => formFor(initialEntry));
  const [baseline, setBaseline] = useState(() => formFor(initialEntry));
  const [step, setStep] = useState<EditorStep>(initialEntry ? "review" : 0);
  const [search, setSearch] = useState("");
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
  const matchingEntries = timeline.entries.filter(entry => `${entry.title} ${formatTimelineDate(entry, true)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedIndex = timeline.entries.findIndex(entry => entry.id === editingId);
  const nextMoment = selectedIndex >= 0 ? timeline.entries[selectedIndex + 1] : undefined;
  const answered = REFLECTIONS.filter(item => form[item.field]?.trim()).length;
  const firstUnanswered = REFLECTIONS.findIndex(item => !form[item.field]?.trim());
  const reviewingDraft = dirty || !selected || needsReview;

  useEffect(() => {
    if (confirmation) { dialog.current?.showModal(); cancelButton.current?.focus(); }
    else { dialog.current?.close(); trigger.current?.focus(); }
  }, [confirmation]);

  function focusStep(next: EditorStep) {
    setStep(next);
    window.requestAnimationFrame(() => {
      const heading = formElement.current?.querySelector<HTMLElement>(`[data-step-heading="${next}"]`);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "nearest" });
    });
  }
  function ask(action: Confirmation) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(action);
  }
  function open(entry?: MemberTimelineEntry) {
    if (pending || recoveryDraft || (!entry && !allowEdit)) return;
    if (dirty || needsReview) {
      setError("Save or discard this draft before opening another moment.");
      formElement.current?.scrollIntoView({ block: "center" });
      return;
    }
    clearDraft(); setMissingRequested(false);
    setEditingId(entry?.id ?? null); setForm(formFor(entry)); setBaseline(formFor(entry)); setError(""); setStatus("");
    focusStep(entry ? "review" : 0);
  }
  function discard() {
    clearDraft(); setForm(formFor(selected)); setBaseline(formFor(selected));
    setNeedsReview(false); setReviewLoaded(false); setUncertain(false); setError(""); setStatus("Draft discarded. Your saved moments are unchanged.");
    focusStep(selected ? "review" : 0);
  }
  function confirm() {
    if (!confirmation) return;
    const action = confirmation; setConfirmation(null);
    if (action.kind === "discard") discard();
    else {
      if (new URL(action.url).origin === window.location.origin) router.push(action.url);
      else window.location.assign(action.url);
    }
  }
  function change(field: keyof TimelineFormValue, value: string) {
    if (disabled) return;
    setForm(current => ({ ...current, [field]: value })); setStatus(""); setError("");
  }
  function restore() {
    if (!recoveryDraft) return;
    setEditingId(recoveryDraft.editingEntryId); setForm({ ...EMPTY, ...recoveryDraft.form }); setBaseline({ ...EMPTY, ...recoveryDraft.baseline });
    setNeedsReview(recoveryDraft.wasPending || recoveryDraft.revision !== timeline.revision);
    setUncertain(recoveryDraft.wasPending); focusStep("review"); dismissRecovery(); setStatus("Your unfinished moment is restored.");
  }
  function validThrough(target: EditorStep) {
    const index = target === "review" ? 6 : target;
    if (index > 0 && (!/^\d{4}$/.test(form.year) || Number(form.year) < 1900 || Number(form.year) > 2200)) {
      focusStep(0); setError("Add a four-digit year between 1900 and 2200. An approximate year is fine."); return false;
    }
    if (index > 1 && !form.title.trim()) { focusStep(1); setError("Give this moment a short title."); return false; }
    return true;
  }
  function go(next: EditorStep) {
    if (disabled || !validThrough(next)) return;
    setError(""); focusStep(next);
  }
  function advance() {
    if (step === "review") return;
    go(step === 5 ? "review" : step + 1);
  }
  async function submitStep(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (step !== "review") { advance(); return; }
    await save();
  }
  async function save() {
    if (disabled || needsReview || !dirty || !validThrough("review")) return;
    if (editingId && !selected) { setNeedsReview(true); setError("This moment is no longer on your timeline. Review the latest moments before saving."); return; }
    setPending(true); setError("");
    const entry = { clientKey: editingId ?? "new", createdOrder: selected?.position ?? timeline.entries.length + 1,
      position: selected?.position ?? timeline.entries.length + 1, id: editingId, year: Number(form.year), month: form.month ? Number(form.month) : null,
      title: form.title, details: form.details, meaning: form.meaning ?? "", belief: form.belief ?? "", presentImpact: form.presentImpact ?? "", perspective: form.perspective ?? "" };
    const entries = fromMemberTimelineEntries(timeline.entries);
    const next = selected ? entries.map(item => item.id === editingId ? entry : item) : [...entries, entry];
    try {
      const saved = await adapter.save(toTimelineSaveEntries(next), timeline);
      const savedEntry = selected ? saved.entries.find(item => item.id === editingId) : saved.entries.find(item => !timeline.entries.some(old => old.id === item.id));
      if (!savedEntry) throw new TimelineSaveUncertainError("The save response could not be matched. Load the latest moments before trying again.");
      clearDraft(); setTimeline(saved); setEditingId(savedEntry.id); setForm(formFor(savedEntry)); setBaseline(formFor(savedEntry));
      focusStep("review");
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
        setEditingId(entry?.id ?? null); setForm(formFor(entry)); setBaseline(formFor(entry)); focusStep(entry ? "review" : 0);
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
    const blob = new Blob([JSON.stringify({ title: "Ruined Timeline · Foundations", savedMoments: timeline.entries, unfinishedMoment: dirty || needsReview ? { id: editingId, ...form } : null }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "ruined-private-timeline.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <article className={styles.experience}>
    <header className={styles.header}>
      <div><Link className={styles.back} href="/my/foundations/timeline"><Arrow back /> Full timeline</Link><h1>Your story.<span> In perspective.</span></h1><p>A moment, the story it became, and what you can see now.</p></div>
      <div className={styles.headerActions}>
        <span className={styles.private}><Lock /> {preview ? "Preview · only here" : "Only you"}</span>
        <details className={styles.options}><summary aria-label="Timeline options">···</summary><div><button onClick={downloadDraft}>Download private copy</button><button disabled={pending} onClick={() => void loadLatest()}>Load latest moments</button></div></details>
      </div>
    </header>
    {preview ? <p className={styles.previewNote}>Example moments. You can try every question here. Nothing is saved to an account.</p> : null}
    {recoveryDraft ? <aside className={styles.recovery}><div><h2>Pick up where you left off.</h2><p>Your unfinished moment is here.</p></div><button onClick={restore}>Restore draft</button><button onClick={dismissRecovery}>Discard recovered draft</button></aside> : null}
    <div className={styles.workspace}>
      <aside className={styles.moments} aria-label="Your saved timeline moments">
        <div className={styles.railHeading}><h2>Your moments <span>{timeline.entries.length}</span></h2><button className={styles.add} disabled={disabled} onClick={() => open()} aria-label="Add a moment"><span aria-hidden="true">+</span></button></div>
        {timeline.entries.length > 6 ? <input className={styles.search} type="search" aria-label="Find a moment" placeholder="Find a moment…" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(40); }} /> : null}
        {!timeline.entries.length ? <div className={styles.empty}><span aria-hidden="true">↗</span><p>A beginning.<br />A turning point.<br />Anything that stayed.</p><small>Start anywhere. You can come back to the rest.</small></div> : null}
        {timeline.entries.length > 0 && !matchingEntries.length ? <p className={styles.noResults}>No moments found.</p> : null}
        <ol>{matchingEntries.slice(0, visibleCount).map(entry => <li key={entry.id}><button className={styles.momentCard} disabled={pending || Boolean(recoveryDraft)} aria-current={editingId === entry.id ? "true" : undefined} onClick={() => open(entry)}>
          <span className={styles.cardTop}><time dateTime={String(entry.year)}>{formatTimelineDate(entry)}</time>{entry.perspective?.trim() ? <span className={styles.check} aria-label="Perspective added"><Check /></span> : <span className={styles.cardDot} aria-hidden="true" />}</span>
          <strong>{entry.title}</strong><span className={styles.cardBottom}>{editingId === entry.id ? "Open now" : "Revisit moment"}<Arrow /></span>
        </button></li>)}</ol>
        {visibleCount < matchingEntries.length ? <button className={styles.more} onClick={() => setVisibleCount(count => count + 40)}>Show more moments</button> : null}
        <p className={styles.railNote}><Lock /> These reflections stay private.</p>
      </aside>
      {missingRequested || (!allowEdit && !selected) ? <section className={styles.editor} aria-label="Timeline moment unavailable"><h2>{missingRequested ? "This moment isn’t available." : "No saved moments yet."}</h2><p>{missingRequested ? "It may have been removed from your private timeline. Choose another moment to revisit." : "Your saved Foundations moments will appear here."}</p>{allowEdit ? <button type="button" className={styles.backStep} onClick={() => open()}>Start a new moment <Arrow /></button> : null}</section> : null}
      <form ref={formElement} className={styles.editor} hidden={missingRequested || (!allowEdit && !selected)} onSubmit={submitStep} noValidate aria-label="Explore a timeline moment">
        {step !== "review" ? <div className={styles.editorTop}>
          <div className={styles.stepCaption}><span>{STEPS[step]}</span><span>Question {step + 1} of 6</span></div>
          <nav className={styles.steps} aria-label="Questions in this moment">{STEPS.map((label, index) => <button key={label} type="button" aria-label={`Question ${index + 1}: ${label}`} aria-current={step === index ? "step" : undefined} data-past={step > index} disabled={disabled} onClick={() => go(index)}><span>{index + 1}</span></button>)}</nav>
        </div> : null}
        <section className={styles.question} data-tone="date" hidden={step !== 0} aria-label="When was this?">
          <span className={styles.overline}>Place a pin in your story</span><h2 tabIndex={-1} data-step-heading="0">When was this?</h2><p className={styles.hint}>An approximate year is enough. You don’t need to remember the exact date.</p>
          <div className={styles.date}><label htmlFor="foundation-year">Year<input id="foundation-year" inputMode="numeric" maxLength={4} required disabled={disabled} value={form.year} onChange={event => change("year", event.target.value)} placeholder="e.g. 2019" /></label><label htmlFor="foundation-month">Month <span>optional</span><select id="foundation-month" disabled={disabled} value={form.month} onChange={event => change("month", event.target.value)}><option value="">Year only</option>{TIMELINE_MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></label></div>
          <button type="button" className={styles.today} disabled={disabled} onClick={() => { const now = new Date(); change("year", String(now.getFullYear())); change("month", String(now.getMonth() + 1)); }}>It’s happening now <Arrow /></button>
        </section>
        <section className={styles.question} data-tone="moment" hidden={step !== 1} aria-label="What happened?">
          <span className={styles.overline}>{form.year || "The moment itself"}</span><h2 tabIndex={-1} data-step-heading="1">What happened?</h2><p className={styles.hint}>Start with the moment itself. The meaning can come next.</p>
          <label className={styles.fieldLabel} htmlFor="foundation-event">Give it a name<input id="foundation-event" maxLength={200} required disabled={disabled} value={form.title} onChange={event => change("title", event.target.value)} placeholder="A move. A conversation. A new beginning." /></label>
          <label className={styles.fieldLabel} htmlFor="foundation-details">A little context <span>optional</span><textarea id="foundation-details" rows={4} maxLength={Math.max(4000, selected?.details?.length ?? 0)} disabled={disabled} value={form.details} onChange={event => change("details", event.target.value)} placeholder="What do you remember?" /></label>
        </section>
        {REFLECTIONS.map((item, index) => <section key={item.field} className={styles.question} data-tone={item.field} hidden={step !== index + 2} aria-label={item.label}>
          <div className={styles.context}><span>{form.year}</span><span>{form.title}</span></div>
          <span className={styles.overline}>{item.chapter}</span><h2 tabIndex={-1} data-step-heading={index + 2}><label htmlFor={`foundation-${item.field}`}>{item.label}</label></h2><p className={styles.hint}>{item.hint}</p>
          <textarea id={`foundation-${item.field}`} rows={6} maxLength={4000} disabled={disabled} value={form[item.field] ?? ""} onChange={event => change(item.field, event.target.value)} placeholder={item.placeholder} aria-describedby={`hint-${item.field}`} />
          <p id={`hint-${item.field}`} className={styles.optional}>A few words are enough. You can leave this open and return later.</p>
        </section>)}
        <section className={styles.story} hidden={step !== "review"} aria-label="Your moment in perspective">
          <div className={styles.storyTop}><span className={styles.overline}>{reviewingDraft ? "Read it back" : "Your moment, in perspective"}</span><span className={styles.private}><Lock /> Private</span></div>
          <h2 className={styles.storyTitle} tabIndex={-1} data-step-heading="review">{form.title || "An unfinished moment"}</h2><p className={styles.storyDate}>{form.year ? formatTimelineDate({ year: Number(form.year), month: Number(form.month) || null }, true) : "Date not added"}</p>
          {form.details ? <p className={styles.storyContext}>{form.details}</p> : null}
          {allowEdit ? <div className={styles.storyActions}><button type="button" disabled={disabled} onClick={() => go(0)}>{reviewingDraft ? "Edit the moment" : "Edit story"}<Arrow /></button>{firstUnanswered !== -1 ? <button type="button" disabled={disabled} onClick={() => go(firstUnanswered + 2)}>Continue exploring <Arrow /></button> : null}</div> : null}
          <div className={styles.storyReflections}>{REFLECTIONS.map((item, index) => <div key={item.field} className={styles.storyReflection} data-tone={item.field} data-empty={!form[item.field]?.trim()}><div><h3>{item.chapter}</h3>{allowEdit ? <button type="button" disabled={disabled} onClick={() => go(index + 2)} aria-label={`Edit ${item.short.toLowerCase()}`}>{form[item.field]?.trim() ? "Edit" : "Explore"}<Arrow /></button> : null}</div><p>{form[item.field]?.trim() || "Still open. There’s room to come back to this."}</p></div>)}</div>
          <p className={styles.storyFoot}>{answered ? `${answered} of 4 reflections explored.` : "The moment is a starting point."} Nothing has to be resolved to save it.</p>
        </section>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {needsReview ? <aside className={styles.review}><h2>Review before saving.</h2>{!reviewLoaded ? <button disabled={pending} type="button" onClick={() => void loadLatest()}>Load latest saved moments</button> : <>
          {selected ? <><p>Currently saved: <strong>{selected.title}</strong> · {formatTimelineDate(selected)}</p><p className={styles.savedText}>{selected.details || "No details added."}</p>{REFLECTIONS.map(item => <p className={styles.savedText} key={item.field}>{item.short}: {selected[item.field] || "Not added."}</p>)}<button type="button" onClick={keepDraft}>Keep my draft for this moment</button></> : uncertain ? <p>The save may have reached your timeline. Download your draft, then discard it here and open the matching saved moment above. Review the list before adding it again.</p> : <><p>This moment is no longer on your timeline.</p><button type="button" onClick={keepDraft}>Keep draft as a new moment</button></>}
        </>}</aside> : null}
        <div className={styles.saveRow}>
          {step !== "review" ? <><button className={styles.backStep} type="button" disabled={disabled || step === 0} onClick={() => go(step - 1)}><Arrow back /> Back</button><div className={styles.saveActions}>{step >= 2 && !form[REFLECTIONS[step - 2].field]?.trim() ? <button className={styles.skip} type="button" disabled={disabled} onClick={advance}>Skip for now</button> : null}<button className={styles.save} type="button" disabled={disabled} onClick={event => { event.preventDefault(); advance(); }}>{step === 5 ? "Read my story" : "Continue"}<Arrow /></button></div></> : <><span className={styles.saveState}><span className={styles.stateDot} data-dirty={dirty || needsReview} aria-hidden="true" />{pending ? "Saving…" : needsReview ? "Review needed" : dirty ? "Unsaved changes" : !allowEdit ? "Read only" : preview ? "Preview only" : !selected ? "New moment" : "Saved to your timeline"}</span>{allowEdit ? <button className={styles.save} type="submit" disabled={disabled || !dirty || needsReview} aria-label={preview ? "Save in preview" : "Save to my timeline"}>{pending ? "Saving…" : "Save moment"}{pending ? null : <Check />}</button> : null}</>}
        </div>
        <p className={styles.status} role="status">{status}</p>
        <div className={styles.afterword}><div>{dirty || needsReview ? <button className={styles.discard} type="button" disabled={pending} onClick={() => ask({ kind: "discard" })} aria-label="Discard draft">Discard draft</button> : <span>Only for you. Go at your own pace.</span>}{step !== "review" && (step >= 2 || selected) ? <button type="button" disabled={disabled} onClick={() => go("review")}>Review & save what I have</button> : null}</div>{nextMoment && !dirty && !needsReview && step === "review" ? <button type="button" disabled={pending || Boolean(recoveryDraft)} onClick={() => open(nextMoment)}>Next moment <Arrow /></button> : null}</div>
      </form>
    </div>
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby="foundation-confirm-title" onCancel={event => { event.preventDefault(); setConfirmation(null); }}>
      <h2 id="foundation-confirm-title">{confirmation?.kind === "leave" ? "Leave this moment?" : "Discard this draft?"}</h2><p>{confirmation?.kind === "leave" ? preview ? "This is a preview. Leaving will reset the examples and unfinished writing." : memberNavigation ? "You have unsaved writing. Stay to save it to your timeline. Your draft stays available while you move around the member area." : "Leaving the member area will lose this unfinished draft. Stay to save it to your timeline first." : "Your saved timeline will stay as it is. Only these unfinished changes will be discarded."}</p><div><button ref={cancelButton} type="button" onClick={() => setConfirmation(null)}>Keep writing</button><button type="button" onClick={confirm}>{confirmation?.kind === "leave" ? !preview && memberNavigation ? "Leave with draft" : "Leave without saving" : "Discard draft"}</button></div>
    </dialog>
  </article>;
}
