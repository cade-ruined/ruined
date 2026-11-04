"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";

import type { MemberTimelineEntry } from "@/lib/membership/model";
import { PRACTICE_CATEGORIES, type PracticeAction, type PracticeCourse, type PracticeSnapshot, type PracticeTimeFields, type PracticeTimelineDraft } from "@/lib/practice/model";

import { usePracticeDraftStore, type PracticeDrafts as Drafts, type PracticeWork as Work } from "./MemberPracticeDraftState";
import styles from "./MemberPractice.module.css";

type Area = "foundations" | "monthly";
type View = "overview" | "assignment" | "work" | "read" | "recap";
type SaveState = "idle" | "saving" | "saved" | "error";
type FailedRequest = { request: PracticeAction; entryIds: string[] };

const blankTimeline = (): PracticeTimelineDraft => ({ id: null, year: null, title: "", details: "", meaning: "", presentImpact: "" });
const timeFields = (value: PracticeTimeFields): PracticeTimeFields => ({ action: value.action, category: value.category, minutes: value.minutes, sourceCategory: value.sourceCategory, sourceMinutes: value.sourceMinutes });
const draftsFor = (value: PracticeSnapshot): Drafts => ({ timeline: value.timelineDraft ?? blankTimeline(), letter: { body: value.letter.body }, time: timeFields(value.time) });
const signature = (value: unknown) => JSON.stringify(value);
const workFor = (course: PracticeCourse): Work => course === "f1" ? "timeline" : course === "f4" ? "letter" : "time";
const hasTimelineDraft = (draft: PracticeTimelineDraft) => Boolean(draft.id || draft.year || draft.title.trim() || draft.details.trim() || draft.meaning.trim() || draft.presentImpact.trim());
const entryDraft = (entry: MemberTimelineEntry): PracticeTimelineDraft => ({ id: entry.id, year: entry.year, month: entry.month ?? null, title: entry.title, details: entry.details ?? "", meaning: entry.meaning ?? "", presentImpact: entry.presentImpact ?? "", belief: entry.belief, perspective: entry.perspective });
const foundationIds: PracticeCourse[] = ["f1", "f2", "f3", "f4"];
const courseTitle = (course: PracticeCourse) => course === "time" ? "TIME / December" : `Foundations ${course.slice(1)}`;
const assignmentTitle = (course: PracticeCourse) => course === "f1" ? "Add 3 timeline entries" : course === "f4" ? "A letter to your future self" : course === "time" ? "Make room in MY 168" : "Assignment to be announced";
const releaseLabel = (course: PracticeCourse) => course === "time" ? "Opens December 1" : `Opens with the Foundations ${course.slice(1)} call`;
const categoryLabel = (id: string) => PRACTICE_CATEGORIES.find(category => category.id === id)?.label ?? "your week";
const duration = (minutes: number) => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ""}${minutes % 60 ? `${minutes >= 60 ? " " : ""}${minutes % 60}m` : ""}` || "0m";

function Badge({ course, earned = false }: { course: PracticeCourse; earned?: boolean }) {
  return <span className={`${styles.badge} ${course === "time" ? styles.badgeTime : styles.badgeArtwork} ${earned ? styles.earned : ""}`} role="img" aria-label={`${course.toUpperCase()} Badge${earned ? " earned" : " not yet earned"}`}>
    {course === "time" ? "TIME" : <Image src={`/membership/badges/foundations-${course}-v1.png`} alt="" width={160} height={160} sizes="(max-width: 640px) 74px, 112px" draggable={false} />}
  </span>;
}
function Lock() {
  return <svg className={styles.lock} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" role="img" aria-label="Locked"><path d="M8 10V7a4 4 0 0 1 8 0v3" /><rect x="5" y="10" width="14" height="11" rx="1" /></svg>;
}
function Progress({ completed, target, label }: { completed: number; target: number; label: string }) {
  return <div className={styles.progress} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(completed, target)}><div className={styles.progressLabel}><strong>{Math.min(completed, target)}<span> / {target}</span></strong><span>{label}</span></div><div className={styles.progressTrack} aria-hidden="true">{Array.from({ length: target }, (_, index) => <span className={index < completed ? styles.complete : ""} key={index} />)}</div></div>;
}
function Primary({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className={`member-button member-button-primary ${styles.primary}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function MemberPractice({ initial, connected, initialArea = "foundations", initialCourse }: {
  initial: PracticeSnapshot;
  connected: boolean;
  initialArea?: Area;
  initialCourse?: PracticeCourse;
}) {
  const draftStore = usePracticeDraftStore();
  const writerRef = useRef(Symbol("practice-draft"));
  const [recovery] = useState(() => draftStore?.read()?.draft ?? null);
  const needsReconciliation = Boolean(recovery && (recovery.failed || recovery.revision !== initial.revision));
  const [snapshot, setSnapshot] = useState(initial);
  const snapshotRef = useRef(initial);
  const [area, setArea] = useState<Area>((recovery?.course ?? initialCourse) === "time" ? "monthly" : initialArea);
  const [course, setCourse] = useState<PracticeCourse>(recovery?.course ?? initialCourse ?? (initialArea === "monthly" ? "time" : "f1"));
  const [view, setView] = useState<View>(recovery ? "work" : initialCourse ? "assignment" : "overview");
  const [readEntry, setReadEntry] = useState<PracticeTimelineDraft | null>(null);
  const [step, setStep] = useState(recovery?.step ?? 0);
  const [drafts, setDrafts] = useState<Drafts>(() => recovery?.drafts ?? draftsFor(initial));
  const draftsRef = useRef(recovery?.drafts ?? draftsFor(initial));
  const savedRef = useRef(recovery?.saved ?? { timeline: signature(draftsFor(initial).timeline), letter: signature(draftsFor(initial).letter), time: signature(draftsFor(initial).time) });
  const [yearInput, setYearInput] = useState(recovery?.yearInput ?? initial.timelineDraft?.year?.toString() ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState(needsReconciliation ? "Your unfinished work is still here. Check the saved version before continuing." : "");
  const [blocked, setBlocked] = useState(needsReconciliation);
  const blockedRef = useRef(needsReconciliation);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const pendingRef = useRef<Promise<boolean> | null>(null);
  const navigationPendingRef = useRef(false);
  const failedRef = useRef<FailedRequest | null>(recovery?.failed ?? null);
  const availabilitySequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cursorRef = useRef({ course, step, yearInput });
  cursorRef.current = { course, step, yearInput };
  const writable = connected && snapshot.canWrite;
  const work = workFor(course);
  const primaryDisabled = !writable || blocked || finishing;

  const acceptSnapshot = useCallback((next: PracticeSnapshot) => {
    if (!mountedRef.current || next.ownerId !== initial.ownerId) return;
    snapshotRef.current = next;
    setSnapshot(next);
  }, [initial.ownerId]);

  const replaceDrafts = useCallback((next: Drafts) => {
    draftsRef.current = next;
    setDrafts(next);
    setYearInput(next.timeline.year?.toString() ?? "");
  }, []);

  const updateDraft = useCallback(<K extends Work>(kind: K, value: Drafts[K]) => {
    const next = { ...draftsRef.current, [kind]: value };
    draftsRef.current = next;
    setDrafts(next);
    setSaveState("idle");
  }, []);

  const readSnapshot = useCallback(async (response: Response): Promise<PracticeSnapshot> => {
    const payload = await response.json() as PracticeSnapshot & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Your work could not be saved.");
    if (payload.ownerId !== initial.ownerId || !payload.timeline || !Array.isArray(payload.timeline.entries) || !payload.releases || !payload.badges) {
      throw new Error("Your signed-in account changed. Reload this page before continuing.");
    }
    return payload;
  }, [initial.ownerId]);

  const send = useCallback(async (request: PracticeAction): Promise<PracticeSnapshot | null> => {
    if (!connected || !snapshotRef.current.canWrite || blockedRef.current) return null;
    setSaveState("saving");
    failedRef.current = { request, entryIds: snapshotRef.current.timeline.entries.map(entry => entry.id) };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/my/practice", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json", "x-ruined-session-owner": initial.ownerId },
        body: JSON.stringify(request),
      });
      const next = await readSnapshot(response);
      if (!mountedRef.current) return null;
      acceptSnapshot(next);
      failedRef.current = null;
      setSaveState("saved");
      setMessage("");
      return next;
    } catch (error) {
      if (!mountedRef.current) return null;
      blockedRef.current = true;
      setBlocked(true);
      setRecoveryReady(false);
      setSaveState("error");
      setMessage(error instanceof Error && error.name !== "AbortError" ? error.message : "We couldn’t confirm the save. Your work is still here. Check your saved work before continuing.");
      return null;
    } finally { window.clearTimeout(timeout); }
  }, [acceptSnapshot, connected, initial.ownerId, readSnapshot]);

  const flush = useCallback(async (kind: Work): Promise<boolean> => {
    while (pendingRef.current) if (!await pendingRef.current) return false;
    if (blockedRef.current) return false;
    if (savedRef.current[kind] === signature(draftsRef.current[kind])) return true;
    if (!connected || !snapshotRef.current.canWrite) return false;
    const operation = (async () => {
      while (savedRef.current[kind] !== signature(draftsRef.current[kind])) {
        const fields = { ...draftsRef.current[kind] };
        const serialized = signature(fields);
        const base = { ownerId: initial.ownerId, expectedRevision: snapshotRef.current.revision };
        const request: PracticeAction = kind === "timeline"
          ? { ...base, action: "save_timeline_draft", fields: fields as PracticeTimelineDraft }
          : kind === "letter" ? { ...base, action: "save_letter", fields: fields as { body: string } }
            : { ...base, action: "save_time", fields: fields as PracticeTimeFields };
        const next = await send(request);
        if (!next) return false;
        savedRef.current[kind] = serialized;
      }
      return true;
    })();
    pendingRef.current = operation;
    try { return await operation; } finally { if (pendingRef.current === operation) pendingRef.current = null; }
  }, [connected, initial.ownerId, send]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const checkpoint = useCallback(() => {
    const dirty = Object.keys(savedRef.current).some(key => savedRef.current[key as Work] !== signature(draftsRef.current[key as Work]));
    if (connected && (dirty || pendingRef.current || failedRef.current)) {
      draftStore?.write(writerRef.current, { drafts: draftsRef.current, saved: savedRef.current, revision: snapshotRef.current.revision, ...cursorRef.current, failed: failedRef.current });
    } else draftStore?.clear(writerRef.current);
  }, [connected, draftStore]);

  useEffect(() => { checkpoint(); }, [checkpoint, drafts, saveState, course, step, yearInput]);
  useEffect(() => () => { checkpoint(); }, [checkpoint]);

  useEffect(() => {
    if (view !== "work" || !writable || blocked || finishing) return;
    const timer = window.setTimeout(() => { void flush(work); }, 700);
    return () => window.clearTimeout(timer);
  }, [blocked, drafts, finishing, flush, view, work, writable]);

  useEffect(() => {
    const unsaved = () => Boolean(pendingRef.current || failedRef.current) || Object.keys(savedRef.current).some(key => savedRef.current[key as Work] !== signature(draftsRef.current[key as Work]));
    function beforeUnload(event: BeforeUnloadEvent) {
      if (unsaved()) { event.preventDefault(); event.returnValue = ""; }
    }
    function leaveThroughLink(event: MouseEvent) {
      if (!unsaved() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      let destination: URL;
      try { destination = new URL(anchor.href, window.location.href); } catch { return; }
      if (!["http:", "https:"].includes(destination.protocol)) return;
      const current = new URL(window.location.href);
      if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (navigationPendingRef.current) return;
      navigationPendingRef.current = true;
      void (async () => {
        try {
          for (const kind of ["timeline", "letter", "time"] as Work[]) if (!await flush(kind)) return;
          if (mountedRef.current) window.location.assign(destination.href);
        } finally { navigationPendingRef.current = false; }
      })();
    }
    function browserBack() {
      if (!unsaved()) return;
      checkpoint();
      void (async () => { for (const kind of ["timeline", "letter", "time"] as Work[]) if (!await flush(kind)) return; })();
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", browserBack);
    document.addEventListener("click", leaveThroughLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", browserBack);
      document.removeEventListener("click", leaveThroughLink, true);
    };
  }, [checkpoint, flush]);

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [view, course, step]);

  useEffect(() => {
    if (!connected) return;
    let current = true;
    const controller = new AbortController();
    async function refreshAvailability() {
      if (document.hidden || pendingRef.current || failedRef.current) return;
      const sequence = ++availabilitySequenceRef.current;
      const revision = snapshotRef.current.revision;
      try {
        const response = await fetch("/api/my/practice", { cache: "no-store", signal: controller.signal, headers: { "x-ruined-session-owner": initial.ownerId } });
        const next = await readSnapshot(response);
        if (!current || sequence !== availabilitySequenceRef.current || pendingRef.current || failedRef.current || snapshotRef.current.revision !== revision) return;
        // Availability can change during a call. Writing and its baseline stay
        // untouched; newer account work is reconciled through the save flow.
        acceptSnapshot({ ...snapshotRef.current, releases: next.releases, canWrite: next.canWrite });
      } catch { /* A failed availability refresh never discards or blocks open writing. */ }
    }
    window.addEventListener("focus", refreshAvailability);
    document.addEventListener("visibilitychange", refreshAvailability);
    return () => {
      current = false;
      controller.abort();
      window.removeEventListener("focus", refreshAvailability);
      document.removeEventListener("visibilitychange", refreshAvailability);
    };
  }, [acceptSnapshot, connected, initial.ownerId, readSnapshot]);

  const syncUrl = (nextArea: Area, nextCourse?: PracticeCourse) => {
    const query = new URLSearchParams({ area: nextArea });
    if (nextCourse) query.set("course", nextCourse);
    window.history.replaceState(window.history.state, "", `/my/practice?${query}`);
  };

  async function navigate(nextView: View, nextCourse = course, nextArea: Area = nextCourse === "time" ? "monthly" : "foundations") {
    if (view === "work" && !await flush(work)) return;
    setMessage("");
    setArea(nextArea);
    setCourse(nextCourse);
    setView(nextView);
    setStep(0);
    syncUrl(nextArea, nextView === "overview" ? undefined : nextCourse);
  }

  async function openDeck() {
    if (!snapshotRef.current.releases[course]) return;
    if (view === "work" && !await flush(work)) return;
    window.location.assign(`/my/practice/deck/${course}`);
  }

  function beginWork() {
    if (!snapshot.releases[course] || course === "f2" || course === "f3") return;
    setMessage("");
    if (!writable) {
      setReadEntry(snapshot.timelineDraft ?? (snapshot.timeline.entries[0] ? entryDraft(snapshot.timeline.entries[0]) : null));
      setView("read");
      return;
    }
    setStep(course === "f1" ? !drafts.timeline.year ? 0 : !drafts.timeline.title.trim() ? 1 : !drafts.timeline.meaning.trim() ? 2 : !drafts.timeline.presentImpact.trim() ? 3 : 0
      : course === "time" ? !drafts.time.action.trim() ? 0 : !drafts.time.category ? 1 : !drafts.time.minutes ? 2 : !drafts.time.sourceCategory ? 3 : !drafts.time.sourceMinutes ? 4 : 5 : 0);
    setView("work");
  }

  function editEntry(entry: MemberTimelineEntry) {
    if (!writable) { setReadEntry(entryDraft(entry)); setView("read"); return; }
    if (hasTimelineDraft(draftsRef.current.timeline) && draftsRef.current.timeline.id !== entry.id) {
      setMessage("Finish your current entry before opening another. It’s saved in Foundations 1.");
      return;
    }
    updateDraft("timeline", entryDraft(entry));
    setYearInput(String(entry.year));
    setStep(0);
    setView("work");
  }

  async function finish() {
    if (primaryDisabled) return;
    setFinishing(true);
    try {
      if (!await flush(work)) return;
      const base = { ownerId: initial.ownerId, expectedRevision: snapshotRef.current.revision };
      const request: PracticeAction = work === "timeline"
        ? { ...base, action: "keep_timeline_entry", expectedTimelineRevision: snapshotRef.current.timeline.revision, fields: draftsRef.current.timeline }
        : work === "letter" ? { ...base, action: "keep_letter", fields: draftsRef.current.letter }
          : { ...base, action: "keep_time", fields: draftsRef.current.time };
      const operation = send(request);
      const pending = operation.then(Boolean);
      pendingRef.current = pending;
      const next = await operation;
      if (pendingRef.current === pending) pendingRef.current = null;
      if (!next) return;
      const nextDrafts = draftsFor(next);
      replaceDrafts(nextDrafts);
      savedRef.current = { timeline: signature(nextDrafts.timeline), letter: signature(nextDrafts.letter), time: signature(nextDrafts.time) };
      setView("assignment");
      setStep(0);
      window.dispatchEvent(new CustomEvent("ruined:member-progress"));
    } finally { setFinishing(false); }
  }

  async function continueStep() {
    if (primaryDisabled) return;
    if (!await flush(work)) return;
    setStep(current => current + 1);
  }

  async function checkSavedWork() {
    setSaveState("saving");
    try {
      const response = await fetch("/api/my/practice", { cache: "no-store", headers: { "x-ruined-session-owner": initial.ownerId } });
      const next = await readSnapshot(response);
      acceptSnapshot(next);
      const failed = failedRef.current;
      const pendingEntry = failed?.request.action === "keep_timeline_entry" ? failed.request.fields : null;
      const keptEntry = pendingEntry && next.timelineDraft === null && next.timeline.entries.find(entry =>
        next.lastTimelineEntryId === entry.id
        &&
        (pendingEntry.id ? entry.id === pendingEntry.id : !failed!.entryIds.includes(entry.id))
        && entry.year === pendingEntry.year && entry.title.trim() === pendingEntry.title.trim()
        && (entry.details ?? "").trim() === pendingEntry.details.trim()
        && (pendingEntry.month === undefined || (entry.month ?? null) === pendingEntry.month)
        && (pendingEntry.belief === undefined || (entry.belief ?? "").trim() === (pendingEntry.belief ?? "").trim())
        && (pendingEntry.perspective === undefined || (entry.perspective ?? "").trim() === (pendingEntry.perspective ?? "").trim())
        && (entry.meaning ?? "").trim() === pendingEntry.meaning.trim()
        && (entry.presentImpact ?? "").trim() === pendingEntry.presentImpact.trim());
      if (keptEntry) {
        const nextDrafts = draftsFor(next);
        replaceDrafts(nextDrafts);
        savedRef.current = { timeline: signature(nextDrafts.timeline), letter: signature(nextDrafts.letter), time: signature(nextDrafts.time) };
        blockedRef.current = false;
        setBlocked(false);
        failedRef.current = null;
        setMessage("Your entry was saved.");
        setSaveState("saved");
        setView("assignment");
        window.dispatchEvent(new CustomEvent("ruined:member-progress"));
        return;
      }
      const serverDrafts = draftsFor(next);
      const matching = signature(serverDrafts[work]) === signature(draftsRef.current[work]);
      if (matching) {
        savedRef.current[work] = signature(serverDrafts[work]);
        blockedRef.current = false;
        setBlocked(false);
        failedRef.current = null;
        setMessage("");
        setSaveState("saved");
        if ((failed?.request.action === "keep_letter" && next.letter.keptAt) || (failed?.request.action === "keep_time" && next.time.keptAt)) {
          setView("assignment");
          window.dispatchEvent(new CustomEvent("ruined:member-progress"));
        }
      } else {
        setMessage("Your saved work is different from the draft open here. Choose which version to continue with.");
        setRecoveryReady(true);
        setSaveState("error");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your saved work could not be checked. Your draft is still here.");
      setSaveState("error");
    }
  }

  function resolveRecovery(useOpenDraft: boolean) {
    const serverDrafts = draftsFor(snapshotRef.current);
    savedRef.current = { timeline: signature(serverDrafts.timeline), letter: signature(serverDrafts.letter), time: signature(serverDrafts.time) };
    if (!useOpenDraft) replaceDrafts(serverDrafts);
    blockedRef.current = false;
    setBlocked(false);
    setRecoveryReady(false);
    failedRef.current = null;
    setMessage("");
    setSaveState(useOpenDraft ? "idle" : "saved");
  }

  function downloadDraft() {
    const value = draftsRef.current[work];
    const text = work === "timeline" ? [draftsRef.current.timeline.year, draftsRef.current.timeline.title, draftsRef.current.timeline.details, draftsRef.current.timeline.meaning, draftsRef.current.timeline.presentImpact].filter(Boolean).join("\n\n")
      : work === "letter" ? draftsRef.current.letter.body : `${draftsRef.current.time.action}\n\n${duration(draftsRef.current.time.minutes)} for ${categoryLabel(draftsRef.current.time.category)}\nFrom ${categoryLabel(draftsRef.current.time.sourceCategory)} (${duration(draftsRef.current.time.sourceMinutes)} currently)`;
    if (!value) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `ruined-${course}-draft.txt`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const badgeFor = (id: PracticeCourse) => id === "f1" ? snapshot.badges.f1 : id === "f4" ? snapshot.badges.f4 : id === "time" ? snapshot.badges.time : null;
  const entryComplete = (entry: MemberTimelineEntry) => snapshot.timeline.completeEntryIds?.includes(entry.id) === true;
  const resourceLinks = <div className={styles.resources} aria-label="Supporting resources"><button type="button" className={styles.textButton} onClick={() => void openDeck()}>View deck ↗</button>{course === "f1" || course === "time" ? <button type="button" className={styles.textButton} onClick={() => void navigate("recap")}>Call recap ↗</button> : null}</div>;
  const back = <div className={styles.back}><button type="button" className={styles.textButton} onClick={() => void navigate("overview")}>← All {area === "monthly" ? "Monthly" : "Foundations"}</button></div>;

  function overview() {
    const ids = area === "monthly" ? ["time" as const] : foundationIds;
    const featured = ids.find(id => snapshot.releases[id] && (id === "f1" || id === "f4" || id === "time") && !badgeFor(id)?.earned) ?? ids.find(id => snapshot.releases[id]);
    return <section aria-label={area === "monthly" ? "Monthly assignments" : "Foundations assignments"}><header className={styles.sectionHeading}><h2 ref={headingRef} tabIndex={-1}>{area === "monthly" ? "Monthly." : "Foundations."}</h2><p>{area === "monthly" ? "One assignment each month." : "One assignment for each call."}</p></header><div className={styles.courseList}>{ids.map(id => {
      const released = snapshot.releases[id], badge = badgeFor(id), current = released && featured === id;
      return <article key={id} className={`${styles.course} ${current ? styles.current : ""} ${!released ? styles.locked : ""}`} aria-label={`${courseTitle(id)}${released ? "" : ". Locked"}`}><Badge course={id} earned={badge?.earned} /><div className={styles.courseCopy}><h3>{courseTitle(id)}</h3><p>{assignmentTitle(id)}</p>{released && (id === "f1" || id === "time") && badge ? <Progress completed={badge.completed} target={badge.target} label={id === "f1" ? "timeline entries" : "steps complete"} /> : <span className={styles.courseStatus}>{!released ? releaseLabel(id) : badge?.earned ? "Badge earned" : id === "f2" || id === "f3" ? "Assignment to be announced" : "Ready when you are"}</span>}</div><div className={styles.courseAction}>{released ? <Primary onClick={() => void navigate("assignment", id)}>{badge?.earned ? "View assignment →" : "Continue →"}</Primary> : <Lock />}</div></article>;
    })}</div></section>;
  }

  function assignment() {
    const released = snapshot.releases[course], badge = badgeFor(course), known = course !== "f2" && course !== "f3";
    const heading = badge?.earned ? `${course.toUpperCase()} Badge earned.` : `${assignmentTitle(course)}.`;
    const hasSavedWork = course === "f1" ? Boolean(snapshot.timelineDraft || snapshot.timeline.entries.length) : course === "f4" ? Boolean(snapshot.letter.body.trim()) : Boolean(snapshot.time.action.trim());
    const intro = !released ? `${releaseLabel(course)}.` : !known ? `The assignment for your ${course.toUpperCase()} Badge will appear here.` : course === "f1" ? badge?.earned ? "Three moments. A clearer view of your story." : "Choose experiences that changed you, good or bad. Work through one moment at a time."
      : course === "f4" ? badge?.earned ? "You’ve kept something for the person you’re becoming." : "Write what you want yourself to remember a year from now."
        : badge?.earned ? "Your next step has a place in your week." : "Choose one thing that matters, then give it time in your week.";
    return <section aria-label={`${courseTitle(course)} assignment`}>{back}<header className={styles.assignmentHeading}><div><p className={styles.chapter}>{courseTitle(course)}</p><h2 ref={headingRef} tabIndex={-1}>{heading}</h2><p className={styles.intro}>{intro}</p></div><Badge course={course} earned={badge?.earned} /></header>{released && known ? <>
      {course === "f1" || course === "time" ? <Progress completed={badge?.completed ?? 0} target={course === "f1" ? 3 : 2} label={course === "f1" ? "timeline entries" : "steps complete"} /> : null}
      {course === "time" ? <><ol className={styles.steps} aria-label="Your assignment"><li className={(badge?.completed ?? 0) > 0 ? styles.stepComplete : ""}><span aria-hidden="true">{(badge?.completed ?? 0) > 0 ? "✓" : "01"}</span>Choose one thing</li><li className={badge?.earned ? styles.stepComplete : ""}><span aria-hidden="true">{badge?.earned ? "✓" : "02"}</span>Make room in MY 168</li></ol>{snapshot.time.action ? <div className={styles.keptPlan}><p>{snapshot.time.action}</p>{badge?.earned ? <span>{duration(snapshot.time.minutes)} planned each week</span> : null}</div> : null}</> : null}
      <div className={styles.assignmentAction}><Primary disabled={(!writable && !hasSavedWork) || blocked} onClick={beginWork}>{!writable && hasSavedWork ? "View my work →" : course === "f1" ? hasTimelineDraft(drafts.timeline) ? "Continue entry →" : badge?.earned ? "Add another entry →" : "Add an entry →" : course === "f4" ? drafts.letter.body.trim() ? "Revisit my letter →" : "Write my letter →" : badge?.earned ? "View my week →" : snapshot.time.action || drafts.time.action ? "Continue →" : "Start assignment →"}</Primary></div>
      {course === "f1" && snapshot.timeline.entries.length ? <section className={styles.entries} aria-label="Your private timeline entries"><h3>Your entries</h3><ol>{snapshot.timeline.entries.map((entry, index) => <li key={entry.id}><button type="button" onClick={() => editEntry(entry)} disabled={blocked}><span className={styles.entryNumber}>{String(index + 1).padStart(2, "0")}</span><span>{entry.title}</span><span className={styles.entryState}>{!writable ? "Read ↗" : entryComplete(entry) ? "Complete ↗" : "Continue ↗"}</span></button></li>)}</ol></section> : null}
    </> : null}{released ? resourceLinks : null}</section>;
  }

  function timelineWork() {
    const draft = drafts.timeline;
    const questions = ["When was this?", "What happened?", "What did I make it mean?", "How did that meaning shape me?"];
    const valid = step === 0 ? draft.year !== null && draft.year >= 1900 && draft.year <= 2200 : step === 1 ? Boolean(draft.title.trim()) : step === 2 ? Boolean(draft.meaning.trim()) : Boolean(draft.presentImpact.trim());
    const change = <K extends keyof PracticeTimelineDraft>(key: K, value: PracticeTimelineDraft[K]) => updateDraft("timeline", { ...draftsRef.current.timeline, [key]: value });
    return <><div className={styles.question}><h2 ref={headingRef} tabIndex={-1} id="practice-question">{questions[step]}</h2>{step === 0 ? <p>An approximate year is enough.</p> : step === 1 ? <p>Don’t only look for the hardest moments. Include experiences that changed you, good or bad.</p> : null}</div>
      {step === 0 ? <div className={styles.field}><label htmlFor="practice-year">Year</label><input id="practice-year" type="number" inputMode="numeric" min="1900" max="2200" value={yearInput} onChange={event => { const value = event.target.value; setYearInput(value); const year = Number(value); change("year", value && Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null); }} /></div>
        : step === 1 ? <><div className={styles.field}><label htmlFor="practice-event">Name the moment</label><input id="practice-event" value={draft.title} maxLength={200} onChange={event => change("title", event.target.value)} /></div><div className={styles.field}><label htmlFor="practice-details">A little more <span className={styles.optional}>(optional)</span></label><textarea id="practice-details" value={draft.details} maxLength={draft.id ? 20000 : 4000} onChange={event => change("details", event.target.value)} /></div></>
          : <div className={styles.field}><label htmlFor="practice-reflection" className="sr-only">{questions[step]}</label><textarea key={step} id="practice-reflection" aria-labelledby="practice-question" value={step === 2 ? draft.meaning : draft.presentImpact} maxLength={4000} onChange={event => change(step === 2 ? "meaning" : "presentImpact", event.target.value)} /></div>}
      <div className={styles.workActions}><button type="button" className={styles.textButton} onClick={() => step ? setStep(value => value - 1) : void navigate("assignment")}>← Back</button><Primary disabled={primaryDisabled || !valid} onClick={() => void (step === 3 ? finish() : continueStep())}>{finishing ? "Keeping…" : step === 3 ? draft.id ? "Keep changes →" : "Keep entry →" : "Continue →"}</Primary></div></>;
  }

  function timeWork() {
    const draft = drafts.time;
    const questions = ["What do you want to make room for?", "Which part of your life is this for?", "How much time will you give it?", "Where will that time come from?", "How much time goes there now?", "Make room for this."];
    const valid = step === 0 ? Boolean(draft.action.trim()) : step === 1 ? Boolean(draft.category) : step === 2 ? draft.minutes > 0 && draft.minutes <= 10080 : step === 3 ? Boolean(draft.sourceCategory && draft.sourceCategory !== draft.category) : step === 4 ? draft.sourceMinutes >= draft.minutes && draft.sourceMinutes <= 10080 : Boolean(draft.action.trim() && draft.category && draft.sourceCategory && draft.category !== draft.sourceCategory && draft.minutes > 0 && draft.sourceMinutes >= draft.minutes);
    const change = <K extends keyof PracticeTimeFields>(key: K, value: PracticeTimeFields[K]) => updateDraft("time", { ...draftsRef.current.time, [key]: value });
    return <><div className={styles.question}><h2 ref={headingRef} tabIndex={-1} id="practice-question">{questions[step]}</h2>{step === 0 ? <p>One concrete thing you can do this week.</p> : step === 2 ? <p>Count the minutes for one week.</p> : step === 4 ? <p>Estimate a week of {categoryLabel(draft.sourceCategory).toLowerCase()}. You’re making room for {duration(draft.minutes)}.</p> : null}</div>
      {step === 0 ? <div className={styles.field}><label className="sr-only" htmlFor="practice-action">Your next step</label><textarea id="practice-action" aria-labelledby="practice-question" value={draft.action} maxLength={2000} onChange={event => change("action", event.target.value)} /></div>
        : step === 1 || step === 3 ? <div className={styles.field}><label htmlFor="practice-category">{step === 1 ? "Part of my life" : "Take time from"}</label><select id="practice-category" value={step === 1 ? draft.category : draft.sourceCategory} onChange={event => change(step === 1 ? "category" : "sourceCategory", event.target.value as PracticeTimeFields["category"])}><option value="">Choose an area</option>{PRACTICE_CATEGORIES.filter(category => step === 1 || category.id !== draft.category).map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div>
          : step === 2 || step === 4 ? <div className={styles.field}><label htmlFor="practice-minutes">Minutes per week</label><input id="practice-minutes" type="number" inputMode="numeric" min={step === 4 ? draft.minutes : 1} max={10080} step={1} value={(step === 2 ? draft.minutes : draft.sourceMinutes) || ""} onChange={event => { const value = Number(event.target.value); change(step === 2 ? "minutes" : "sourceMinutes", Number.isInteger(value) && value >= 0 && value <= 10080 ? value : 0); }} /></div>
            : <div className={styles.planReview}><p>{draft.action}</p><span>{duration(draft.minutes)} each week for {categoryLabel(draft.category).toLowerCase()}, from {categoryLabel(draft.sourceCategory).toLowerCase()}.</span></div>}
      <div className={styles.workActions}><button type="button" className={styles.textButton} onClick={() => step ? setStep(value => value - 1) : void navigate("assignment")}>← Back</button><Primary disabled={primaryDisabled || !valid} onClick={() => void (step === 5 ? finish() : continueStep())}>{finishing ? "Keeping…" : step === 5 ? "Keep my plan →" : "Continue →"}</Primary></div></>;
  }

  function workView() {
    if (!snapshot.releases[course]) return assignment();
    return <section className={styles.work} aria-label={`${courseTitle(course)} work`}><div className={styles.workTop}><button type="button" className={styles.textButton} onClick={() => void navigate("assignment")}>← Assignment</button><p>{course === "f1" ? `${step + 1} / 4` : course === "time" ? `${Math.min(step + 1, 5)} / 5` : "Foundations 4"}</p></div>
      <fieldset className={styles.workFields} disabled={finishing || blocked || !writable}>{course === "f1" ? timelineWork() : course === "time" ? timeWork() : <><div className={styles.question}><h2 ref={headingRef} tabIndex={-1} id="practice-question">A letter to your future self.</h2><p>What do you want yourself to remember a year from now?</p></div><div className={styles.field}><label htmlFor="practice-letter" className="sr-only">Your private letter</label><textarea className={styles.letterField} id="practice-letter" aria-labelledby="practice-question" value={drafts.letter.body} maxLength={20000} onChange={event => updateDraft("letter", { body: event.target.value })} /></div><div className={styles.workActions}><button type="button" className={styles.textButton} onClick={downloadDraft}>Download a copy ↗</button><Primary disabled={primaryDisabled || !drafts.letter.body.trim()} onClick={() => void finish()}>{finishing ? "Keeping…" : "Keep my letter →"}</Primary></div></>}</fieldset>
      <p className={styles.saveState} role="status" aria-live="polite">{!writable ? "Your saved work is read-only." : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to your private account." : saveState === "error" ? "Your changes need attention above." : "Your work saves automatically."}</p>
    </section>;
  }

  function readView() {
    return <section className={styles.recap} aria-label="Your saved private work"><div className={styles.back}><button type="button" className={styles.textButton} onClick={() => void navigate("assignment")}>← Assignment</button></div><p className={styles.chapter}>{courseTitle(course)}</p><h2 ref={headingRef} tabIndex={-1}>{course === "f1" ? readEntry?.title || "Your timeline entry" : course === "f4" ? "Your letter to your future self." : "Your week."}</h2>{course === "f1" && readEntry ? <><p>{readEntry.year}</p>{readEntry.details ? <p className={styles.savedWriting}>{readEntry.details}</p> : null}<h3>What did I make it mean?</h3><p className={styles.savedWriting}>{readEntry.meaning || "Not yet added."}</p><h3>How did that meaning shape me?</h3><p className={styles.savedWriting}>{readEntry.presentImpact || "Not yet added."}</p>{readEntry.belief ? <><h3>What did I start believing?</h3><p className={styles.savedWriting}>{readEntry.belief}</p></> : null}{readEntry.perspective ? <><h3>What can I see now?</h3><p className={styles.savedWriting}>{readEntry.perspective}</p></> : null}</> : course === "f4" ? <p className={styles.savedWriting}>{snapshot.letter.body}</p> : <div className={styles.planReview}><p>{snapshot.time.action}</p>{snapshot.time.minutes > 0 && snapshot.time.category && snapshot.time.sourceCategory ? <span>{duration(snapshot.time.minutes)} each week for {categoryLabel(snapshot.time.category).toLowerCase()}, from {categoryLabel(snapshot.time.sourceCategory).toLowerCase()}.</span> : null}</div>}{snapshot.releases[course] ? resourceLinks : null}</section>;
  }

  function recap() {
    return <section className={styles.recap} aria-label={`${courseTitle(course)} call recap`}><div className={styles.back}><button type="button" className={styles.textButton} onClick={() => void navigate("assignment")}>← {courseTitle(course)}</button></div><p className={styles.chapter}>Call recap</p><h2 ref={headingRef} tabIndex={-1}>{course === "f1" ? <>Your story.<br />A place to begin.</> : <>The same week.<br />A different choice.</>}</h2>{course === "f1" ? <><p>In Foundations 1, we explored the Ruined philosophy, the experiences that shape us, and the difference between what happened and what we made it mean.</p><p>The experience stays. We can get curious about the meaning we carry—and how it shapes the way we live.</p><div className={styles.recapAssignment}><Badge course="f1" earned={snapshot.badges.f1.earned} /><div><h3>Earn your F1 Badge.</h3><p>Add three entries to your timeline. Choose experiences that changed you, good or bad.</p></div></div><ol><li>What happened?</li><li>What did I make it mean?</li><li>How did that meaning shape me?</li></ol><p>Take them one at a time. Once you keep three complete entries, your F1 Badge is earned.</p></> : <><p>We all work within 168 hours. Making room for what matters begins by noticing where some of that time goes—and choosing what could change.</p><p>You don’t need to rebuild your whole life. Begin with one thing.</p><div className={styles.recapAssignment}><Badge course="time" earned={snapshot.badges.time.earned} /><div><h3>Earn your TIME Badge.</h3><p>Choose one thing you want to make room for, then keep your time plan in MY 168.</p></div></div><ol><li>Name one concrete next step.</li><li>Choose how much time it needs and where that time can come from.</li><li>Keep the plan, then try that small change.</li></ol><p>Keeping a plan for your chosen step earns the badge. You can return to adjust it whenever you need.</p></>}<Primary onClick={() => void navigate("assignment")}>Open your assignment →</Primary></section>;
  }

  return <main className={`member-journey-page ${styles.page}`}><header className={styles.header}><h1 className="member-page-title">The Work</h1></header><nav className={styles.tabs} aria-label="The Work topics"><button type="button" aria-pressed={area === "foundations"} onClick={() => void navigate("overview", "f1", "foundations")}>Foundations</button><button type="button" aria-pressed={area === "monthly"} onClick={() => void navigate("overview", "time", "monthly")}>Monthly</button></nav>
    {!connected ? <div className={styles.notice}><p>This is a preview. Sign in to save your own work.</p></div> : !snapshot.canWrite ? <div className={styles.notice}><p>Your saved work is available to read. Editing is currently unavailable.</p></div> : null}
    {message ? <div className={styles.notice} role={blocked ? "alert" : "status"}><p>{message}</p>{blocked ? <div className={styles.noticeActions}>{recoveryReady ? <><button type="button" className={styles.textButton} onClick={() => resolveRecovery(true)}>Continue with my open draft</button><button type="button" className={styles.textButton} onClick={() => resolveRecovery(false)}>Use the saved version</button></> : <button type="button" className={styles.textButton} onClick={() => void checkSavedWork()} disabled={saveState === "saving"}>Check saved work</button>}<button type="button" className={styles.textButton} onClick={downloadDraft}>Download my draft</button></div> : null}</div> : null}
    {view === "overview" ? overview() : view === "assignment" ? assignment() : view === "work" ? workView() : view === "read" ? readView() : recap()}
  </main>;
}
