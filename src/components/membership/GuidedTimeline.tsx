"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MemberTimelineEntry, MemberTimelineSnapshot } from "@/lib/membership/model";
import { JOURNAL_BODY_LENGTH, JOURNAL_MAX_IMAGES, JOURNAL_MEDIA_ACCEPT, journalFilePolicy, type JournalEntry, type JournalSnapshot } from "@/lib/membership/journal-model";
import Image from "next/image";
import { TIMELINE_MONTHS, formatTimelineDate, timelineFormIsDirty, type TimelineFormValue } from "./timeline-model";
import useTimelineDraftGuard from "./useTimelineDraftGuard";
import { copyPublicTimelineMedia, type PublicTimelineMediaDraft } from "./MemberTimelineDraftState";
import styles from "./guided-timeline.module.css";

const EMPTY = { year: "", month: "", title: "", details: "", meaning: "", belief: "", presentImpact: "", perspective: "" };
const REFLECTIONS = [
  { field: "meaning", label: "What did I make it mean?", short: "Meaning", chapter: "The meaning I gave it", hint: "What did that moment seem to say about you, other people, or life?", placeholder: "At the time, I took it to mean…" },
  { field: "belief", label: "What did I start believing?", short: "Belief", chapter: "The belief I carried", hint: "Did it become a rule you lived by, a promise, or an expectation?", placeholder: "After that, I began to believe…" },
  { field: "presentImpact", label: "How does it show up now?", short: "Now", chapter: "The echo in my life", hint: "Where do you notice that story in your choices, relationships, or habits today?", placeholder: "I notice it when…" },
  { field: "perspective", label: "What can I see now?", short: "Perspective", chapter: "What I can see from here", hint: "With some distance, what feels clearer, different, or still unresolved?", placeholder: "Looking back from here…" },
] as const;
function formFor(entry?: MemberTimelineEntry): TimelineFormValue {
  const now = new Date();
  return entry ? { year: String(entry.year), month: entry.month ? String(entry.month) : "", title: entry.title, details: entry.details ?? "", meaning: entry.meaning ?? "", belief: entry.belief ?? "", presentImpact: entry.presentImpact ?? "", perspective: entry.perspective ?? "" } : { ...EMPTY, year: String(now.getFullYear()), month: String(now.getMonth() + 1) };
}
function Arrow({ back = false }: { back?: boolean }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" style={back ? { transform: "rotate(180deg)" } : undefined}><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PublicIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" stroke="currentColor" strokeWidth="1.5" /></svg>;
}
function PhotoIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>;
}
function hasReflections(value: TimelineFormValue) { return REFLECTIONS.some(item => value[item.field]?.trim()); }
function draftTitle(value: TimelineFormValue, kind: PublicTimelineMediaDraft["kind"]) {
  return value.details.trim().split(/\n/)[0].slice(0, 80).trim() || (kind === "images" ? "Photos" : kind === "video" ? "Video" : "A moment in my story");
}
function postLabel(entry: StoryEntry) { return entry.title || entry.details?.trim().slice(0, 70) || (entry.journal.kind === "video" ? "Video" : "Photos"); }
function postDate(entry: StoryEntry) {
  const { eventYear, eventMonth, eventDay } = entry.journal;
  if (eventYear && eventMonth && eventDay) return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(eventYear, eventMonth - 1, eventDay)));
  return formatTimelineDate(entry, true);
}
function Lock() {
  return <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.5"/></svg>;
}
type Confirmation = { kind: "discard" } | { kind: "leave"; url: string };
type StoryEntry = MemberTimelineEntry & { journal: JournalEntry };
type StoryState = { entries: StoryEntry[]; revision: string; hasMore: boolean; nextCursor: string | null };
function isPublished(entry?: StoryEntry) { return entry?.journal.visibility === "public" && entry.journal.includeOnTimeline; }
function storyEntry(entry: JournalEntry, position = 1): StoryEntry {
  const reflection = entry.timelineReflection ?? (entry.visibility !== "public" ? entry.legacyTimelineReflection : null);
  return { id: entry.id, title: entry.title ?? "", details: entry.body, year: entry.eventYear ?? new Date(entry.createdAt).getUTCFullYear(), month: entry.eventMonth,
    meaning: reflection?.meaning ?? null, belief: reflection?.belief ?? null, presentImpact: reflection?.presentImpact ?? null, perspective: reflection?.perspective ?? null,
    position, journal: entry };
}
function storyState(page: JournalSnapshot): StoryState {
  const entries = page.entries.map((entry, index) => storyEntry(entry, index + 1));
  return { entries, revision: entries.map(entry => `${entry.id}:${entry.journal.version}`).join("|"), hasMore: page.hasMore, nextCursor: page.nextCursor ?? null };
}
function mediaFor(entry?: StoryEntry): PublicTimelineMediaDraft {
  return { editingExisting: Boolean(entry), eventDay: entry ? entry.journal.eventDay : new Date().getDate(), baselineEventDay: entry ? entry.journal.eventDay : new Date().getDate(), kind: entry?.journal.kind ?? "text", keptMedia: entry?.journal.media.map(media => ({ ...media })) ?? [], files: [], uploadIds: [], attemptedVisibility: null };
}
function mediaIds(media: PublicTimelineMediaDraft) {
  return [...media.keptMedia.map(item => item.id), ...media.files.map(file => media.uploadIds.find(([uploaded]) => uploaded === file)?.[1])];
}
function matchingMedia(media: PublicTimelineMediaDraft, entry?: StoryEntry) {
  return media.kind === (entry?.journal.kind ?? "text") && JSON.stringify(mediaIds(media)) === JSON.stringify(entry?.journal.media.map(item => item.id) ?? []) && (media.eventDay === undefined || media.eventDay === (entry ? entry.journal.eventDay : media.baselineEventDay));
}
class StoryRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}


export default function GuidedTimeline({ initialJournal, preview = false, ownerId, initialEntryId, startNew = false }: {
  initialJournal: JournalSnapshot; preview?: boolean; ownerId?: string; initialEntryId?: string; startNew?: boolean;
}) {
  const router = useRouter();
  const [timeline, setTimeline] = useState<StoryState>(() => storyState(initialJournal));
  const writable = initialJournal.writable;
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const attemptId = useRef<string | null>(null);
  const sending = useRef(false);
  const active = useRef(true);
  const [missingAfterReview, setMissingAfterReview] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [foundation, setFoundation] = useState<{ allowed: boolean; completedAt: string | null } | null>(null);
  const [completing, setCompleting] = useState(false);
  const initialEntry = !startNew && initialEntryId ? timeline.entries.find(entry => entry.id === initialEntryId) : undefined;
  const [missingRequested, setMissingRequested] = useState(!startNew && Boolean(initialEntryId) && !initialEntry);
  const [editingId, setEditingId] = useState<string | null>(initialEntry?.id ?? null);
  const [form, setForm] = useState(() => formFor(initialEntry));
  const [baseline, setBaseline] = useState(() => formFor(initialEntry));
  const [media, setMedia] = useState(() => mediaFor(initialEntry));
  const [fileUrls, setFileUrls] = useState<string[]>([]);
  const [mediaReady, setMediaReady] = useState(preview || initialJournal.mediaReady);
  const [uploading, setUploading] = useState(false);
  const uploadController = useRef<AbortController | null>(null);
  const previewUrls = useRef<string[]>([]);
  const [reflectionsOpen, setReflectionsOpen] = useState(() => hasReflections(formFor(initialEntry)));
  const [titleOpen, setTitleOpen] = useState(Boolean(initialEntry?.title));
  const [dateOpen, setDateOpen] = useState(false);
  const [feedFilter, setFeedFilter] = useState<"posts" | "drafts">("posts");
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
  const allowEdit = preview || (writable && Boolean(ownerId));
  const selected = timeline.entries.find(entry => entry.id === editingId);
  const dirty = timelineFormIsDirty(form, baseline) || !matchingMedia(media, selected);
  const { recoveryDraft, dismissRecovery, clearDraft } = useTimelineDraftGuard({
    enabled: allowEdit, scope: "public-timeline", dirty, pending: pending || uncertain, form, baseline,
    editingEntryId: editingId ?? draftId, revision: timeline.revision,
    publicTimelineMedia: media,
    onNavigate: url => ask({ kind: "leave", url }),
  });
  const disabled = !allowEdit || pending || Boolean(recoveryDraft);
  const frozen = disabled || needsReview;
  const memberNavigation = confirmation?.kind === "leave" && (() => {
    const path = new URL(confirmation.url).pathname;
    return path === "/my" || (path.startsWith("/my/") && path !== "/my/access");
  })();
  const matchingEntries = timeline.entries.filter(entry =>
    (feedFilter === "posts" ? isPublished(entry) : !isPublished(entry)) &&
    `${entry.title} ${entry.details ?? ""} ${formatTimelineDate(entry, true)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const preservedDay = media.eventDay !== undefined ? media.eventDay : selected?.journal.eventYear === Number(form.year) && selected.journal.eventMonth === (form.month ? Number(form.month) : null) ? selected.journal.eventDay : null;
  const now = new Date();
  const useToday = Number(form.year) === now.getFullYear() && Number(form.month) === now.getMonth() + 1 && preservedDay === now.getDate();
  const dateLabel = useToday ? "Today" : form.year ? preservedDay && form.month
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(form.year), Number(form.month) - 1, preservedDay)))
    : formatTimelineDate({ year: Number(form.year), month: Number(form.month) || null }, true) : "Add a date";
  const hasContent = Boolean(form.title.trim() || form.details.trim() || media.keptMedia.length || media.files.length);

  useEffect(() => { active.current = true; const urls = previewUrls.current; return () => { active.current = false; uploadController.current?.abort(); urls.forEach(url => URL.revokeObjectURL(url)); }; }, []);
  useEffect(() => {
    const urls = media.files.map(file => URL.createObjectURL(file)); setFileUrls(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [media.files]);
  useEffect(() => {
    if (preview || !ownerId) return;
    const controller = new AbortController();
    fetch("/api/my/timeline", { cache: "no-store", headers: { "x-ruined-session-owner": ownerId }, signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then((result: { timeline?: MemberTimelineSnapshot } | null) => {
        if (!controller.signal.aborted && result?.timeline) setFoundation({ allowed: result.timeline.access.capabilities.includes("foundations.write"), completedAt: result.timeline.completedAt });
      }).catch(() => { /* Optional Foundations status must not block the Timeline editor. */ });
    return () => controller.abort();
  }, [ownerId, preview]);

  useEffect(() => {
    if (confirmation) { dialog.current?.showModal(); cancelButton.current?.focus(); }
    else { dialog.current?.close(); trigger.current?.focus(); }
  }, [confirmation]);

  function focusComposer() {
    window.requestAnimationFrame(() => {
      const field = formElement.current?.querySelector<HTMLTextAreaElement>("#timeline-details");
      field?.focus({ preventScroll: true });
      formElement.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  }
  function resetEditor(entry?: StoryEntry) {
    const value = formFor(entry);
    setEditingId(entry?.id ?? null); setForm(value); setBaseline(value); setMedia(mediaFor(entry));
    setReflectionsOpen(hasReflections(value)); setTitleOpen(Boolean(entry?.title)); setDateOpen(false);
  }
  function ask(action: Confirmation) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(action);
  }
  function open(entry?: StoryEntry) {
    if (pending || recoveryDraft || (!entry && !allowEdit)) return;
    if (dirty || needsReview) {
      setError("Save or discard this draft before opening another moment.");
      formElement.current?.scrollIntoView({ block: "center" });
      return;
    }
    clearDraft(); setMissingRequested(false); setDraftId(crypto.randomUUID()); attemptId.current = null; setMissingAfterReview(false);
    resetEditor(entry); setError(""); setStatus("");
    focusComposer();
  }
  function discard() {
    clearDraft(); resetEditor(selected);
    setNeedsReview(false); setReviewLoaded(false); setUncertain(false); attemptId.current = null; setMissingAfterReview(false); setDraftId(crypto.randomUUID()); setError(""); setStatus("Draft discarded. Your saved moments are unchanged.");
    focusComposer();
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
    if (frozen) return;
    setForm(current => ({ ...current, [field]: value })); setStatus(""); setError("");
  }
  function addFiles(incoming: FileList | null) {
    if (!incoming?.length || frozen || !mediaReady) return;
    try {
      const files = [...media.files, ...Array.from(incoming)];
      const kind = media.kind === "text" ? journalFilePolicy(files[0].type, files[0].size) : media.kind;
      if (files.length + media.keptMedia.length > (kind === "images" ? JOURNAL_MAX_IMAGES : 1)) throw Error(kind === "images" ? "Choose up to eight images." : "Remove the current video before choosing another.");
      for (const file of files) if (journalFilePolicy(file.type, file.size) !== kind) throw Error("Use photos or one video in a story. Remove the current attachments to switch.");
      setMedia(current => ({ ...current, kind, files })); setStatus(""); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Choose a supported file."); }
  }
  function removeMedia(index: number, saved: boolean) {
    if (frozen) return;
    setMedia(current => {
      const keptMedia = saved ? current.keptMedia.filter((_, position) => position !== index) : current.keptMedia;
      const files = saved ? current.files : current.files.filter((_, position) => position !== index);
      return { ...current, keptMedia, files, kind: keptMedia.length + files.length ? current.kind : "text", uploadIds: current.uploadIds.filter(([file]) => files.includes(file)) };
    }); setStatus(""); setError("");
  }
  function restore() {
    if (!recoveryDraft) return;
    const restored = timeline.entries.find(entry => entry.id === recoveryDraft.editingEntryId);
    const hadSavedEntry = recoveryDraft.publicTimelineMedia?.editingExisting ?? Boolean(
      recoveryDraft.baseline.title || recoveryDraft.baseline.details || hasReflections(recoveryDraft.baseline) || recoveryDraft.publicTimelineMedia?.keptMedia.length,
    );
    const existingOutsidePage = !restored && hadSavedEntry;
    setEditingId(restored?.id ?? (existingOutsidePage ? recoveryDraft.editingEntryId : null)); setDraftId(recoveryDraft.editingEntryId ?? crypto.randomUUID());
    attemptId.current = recoveryDraft.wasPending ? recoveryDraft.editingEntryId : null;
    const restoredForm = { ...EMPTY, ...recoveryDraft.form };
    setForm(restoredForm); setBaseline({ ...EMPTY, ...recoveryDraft.baseline });
    setReflectionsOpen(hasReflections(restoredForm)); setTitleOpen(Boolean(restoredForm.title));
    setMedia(recoveryDraft.publicTimelineMedia ? copyPublicTimelineMedia(recoveryDraft.publicTimelineMedia) : mediaFor(restored));
    setNeedsReview(existingOutsidePage || recoveryDraft.wasPending || recoveryDraft.revision !== timeline.revision);
    setUncertain(recoveryDraft.wasPending); focusComposer(); dismissRecovery(); setStatus(recoveryDraft.wasPending ? "Your unfinished story is restored. Check the latest saved story before continuing." : "Your unfinished story is restored. Nothing new has been published.");
  }
  function validPost() {
    if (!/^\d{4}$/.test(form.year) || Number(form.year) < 1900 || Number(form.year) > 2200) {
      setDateOpen(true); setError("Add a four-digit year between 1900 and 2200. An approximate year is fine."); return false;
    }
    if (!hasContent) { setError("Write something or add a photo or video first."); focusComposer(); return false; }
    return true;
  }
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    if (!ownerId) throw new StoryRequestError("Your session needs to be refreshed before saving.", 401);
    const headers = new Headers(init?.headers); headers.set("x-ruined-session-owner", ownerId);
    const response = await fetch(url, { ...init, headers, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(90_000) });
    const result = await response.json();
    if (!response.ok) throw new StoryRequestError(result.error || "Your story could not be saved.", response.status);
    return result as T;
  }
  function install(entry: JournalEntry) {
    const next = storyEntry(entry, selected?.position ?? timeline.entries.length + 1);
    setTimeline(current => {
      const entries = current.entries.some(item => item.id === entry.id) ? current.entries.map(item => item.id === entry.id ? next : item) : [next, ...current.entries];
      return { ...current, entries, revision: entries.map(item => `${item.id}:${item.journal.version}`).join("|") };
    });
    return next;
  }
  async function submitPost(event: FormEvent) {
    event.preventDefault();
    if (frozen) return;
    await save("public");
  }
  async function save(visibility: "public" | "private") {
    if (disabled || needsReview || sending.current || !validPost()) return;
    if (editingId && !selected) { setNeedsReview(true); setError("This moment has changed. Load the latest saved story before saving."); return; }
    if (selected && !dirty && isPublished(selected) === (visibility === "public")) return;
    if (media.files.length && !mediaReady) { setError("Attachments are temporarily unavailable. Your draft is still here."); return; }
    sending.current = true; setPending(true); setError("");
    const entryId = selected?.id ?? draftId;
    const workingMedia = copyPublicTimelineMedia(media);
    let entryRequestStarted = false;
    const reflected = hasReflections(form);
    const title = form.title.trim() || ((visibility === "private" || reflected) ? draftTitle(form, media.kind) : "");
    if (title !== form.title) { setForm(current => ({ ...current, title })); setTitleOpen(true); }
    const sameDate = selected?.journal.eventYear === Number(form.year) && selected.journal.eventMonth === (form.month ? Number(form.month) : null);
    const fields = {
      kind: media.kind, title, body: form.details,
      mediaIds: [] as string[],
      eventYear: Number(form.year), eventMonth: form.month ? Number(form.month) : null,
      eventDay: media.eventDay !== undefined ? media.eventDay : sameDate ? selected?.journal.eventDay ?? null : null,
      includeOnTimeline: true, visibility,
      timelineReflection: reflected ? { meaning: form.meaning?.trim() || null, belief: form.belief?.trim() || null, presentImpact: form.presentImpact?.trim() || null, perspective: form.perspective?.trim() || null } : null,
    };
    try {
      if (!preview && workingMedia.files.length) {
        const controller = new AbortController(); uploadController.current = controller; setUploading(true);
        for (const file of workingMedia.files) {
          if (workingMedia.uploadIds.some(([uploaded]) => uploaded === file)) continue;
          const upload = await request<{ id: string; signedUrl: string }>("/api/my/journal/media", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mimeType: file.type, size: file.size }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
          });
          const data = new FormData(); data.append("cacheControl", "0"); data.append("", file);
          const response = await fetch(upload.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), body: data });
          if (!response.ok) throw Error("An attachment could not upload. Your draft is still here; please try again.");
          workingMedia.uploadIds.push([file, upload.id]);
          if (active.current) setMedia(copyPublicTimelineMedia(workingMedia));
        }
        if (controller.signal.aborted || !active.current) throw new DOMException("Upload canceled", "AbortError");
      }
      uploadController.current = null; setUploading(false);
      fields.mediaIds = mediaIds(workingMedia).filter((id): id is string => Boolean(id));
      workingMedia.attemptedVisibility = visibility;
      setMedia(copyPublicTimelineMedia(workingMedia));
      attemptId.current = entryId; entryRequestStarted = true;
      const result = preview ? { entry: {
        id: entryId, ...fields, title: title || null, body: form.details.trim() || null,
        createdAt: selected?.journal.createdAt ?? new Date().toISOString(), saved: selected?.journal.saved ?? false,
        version: String(Number(selected?.journal.version ?? "0") + 1), media: [...workingMedia.keptMedia, ...workingMedia.files.map(file => {
          const url = URL.createObjectURL(file); previewUrls.current.push(url); return { id: crypto.randomUUID(), mimeType: file.type, size: file.size, url };
        })],
      } satisfies JournalEntry } : await request<{ entry: JournalEntry }>(selected ? `/api/my/journal/${selected.id}` : "/api/my/journal", {
        method: selected ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(selected ? { action: "edit", expectedVersion: selected.journal.version, ...fields } : { id: entryId, ...fields }),
      });
      if (!result.entry || result.entry.id !== entryId) throw new Error("The save response could not be matched. Check the latest saved story before trying again.");
      if (!active.current) return;
      const saved = install(result.entry); clearDraft(); resetEditor(visibility === "private" ? saved : undefined); setDraftId(crypto.randomUUID()); setFeedFilter(visibility === "public" ? "posts" : "drafts");
      attemptId.current = null; setNeedsReview(false); setUncertain(false);
      setStatus(preview ? "Saved in this preview only. Nothing was published to an account." : visibility === "public" ? "Published to your Timeline. This story is visible on your public profile." : "Saved privately in your Journal. This story is not on your public Timeline.");
      if (!preview) window.dispatchEvent(new CustomEvent("ruined:member-progress"));
    } catch (caught) {
      if (!active.current) return;
      const ambiguous = entryRequestStarted && (!(caught instanceof StoryRequestError) || caught.status >= 500);
      setNeedsReview(ambiguous || (entryRequestStarted && caught instanceof StoryRequestError && caught.status === 409));
      setReviewLoaded(false); setUncertain(ambiguous);
      setError(caught instanceof DOMException && caught.name === "AbortError" ? "Upload canceled. Your writing and selected attachments are still here; nothing was published." : caught instanceof Error ? caught.message : "Your story could not be saved. Your draft is still here.");
    } finally { sending.current = false; uploadController.current = null; if (active.current) { setPending(false); setUploading(false); } }
  }
  async function loadLatest() {
    if (sending.current || pending) return;
    setPending(true); setError("");
    try {
      const page = preview ? null : await request<JournalSnapshot>("/api/my/journal?view=timeline");
      if (!active.current) return;
      if (page) setMediaReady(page.mediaReady);
      const latest = page ? storyState(page) : timeline;
      const targetId = attemptId.current ?? editingId ?? draftId;
      let target = latest.entries.find(entry => entry.id === targetId);
      let missing = false;
      if (!preview && !target && targetId) {
        try { const result = await request<{ entry: JournalEntry }>(`/api/my/journal/${targetId}`); target = storyEntry(result.entry); latest.entries.unshift(target); }
        catch (caught) { if (caught instanceof StoryRequestError && caught.status === 404) missing = true; else throw caught; }
      }
      if (!active.current) return;
      setTimeline({ ...latest, revision: latest.entries.map(item => `${item.id}:${item.journal.version}`).join("|") });
      setMissingAfterReview(missing);
      if (target && !timelineFormIsDirty(form, formFor(target)) && matchingMedia(media, target)
        && (!uncertain || (media.attemptedVisibility !== null && target.journal.visibility === media.attemptedVisibility))) {
        clearDraft(); setEditingId(target.id); setForm(formFor(target)); setBaseline(formFor(target));
        setMedia(mediaFor(target)); setReflectionsOpen(hasReflections(formFor(target))); setTitleOpen(Boolean(target.title));
        setNeedsReview(false); setReviewLoaded(false); setUncertain(false); attemptId.current = null;
        setStatus(isPublished(target) ? "Your story is published on your Timeline." : "Your private draft is saved in Journal.");
      } else if (!dirty && !needsReview) {
        if (target) { resetEditor(target); focusComposer(); }
        setStatus("Your latest saved stories are loaded.");
      } else {
        if (target) setEditingId(target.id);
        setNeedsReview(true); setReviewLoaded(true); setStatus("Latest stories loaded. Review the saved version before keeping your draft.");
      }
    } catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : "The latest stories could not be loaded."); }
    finally { if (active.current) setPending(false); }
  }
  async function loadMore() {
    if (pageLoading || !timeline.nextCursor || preview) return;
    setPageLoading(true); setError("");
    try {
      const page = await request<JournalSnapshot>(`/api/my/journal?view=timeline&before=${encodeURIComponent(timeline.nextCursor)}`);
      if (!active.current) return;
      setTimeline(current => {
        const entries = [...current.entries, ...page.entries.filter(entry => !current.entries.some(item => item.id === entry.id)).map((entry, index) => storyEntry(entry, current.entries.length + index + 1))];
        return { entries, revision: entries.map(item => `${item.id}:${item.journal.version}`).join("|"), hasMore: page.hasMore, nextCursor: page.nextCursor ?? null };
      });
    } catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : "More stories could not be loaded."); }
    finally { if (active.current) setPageLoading(false); }
  }
  function keepDraft() {
    if (!reviewLoaded) return;
    if (missingAfterReview && editingId) {
      setEditingId(null); setDraftId(crypto.randomUUID());
      setMedia(current => ({ ...current, editingExisting: false, baselineEventDay: current.eventDay ?? null }));
    }
    setBaseline(formFor(selected)); setNeedsReview(false); setReviewLoaded(false); setUncertain(false);
    setError(""); setStatus("Draft kept. Review it, then choose whether to publish or save privately.");
  }
  async function completeFoundation() {
    if (!foundation?.allowed || completing || pending || dirty || needsReview || preview) return;
    setCompleting(true); setError("");
    try {
      const result = await request<{ requirements?: { timeline?: { completedAt?: string | null } } }>("/api/my/timeline", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete" }),
      });
      const completedAt = result.requirements?.timeline?.completedAt;
      if (!completedAt) throw new Error("Completion could not be confirmed. Your saved stories are unchanged.");
      if (active.current) { setFoundation({ allowed: true, completedAt }); setStatus("Foundations Timeline step complete. Your story keeps going."); window.dispatchEvent(new CustomEvent("ruined:member-progress")); }
    } catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : "Completion could not be recorded."); }
    finally { if (active.current) setCompleting(false); }
  }
  function downloadDraft() {
    const blob = new Blob([JSON.stringify({ title: "Ruined Timeline", unfinishedMoment: { id: editingId ?? draftId, ...form } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "ruined-timeline-draft.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <article className={styles.experience}>
    <header className={styles.header}>
      <div><Link className={styles.back} href="/my#timeline"><Arrow back /> My profile</Link><h1>Timeline</h1></div>
      <div className={styles.headerActions}>{initialJournal.publicUrl ? <Link href={initialJournal.publicUrl} target="_blank" rel="noreferrer">View profile ↗</Link> : null}<details className={styles.options}><summary aria-label="Timeline options">···</summary><div><button onClick={downloadDraft}>Download draft</button><button disabled={pending} onClick={() => void loadLatest()}>Load latest moments</button></div></details></div>
    </header>
    {preview ? <p className={styles.previewNote}>Try posting here. This preview isn’t saved to an account.</p> : null}
    {recoveryDraft ? <aside className={styles.recovery}><div><h2>Pick up where you left off.</h2><p>Your unfinished post is here.</p></div><button onClick={restore}>Restore draft</button><button onClick={dismissRecovery}>Discard recovered draft</button></aside> : null}
    {missingRequested ? <section className={styles.unavailable} aria-label="Timeline moment unavailable"><h2>This moment isn’t available.</h2><p>It may have been removed. Your other posts are below.</p>{allowEdit ? <button type="button" onClick={() => open()}>Start a new post <Arrow /></button> : null}</section> : null}
    {allowEdit ? <form ref={formElement} className={styles.editor} hidden={missingRequested} onSubmit={submitPost} noValidate aria-label="Create a Timeline post">
      <div className={styles.composerTop}>
        <strong>{selected ? "Edit post" : "Create a post"}</strong>
        <details className={styles.dateControl} open={dateOpen} onToggle={event => setDateOpen(event.currentTarget.open)}>
          <summary aria-label="When was this?">{dateLabel}<span aria-hidden="true">⌄</span></summary>
          <div className={styles.datePanel}><span className={styles.dateHeading}>When was this?</span><p>An approximate date is fine.</p><div className={styles.date}>
            <label htmlFor="timeline-year">Year<input id="timeline-year" inputMode="numeric" maxLength={4} required disabled={frozen} value={form.year} onChange={event => { if (frozen) return; setMedia(current => ({ ...current, eventDay: null })); change("year", event.target.value); }} placeholder="e.g. 2019" /></label>
            <label htmlFor="timeline-month">Month<select id="timeline-month" disabled={frozen} value={form.month} onChange={event => { if (frozen) return; setMedia(current => ({ ...current, eventDay: null })); change("month", event.target.value); }}><option value="">Year only</option>{TIMELINE_MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></label>
          </div><button type="button" disabled={frozen} onClick={() => { const now = new Date(); change("year", String(now.getFullYear())); change("month", String(now.getMonth() + 1)); setMedia(current => ({ ...current, eventDay: now.getDate() })); setDateOpen(false); }}>Use today</button></div>
        </details>
      </div>
      {titleOpen ? <label className={styles.titleField} htmlFor="timeline-event">Title <span>optional</span><input id="timeline-event" maxLength={200} disabled={frozen} value={form.title} onChange={event => change("title", event.target.value)} placeholder="Give this moment a name" /></label> : null}
      <div className={styles.writingArea}>
        <label className={styles.writingLabel} htmlFor="timeline-details">What happened?</label>
        <textarea className={styles.postInput} id="timeline-details" rows={4} maxLength={Math.max(JOURNAL_BODY_LENGTH, selected?.details?.length ?? 0)} disabled={frozen} value={form.details} onChange={event => change("details", event.target.value)} placeholder="Start typing here…" aria-describedby="timeline-writing-hint" />
        <p className={styles.writingHint} id="timeline-writing-hint">A moment, a thought, or something you’re seeing differently.</p>
      </div>
      {media.keptMedia.length + media.files.length ? <div className={styles.attachmentPreviews}>
        {media.keptMedia.map((item, index) => <figure key={item.id}>{media.kind === "video" ? <video src={item.url} controls playsInline preload="metadata" /> : <Image src={item.url} alt={`Attached photograph ${index + 1}`} width={600} height={450} unoptimized />}<button type="button" disabled={frozen} onClick={() => removeMedia(index, true)} aria-label={`Remove saved attachment ${index + 1}`}>Remove</button></figure>)}
        {media.files.map((file, index) => <figure key={`${file.name}-${index}`}>{fileUrls[index] ? media.kind === "video" ? <video src={fileUrls[index]} controls playsInline preload="metadata" /> : <Image src={fileUrls[index]} alt={`Selected photograph ${index + 1}`} width={600} height={450} unoptimized /> : null}<figcaption>{file.name}</figcaption><button type="button" disabled={frozen} onClick={() => removeMedia(index, false)} aria-label={`Remove selected attachment ${index + 1}`}>Remove</button></figure>)}
      </div> : null}
      <div className={styles.tools}>
        <label className={styles.attachmentButton} data-disabled={frozen || !mediaReady} htmlFor="timeline-attachments"><PhotoIcon /> Photos / video<input className={styles.srOnly} id="timeline-attachments" type="file" accept={media.kind === "text" ? `${JOURNAL_MEDIA_ACCEPT.images},${JOURNAL_MEDIA_ACCEPT.video}` : JOURNAL_MEDIA_ACCEPT[media.kind]} multiple={media.kind !== "video"} disabled={frozen || !mediaReady} onChange={event => { addFiles(event.target.files); event.target.value = ""; }} /></label>
        {!titleOpen ? <button type="button" disabled={frozen} onClick={() => setTitleOpen(true)}>Add a title</button> : null}
        {media.keptMedia.length + media.files.length ? <span className={styles.mediaHint}>{media.kind === "video" ? "One video · up to 50 MB" : "Up to 8 photos · 8 MB each"}</span> : null}
      </div>
      {!mediaReady ? <p className={styles.mediaHint}>Attachments are temporarily unavailable. You can still write and post.</p> : null}
      <details className={styles.deeper} open={reflectionsOpen} onToggle={event => setReflectionsOpen(event.currentTarget.open)}>
        <summary><span>Go deeper <small>optional</small></span><span className={styles.disclosureMark} aria-hidden="true">+</span></summary>
        <div className={styles.reflectionFields}>
          <p>These answers become part of your public post.</p>
          {REFLECTIONS.map(item => <label key={item.field} htmlFor={`timeline-${item.field}`}><span>{item.label}</span><textarea id={`timeline-${item.field}`} rows={3} maxLength={4000} disabled={frozen} value={form[item.field] ?? ""} onChange={event => change(item.field, event.target.value)} placeholder={item.placeholder} /></label>)}
        </div>
      </details>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {needsReview ? <aside className={styles.review}><h2>Review before saving.</h2>{!reviewLoaded ? <button disabled={pending} type="button" onClick={() => void loadLatest()}>Load latest saved story</button> : <>
        {selected && !missingAfterReview ? <><p>Currently saved: <strong>{selected.title}</strong> · {formatTimelineDate(selected)}</p><p className={styles.savedText}>{selected.details || "No context added."}</p>{REFLECTIONS.map(item => <p className={styles.savedText} key={item.field}>{item.short}: {selected[item.field] || "Not added."}</p>)}<button type="button" onClick={keepDraft}>Keep my draft for this story</button></> : <><p>{uncertain && !editingId ? "No saved story was found for this attempt. Your draft can be retried with the same identifier." : "This story is no longer available. Your writing is still here."}</p><button type="button" onClick={keepDraft}>{editingId ? "Keep draft as a new story" : "Keep draft and retry"}</button></>}
      </>}</aside> : null}
      <div className={styles.saveRow}>
        <span className={styles.publicLabel}><PublicIcon /> Public<span className={styles.audienceDescription}> · on your profile</span></span>
        <div className={styles.saveActions}>
          <details className={styles.options}><summary aria-label="Post options">···</summary><div><button type="button" disabled={frozen || !hasContent || (!dirty && Boolean(selected) && !isPublished(selected))} onClick={() => void save("private")}><Lock />{isPublished(selected) ? "Move to Journal" : "Save private draft"}</button>{dirty || needsReview ? <button type="button" disabled={pending || (uncertain && !reviewLoaded)} onClick={() => ask({ kind: "discard" })}>Discard draft</button> : null}</div></details>
          <button className={styles.save} type="submit" disabled={frozen || !hasContent || (!dirty && isPublished(selected))}>{pending ? "Saving…" : isPublished(selected) ? "Save changes" : "Post"}</button>
        </div>
      </div>
      {uploading ? <div className={styles.uploadStatus}><span role="status">Uploading attachments…</span><button type="button" onClick={() => uploadController.current?.abort()}>Cancel upload</button></div> : null}
      {selected ? <div className={styles.editingNotice}><span>{isPublished(selected) ? "Editing a public post" : "Private draft · only you can see it"}</span><button type="button" disabled={frozen || dirty} onClick={() => open()}>Done editing</button></div> : null}
    </form> : <p className={styles.readOnly}>Your Timeline is read only right now.</p>}
    <p className={styles.status} role="status">{status}</p>
    {!allowEdit && error ? <p className={styles.error} role="alert">{error}</p> : null}
    <section className={styles.feed} aria-label="Your Timeline posts">
      <div className={styles.feedTop}><div className={styles.tabs} aria-label="Timeline filters"><button type="button" aria-pressed={feedFilter === "posts"} onClick={() => { setFeedFilter("posts"); setVisibleCount(40); }}>Posts</button><button type="button" aria-pressed={feedFilter === "drafts"} onClick={() => { setFeedFilter("drafts"); setVisibleCount(40); }}><Lock /> Drafts</button></div>{timeline.entries.length > 6 ? <input className={styles.search} type="search" aria-label="Find a post" placeholder="Find a post…" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(40); }} /> : null}</div>
      {!matchingEntries.length ? <div className={styles.empty}><p>{search ? "No matching posts." : feedFilter === "drafts" ? "No private drafts." : "Your story starts anywhere."}</p><span>{feedFilter === "drafts" ? "Save a private draft from the post options. Only you can see it." : "Share a thought, a photograph, or a moment that stayed with you."}</span></div> : null}
      <div className={styles.posts}>{matchingEntries.slice(0, visibleCount).map(entry => {
        const reflections = REFLECTIONS.filter(item => entry[item.field]?.trim());
        const showTitle = Boolean(entry.title && !entry.details?.trim().startsWith(entry.title));
        const longBody = (entry.details?.length ?? 0) > 500;
        return <article key={entry.id} className={styles.post} aria-label={postLabel(entry)} data-editing={editingId === entry.id}>
          <header className={styles.postTop}><div><time dateTime={String(entry.year)}>{postDate(entry)}</time><span className={styles.postAudience}>{isPublished(entry) ? <><PublicIcon /> Public</> : <><Lock /> Private draft</>}</span></div>{allowEdit ? <button type="button" disabled={pending || Boolean(recoveryDraft)} onClick={() => open(entry)} aria-label={`Edit ${postLabel(entry)}`}>Edit</button> : null}</header>
          {showTitle ? <h2>{entry.title}</h2> : null}
          {entry.details ? <p className={styles.postBody} data-long={longBody}>{entry.details}</p> : null}
          {entry.journal.media.length ? <div className={styles.postMedia} data-count={entry.journal.media.length}>{entry.journal.media.map((item, index) => entry.journal.kind === "video" ? <video key={item.id} src={item.url} controls playsInline preload="metadata" aria-label={`Post video ${index + 1}`} /> : <Image key={item.id} src={item.url} alt={`Post photograph ${index + 1}`} width={1000} height={750} unoptimized />)}</div> : null}
          {reflections.length || longBody ? <details className={styles.postReflections}><summary><span className={styles.readMore}>Read more</span><span className={styles.readLess}>Read less</span><span className={styles.disclosureMark} aria-hidden="true">+</span></summary>{reflections.length ? <div>{reflections.map(item => <section key={item.field}><h3>{item.label}</h3><p>{entry[item.field]}</p></section>)}</div> : null}</details> : null}
        </article>;
      })}</div>
      {visibleCount < matchingEntries.length ? <button className={styles.more} onClick={() => setVisibleCount(count => count + 40)}>Show more posts</button> : null}
      {timeline.hasMore ? <button className={styles.more} disabled={pageLoading || pending} onClick={() => void loadMore()}>{pageLoading ? "Loading…" : "Load more stories"}</button> : null}
    </section>
    {foundation?.completedAt ? <p className={styles.foundationStatus}>Foundations Timeline step complete. Your story keeps going.</p> : foundation?.allowed && timeline.entries.some(entry => entry.journal.eventYear !== null && entry.title.trim() && (!isPublished(entry) || entry.journal.timelineReflection)) ? <div className={styles.foundationStatus}><span>Ready to mark your Foundations Timeline step complete?</span><button type="button" disabled={completing || pending || dirty || needsReview} onClick={() => void completeFoundation()}>{completing ? "Recording…" : "Complete Foundations step"}</button></div> : foundation?.allowed ? <p className={styles.foundationStatus}>Working on Foundations? Add a reflection under Go deeper to complete your Timeline step.</p> : null}
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby="timeline-confirm-title" onCancel={event => { event.preventDefault(); setConfirmation(null); }}>
      <h2 id="timeline-confirm-title">{confirmation?.kind === "leave" ? "Leave this moment?" : "Discard this draft?"}</h2><p>{confirmation?.kind === "leave" ? preview ? "This is a preview. Leaving will reset the examples and unfinished writing." : memberNavigation ? "You have unsaved writing. Stay to publish it or save a private draft. Your draft stays available while you move around the member area." : "Leaving the member area will lose this unfinished draft. Stay to publish it or save a private draft first." : "Your saved timeline will stay as it is. Only these unfinished changes will be discarded."}</p><div><button ref={cancelButton} type="button" onClick={() => setConfirmation(null)}>Keep writing</button><button type="button" onClick={confirm}>{confirmation?.kind === "leave" ? !preview && memberNavigation ? "Leave with draft" : "Leave without saving" : "Discard draft"}</button></div>
    </dialog>
  </article>;
}
