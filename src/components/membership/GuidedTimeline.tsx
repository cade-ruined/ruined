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
  return { kind: entry?.journal.kind ?? "text", keptMedia: entry?.journal.media.map(media => ({ ...media })) ?? [], files: [], uploadIds: [], attemptedVisibility: null };
}
function mediaIds(media: PublicTimelineMediaDraft) {
  return [...media.keptMedia.map(item => item.id), ...media.files.map(file => media.uploadIds.find(([uploaded]) => uploaded === file)?.[1])];
}
function matchingMedia(media: PublicTimelineMediaDraft, entry?: StoryEntry) {
  return media.kind === (entry?.journal.kind ?? "text") && JSON.stringify(mediaIds(media)) === JSON.stringify(entry?.journal.media.map(item => item.id) ?? []);
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
  const initialEntry = startNew && (writable || preview) ? undefined : initialEntryId ? timeline.entries.find(entry => entry.id === initialEntryId) : timeline.entries[0];
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
  const matchingEntries = timeline.entries.filter(entry => `${entry.title} ${formatTimelineDate(entry, true)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedIndex = timeline.entries.findIndex(entry => entry.id === editingId);
  const nextMoment = selectedIndex >= 0 ? timeline.entries[selectedIndex + 1] : undefined;
  const answered = REFLECTIONS.filter(item => form[item.field]?.trim()).length;
  const firstUnanswered = REFLECTIONS.findIndex(item => !form[item.field]?.trim());
  const reviewingDraft = dirty || !selected || needsReview;
  const preservedDay = selected?.journal.eventYear === Number(form.year) && selected.journal.eventMonth === (form.month ? Number(form.month) : null) ? selected.journal.eventDay : null;
  const reviewDate = form.year ? preservedDay && form.month
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(form.year), Number(form.month) - 1, preservedDay)))
    : formatTimelineDate({ year: Number(form.year), month: Number(form.month) || null }, true) : "Date not added";

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
  function open(entry?: StoryEntry) {
    if (pending || recoveryDraft || (!entry && !allowEdit)) return;
    if (dirty || needsReview) {
      setError("Save or discard this draft before opening another moment.");
      formElement.current?.scrollIntoView({ block: "center" });
      return;
    }
    clearDraft(); setMissingRequested(false); setDraftId(crypto.randomUUID()); attemptId.current = null; setMissingAfterReview(false);
    setEditingId(entry?.id ?? null); setForm(formFor(entry)); setBaseline(formFor(entry)); setMedia(mediaFor(entry)); setError(""); setStatus("");
    focusStep(entry ? "review" : 0);
  }
  function discard() {
    clearDraft(); setForm(formFor(selected)); setBaseline(formFor(selected)); setMedia(mediaFor(selected));
    setNeedsReview(false); setReviewLoaded(false); setUncertain(false); attemptId.current = null; setMissingAfterReview(false); setDraftId(crypto.randomUUID()); setError(""); setStatus("Draft discarded. Your saved moments are unchanged.");
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
    const existingOutsidePage = !restored && Boolean(recoveryDraft.baseline.year);
    setEditingId(restored?.id ?? (existingOutsidePage ? recoveryDraft.editingEntryId : null)); setDraftId(recoveryDraft.editingEntryId ?? crypto.randomUUID());
    attemptId.current = recoveryDraft.wasPending ? recoveryDraft.editingEntryId : null;
    setForm({ ...EMPTY, ...recoveryDraft.form }); setBaseline({ ...EMPTY, ...recoveryDraft.baseline });
    setMedia(recoveryDraft.publicTimelineMedia ? copyPublicTimelineMedia(recoveryDraft.publicTimelineMedia) : mediaFor(restored));
    setNeedsReview(existingOutsidePage || recoveryDraft.wasPending || recoveryDraft.revision !== timeline.revision);
    setUncertain(recoveryDraft.wasPending); focusStep("review"); dismissRecovery(); setStatus(recoveryDraft.wasPending ? "Your unfinished story is restored. Check the latest saved story before continuing." : "Your unfinished story is restored. Nothing new has been published.");
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
  async function submitStep(event: FormEvent) {
    event.preventDefault();
    if (frozen) return;
    if (step !== "review") { advance(); return; }
    await save("public");
  }
  async function save(visibility: "public" | "private") {
    if (disabled || needsReview || sending.current || !validThrough("review")) return;
    if (editingId && !selected) { setNeedsReview(true); setError("This moment has changed. Load the latest saved story before saving."); return; }
    if (selected && !dirty && isPublished(selected) === (visibility === "public") && selected.journal.timelineReflection) return;
    if (media.files.length && !mediaReady) { setError("Attachments are temporarily unavailable. Your draft is still here."); return; }
    sending.current = true; setPending(true); setError("");
    const entryId = selected?.id ?? draftId;
    const workingMedia = copyPublicTimelineMedia(media);
    let entryRequestStarted = false;
    const sameDate = selected?.journal.eventYear === Number(form.year) && selected.journal.eventMonth === (form.month ? Number(form.month) : null);
    const fields = {
      kind: media.kind, title: form.title, body: form.details,
      mediaIds: [] as string[],
      eventYear: Number(form.year), eventMonth: form.month ? Number(form.month) : null,
      eventDay: sameDate ? selected?.journal.eventDay ?? null : null,
      includeOnTimeline: true, visibility,
      timelineReflection: { meaning: form.meaning?.trim() || null, belief: form.belief?.trim() || null, presentImpact: form.presentImpact?.trim() || null, perspective: form.perspective?.trim() || null },
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
        id: entryId, ...fields, title: form.title.trim() || null, body: form.details.trim() || null,
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
      const saved = install(result.entry); clearDraft(); setEditingId(saved.id); setForm(formFor(saved)); setBaseline(formFor(saved)); setMedia(mediaFor(saved));
      attemptId.current = null; setNeedsReview(false); setUncertain(false); focusStep("review");
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
        setMedia(mediaFor(target));
        setNeedsReview(false); setReviewLoaded(false); setUncertain(false); attemptId.current = null;
        setStatus(isPublished(target) ? "Your story is published on your Timeline." : "Your private draft is saved in Journal.");
      } else if (!dirty && !needsReview) {
        if (target) { setEditingId(target.id); setForm(formFor(target)); setBaseline(formFor(target)); setMedia(mediaFor(target)); focusStep("review"); }
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
    if (missingAfterReview && editingId) { setEditingId(null); setDraftId(crypto.randomUUID()); }
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
      <div><Link className={styles.back} href="/my#timeline"><Arrow back /> My profile</Link><h1>Your story.<span> In perspective.</span></h1><p>Six questions. One story. Your public Timeline.</p></div>
      <div className={styles.headerActions}>
        <span className={styles.private}>{preview ? "Preview · only here" : "Timeline · Public"}</span>
        <details className={styles.options}><summary aria-label="Timeline options">···</summary><div><button onClick={downloadDraft}>Download draft</button><button disabled={pending} onClick={() => void loadLatest()}>Load latest moments</button></div></details>
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
          <strong>{entry.title || "Untitled moment"}</strong><span className={styles.cardBottom}><span className={styles.audienceChip} data-public={isPublished(entry)}>{isPublished(entry) ? "Published" : "Private draft"}</span><Arrow /></span>
        </button></li>)}</ol>
        {visibleCount < matchingEntries.length ? <button className={styles.more} onClick={() => setVisibleCount(count => count + 40)}>Show more moments</button> : null}
        {timeline.hasMore ? <button className={styles.more} disabled={pageLoading || pending} onClick={() => void loadMore()}>{pageLoading ? "Loading…" : "Load more stories"}</button> : null}
        <p className={styles.railNote}><Lock /> Drafts stay private until you publish.</p>
      </aside>
      {missingRequested || (!allowEdit && !selected) ? <section className={styles.editor} aria-label="Timeline moment unavailable"><h2>{missingRequested ? "This moment isn’t available." : "No saved moments yet."}</h2><p>{missingRequested ? "It may have been removed. Choose another moment to revisit." : "Your Timeline stories and private drafts will appear here."}</p>{allowEdit ? <button type="button" className={styles.backStep} onClick={() => open()}>Start a new moment <Arrow /></button> : null}</section> : null}
      <form ref={formElement} className={styles.editor} hidden={missingRequested || (!allowEdit && !selected)} onSubmit={submitStep} noValidate aria-label="Explore a timeline moment">
        {step !== "review" ? <div className={styles.editorTop}>
          <div className={styles.stepCaption}><span>{STEPS[step]}</span><span>Question {step + 1} of 6</span></div>
          <nav className={styles.steps} aria-label="Questions in this moment">{STEPS.map((label, index) => <button key={label} type="button" aria-label={`Question ${index + 1}: ${label}`} aria-current={step === index ? "step" : undefined} data-past={step > index} disabled={disabled} onClick={() => go(index)}><span>{index + 1}</span></button>)}</nav>
        </div> : null}
        <section className={styles.question} data-tone="date" hidden={step !== 0} aria-label="When was this?">
          <span className={styles.overline}>Place a pin in your story</span><h2 tabIndex={-1} data-step-heading="0">When was this?</h2><p className={styles.hint}>An approximate year is enough. You don’t need to remember the exact date.</p>
          <div className={styles.date}><label htmlFor="timeline-year">Year<input id="timeline-year" inputMode="numeric" maxLength={4} required disabled={frozen} value={form.year} onChange={event => change("year", event.target.value)} placeholder="e.g. 2019" /></label><label htmlFor="timeline-month">Month <span>optional</span><select id="timeline-month" disabled={frozen} value={form.month} onChange={event => change("month", event.target.value)}><option value="">Year only</option>{TIMELINE_MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></label></div>
          <button type="button" className={styles.today} disabled={disabled} onClick={() => { const now = new Date(); change("year", String(now.getFullYear())); change("month", String(now.getMonth() + 1)); }}>It’s happening now <Arrow /></button>
        </section>
        <section className={styles.question} data-tone="moment" hidden={step !== 1} aria-label="What happened?">
          <span className={styles.overline}>{form.year || "The moment itself"}</span><h2 tabIndex={-1} data-step-heading="1">What happened?</h2><p className={styles.hint}>Start with the moment itself. The meaning can come next.</p>
          <label className={styles.fieldLabel} htmlFor="timeline-event">Give it a name<input id="timeline-event" maxLength={200} required disabled={frozen} value={form.title} onChange={event => change("title", event.target.value)} placeholder="A move. A conversation. A new beginning." /></label>
          <label className={styles.fieldLabel} htmlFor="timeline-details">A little context <span>optional</span><textarea id="timeline-details" rows={4} maxLength={Math.max(JOURNAL_BODY_LENGTH, selected?.details?.length ?? 0)} disabled={frozen} value={form.details} onChange={event => change("details", event.target.value)} placeholder="What do you remember?" /></label>
          <details className={styles.attachments}>
            <summary>{media.keptMedia.length + media.files.length ? `${media.keptMedia.length + media.files.length} attached · manage photos or video` : "Add photos or a video"}<span>optional</span></summary>
            <div className={styles.attachmentPreviews}>
              {media.keptMedia.map((item, index) => <figure key={item.id}>{media.kind === "video" ? <video src={item.url} controls playsInline preload="metadata" /> : <Image src={item.url} alt={`Attached photograph ${index + 1}`} width={240} height={180} unoptimized />}<button type="button" disabled={frozen} onClick={() => removeMedia(index, true)} aria-label={`Remove saved attachment ${index + 1}`}>Remove attachment</button></figure>)}
              {media.files.map((file, index) => <figure key={`${file.name}-${index}`}>{fileUrls[index] ? media.kind === "video" ? <video src={fileUrls[index]} controls playsInline preload="metadata" /> : <Image src={fileUrls[index]} alt={`Selected photograph ${index + 1}`} width={240} height={180} unoptimized /> : null}<figcaption>{file.name}</figcaption><button type="button" disabled={frozen} onClick={() => removeMedia(index, false)} aria-label={`Remove selected attachment ${index + 1}`}>Remove attachment</button></figure>)}
            </div>
            <label className={styles.fileInput} htmlFor="timeline-attachments">Choose {media.kind === "images" ? "photos" : media.kind === "video" ? "a video" : "photos or a video"}<input id="timeline-attachments" type="file" accept={media.kind === "text" ? `${JOURNAL_MEDIA_ACCEPT.images},${JOURNAL_MEDIA_ACCEPT.video}` : JOURNAL_MEDIA_ACCEPT[media.kind]} multiple={media.kind !== "video"} disabled={frozen || !mediaReady} onChange={event => { addFiles(event.target.files); event.target.value = ""; }} /><span>Up to 8 photos · JPG, PNG, WebP · 8 MB each<br />Or one video · MP4, WebM · 50 MB</span></label>
            {!mediaReady ? <p>New attachments are temporarily unavailable. You can keep writing and save your story.</p> : null}
          </details>
        </section>
        {REFLECTIONS.map((item, index) => <section key={item.field} className={styles.question} data-tone={item.field} hidden={step !== index + 2} aria-label={item.label}>
          <div className={styles.context}><span>{form.year}</span><span>{form.title}</span></div>
          <span className={styles.overline}>{item.chapter}</span><h2 tabIndex={-1} data-step-heading={index + 2}><label htmlFor={`timeline-${item.field}`}>{item.label}</label></h2><p className={styles.hint}>{item.hint}</p>
          <textarea id={`timeline-${item.field}`} rows={6} maxLength={4000} disabled={frozen} value={form[item.field] ?? ""} onChange={event => change(item.field, event.target.value)} placeholder={item.placeholder} aria-describedby={`hint-${item.field}`} />
          <p id={`hint-${item.field}`} className={styles.optional}>A few words are enough. You can leave this open and return later.</p>
        </section>)}
        <section className={styles.story} hidden={step !== "review"} aria-label="Your moment in perspective">
          <div className={styles.storyTop}><span className={styles.overline}>{reviewingDraft ? "Read it back" : "Your moment, in perspective"}</span><span className={styles.private}>{isPublished(selected) ? "Published · Public" : "Not published yet"}</span></div>
          <h2 className={styles.storyTitle} tabIndex={-1} data-step-heading="review">{form.title || "An unfinished moment"}</h2><p className={styles.storyDate}>{reviewDate}</p>
          {form.details ? <p className={styles.storyContext}>{form.details}</p> : null}
          {media.keptMedia.length + media.files.length ? <div className={styles.storyMedia}>{media.keptMedia.map((item, index) => media.kind === "video" ? <video key={item.id} src={item.url} controls playsInline preload="metadata" aria-label={`Attached video ${index + 1}`} /> : <Image key={item.id} src={item.url} alt={`Attached photograph ${index + 1}`} width={800} height={600} unoptimized />)}{media.files.map((file, index) => fileUrls[index] ? media.kind === "video" ? <video key={`${file.name}-${index}`} src={fileUrls[index]} controls playsInline preload="metadata" aria-label={`Selected video ${index + 1}`} /> : <Image key={`${file.name}-${index}`} src={fileUrls[index]} alt={`Selected photograph ${index + 1}`} width={800} height={600} unoptimized /> : null)}<p>These attachments will be included with your story.</p></div> : null}
          {allowEdit ? <div className={styles.storyActions}><button type="button" disabled={disabled} onClick={() => go(0)}>{reviewingDraft ? "Edit the moment" : "Edit story"}<Arrow /></button>{firstUnanswered !== -1 ? <button type="button" disabled={disabled} onClick={() => go(firstUnanswered + 2)}>Continue exploring <Arrow /></button> : null}</div> : null}
          <div className={styles.storyReflections}>{REFLECTIONS.map((item, index) => <div key={item.field} className={styles.storyReflection} data-tone={item.field} data-empty={!form[item.field]?.trim()}><div><h3>{item.chapter}</h3>{allowEdit ? <button type="button" disabled={disabled} onClick={() => go(index + 2)} aria-label={`Edit ${item.short.toLowerCase()}`}>{form[item.field]?.trim() ? "Edit" : "Explore"}<Arrow /></button> : null}</div><p>{form[item.field]?.trim() || "Still open. There’s room to come back to this."}</p></div>)}</div>
          <p className={styles.storyFoot}>{answered ? `${answered} of 4 reflections explored.` : "The moment is a starting point."} Unanswered questions will not appear on your public story.</p>
        </section>
        {step === "review" ? <div className={styles.publicationNotice}><strong>{isPublished(selected) ? "This story is on your public Timeline." : "Ready to share your story?"}</strong><p>Publishing shares the date, words, attachments, and answers shown above on your public profile. {isPublished(selected) ? "Choose Move to Journal to remove it from your public profile and keep it private." : "Choose Save private draft to keep it in Journal instead."}</p>{initialJournal.publicUrl ? <Link href={initialJournal.publicUrl} target="_blank" rel="noreferrer">View public profile ↗</Link> : null}</div> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {needsReview ? <aside className={styles.review}><h2>Review before saving.</h2>{!reviewLoaded ? <button disabled={pending} type="button" onClick={() => void loadLatest()}>Load latest saved story</button> : <>
          {selected && !missingAfterReview ? <><p>Currently saved: <strong>{selected.title}</strong> · {formatTimelineDate(selected)}</p><p className={styles.savedText}>{selected.details || "No context added."}</p>{REFLECTIONS.map(item => <p className={styles.savedText} key={item.field}>{item.short}: {selected[item.field] || "Not added."}</p>)}<button type="button" onClick={keepDraft}>Keep my draft for this story</button></> : <><p>{uncertain && !editingId ? "No saved story was found for this attempt. Your draft can be retried with the same identifier." : "This story is no longer available. Your writing is still here."}</p><button type="button" onClick={keepDraft}>{editingId ? "Keep draft as a new story" : "Keep draft and retry"}</button></>}
        </>}</aside> : null}
        <div className={styles.saveRow}>
          {step !== "review" ? <><button className={styles.backStep} type="button" disabled={disabled || step === 0} onClick={() => go(step - 1)}><Arrow back /> Back</button><div className={styles.saveActions}>{step >= 2 && !form[REFLECTIONS[step - 2].field]?.trim() ? <button className={styles.skip} type="button" disabled={disabled} onClick={advance}>Skip for now</button> : null}<button className={styles.save} type="button" disabled={disabled} onClick={event => { event.preventDefault(); advance(); }}>{step === 5 ? "Read my story" : "Continue"}<Arrow /></button></div></> : <><span className={styles.saveState}><span className={styles.stateDot} data-dirty={dirty || needsReview} aria-hidden="true" />{pending ? "Saving…" : needsReview ? "Review needed" : dirty ? "Unpublished changes" : !allowEdit ? "Read only" : preview ? "Preview only" : isPublished(selected) ? "Published to Timeline" : selected ? "Private draft" : "New story"}</span>{allowEdit ? <div className={styles.saveActions}><button className={styles.skip} type="button" disabled={disabled || needsReview || (!dirty && Boolean(selected) && !isPublished(selected) && Boolean(selected?.journal.timelineReflection))} onClick={() => void save("private")}>{isPublished(selected) ? "Move to Journal" : "Save private draft"}</button><button className={styles.save} type="submit" disabled={disabled || needsReview || (!dirty && isPublished(selected) && Boolean(selected?.journal.timelineReflection))}>{pending ? "Saving…" : isPublished(selected) ? "Update Timeline" : "Publish to Timeline"}{pending ? null : <Arrow />}</button></div> : null}</>}
        </div>
        {uploading ? <div className={styles.uploadStatus}><span role="status">Uploading attachments…</span><button type="button" onClick={() => uploadController.current?.abort()}>Cancel upload</button></div> : null}
        <p className={styles.status} role="status">{status}</p>
        <div className={styles.afterword}><div>{dirty || needsReview ? <button className={styles.discard} type="button" disabled={pending || (uncertain && !reviewLoaded)} onClick={() => ask({ kind: "discard" })} aria-label="Discard draft">Discard draft</button> : <span>Go at your own pace. Nothing publishes automatically.</span>}{step !== "review" && (step >= 2 || selected) ? <button type="button" disabled={disabled} onClick={() => go("review")}>Review my story</button> : null}</div>{nextMoment && !dirty && !needsReview && step === "review" ? <button type="button" disabled={pending || Boolean(recoveryDraft)} onClick={() => open(nextMoment)}>Next moment <Arrow /></button> : null}</div>
      </form>
    </div>
    {foundation?.completedAt ? <p className={styles.foundationStatus}>Foundations Timeline step complete. Your story keeps going.</p> : foundation?.allowed && timeline.entries.some(entry => entry.journal.eventYear !== null && entry.title.trim() && (!isPublished(entry) || entry.journal.timelineReflection)) ? <div className={styles.foundationStatus}><span>Ready to mark your Foundations Timeline step complete?</span><button type="button" disabled={completing || pending || dirty || needsReview} onClick={() => void completeFoundation()}>{completing ? "Recording…" : "Complete Foundations step"}</button></div> : null}
    <dialog ref={dialog} className={styles.confirmation} aria-labelledby="timeline-confirm-title" onCancel={event => { event.preventDefault(); setConfirmation(null); }}>
      <h2 id="timeline-confirm-title">{confirmation?.kind === "leave" ? "Leave this moment?" : "Discard this draft?"}</h2><p>{confirmation?.kind === "leave" ? preview ? "This is a preview. Leaving will reset the examples and unfinished writing." : memberNavigation ? "You have unsaved writing. Stay to publish it or save a private draft. Your draft stays available while you move around the member area." : "Leaving the member area will lose this unfinished draft. Stay to publish it or save a private draft first." : "Your saved timeline will stay as it is. Only these unfinished changes will be discarded."}</p><div><button ref={cancelButton} type="button" onClick={() => setConfirmation(null)}>Keep writing</button><button type="button" onClick={confirm}>{confirmation?.kind === "leave" ? !preview && memberNavigation ? "Leave with draft" : "Leave without saving" : "Discard draft"}</button></div>
    </dialog>
  </article>;
}
