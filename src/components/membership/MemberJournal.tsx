"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  JOURNAL_BODY_LENGTH, JOURNAL_MAX_IMAGES, JOURNAL_MEDIA_ACCEPT, journalFilePolicy,
  type JournalEntry, type JournalKind, type JournalSnapshot,
} from "@/lib/membership/journal-model";
import { TIMELINE_MONTHS, type TimelineDraftEntry } from "./timeline-model";
import TimelineExportStudio from "./TimelineExportStudio";
import useJournalDraftGuard from "./useJournalDraftGuard";
import type { JournalDraft } from "./MemberJournalDraftState";
import styles from "./MemberJournal.module.css";

type ReadingMode = "all" | "timeline";
type Page = JournalSnapshot & { nextCursor?: string | null; total?: number; years?: number[] };
class JournalRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function readJournalResponse<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(90_000), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new JournalRequestError(result.error || "Something went wrong. Please try again.", response.status);
  return result as T;
}
const jsonRequest = (method: string, value: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const blankDraft = (): JournalDraft => ({ kind: "text", title: "", body: "", eventYear: "", eventMonth: "", eventDay: "", includeOnTimeline: false, files: [], keptMedia: [], editingId: null, editingVersion: null, attempted: false, draftId: "", uploadIds: [] });
function draftFor(entry: JournalEntry): JournalDraft {
  return { ...blankDraft(), kind: entry.kind, title: entry.title ?? "", body: entry.body ?? "", eventYear: entry.eventYear == null ? "" : String(entry.eventYear), eventMonth: entry.eventMonth == null ? "" : String(entry.eventMonth), eventDay: entry.eventDay == null ? "" : String(entry.eventDay), includeOnTimeline: entry.includeOnTimeline, keptMedia: entry.media, editingId: entry.id, editingVersion: entry.version, draftId: entry.id };
}
function signature(draft: JournalDraft) {
  return JSON.stringify([draft.kind, draft.title, draft.body, draft.eventYear, draft.eventMonth, draft.eventDay, draft.includeOnTimeline, draft.keptMedia.map(item => item.id), draft.files.map(file => [file.name, file.size, file.lastModified])]);
}
function eventDate(entry: Pick<JournalEntry, "eventYear" | "eventMonth" | "eventDay">) {
  if (!entry.eventYear) return null;
  const month = entry.eventMonth ? TIMELINE_MONTHS[entry.eventMonth - 1]?.slice(0, 3) : null;
  return month ? `${month}${entry.eventDay ? ` ${entry.eventDay},` : ""} ${entry.eventYear}` : String(entry.eventYear);
}
function postedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
function dateValue(entry: JournalEntry) {
  return entry.eventYear ? `${entry.eventYear}${entry.eventMonth ? `-${String(entry.eventMonth).padStart(2, "0")}${entry.eventDay ? `-${String(entry.eventDay).padStart(2, "0")}` : ""}` : ""}` : entry.createdAt;
}
function entryTitle(entry: JournalEntry) { return entry.title || entry.body?.slice(0, 90) || "A moment, kept."; }
function validateDraft(draft: JournalDraft) {
  if (draft.eventYear && (!/^\d{4}$/.test(draft.eventYear) || +draft.eventYear < 1900 || +draft.eventYear > 2200)) return "Use a year between 1900 and 2200.";
  if (draft.eventMonth && !draft.eventYear) return "Add a year with this month.";
  if (draft.eventDay && (!draft.eventMonth || !draft.eventYear)) return "Add a month and year with this day.";
  if (draft.eventDay) {
    const day = +draft.eventDay, date = new Date(Date.UTC(+draft.eventYear, +draft.eventMonth - 1, day));
    if (!/^\d{1,2}$/.test(draft.eventDay) || day < 1 || date.getUTCMonth() !== +draft.eventMonth - 1) return "Choose a valid day for this month.";
  }
  if (draft.includeOnTimeline && (!draft.title.trim() || !draft.eventYear)) return "Give your timeline moment a title and a year. Month and day are optional.";
  if (draft.kind === "text" && !draft.title.trim() && !draft.body.trim()) return "Add a title or a few words.";
  const count = draft.files.length + draft.keptMedia.length;
  if (draft.kind === "images" && (count < 1 || count > JOURNAL_MAX_IMAGES)) return "Choose up to eight images.";
  if (draft.kind === "video" && count !== 1) return "Choose one video.";
  return null;
}
const previewEntries: JournalEntry[] = [
  { id: "example-image", kind: "images", title: "A moment, kept.", body: "A photograph and a few words can belong to the same story.", createdAt: "2026-08-27T12:00:00Z", saved: false, eventYear: 2026, eventMonth: 8, eventDay: null, includeOnTimeline: true, version: "1", media: [{ id: "example-photo", mimeType: "image/webp", size: 0, url: "/membership/portrait-pending-editorial.webp" }] },
  { id: "example-text", kind: "text", title: "Making room.", body: "What stays when you take away everything that does not belong?", createdAt: "2026-08-26T12:00:00Z", saved: true, eventYear: null, eventMonth: null, eventDay: null, includeOnTimeline: false, version: "1", media: [] },
  { id: "example-moment", kind: "text", title: "Moved somewhere new", body: "A new city. New rooms. No familiar faces.", createdAt: "2026-08-25T12:00:00Z", saved: false, eventYear: 2014, eventMonth: null, eventDay: null, includeOnTimeline: true, version: "1", media: [] },
];
function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = previous; };
    }
    if (dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className={styles.dialogBody}><header className={styles.dialogHeader}><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="Close">×</button></header>{children}</div></dialog>;
}

export default function MemberJournal({ preview, writable, view = "journal", initialMode = "all", onModeChange }: { preview: boolean; writable: boolean; view?: "journal" | "saved"; initialMode?: ReadingMode; onModeChange?: (mode: ReadingMode) => void }) {
  const [mode, setMode] = useState<ReadingMode>(initialMode);
  const timelineView = view === "journal" && mode === "timeline";
  const [entries, setEntries] = useState<JournalEntry[]>(preview ? previewEntries : []);
  const [previewData, setPreviewData] = useState(previewEntries);
  const [loading, setLoading] = useState(!preview), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [mediaReady, setMediaReady] = useState(preview), [hasMore, setHasMore] = useState(false), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]), [total, setTotal] = useState(0), [reload, setReload] = useState(0);
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [year, setYear] = useState(""), [order, setOrder] = useState<"oldest" | "newest">("oldest");
  const [composer, setComposer] = useState(false), [draft, setDraft] = useState<JournalDraft>(blankDraft), [baseline, setBaseline] = useState(signature(blankDraft()));
  const [dateOpen, setDateOpen] = useState(false), [draftError, setDraftError] = useState(""), [pending, setPending] = useState(false);
  const [needsReview, setNeedsReview] = useState(false), [latestSaved, setLatestSaved] = useState<JournalEntry | null>(null);
  const [selected, setSelected] = useState<JournalEntry | null>(null), [imageIndex, setImageIndex] = useState(0), [mediaError, setMediaError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null), [fileUrls, setFileUrls] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false), [exportEntries, setExportEntries] = useState<TimelineDraftEntry[]>([]), [exportLoading, setExportLoading] = useState(false), [exportError, setExportError] = useState("");
  const [completedAt, setCompletedAt] = useState<string | null>(null), [canComplete, setCanComplete] = useState(false), [completing, setCompleting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false), listVersion = useRef(0), savedUrls = useRef<string[]>([]), exportRequest = useRef(0), active = useRef(true), id = useId();
  const dirty = signature(draft) !== baseline;
  const { ownerId, recoveryDraft, dismissRecovery, clearDraft } = useJournalDraftGuard({ enabled: writable && !preview, dirty: dirty || draft.attempted, pending: pending && Boolean(draft.draftId), draft });
  const requestJson = useCallback(<T,>(url: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (ownerId) headers.set("x-ruined-session-owner", ownerId);
    return readJournalResponse<T>(url, { ...init, headers });
  }, [ownerId]);
  useEffect(() => { setMode(initialMode); }, [initialMode]);
  useEffect(() => { if (composer) window.requestAnimationFrame(() => titleRef.current?.focus()); }, [composer]);
  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { const urls = draft.files.map(file => URL.createObjectURL(file)); setFileUrls(urls); return () => urls.forEach(url => URL.revokeObjectURL(url)); }, [draft.files]);
  useEffect(() => { active.current = true; const urls = savedUrls.current; return () => { active.current = false; urls.forEach(url => URL.revokeObjectURL(url)); }; }, []);
  const listUrl = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams();
    if (view === "saved") params.set("saved", "true");
    if (timelineView) { params.set("view", "timeline"); params.set("order", order); }
    if (query) params.set("search", query);
    if (year) params.set("year", year);
    if (cursor) params.set("before", cursor);
    return `/api/my/journal?${params}`;
  }, [view, timelineView, order, query, year]);
  useEffect(() => {
    listVersion.current += 1;
    if (preview) {
      const filtered = previewData.filter(entry => (view !== "saved" || entry.saved) && (!timelineView || entry.includeOnTimeline) && (!year || String(entry.eventYear) === year) && (!query || `${entry.title}\n${entry.body}\n${eventDate(entry)}`.toLowerCase().includes(query.toLowerCase())));
      filtered.sort((a, b) => timelineView ? (order === "oldest" ? 1 : -1) * ((a.eventYear ?? 0) - (b.eventYear ?? 0) || (a.eventMonth ?? 13) - (b.eventMonth ?? 13) || (a.eventDay ?? 32) - (b.eventDay ?? 32)) : b.createdAt.localeCompare(a.createdAt));
      setEntries(filtered); setTotal(filtered.length); setYears([...new Set(previewData.flatMap(entry => entry.eventYear ? [entry.eventYear] : []))].sort((a, b) => b - a)); setLoading(false); return;
    }
    const abort = new AbortController(); setLoading(true); setEntries([]); setHasMore(false); setTotal(0); setError("");
    requestJson<Page>(listUrl(), { signal: abort.signal }).then(data => {
      if (abort.signal.aborted) return;
      setEntries(data.entries); setHasMore(data.hasMore); setNextCursor(data.nextCursor ?? data.entries.at(-1)?.id ?? null); setMediaReady(data.mediaReady); setTotal(data.total ?? data.entries.length); setYears(data.years ?? []);
    }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [preview, previewData, listUrl, reload, view, timelineView, order, query, year, requestJson]);
  useEffect(() => {
    if (!timelineView || preview) return;
    const abort = new AbortController(); setCanComplete(false);
    requestJson<{ timeline: { completedAt: string | null; access: { capabilities?: string[] } } }>("/api/my/timeline", { signal: abort.signal }).then(data => { if (!abort.signal.aborted) { setCompletedAt(data.timeline.completedAt); setCanComplete(writable && Boolean(data.timeline.access.capabilities?.includes("foundations.write"))); } }).catch(() => { /* Journal remains usable independently of Foundations. */ });
    return () => abort.abort();
  }, [timelineView, preview, writable, reload, requestJson]);
  useEffect(() => { exportRequest.current += 1; setExportOpen(false); setExportEntries([]); setExportError(""); setExportLoading(false); }, [reload]);
  const patchDraft = (patch: Partial<JournalDraft>) => { setDraft(current => ({ ...current, ...patch })); setDraftError(""); };
  function changeMode(value: ReadingMode) { setMode(value); setSearch(""); setQuery(""); setYear(""); onModeChange?.(value); }
  function installDraft(value: JournalDraft) { setDraft(value); setBaseline(signature(value)); setDateOpen(Boolean(value.eventYear) || value.includeOnTimeline); setDraftError(""); setNeedsReview(false); setLatestSaved(null); }
  function addEntry() {
    if (!writable || pending || recoveryDraft) return;
    if (!dirty && !draft.attempted) installDraft({ ...blankDraft(), draftId: crypto.randomUUID(), includeOnTimeline: timelineView });
    setComposer(true);
  }
  function editEntry(entry: JournalEntry) {
    if (!writable || pending || recoveryDraft) return;
    if ((dirty || draft.attempted) && draft.editingId !== entry.id) { setNotice("Finish or discard your current draft before editing another entry."); setSelected(null); setComposer(true); return; }
    if (!dirty && !draft.attempted) installDraft(draftFor(entry));
    setSelected(null); setComposer(true);
  }
  function restoreDraft() {
    if (!recoveryDraft) return;
    const { wasPending, ...value } = recoveryDraft;
    setDraft(value); setBaseline("recovered-draft"); setDateOpen(Boolean(value.eventYear) || value.includeOnTimeline); setNeedsReview(wasPending || value.attempted); setComposer(true); dismissRecovery();
    if (wasPending || value.attempted) setDraftError("A save may have completed. Check the saved entry before continuing.");
  }
  function discardDraft() {
    if (pending || ((dirty || draft.attempted) && !window.confirm("Discard this unfinished entry?"))) return;
    clearDraft(); installDraft(blankDraft()); setComposer(false);
  }
  function changeKind(kind: JournalKind) {
    if (kind === draft.kind) return;
    if ((draft.files.length || draft.keptMedia.length) && !window.confirm("Changing entry type will remove these attachments from this draft. Continue?")) return;
    patchDraft({ kind, files: [], keptMedia: [], uploadIds: [] });
  }
  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    try {
      const next = [...draft.files, ...Array.from(incoming)];
      if (next.length + draft.keptMedia.length > (draft.kind === "images" ? JOURNAL_MAX_IMAGES : 1)) throw Error(draft.kind === "images" ? "Choose up to eight images." : "Remove the current video before choosing another.");
      for (const file of next) if (journalFilePolicy(file.type, file.size) !== draft.kind) throw Error("Choose the matching media type.");
      patchDraft({ files: next });
    } catch (cause) { setDraftError(cause instanceof Error ? cause.message : "Choose a supported file."); }
  }
  function rememberEntry(entry: JournalEntry) {
    if (preview) setPreviewData(current => [entry, ...current.filter(item => item.id !== entry.id)]);
    setSelected(current => current?.id === entry.id ? entry : current);
    setReload(value => value + 1);
  }
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current || !writable || needsReview) return;
    const problem = validateDraft(draft); if (problem) { setDraftError(problem); return; }
    const addAnother = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-add-another") === "true" && !draft.editingId;
    busy.current = true; setPending(true); setDraftError("");
    const working = { ...draft, draftId: draft.draftId || crypto.randomUUID(), uploadIds: [...draft.uploadIds] };
    setDraft(working);
    try {
      let entry: JournalEntry;
      if (preview) {
        entry = { id: working.editingId || working.draftId, kind: working.kind, title: working.title.trim() || null, body: working.body.trim() || null, createdAt: previewData.find(item => item.id === working.editingId)?.createdAt ?? new Date().toISOString(), saved: previewData.find(item => item.id === working.editingId)?.saved ?? false, eventYear: working.eventYear ? +working.eventYear : null, eventMonth: working.eventMonth ? +working.eventMonth : null, eventDay: working.eventDay ? +working.eventDay : null, includeOnTimeline: working.includeOnTimeline, version: String(Number(working.editingVersion ?? "0") + 1), media: [...working.keptMedia, ...working.files.map(file => { const url = URL.createObjectURL(file); savedUrls.current.push(url); return { id: crypto.randomUUID(), mimeType: file.type, size: file.size, url }; })] };
      } else {
        for (const file of working.files) {
          if (working.uploadIds.some(([uploaded]) => uploaded === file)) continue;
          const upload = await requestJson<{ id: string; signedUrl: string }>("/api/my/journal/media", jsonRequest("POST", { mimeType: file.type, size: file.size }));
          const data = new FormData(); data.append("cacheControl", "0"); data.append("", file);
          const response = await fetch(upload.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, signal: AbortSignal.timeout(180_000), body: data });
          if (!response.ok) throw Error("An upload could not finish. Your draft is still here; please try again.");
          working.uploadIds.push([file, upload.id]);
          if (active.current) setDraft(current => ({ ...current, uploadIds: [...working.uploadIds] }));
        }
        working.attempted = true; if (active.current) setDraft(current => ({ ...current, attempted: true }));
        const fields = { kind: working.kind, title: working.title, body: working.body, mediaIds: [...working.keptMedia.map(item => item.id), ...working.files.map(file => working.uploadIds.find(([uploaded]) => uploaded === file)![1])], eventYear: working.eventYear ? +working.eventYear : null, eventMonth: working.eventMonth ? +working.eventMonth : null, eventDay: working.eventDay ? +working.eventDay : null, includeOnTimeline: working.includeOnTimeline };
        const result = working.editingId
          ? await requestJson<{ entry: JournalEntry }>(`/api/my/journal/${working.editingId}`, jsonRequest("PATCH", { action: "edit", expectedVersion: working.editingVersion, ...fields }))
          : await requestJson<{ entry: JournalEntry }>("/api/my/journal", jsonRequest("POST", { id: working.draftId, ...fields }));
        entry = result.entry;
      }
      clearDraft(); if (!active.current) return;
      rememberEntry(entry); setNotice(working.editingId ? "Entry updated everywhere it appears." : working.includeOnTimeline ? "Added to your journal and timeline." : "Added to your journal.");
      if (addAnother) { installDraft({ ...blankDraft(), draftId: crypto.randomUUID(), eventYear: working.eventYear, eventMonth: working.eventMonth, eventDay: working.eventDay, includeOnTimeline: working.includeOnTimeline }); window.requestAnimationFrame(() => titleRef.current?.focus()); }
      else { installDraft(blankDraft()); setComposer(false); }
    } catch (cause) {
      if (!active.current) return;
      if (cause instanceof JournalRequestError && cause.status >= 400 && cause.status < 500 && cause.status !== 409) patchDraft({ attempted: false });
      if (cause instanceof JournalRequestError && cause.status === 409) setNeedsReview(true);
      setDraftError(cause instanceof Error ? cause.message : "Your draft is still here. Please try again.");
    } finally { busy.current = false; if (active.current) setPending(false); }
  }
  async function loadLatest() {
    if (pending) return; setPending(true); setDraftError("");
    try {
      const { entry } = await requestJson<{ entry: JournalEntry }>(`/api/my/journal/${draft.editingId || draft.draftId}`);
      setLatestSaved(entry); setDraft(current => ({ ...current, editingId: entry.id, editingVersion: entry.version, draftId: entry.id, attempted: false }));
      setNeedsReview(false); setReload(value => value + 1);
    } catch (cause) {
      if (cause instanceof JournalRequestError && cause.status === 404 && !draft.editingId) { patchDraft({ attempted: false }); setNeedsReview(false); setDraftError("This entry has not been saved yet. Your draft is ready to retry."); }
      else setDraftError(cause instanceof Error ? cause.message : "The saved entry could not be loaded.");
    } finally { setPending(false); }
  }
  async function toggleSaved(entry: JournalEntry) {
    if (savingId || !writable) return; setSavingId(entry.id); setError("");
    try { const updated = preview ? { ...entry, saved: !entry.saved } : (await requestJson<{ entry: JournalEntry }>(`/api/my/journal/${entry.id}`, jsonRequest("PATCH", { saved: !entry.saved }))).entry; rememberEntry(updated); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save entry."); }
    finally { setSavingId(null); }
  }
  async function deleteEntry(entry: JournalEntry) {
    if (pending || !writable || !window.confirm("Delete this entry from your journal, timeline, and saved entries?")) return;
    setPending(true); setError("");
    try {
      if (!preview) await requestJson(`/api/my/journal/${entry.id}`, jsonRequest("DELETE", { expectedVersion: entry.version }));
      else setPreviewData(current => current.filter(item => item.id !== entry.id));
      if (draft.editingId === entry.id) { clearDraft(); installDraft(blankDraft()); }
      setSelected(null); setReload(value => value + 1); setNotice("Entry deleted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This entry could not be deleted."); }
    finally { setPending(false); }
  }
  async function loadMore() {
    if (loading || !hasMore || !nextCursor) return;
    const version = listVersion.current; setLoading(true); setError("");
    try {
      const data = await requestJson<Page>(listUrl(nextCursor));
      if (version !== listVersion.current) return;
      setEntries(current => [...current, ...data.entries.filter(item => !current.some(old => old.id === item.id))]); setHasMore(data.hasMore); setNextCursor(data.nextCursor ?? data.entries.at(-1)?.id ?? null);
    } catch (cause) { if (version === listVersion.current) setError(cause instanceof Error ? cause.message : "Could not load entries."); }
    finally { if (version === listVersion.current) setLoading(false); }
  }
  async function openExport() {
    if (exportOpen) { exportRequest.current += 1; setExportOpen(false); setExportLoading(false); return; }
    setExportOpen(true); setExportLoading(true); setExportError("");
    const version = ++exportRequest.current;
    try {
      const source = preview ? previewData.filter(entry => entry.includeOnTimeline) : (await requestJson<{ entries: JournalEntry[] }>("/api/my/journal/export")).entries;
      if (version !== exportRequest.current || !active.current) return;
      setExportEntries(source.map((entry, index) => ({ id: entry.id, clientKey: entry.id, createdOrder: index, position: index + 1, year: entry.eventYear!, month: entry.eventMonth, day: entry.eventDay, title: entry.title || entryTitle(entry), details: entry.body || "" })));
    } catch (cause) { if (version === exportRequest.current && active.current) setExportError(cause instanceof Error ? cause.message : "Your export could not load."); }
    finally { if (version === exportRequest.current && active.current) setExportLoading(false); }
  }
  async function completeTimeline() {
    if (completing || pending || dirty) return; setCompleting(true); setError("");
    try { const data = await requestJson<{ requirements: { timeline: { completedAt: string } } }>("/api/my/timeline", jsonRequest("POST", { action: "complete" })); setCompletedAt(data.requirements.timeline.completedAt); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Completion could not be saved."); }
    finally { setCompleting(false); }
  }
  const groups = useMemo(() => {
    // A view switch can render the previous list before its loading effect runs.
    // Group by identity, not adjacency, and never treat an unmarked entry as a milestone.
    const byYear = new Map<number, JournalEntry[]>();
    for (const entry of entries) {
      if (!entry.includeOnTimeline || entry.eventYear === null) continue;
      const group = byYear.get(entry.eventYear);
      if (group) group.push(entry);
      else byYear.set(entry.eventYear, [entry]);
    }
    return [...byYear].sort(([left], [right]) => order === "oldest" ? left - right : right - left)
      .map(([year, entries]) => ({ year, entries }));
  }, [entries, order]);
  function card(entry: JournalEntry) {
    return <article className={timelineView ? styles.storyMoment : styles.storyCard} key={entry.id}>
      <button className={styles.storyOpen} type="button" onClick={() => { setSelected(entry); setImageIndex(0); setMediaError(""); }} aria-label={`Open entry: ${entryTitle(entry)}`}>
        {entry.kind === "images" && entry.media[0] ? <span className={styles.storyImage}><Image src={entry.media[0].url} alt="" fill sizes={timelineView ? "96px" : "(max-width: 600px) 100vw, 360px"} unoptimized/></span> : entry.kind === "video" ? <span className={styles.storyVideo} aria-hidden="true">▷ <span>Video</span></span> : null}
        <span className={styles.storyWords}><time dateTime={dateValue(entry)}>{eventDate(entry) || `Added ${postedDate(entry.createdAt)}`}</time><span className={styles.storyTitle}>{entryTitle(entry)}</span>{entry.title && entry.body ? <span className={styles.storyExcerpt}>{entry.body}</span> : null}<span className={styles.storyMeta}>{entry.includeOnTimeline ? "On your timeline" : entry.kind === "images" ? `${entry.media.length} ${entry.media.length === 1 ? "image" : "images"}` : entry.kind === "video" ? "Video entry" : "Journal entry"} <span aria-hidden="true">↗</span></span></span>
      </button>
      <button className={styles.storySave} type="button" aria-label={entry.saved ? "Unsave entry" : "Save entry"} aria-pressed={entry.saved} disabled={!writable || savingId === entry.id} onClick={() => void toggleSaved(entry)}>{entry.saved ? "Saved ✓" : "Save"}</button>
    </article>;
  }
  const frozen = pending || draft.attempted || needsReview;
  return <section className={styles.journal} aria-labelledby={`${id}-title`}>
    <header className={styles.storyHeader}><div><h2 className={`member-handwritten ${styles.sectionTitle}`} id={`${id}-title`}>{view === "saved" ? "Kept close" : "Your journal"}</h2><p className={styles.storyIntro}>{view === "saved" ? "Entries you want to return to." : timelineView ? "The moments that shaped you. Part of the same story." : "Words, photographs, and moments. All yours. All private."}</p></div>{writable && view === "journal" ? <button className="member-button member-button-primary" type="button" disabled={pending || Boolean(recoveryDraft)} onClick={addEntry}>{dirty || draft.attempted ? "Continue entry" : timelineView ? "+ Add milestone" : "+ Add entry"}</button> : null}</header>
    {view === "journal" ? <div className={styles.storySwitch} role="group" aria-label="Journal view"><button type="button" aria-pressed={!timelineView} onClick={() => changeMode("all")}>All entries</button><button type="button" aria-pressed={timelineView} onClick={() => changeMode("timeline")}>Timeline</button></div> : null}
    {preview ? <p className={styles.previewNote}>Example entries · Changes stay in this preview.</p> : null}
    {recoveryDraft ? <div className={styles.storyNotice}><p>You have an unfinished entry from earlier in this visit.</p><button type="button" className="member-button" onClick={restoreDraft}>Restore draft</button><button type="button" className={styles.quiet} onClick={dismissRecovery}>Discard draft</button></div> : null}
    {notice ? <p role="status" className={styles.feedback}>{notice}</p> : null}
    {total >= 8 || search || year ? <div className={styles.storyFilters}><label>Find an entry<input type="search" placeholder="Search your story" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Year<select value={year} onChange={event => setYear(event.target.value)}><option value="">All years</option>{years.map(value => <option value={value} key={value}>{value}</option>)}</select></label>{timelineView ? <label>Order<select value={order} onChange={event => setOrder(event.target.value as "oldest" | "newest")}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label> : null}</div> : null}
    {error ? <div role="alert" className={styles.feedback}>{error} <button type="button" className={styles.retry} onClick={() => setReload(value => value + 1)}>Try again</button></div> : null}
    {loading && !entries.length ? <p role="status">Opening your journal…</p> : null}
    {(query || year) && !loading ? <p className={styles.storyCount} role="status">{total} {total === 1 ? "entry" : "entries"} found <button type="button" className={styles.quiet} onClick={() => { setSearch(""); setQuery(""); setYear(""); }}>Clear filters</button></p> : null}
    <div aria-busy={loading} className={timelineView ? styles.storyTimeline : styles.storyGrid}>{timelineView ? groups.map(group => <section className={styles.storyYear} key={group.year} aria-labelledby={`${id}-year-${group.year}`}><h3 id={`${id}-year-${group.year}`}>{group.year}</h3><div>{group.entries.map(card)}</div></section>) : entries.map(card)}</div>
    {!loading && !entries.length && !error ? <div className={styles.empty}><h3>{query || year ? "No matching entries." : view === "saved" ? "Keep something worth returning to." : timelineView ? "Your story starts anywhere." : "Start with a moment."}</h3><p>{query || year ? "Try another word or year." : view === "saved" ? "Save an entry to find it here." : timelineView ? "Mark a journal entry for your timeline, or add a milestone from your past." : "A few words, a photograph, a video. It can be that simple."}</p></div> : null}
    {hasMore ? <button type="button" className={`member-button ${styles.more}`} disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Show more entries"}</button> : null}
    {timelineView ? <footer className={styles.storyFooter}><div>{completedAt ? <p>Foundations step complete. Your story keeps going.</p> : canComplete && total > 0 ? <button type="button" className={styles.quiet} disabled={completing || pending || dirty} onClick={() => void completeTimeline()}>{completing ? "Recording…" : "Complete Foundations step"}</button> : null}</div><button type="button" className={styles.quiet} aria-expanded={exportOpen} onClick={() => void openExport()}>{exportOpen ? "Close export" : "Export timeline ↗"}</button></footer> : null}
    {timelineView && exportOpen ? <section aria-label="Export your timeline" className={styles.storyExport}>{exportLoading ? <p role="status">Preparing your full timeline…</p> : exportError ? <p role="alert">{exportError}</p> : exportEntries.length ? <TimelineExportStudio entries={exportEntries} examples={preview}/> : <p>Add a milestone to prepare your timeline artwork.</p>}</section> : null}

    <Dialog open={composer} onClose={() => setComposer(false)} title={draft.editingId ? "Edit your entry." : "Leave something here."}>
      <form onSubmit={publish} aria-busy={pending}>
        <p className={styles.subtitle}>Your journal is private. Only you can see this entry.</p>
        <fieldset className={styles.kindPicker} disabled={frozen}><legend className={styles.srOnly}>Entry type</legend>{(["text", "images", "video"] as const).map(kind => <label key={kind}><input type="radio" name={`${id}-kind`} checked={draft.kind === kind} onChange={() => changeKind(kind)} disabled={kind !== "text" && !mediaReady && kind !== draft.kind}/><span>{kind === "text" ? "Words" : kind === "images" ? "Photos" : "Video"}</span></label>)}</fieldset>
        <label className={styles.field}>Title {!draft.includeOnTimeline ? <span>(optional)</span> : null}<input ref={titleRef} value={draft.title} maxLength={200} disabled={frozen} required={draft.includeOnTimeline} onChange={event => patchDraft({ title: event.target.value })} placeholder="Give this moment a name"/></label>
        <label className={styles.field}>{draft.kind === "text" ? "Your words" : "Caption"} <span>(optional)</span><textarea rows={6} value={draft.body} maxLength={JOURNAL_BODY_LENGTH} disabled={frozen} onChange={event => patchDraft({ body: event.target.value })} placeholder="What do you want to remember?"/></label>
        {draft.kind !== "text" ? <><div className={styles.previews}>{draft.keptMedia.map((media, index) => <figure key={media.id}>{draft.kind === "images" ? <Image src={media.url} alt={`Attached image ${index + 1}`} width={180} height={140} unoptimized/> : <video src={media.url} controls playsInline preload="metadata"/>}<button type="button" disabled={frozen} onClick={() => patchDraft({ keptMedia: draft.keptMedia.filter(item => item.id !== media.id) })}>Remove attachment</button></figure>)}{draft.files.map((file, index) => <figure key={`${file.name}-${index}`}>{fileUrls[index] ? draft.kind === "images" ? <Image src={fileUrls[index]} alt={`Selected image ${index + 1}`} width={180} height={140} unoptimized/> : <video src={fileUrls[index]} controls playsInline preload="metadata"/> : null}<figcaption>{file.name}</figcaption><button type="button" disabled={frozen} onClick={() => patchDraft({ files: draft.files.filter((_, position) => position !== index) })}>Remove attachment</button></figure>)}</div><label className={styles.fileInput}>{draft.kind === "images" ? "Choose images" : "Choose a video"}<input type="file" accept={JOURNAL_MEDIA_ACCEPT[draft.kind]} multiple={draft.kind === "images"} disabled={frozen || !mediaReady} onChange={event => { addFiles(event.target.files); event.target.value = ""; }}/><span>{draft.kind === "images" ? "Up to 8 images · JPG, PNG, WebP · 8 MB each" : "MP4 or WebM · Up to 50 MB"}</span></label></> : null}
        <label className={styles.storyMilestone}><input type="checkbox" checked={draft.includeOnTimeline} disabled={frozen} onChange={event => { patchDraft({ includeOnTimeline: event.target.checked }); if (event.target.checked) setDateOpen(true); }}/><span>Include on my timeline<small>A milestone you want to place in your story.</small></span></label>
        {!dateOpen && !draft.includeOnTimeline ? <button type="button" className={styles.quiet} disabled={frozen} onClick={() => setDateOpen(true)}>Add when it happened <span>(optional)</span></button> : <fieldset className={styles.storyDateFields} disabled={frozen}><legend>When did it happen? {!draft.includeOnTimeline ? <span>(optional)</span> : null}</legend><p>Only add what you remember. A year is enough.</p><div><label>Year<input type="text" inputMode="numeric" maxLength={4} placeholder="2014" value={draft.eventYear} required={draft.includeOnTimeline} onChange={event => patchDraft({ eventYear: event.target.value })}/></label><label>Month <small>Optional</small><select value={draft.eventMonth} onChange={event => patchDraft({ eventMonth: event.target.value, eventDay: event.target.value ? draft.eventDay : "" })}><option value="">Year only</option>{TIMELINE_MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label><label>Day <small>Optional</small><input type="text" inputMode="numeric" maxLength={2} placeholder="—" value={draft.eventDay} onChange={event => patchDraft({ eventDay: event.target.value })}/></label></div><button type="button" className={styles.quiet} onClick={() => { const now = new Date(); patchDraft({ eventYear: String(now.getFullYear()), eventMonth: String(now.getMonth() + 1), eventDay: "" }); }}>Use this month ↗</button></fieldset>}
        {draftError ? <p role="alert" className={styles.draftError}>{draftError}</p> : null}
        {needsReview || draft.attempted ? <div className={styles.storyNotice}><p>Keep this draft while checking what was saved.</p><button type="button" className="member-button" disabled={pending} onClick={() => void loadLatest()}>Check saved entry</button></div> : null}
        {latestSaved ? <details className={styles.latestVersion}><summary>Latest saved version — review before replacing</summary><p>{entryTitle(latestSaved)}</p><p>{eventDate(latestSaved)}{latestSaved.includeOnTimeline ? " · On your timeline" : ""}</p><p>{latestSaved.body}</p><p>{latestSaved.media.length} attachments</p><button type="button" className={styles.quiet} disabled={pending} onClick={() => { if (window.confirm("Replace your draft with this saved version?")) { clearDraft(); installDraft(draftFor(latestSaved)); } }}>Use saved version</button></details> : null}
        <footer className={styles.composerActions}><button type="button" className={styles.quiet} onClick={() => setComposer(false)}>Keep draft &amp; close</button><button className="member-button member-button-primary" type="submit" disabled={pending || needsReview}>{pending ? "Saving…" : draft.attempted ? "Retry save" : draft.editingId ? "Save changes" : "Add entry"}</button>{!draft.editingId ? <button className="member-button" data-add-another="true" type="submit" disabled={pending || needsReview}>Save &amp; add another</button> : null}<button type="button" className={styles.quiet} disabled={pending} onClick={discardDraft}>Discard draft</button></footer>
      </form>
    </Dialog>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? entryTitle(selected) : "A moment, kept."}>{selected ? <>
      <div className={styles.detailMeta}><time dateTime={dateValue(selected)}>{eventDate(selected) || `Added ${postedDate(selected.createdAt)}`}</time><button className={styles.quiet} type="button" disabled={!writable || savingId === selected.id} onClick={() => void toggleSaved(selected)}>{selected.saved ? "Saved ✓" : "Save entry"}</button></div>
      {selected.includeOnTimeline ? <p className={styles.storyCount}>On your timeline</p> : null}
      {selected.kind === "images" && selected.media[imageIndex] ? <div className={styles.gallery}><Image src={selected.media[imageIndex].url} alt={`Journal image ${imageIndex + 1} of ${selected.media.length}`} width={1000} height={800} unoptimized/>{selected.media.length > 1 ? <nav aria-label="Image gallery"><button type="button" onClick={() => setImageIndex(index => (index - 1 + selected.media.length) % selected.media.length)} aria-label="Previous image">←</button><span>{imageIndex + 1} / {selected.media.length}</span><button type="button" onClick={() => setImageIndex(index => (index + 1) % selected.media.length)} aria-label="Next image">→</button></nav> : null}</div> : null}
      {selected.kind === "video" && selected.media[0] ? <video className={styles.video} key={selected.id} src={selected.media[0].url} controls playsInline preload="metadata" onError={() => setMediaError("This video could not be played. Try reopening the entry.")}/> : null}
      {mediaError ? <p className={styles.draftError} role="alert">{mediaError}</p> : null}
      {selected.body ? <p className={styles.detailBody}>{selected.body}</p> : null}
      {writable ? <footer className={styles.storyEntryActions}><button className="member-button" type="button" disabled={pending} onClick={() => editEntry(selected)}>Edit entry</button><button className={styles.quiet} type="button" disabled={pending} onClick={() => void deleteEntry(selected)}>Delete entry</button></footer> : null}
    </> : null}</Dialog>
  </section>;
}
