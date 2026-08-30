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

import styles from "./ruined-timeline.module.css";

type TimelineMode = "examples" | "user";
type PersistenceState = "error" | "saved" | "saving" | "session";
type ErrorField = "details" | "title" | "year" | null;
type UndoState = { entry: TimelineDraftEntry } | null;
type TimelineSaveEntry = ReturnType<typeof toTimelineSaveEntries>[number];

interface TimelinePersistenceAdapter {
  complete(current: MemberTimelineSnapshot): Promise<MemberTimelineSnapshot>;
  save(
    entries: TimelineSaveEntry[],
    current: MemberTimelineSnapshot,
  ): Promise<MemberTimelineSnapshot>;
}

function createTimelinePersistenceAdapter({
  preview,
  writable,
}: {
  preview: boolean;
  writable: boolean;
}): TimelinePersistenceAdapter {
  if (preview) {
    return {
      async complete(current) {
        return { ...current, completedAt: new Date().toISOString() };
      },
      async save(entries, current) {
        return {
          ...current,
          entries: entries.map((entry, index) => ({
            details: entry.details,
            id: entry.id ?? `preview-${crypto.randomUUID()}`,
            position: index + 1,
            title: entry.title,
            year: entry.year,
          })),
        };
      },
    };
  }

  return {
    async complete(current) {
      if (!writable) throw new Error("This Timeline is read-only.");
      const response = await fetch("/api/my/timeline", {
        body: JSON.stringify({ action: "complete" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        requirements?: { timeline?: { completedAt?: string | null } };
      };
      const completedAt = payload.requirements?.timeline?.completedAt ?? null;
      if (!response.ok || !completedAt) {
        throw new Error(payload.error || "Timeline completion could not be saved.");
      }
      return { ...current, completedAt };
    },
    async save(entries) {
      if (!writable) throw new Error("This Timeline is read-only.");
      const response = await fetch("/api/my/timeline", {
        body: JSON.stringify({ action: "save", entries }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        timeline?: MemberTimelineSnapshot;
      };
      if (!response.ok || !payload.timeline) {
        throw new Error(payload.error || "Your Timeline could not be saved.");
      }
      return payload.timeline;
    },
  };
}

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
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [persistence, setPersistence] = useState<PersistenceState>(
    preview ? "session" : "saved",
  );
  const [pending, setPending] = useState<"complete" | "save" | null>(null);
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
  const canInteract = writable || preview;

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

  const status = examples
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
                if (event.key === "Escape" && (editingKey || dirty)) {
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
                  rows={4}
                  value={form.details}
                />
                {detailsCountVisible ? (
                  <p className={styles.characterCount}>{form.details.length} / {TIMELINE_LIMITS.details}</p>
                ) : null}
              </div>

              {error ? <p className={styles.error} id={errorId} role="alert">{error}</p> : null}

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
                  <p>Add a year and title to begin.</p>
                  <button className={styles.button} onClick={prepareNewEvent} type="button">Add first event</button>
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
                  {timeline.completedAt
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
