"use client";

import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import TimelineExportStudio from "@/components/membership/TimelineExportStudio";
import {
  EMPTY_TIMELINE_FORM,
  TIMELINE_EXAMPLES,
  TIMELINE_LIMITS,
  TIMELINE_MONTHS,
  formatTimelineDate,
  filterTimelineEntries,
  groupTimelineEntries,
  type TimelineReadingOrder,
  formForTimelineEntry,
  fromMemberTimelineEntries,
  restoreDeletedTimelineEntry,
  sortTimelineEntries,
  timelineFormIsDirty,
  toTimelineSaveEntries,
  type TimelineDraftEntry,
  type TimelineFormValue,
} from "@/components/membership/timeline-model";
import type { MemberTimelineSnapshot } from "@/lib/membership/model";
import { createTimelinePersistenceAdapter, TimelineConflictError, TimelineSaveUncertainError } from "./timeline-persistence";

import useTimelineDraftGuard from "./useTimelineDraftGuard";

import styles from "./ruined-timeline.module.css";

type TimelineMode = "examples" | "user";
type PersistenceState = "error" | "saved" | "saving" | "session";
type ErrorField = "details" | "month" | "title" | "year" | null;
type UndoState = { entry: TimelineDraftEntry } | null;

function makeClientKey() {
  return crypto.randomUUID();
}

function summaryFor(entries: TimelineDraftEntry[], examples: boolean) {
  if (!entries.length) return "Your private record";
  if (examples) return `EXAMPLE / ${entries.length} MOMENTS / NOT YOURS`;
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const span = first.year === last.year ? String(first.year) : `${first.year}—${last.year}`;
  return `${entries.length} ${entries.length === 1 ? "MOMENT" : "MOMENTS"} / ${span}`;
}

export default function RuinedTimeline({
  initialTimeline,
  preview = false,
  writable,
}: {
  initialTimeline: MemberTimelineSnapshot;
  preview?: boolean;
  writable: boolean;
}) {
  const hasMemberEntries = initialTimeline.entries.length > 0 && !preview;
  const initialEntries = hasMemberEntries
    ? sortTimelineEntries(fromMemberTimelineEntries(initialTimeline.entries))
    : preview ? TIMELINE_EXAMPLES.map((entry) => ({ ...entry })) : [];
  const [timeline, setTimeline] = useState(() => ({
    ...initialTimeline,
    completedAt: preview ? null : initialTimeline.completedAt,
  }));
  const [entries, setEntries] = useState<TimelineDraftEntry[]>(initialEntries);
  const [mode, setMode] = useState<TimelineMode>(preview ? "examples" : "user");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState<TimelineFormValue>(EMPTY_TIMELINE_FORM);
  const [baseline, setBaseline] = useState<TimelineFormValue>(EMPTY_TIMELINE_FORM);
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [uncertainSave, setUncertainSave] = useState(false);
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [persistence, setPersistence] = useState<PersistenceState>(
    preview ? "session" : "saved",
  );
  const [pending, setPending] = useState<"complete" | "reload" | "save" | null>(null);
  const [recentlySavedKey, setRecentlySavedKey] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [readingOrder, setReadingOrder] = useState<TimelineReadingOrder>("oldest");
  const [visibleCount, setVisibleCount] = useState(40);
  const titleRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const indexRef = useRef<HTMLDivElement>(null);
  const rawId = useId().replaceAll(":", "");
  const errorId = `${rawId}-error`;
  const editorId = `${rawId}-editor`;
  const exportId = `${rawId}-export`;
  const visibleEntries = useMemo(() => filterTimelineEntries(entries, search, selectedYear, readingOrder), [entries, search, selectedYear, readingOrder]);
  const yearGroups = groupTimelineEntries(visibleEntries.slice(0, visibleCount));
  const years = [...new Set(entries.map(entry => entry.year))].sort((a, b) => b - a);
  const dirty = timelineFormIsDirty(form, baseline);
  const adapter = useMemo(
    () => createTimelinePersistenceAdapter({ preview, writable }),
    [preview, writable],
  );
  const sortedEntries = useMemo(() => sortTimelineEntries(entries), [entries]);
  const examples = mode === "examples";
  const { recoveryDraft, dismissRecovery, clearDraft } = useTimelineDraftGuard({
    enabled: writable && !preview,
    dirty,
    pending: Boolean(pending),
    form,
    baseline,
    editingEntryId: entries.find(entry => entry.clientKey === editingKey)?.id ?? null,
    revision: timeline.revision,
  });
  const needsReload = conflicted || uncertainSave;
  const canInteract = (writable || preview) && !needsReload && !recoveryDraft;

  function restoreDraft() {
    if (!recoveryDraft) return;
    const original = entries.find(entry => entry.id === recoveryDraft.editingEntryId);
    setForm(recoveryDraft.form);
    setBaseline(recoveryDraft.baseline);
    setEditingKey(original?.clientKey ?? null);
    setEditorOpen(true);
    setConflicted(recoveryDraft.revision !== timeline.revision);
    setUncertainSave(recoveryDraft.wasPending);
    setLiveMessage("Draft restored. Review your saved moments before saving.");
    dismissRecovery();
    focusYear();
  }

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => {
      setUndo(null);
      setLiveMessage("Undo window closed.");
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    if (!recentlySavedKey) return;
    const timer = window.setTimeout(() => setRecentlySavedKey(null), 1800);
    return () => window.clearTimeout(timer);
  }, [recentlySavedKey]);

  function focusYear() {
    window.requestAnimationFrame(() => {
      yearRef.current?.focus({ preventScroll: true });
      yearRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    });
  }

  function focusIndexEntry(clientKey: string | null) {
    if (!clientKey) return;
    window.requestAnimationFrame(() => {
      indexRef.current
        ?.querySelector<HTMLElement>(`[data-index-key="${CSS.escape(clientKey)}"]`)
        ?.focus();
    });
  }

  function focusTitle() {
    window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
  }

  function revealMoment(clientKey: string, savedEntries: TimelineDraftEntry[]) {
    setSearch("");
    setSelectedYear("");
    const index = filterTimelineEntries(savedEntries, "", "", readingOrder).findIndex(entry => entry.clientKey === clientKey);
    setVisibleCount(current => Math.max(current, index + 1));
    focusIndexEntry(clientKey);
  }

  function resetForm({ focus = false }: { focus?: boolean } = {}) {
    setEditingKey(null);
    setForm(EMPTY_TIMELINE_FORM);
    setBaseline(EMPTY_TIMELINE_FORM);
    setError(null);
    setErrorField(null);
    if (focus) focusYear();
  }

  function blockForDirtyForm() {
    if (!dirty) return false;
    setError("Save or cancel this event before opening another moment.");
    setErrorField(null);
    formRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    return true;
  }

  function startTimeline() {
    if (!canInteract || pending) return;
    setMode("user");
    setEditorOpen(true);
    setEntries([]);
    setUndo(null);
    resetForm({ focus: true });
    setPersistence(preview ? "session" : "saved");
    setLiveMessage("Example events cleared. Add your first event.");
  }

  function prepareNewEvent() {
    if (!canInteract || pending || blockForDirtyForm()) return;
    if (examples) {
      startTimeline();
      return;
    }
    setEditorOpen(true);
    resetForm({ focus: true });
  }

  function beginEdit(entry: TimelineDraftEntry) {
    if (!canInteract || examples || pending || blockForDirtyForm()) return;
    setEditorOpen(true);
    const value = formForTimelineEntry(entry);
    setEditingKey(entry.clientKey);
    setForm(value);
    setBaseline(value);
    setError(null);
    setErrorField(null);
    focusYear();
  }

  function cancelForm() {
    if (pending || (dirty && !window.confirm("Discard this unfinished moment?"))) return;
    const focusKey = editingKey;
    clearDraft();
    resetForm();
    setEditorOpen(false);
    setLiveMessage(editingKey ? "Changes cancelled." : "New moment cleared.");
    if (focusKey) focusIndexEntry(focusKey);
    else window.requestAnimationFrame(() => addRef.current?.focus());
  }

  function useThisMonth() {
    const now = new Date();
    const date = { year: String(now.getFullYear()), month: String(now.getMonth() + 1) };
    setForm(current => ({ ...current, ...date }));
    if (!editingKey && !form.title && !form.details) setBaseline(current => ({ ...current, ...date }));
    setError(null);
    setErrorField(null);
    focusTitle();
  }

  function validateForm() {
    if (!/^\d{4}$/.test(form.year)) {
      return {
        field: "year" as const,
        message: "Use a four-digit year, like 2019.",
      };
    }
    const year = Number(form.year);
    if (year < TIMELINE_LIMITS.minimumYear || year > TIMELINE_LIMITS.maximumYear) {
      return {
        field: "year" as const,
        message: `Use a year between ${TIMELINE_LIMITS.minimumYear} and ${TIMELINE_LIMITS.maximumYear}.`,
      };
    }
    if (form.month !== "" && !/^(?:[1-9]|1[0-2])$/.test(form.month)) {
      return { field: "month" as const, message: "Choose a month, or leave this as a year only." };
    }
    if (!form.title.trim()) {
      return { field: "title" as const, message: "Give this moment a short title." };
    }
    if (form.title.trim().length > TIMELINE_LIMITS.title) {
      return {
        field: "title" as const,
        message: `Keep the title to ${TIMELINE_LIMITS.title} characters or fewer.`,
      };
    }
    if (form.details.trim().length > TIMELINE_LIMITS.details) {
      return {
        field: "details" as const,
        message: `Keep the details to ${TIMELINE_LIMITS.details} characters or fewer.`,
      };
    }
    return null;
  }

  function normalizeSavedEntries(
    saved: MemberTimelineSnapshot,
    optimistic: TimelineDraftEntry[],
  ) {
    const orderedOptimistic = sortTimelineEntries(optimistic);
    return saved.entries.map((entry) => {
      // New and restored moments receive their position on the server. Match
      // the single new draft by identity, never by its old reading position.
      const local = orderedOptimistic.find(local => local.id === entry.id)
        ?? orderedOptimistic.find(local => local.id === null);
      return {
        clientKey: local?.clientKey ?? entry.id,
        createdOrder: entry.position,
        details: entry.details ?? "",
        id: entry.id,
        month: entry.month ?? null,
        position: entry.position,
        title: entry.title,
        year: entry.year,
      };
    });
  }

  async function persistEntries(
    nextEntries: TimelineDraftEntry[],
    successMessage: string,
  ) {
    if (!canInteract || pending) return null;
    const previousEntries = entries;
    const optimistic = sortTimelineEntries(nextEntries);
    setEntries(optimistic);
    setPending("save");
    setPersistence("saving");
    setError(null);
    setErrorField(null);
    try {
      const saved = await adapter.save(toTimelineSaveEntries(optimistic), timeline);
      const normalized = normalizeSavedEntries(saved, optimistic);
      setTimeline(saved);
      setEntries(normalized);
      setPersistence(preview ? "session" : "saved");
      setLiveMessage(successMessage);
      return normalized;
    } catch (requestError) {
      setEntries(previousEntries);
      setPersistence("error");
      setConflicted(requestError instanceof TimelineConflictError);
      setUncertainSave(requestError instanceof TimelineSaveUncertainError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Your Timeline could not be saved.",
      );
      return null;
    } finally {
      setPending(null);
    }
  }

  async function loadLatestEvents() {
    if (pending) return;
    const editedId = entries.find((entry) => entry.clientKey === editingKey)?.id;
    setPending("reload");
    try {
      const latest = await adapter.load(timeline);
      const latestEntries = sortTimelineEntries(fromMemberTimelineEntries(latest.entries));
      const latestEdited = latestEntries.find((entry) => entry.id === editedId);
      setTimeline(latest);
      setEntries(latestEntries);
      setMode("user");
      // Keep the typed draft. If another tab removed its original event, it
      // becomes a new-event draft; nothing is automatically merged or saved.
      setEditingKey(latestEdited?.clientKey ?? null);
      setBaseline(latestEdited ? formForTimelineEntry(latestEdited) : EMPTY_TIMELINE_FORM);
      setUndo(null);
      setConflicted(false);
      setUncertainSave(false);
      setError(null);
      setPersistence("saved");
      setLiveMessage("Latest events loaded. Your draft is still in the form. Review it before saving.");
      focusYear();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The latest events could not be loaded.");
    } finally {
      setPending(null);
    }
  }

  async function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canInteract || pending) return;
    const validation = validateForm();
    if (validation) {
      setError(validation.message);
      setErrorField(validation.field);
      const target = formRef.current?.elements.namedItem(validation.field);
      if (target instanceof HTMLElement) {
        target.focus();
        target.scrollIntoView({ behavior: "auto", block: "center" });
      }
      return;
    }

    const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter;
    const addAnother = submitter?.getAttribute("data-add-another") === "true" && !editingKey;
    const existing = editingKey
      ? entries.find((entry) => entry.clientKey === editingKey) ?? null
      : null;
    const clientKey = existing?.clientKey ?? makeClientKey();
    const nextEntry: TimelineDraftEntry = {
      clientKey,
      createdOrder: existing?.createdOrder ?? Date.now(),
      details: form.details.trim(),
      id: existing?.id ?? null,
      month: form.month === "" ? null : Number(form.month),
      position: existing?.position ?? entries.length + 1,
      title: form.title.trim(),
      year: Number(form.year),
    };
    const wasExamples = examples;
    const nextEntries = wasExamples
      ? [nextEntry]
      : existing
        ? entries.map((entry) =>
            entry.clientKey === existing.clientKey ? nextEntry : entry,
          )
        : [...entries, nextEntry];

    setMode("user");
    const savedEntries = await persistEntries(
      nextEntries,
      existing ? `${nextEntry.title} updated.` : `${nextEntry.title} added.`,
    );
    if (!savedEntries) {
      if (wasExamples) setMode("examples");
      return;
    }
    clearDraft();
    setRecentlySavedKey(clientKey);
    if (addAnother) {
      const blank = { ...EMPTY_TIMELINE_FORM, year: form.year, month: form.month };
      setEditingKey(null);
      setForm(blank);
      setBaseline(blank);
      focusTitle();
    } else {
      resetForm();
      setEditorOpen(false);
      revealMoment(clientKey, savedEntries);
    }
  }

  async function removeEditingEvent() {
    if (!editingKey || pending) return;
    const removed = entries.find((entry) => entry.clientKey === editingKey);
    if (!removed) return;
    const nextEntries = entries.filter((entry) => entry.clientKey !== editingKey);
    const savedEntries = await persistEntries(
      nextEntries,
      `${removed.title} removed. Undo is available for seven seconds.`,
    );
    if (!savedEntries) return;
    const nextFocus = savedEntries.at(-1)?.clientKey ?? null;
    setUndo({ entry: removed });
    clearDraft();
    resetForm();
    setEditorOpen(false);
    focusIndexEntry(nextFocus);
  }

  async function undoDelete() {
    if (!undo || pending) return;
    const restored = restoreDeletedTimelineEntry(undo.entry);
    const savedEntries = await persistEntries(
      [...entries, restored],
      `${restored.title} restored.`,
    );
    if (!savedEntries) return;
    setUndo(null);
    setRecentlySavedKey(restored.clientKey);
    revealMoment(restored.clientKey, savedEntries);
  }

  async function completeTimeline() {
    if (!canInteract || pending || examples || !entries.length || dirty || timeline.completedAt) return;
    setPending("complete");
    setError(null);
    setErrorField(null);
    try {
      const completed = await adapter.complete(timeline);
      setTimeline(completed);
      setLiveMessage("Timeline completion recorded.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Timeline completion could not be saved.",
      );
    } finally {
      setPending(null);
    }
  }

  const status = uncertainSave
    ? "SAVE NOT CONFIRMED"
    : examples
    ? "EXAMPLE / NOT SAVED"
    : persistence === "saving"
      ? "SAVING / PRIVATE RECORD"
      : dirty
        ? "UNSAVED CHANGES"
        : persistence === "error"
          ? "NOT SAVED"
          : preview || persistence === "session"
            ? "PREVIEW / THIS SESSION"
            : "SAVED / PRIVATE MEMBER RECORD";
  const titleCountVisible = form.title.length >= Math.floor(TIMELINE_LIMITS.title * 0.8);
  const detailsCountVisible = form.details.length >= Math.floor(TIMELINE_LIMITS.details * 0.8);

  return (
    <section aria-labelledby={`${rawId}-title`} className={`member-journey-page member-timeline-page ${styles.root}`}>
      <header className={styles.readingHeader}>
        <div>
          <p className={styles.kicker}>PRIVATE / YOUR STORY</p>
          <h1 className={styles.readingTitle} id={`${rawId}-title`}>My Timeline</h1>
          <p className={styles.readingMeta}>{summaryFor(sortedEntries, examples)}</p>
        </div>
        <div className={styles.readingActions}>
          {writable || preview ? <button aria-controls={editorId} aria-expanded={editorOpen} className={`${styles.button} ${styles.primaryButton}`} disabled={Boolean(pending) || needsReload || Boolean(recoveryDraft)} onClick={editorOpen ? focusYear : prepareNewEvent} ref={addRef} type="button">{editorOpen ? "Continue writing" : "+ Add moment"}</button> : null}
          {entries.length > 0 ? <button aria-controls={exportId} aria-expanded={exportOpen} className={styles.readingTextButton} onClick={() => setExportOpen(current => !current)} type="button">{exportOpen ? "Close export" : "Export timeline"} <span aria-hidden="true">↗</span></button> : null}
        </div>
      </header>

      {examples ? <p className={styles.readingNotice}>An example timeline. Your moments stay private when you build your own.</p> : null}
      <p className={styles.readingSaveStatus} role="status">{status}</p>
      {error ? <p className={styles.error} id={errorId} role="alert">{error}</p> : null}
      {recoveryDraft ? <div className={styles.readingNotice} role="status">
        <p>You have an unfinished moment from earlier in this visit.</p>
        <div className={styles.readingActions}><button className={styles.button} onClick={restoreDraft} type="button">Restore draft</button><button className={styles.readingTextButton} onClick={dismissRecovery} type="button">Discard draft</button></div>
      </div> : null}
      {needsReload ? <div className={styles.readingNotice}>
        <p>{uncertainSave ? "A save may have completed. Load your latest moments and check for this moment before trying again." : "Your timeline changed in another tab. Your draft is still here."}</p>
        <button className={styles.button} disabled={Boolean(pending)} onClick={loadLatestEvents} type="button">{pending === "reload" ? "Loading latest moments" : "Load latest saved moments"}</button>
      </div> : null}

      <div className={styles.readingLayout} data-editing={editorOpen || undefined}>
        <section aria-label="Your saved moments" className={styles.reader}>
          {entries.length >= 8 || search || selectedYear ? <div className={styles.readingFilters}>
            <label className={styles.searchField} htmlFor={`${rawId}-search`}><span>Find a moment</span><input id={`${rawId}-search`} onChange={event => { setSearch(event.target.value); setVisibleCount(40); }} placeholder="Search your story" type="search" value={search}/></label>
            <label htmlFor={`${rawId}-filter-year`}><span>Year</span><select id={`${rawId}-filter-year`} onChange={event => { setSelectedYear(event.target.value); setVisibleCount(40); }} value={selectedYear}><option value="">All years</option>{years.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
            <label htmlFor={`${rawId}-order`}><span>Order</span><select id={`${rawId}-order`} onChange={event => { setReadingOrder(event.target.value as TimelineReadingOrder); setVisibleCount(40); }} value={readingOrder}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>
          </div> : null}
          {(search || selectedYear) && entries.length > 0 ? <div className={styles.filterSummary}><p role="status">{visibleEntries.length} {visibleEntries.length === 1 ? "moment" : "moments"} found</p><button className={styles.readingTextButton} onClick={() => { setSearch(""); setSelectedYear(""); setVisibleCount(40); }} type="button">Clear filters</button></div> : null}

          <div ref={indexRef}>
            {yearGroups.map(group => <section aria-labelledby={`${rawId}-year-${group.year}`} className={styles.yearGroup} key={group.year}>
              <h2 className={styles.yearHeading} id={`${rawId}-year-${group.year}`}>{group.year}</h2>
              <ol className={styles.moments}>
                {group.entries.map(entry => <li className={styles.moment} data-recent={recentlySavedKey === entry.clientKey || undefined} key={entry.clientKey}>
                  <details className={styles.momentStory}>
                    <summary data-index-key={entry.clientKey}>
                      <time className={styles.momentDate} dateTime={entry.month ? `${entry.year}-${String(entry.month).padStart(2, "0")}` : String(entry.year)} aria-label={formatTimelineDate(entry, true)}>{formatTimelineDate(entry)}</time>
                      <span className={styles.momentTitle}>{entry.title}</span>
                      <span aria-hidden="true" className={styles.momentToggle}>+</span>
                    </summary>
                    {entry.details ? <p className={styles.momentDetails}>{entry.details}</p> : <p className={styles.momentEmpty}>{examples ? "An example moment." : "A moment worth keeping."}</p>}
                  {!examples && (writable || preview) ? <button aria-label={`Edit ${entry.title}`} className={styles.momentEdit} disabled={!canInteract || Boolean(pending)} onClick={() => beginEdit(entry)} type="button">Edit</button> : null}
                  </details>
                </li>)}
              </ol>
            </section>)}
          </div>
          {visibleEntries.length > visibleCount ? <button className={`${styles.button} ${styles.moreMoments}`} onClick={() => setVisibleCount(current => current + 40)} type="button">Show more moments <span>{Math.min(visibleCount, visibleEntries.length)} of {visibleEntries.length}</span></button> : null}
          {!entries.length ? <div className={styles.readingEmpty}><p className={styles.emptyHand}>Your story starts anywhere.</p><h2>Start with one moment.</h2><p>A beginning, a change, a choice. Add what you remember.</p>{writable || preview ? <button className={`${styles.button} ${styles.primaryButton}`} disabled={Boolean(pending) || needsReload || Boolean(recoveryDraft)} onClick={prepareNewEvent} type="button">Add your first moment</button> : <p>No moments saved yet.</p>}</div> : !visibleEntries.length ? <p className={styles.noResults}>No moments match. Try another word or year.</p> : null}
          {undo ? <div className={styles.readingUndo}><span role="status">{undo.entry.title} removed.</span><button className={styles.readingTextButton} disabled={Boolean(pending)} onClick={undoDelete} type="button">Undo</button></div> : null}
        </section>

        {editorOpen ? <aside className={styles.readingEditor} id={editorId}>
          <form aria-describedby={error ? errorId : undefined} className={styles.eventForm} noValidate onKeyDown={event => { if (event.key === "Escape" && !pending) { event.preventDefault(); cancelForm(); } }} onSubmit={submitEvent} ref={formRef}>
            <div className={styles.editorHeading}><h2>{editingKey ? "Edit moment" : "Add a moment"}</h2><button aria-label="Close moment editor" className={styles.editorClose} disabled={Boolean(pending)} onClick={cancelForm} type="button">×</button></div>
            <div className={styles.compactFields}>
              <div className={styles.field}><label className={styles.captureLabel} htmlFor={`${rawId}-year`}>Year</label><input aria-describedby={errorField === "year" ? errorId : undefined} aria-invalid={errorField === "year" || undefined} autoComplete="off" className={styles.captureControl} enterKeyHint="next" id={`${rawId}-year`} inputMode="numeric" maxLength={4} name="year" onChange={event => { setForm(current => ({ ...current, year: event.target.value })); setError(null); setErrorField(null); }} placeholder="2019" readOnly={Boolean(pending) || (!writable && !preview)} ref={yearRef} required type="text" value={form.year}/></div>
              <div className={styles.field}><label className={styles.captureLabel} htmlFor={`${rawId}-month`}>Month <small>Optional</small></label><select aria-describedby={errorField === "month" ? errorId : undefined} aria-invalid={errorField === "month" || undefined} className={styles.captureControl} disabled={Boolean(pending) || (!writable && !preview)} id={`${rawId}-month`} name="month" onChange={event => { setForm(current => ({ ...current, month: event.target.value })); setError(null); setErrorField(null); }} value={form.month}><option value="">Year only</option>{TIMELINE_MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></div>
            </div>
            <button className={styles.thisMonth} disabled={Boolean(pending)} onClick={useThisMonth} type="button">Use this month ↗</button>
            <div className={styles.field}><label className={styles.captureLabel} htmlFor={`${rawId}-title-field`}>Title {titleCountVisible ? <small>{form.title.length} / {TIMELINE_LIMITS.title}</small> : null}</label><input aria-describedby={errorField === "title" ? errorId : undefined} aria-invalid={errorField === "title" || undefined} autoComplete="off" className={styles.captureControl} enterKeyHint="next" id={`${rawId}-title-field`} maxLength={TIMELINE_LIMITS.title} name="title" onChange={event => { setForm(current => ({ ...current, title: event.target.value })); setError(null); setErrorField(null); }} placeholder="What happened?" readOnly={Boolean(pending) || (!writable && !preview)} ref={titleRef} required value={form.title}/></div>
            <div className={styles.field}><label className={styles.captureLabel} htmlFor={`${rawId}-details`}>Details <small>Optional</small></label><textarea aria-describedby={errorField === "details" ? errorId : undefined} aria-invalid={errorField === "details" || undefined} className={styles.captureControl} id={`${rawId}-details`} maxLength={TIMELINE_LIMITS.details} name="details" onChange={event => { setForm(current => ({ ...current, details: event.target.value })); setError(null); setErrorField(null); }} placeholder="What do you want to remember?" readOnly={Boolean(pending) || (!writable && !preview)} rows={5} value={form.details}/>{detailsCountVisible ? <p className={styles.characterCount}>{form.details.length} / {TIMELINE_LIMITS.details}</p> : null}</div>
            <div className={styles.captureActions}><button className={`${styles.button} ${styles.primaryButton}`} disabled={!canInteract || Boolean(pending)} type="submit">{pending === "save" ? "Saving…" : editingKey ? "Save changes" : "Save moment"}</button>{!editingKey ? <button className={styles.button} data-add-another="true" disabled={!canInteract || Boolean(pending)} type="submit">Save &amp; add another</button> : null}<button className={styles.readingTextButton} disabled={Boolean(pending)} onClick={cancelForm} type="button">Cancel</button>{editingKey ? <button className={`${styles.readingTextButton} ${styles.captureRemove}`} disabled={!canInteract || Boolean(pending)} onClick={removeEditingEvent} type="button">Remove moment</button> : null}</div>
          </form>
        </aside> : null}
      </div>

      {!examples && entries.length > 0 ? <footer className={styles.readingFooter}>{timeline.completedAt ? <p>Foundations step complete. Your story keeps going.</p> : writable ? <><p>Ready to bring your timeline into Foundations?</p><button className={styles.readingTextButton} disabled={Boolean(pending) || needsReload || dirty || Boolean(recoveryDraft)} onClick={completeTimeline} type="button">{pending === "complete" ? "Recording…" : "Complete Foundations step"}</button></> : <p>Your timeline is available to read and export.</p>}</footer> : null}
      {exportOpen ? <section aria-label="Export your timeline" className={styles.readingExport} id={exportId}><TimelineExportStudio entries={sortedEntries} examples={examples}/></section> : null}
      <p aria-live="polite" className={styles.srOnly}>{liveMessage}</p>
    </section>
  );
}
