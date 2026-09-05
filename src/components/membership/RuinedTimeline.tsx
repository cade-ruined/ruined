"use client";

import Link from "next/link";
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

import styles from "./ruined-timeline.module.css";

type TimelineMode = "examples" | "user";
type PersistenceState = "error" | "saved" | "saving" | "session";
type ErrorField = "details" | "title" | "year" | null;
type UndoState = { entry: TimelineDraftEntry } | null;

function makeClientKey() {
  return crypto.randomUUID();
}

function summaryFor(entries: TimelineDraftEntry[], examples: boolean) {
  if (!entries.length) return "NO EVENTS YET";
  if (examples) return `EXAMPLE / ${entries.length} EVENTS / NOT YOURS`;
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const span = first.year === last.year ? String(first.year) : `${first.year}—${last.year}`;
  return `${entries.length} ${entries.length === 1 ? "EVENT" : "EVENTS"} / ${span}`;
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
  const hasMemberEntries = !preview && initialTimeline.entries.length > 0;
  const initialEntries = hasMemberEntries
    ? sortTimelineEntries(fromMemberTimelineEntries(initialTimeline.entries))
    : TIMELINE_EXAMPLES.map((entry) => ({ ...entry }));
  const [timeline, setTimeline] = useState(() => ({
    ...initialTimeline,
    completedAt: preview ? null : initialTimeline.completedAt,
  }));
  const [entries, setEntries] = useState<TimelineDraftEntry[]>(initialEntries);
  const [mode, setMode] = useState<TimelineMode>(hasMemberEntries ? "user" : "examples");
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
  const [listExpanded, setListExpanded] = useState(true);
  const yearRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const indexRef = useRef<HTMLOListElement>(null);
  const rawId = useId().replaceAll(":", "");
  const errorId = `${rawId}-error`;
  const listContentId = `${rawId}-index-content`;
  const dirty = timelineFormIsDirty(form, baseline);
  const adapter = useMemo(
    () => createTimelinePersistenceAdapter({ preview, writable }),
    [preview, writable],
  );
  const sortedEntries = useMemo(() => sortTimelineEntries(entries), [entries]);
  const examples = mode === "examples";
  const needsReload = conflicted || uncertainSave;
  const canInteract = (writable || preview) && !needsReload;

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty]);

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
        ?.querySelector<HTMLButtonElement>(`[data-index-key="${CSS.escape(clientKey)}"]`)
        ?.focus();
    });
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
    resetForm({ focus: true });
  }

  function beginEdit(entry: TimelineDraftEntry) {
    if (!canInteract || examples || pending || blockForDirtyForm()) return;
    const value = formForTimelineEntry(entry);
    setEditingKey(entry.clientKey);
    setForm(value);
    setBaseline(value);
    setError(null);
    setErrorField(null);
    focusYear();
  }

  function cancelForm() {
    const focusKey = editingKey;
    resetForm();
    setLiveMessage(editingKey ? "Changes cancelled." : "New event cleared.");
    focusIndexEntry(focusKey);
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
    return saved.entries.map((entry, index) => {
      const local = orderedOptimistic[index];
      return {
        clientKey: local?.clientKey ?? entry.id,
        createdOrder: local?.createdOrder ?? entry.position,
        details: entry.details ?? "",
        id: entry.id,
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

    const existing = editingKey
      ? entries.find((entry) => entry.clientKey === editingKey) ?? null
      : null;
    const clientKey = existing?.clientKey ?? makeClientKey();
    const nextEntry: TimelineDraftEntry = {
      clientKey,
      createdOrder: existing?.createdOrder ?? Date.now(),
      details: form.details.trim(),
      id: existing?.id ?? null,
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
    setRecentlySavedKey(clientKey);
    setListExpanded(true);
    resetForm();
    focusIndexEntry(clientKey);
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
    resetForm();
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
    setListExpanded(true);
    focusIndexEntry(restored.clientKey);
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
    <main aria-labelledby={`${rawId}-title`} className={styles.root}>
      <section aria-label="Timeline events and image generator" className={styles.app}>
        <div className={styles.setup}>
          <aside className={styles.editor}>
            <form
              aria-describedby={error ? errorId : undefined}
              className={styles.eventForm}
              noValidate
              onKeyDown={(event) => {
                if (event.key === "Escape" && !pending && (editingKey || dirty)) {
                  event.preventDefault();
                  cancelForm();
                }
              }}
              onSubmit={submitEvent}
              ref={formRef}
            >
              <p className={styles.kicker}>
                {editingKey
                  ? `EDITING / EVENT ${String(sortedEntries.findIndex((entry) => entry.clientKey === editingKey) + 1).padStart(2, "0")}`
                  : "ADD EVENT"}
              </p>
              <h1 className={styles.uiHeading} id={`${rawId}-title`}>
                {editingKey ? "Edit event" : "Add an event"}
              </h1>

              <div className={styles.compactFields}>
                <div className={styles.field}>
                  <label className={styles.formLabel} htmlFor={`${rawId}-year`}>
                    <span>01</span><span>Year</span>
                  </label>
                  <input
                    aria-describedby={errorField === "year" ? errorId : undefined}
                    aria-invalid={errorField === "year" || undefined}
                    autoComplete="off"
                    className={styles.formControl}
                    enterKeyHint="next"
                    id={`${rawId}-year`}
                    inputMode="numeric"
                    max={TIMELINE_LIMITS.maximumYear}
                    min={TIMELINE_LIMITS.minimumYear}
                    name="year"
                    onChange={(event) => {
                      setForm((current) => ({ ...current, year: event.target.value }));
                      setError(null);
                      setErrorField(null);
                    }}
                    placeholder="2019"
                    readOnly={Boolean(pending) || (!writable && !preview)}
                    ref={yearRef}
                    required
                    type="text"
                    value={form.year}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.formLabel} htmlFor={`${rawId}-title-field`}>
                    <span>02</span><span>Title</span>
                    {titleCountVisible ? <small>{form.title.length} / {TIMELINE_LIMITS.title}</small> : null}
                  </label>
                  <input
                    aria-describedby={errorField === "title" ? errorId : undefined}
                    aria-invalid={errorField === "title" || undefined}
                    autoComplete="off"
                    className={styles.formControl}
                    enterKeyHint="next"
                    id={`${rawId}-title-field`}
                    maxLength={TIMELINE_LIMITS.title}
                    name="title"
                    onChange={(event) => {
                      setForm((current) => ({ ...current, title: event.target.value }));
                      setError(null);
                      setErrorField(null);
                    }}
                    placeholder="What happened"
                    readOnly={Boolean(pending) || (!writable && !preview)}
                    required
                    value={form.title}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.formLabel} htmlFor={`${rawId}-details`}>
                  <span>03</span><span>Details</span><small>Optional</small>
                </label>
                <textarea
                  aria-describedby={errorField === "details" ? errorId : undefined}
                  aria-invalid={errorField === "details" || undefined}
                  className={styles.formControl}
                  id={`${rawId}-details`}
                  maxLength={TIMELINE_LIMITS.details}
                  name="details"
                  onChange={(event) => {
                    setForm((current) => ({ ...current, details: event.target.value }));
                    setError(null);
                    setErrorField(null);
                  }}
                  placeholder="What made this moment matter?"
                  readOnly={Boolean(pending) || (!writable && !preview)}
                  rows={4}
                  value={form.details}
                />
                {detailsCountVisible ? (
                  <p className={styles.characterCount}>{form.details.length} / {TIMELINE_LIMITS.details}</p>
                ) : null}
              </div>

              {error ? <p className={styles.error} id={errorId} role="alert">{error}</p> : null}
              {needsReload ? (
                <div>
                  <p className={styles.error}>{uncertainSave ? "The save may have completed. Review the saved events below before retrying this draft." : "Another tab saved changes. Your draft is still here."}</p>
                  <button className={styles.button} disabled={Boolean(pending)} onClick={loadLatestEvents} type="button">
                    {pending === "reload" ? "Loading latest events" : "Load latest saved events"}
                  </button>
                </div>
              ) : null}
              {!writable && !preview ? <p>Your Timeline is read-only. You can still view and export your events below.</p> : null}

              <div className={styles.formActions}>
                <button
                  className={`${styles.button} ${styles.primaryButton}`}
                  disabled={!canInteract || Boolean(pending)}
                  type="submit"
                >
                  {pending === "save"
                    ? "Saving"
                    : editingKey
                      ? "Save changes"
                      : "Add event"}
                </button>
                {editingKey || dirty ? (
                  <button
                    className={styles.textButton}
                    disabled={Boolean(pending)}
                    onClick={cancelForm}
                    type="button"
                  >
                    Cancel
                  </button>
                ) : null}
                {editingKey ? (
                  <button
                    className={`${styles.textButton} ${styles.removeButton}`}
                    disabled={Boolean(pending)}
                    onClick={removeEditingEvent}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </form>
          </aside>

          <section aria-labelledby={`${rawId}-index-title`} className={styles.indexPanel}>
            <div className={styles.indexHeading}>
              <div>
                <p className={styles.kicker}>LIST</p>
                <h2 className={styles.uiHeading} id={`${rawId}-index-title`}>
                  {examples ? "Example events" : "Your events"}
                </h2>
              </div>
              <div className={styles.indexHeadingTools}>
                <p className={styles.status}><span aria-hidden="true" />{status}</p>
                <button
                  aria-controls={listContentId}
                  aria-expanded={listExpanded}
                  className={styles.listToggle}
                  onClick={() => setListExpanded((current) => !current)}
                  type="button"
                >
                  {listExpanded ? "Collapse list" : "Expand list"}
                  <span aria-hidden="true" className={styles.listToggleMark}>
                    {listExpanded ? "−" : "+"}
                  </span>
                </button>
              </div>
            </div>

            <div className={styles.indexMeta}>
              <p>{summaryFor(sortedEntries, examples)}</p>
            </div>

            <div hidden={!listExpanded} id={listContentId}>
              {sortedEntries.length ? (
                <ol className={styles.indexList} ref={indexRef}>
                  {sortedEntries.map((entry, index) => {
                    return (
                      <li className={styles.indexItem} key={entry.clientKey}>
                        <div className={styles.indexContent}>
                          <span className={styles.indexNumber}>{String(index + 1).padStart(2, "0")}</span>
                          <span className={styles.indexDate}>{entry.year}</span>
                          <span className={styles.indexCopy}>
                            <span className={styles.indexTitle}>{entry.title}</span>
                            {entry.details ? <span className={styles.indexDetail}>{entry.details}</span> : null}
                          </span>
                          <span className={styles.indexReturn}>
                            {recentlySavedKey === entry.clientKey ? "SAVED" : examples ? "EXAMPLE" : ""}
                          </span>
                        </div>
                        {!examples ? (
                          <button
                            aria-label={`Edit ${entry.title}`}
                            className={styles.indexRevise}
                            data-index-key={entry.clientKey}
                            disabled={!canInteract || Boolean(pending)}
                            onClick={() => beginEdit(entry)}
                            type="button"
                          >
                            Edit
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className={styles.emptyIndex}>
                  <p>{writable || preview ? "Add a year and title to begin." : "No events saved."}</p>
                  {writable || preview ? <button className={styles.button} disabled={!canInteract || Boolean(pending)} onClick={prepareNewEvent} type="button">Add first event</button> : null}
                </div>
              )}

              {undo ? (
                <div className={styles.undo}>
                  <span role="status">{undo.entry.title} removed.</span>
                  <button disabled={Boolean(pending)} onClick={undoDelete} type="button">Undo</button>
                </div>
              ) : null}
            </div>

            <div className={styles.listFooter}>
              <div>
                <p className={styles.kicker}>FOUNDATIONS</p>
                <p>
                  {!writable && !preview
                    ? "Your saved Timeline is available to view and export."
                    : timeline.completedAt
                      ? "Completion recorded. You can still edit your events."
                      : "When the list feels true enough, mark it complete."}
                </p>
              </div>
              <div className={styles.listFooterActions}>
                <Link href="/my/foundations">Back to Foundations</Link>
                <button
                  className={`${styles.button} ${styles.primaryButton}`}
                  disabled={!canInteract || Boolean(pending) || examples || !entries.length || dirty || Boolean(timeline.completedAt)}
                  onClick={completeTimeline}
                  type="button"
                >
                  {pending === "complete" ? "Recording" : timeline.completedAt ? "Completed" : "Mark complete"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <TimelineExportStudio entries={sortedEntries} examples={examples} />

        <p aria-live="polite" className={styles.srOnly}>{liveMessage}</p>
      </section>
    </main>
  );
}
