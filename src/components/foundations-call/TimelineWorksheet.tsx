"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import styles from "./timeline-worksheet.module.css";

type Experience = { id: string; when: string; event: string; meaning: string };
type SavedExperience = Omit<Experience, "id">;
type TimelineFile = { schemaVersion: 1; experiences: SavedExperience[] };
type PendingAction =
  | { kind: "remove"; id: string }
  | { kind: "load"; entries: SavedExperience[] }
  | { kind: "leave" };

const MAX_EXPERIENCES = 200;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const LIMITS = { when: 80, event: 4000, meaning: 4000 } as const;
const CATEGORIES = ["Family", "Relationships", "Success", "Failure", "Business / career", "Money", "Health", "Identity / beliefs", "Important people", "Major decisions", "Transitions", "Loss", "Pride", "Shame"];
const MEANING_PROMPTS = ["What did this mean about me?", "What did this mean about other people?", "What did this mean about life?", "What did I begin believing because of it?"];

function blankExperience(id: string): Experience {
  return { id, when: "", event: "", meaning: "" };
}

function hasWriting(experience: SavedExperience) {
  return Boolean(experience.when.trim() || experience.event.trim() || experience.meaning.trim());
}

function serializedTimeline(experiences: Experience[]) {
  const data: TimelineFile = {
    schemaVersion: 1,
    experiences: experiences.map(({ when, event, meaning }) => ({ when, event, meaning })),
  };
  return JSON.stringify(data, null, 2);
}

function parseTimelineFile(text: string): SavedExperience[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file could not be read. Choose a JSON copy downloaded from this worksheet.");
  }
  if (!data || typeof data !== "object" || !("schemaVersion" in data) || data.schemaVersion !== 1 || !("experiences" in data) || !Array.isArray(data.experiences)) {
    throw new Error("This is not a supported Ruined Timeline file. Choose a version 1 copy downloaded from this worksheet.");
  }
  if (data.experiences.length > MAX_EXPERIENCES) {
    throw new Error(`This file contains too many experiences. A worksheet can hold up to ${MAX_EXPERIENCES}.`);
  }
  return data.experiences.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object" || !("when" in entry) || !("event" in entry) || !("meaning" in entry)
      || typeof entry.when !== "string" || typeof entry.event !== "string" || typeof entry.meaning !== "string"
      || entry.when.length > LIMITS.when || entry.event.length > LIMITS.event || entry.meaning.length > LIMITS.meaning) {
      throw new Error(`Experience ${index + 1} could not be read. Its fields must be text within the worksheet’s limits.`);
    }
    return { when: entry.when, event: entry.event, meaning: entry.meaning };
  });
}

export default function TimelineWorksheet() {
  const router = useRouter();
  const [experiences, setExperiences] = useState<Experience[]>(() => Array.from({ length: 4 }, (_, index) => blankExperience(`experience-${index + 1}`)));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [keptCopy, setKeptCopy] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadCopyButton = useRef<HTMLButtonElement>(null);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const keepWritingButton = useRef<HTMLButtonElement>(null);
  const confirmationTrigger = useRef<HTMLElement | null>(null);
  const shouldRestoreFocus = useRef(false);
  const nextId = useRef(4);
  const focusId = useRef<string | null>(null);
  const currentCopy = serializedTimeline(experiences);
  const hasUnsavedWriting = experiences.some(hasWriting) && currentCopy !== keptCopy;

  useEffect(() => {
    if (!hasUnsavedWriting) return;
    function protectWriting(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protectWriting);
    return () => window.removeEventListener("beforeunload", protectWriting);
  }, [hasUnsavedWriting]);

  useEffect(() => {
    if (focusId.current) {
      document.getElementById(`${focusId.current}-when`)?.focus();
      focusId.current = null;
    }
  }, [experiences]);

  useEffect(() => {
    const dialog = confirmationDialog.current;
    if (!dialog) return;
    if (pendingAction) {
      if (!dialog.open) dialog.showModal();
      keepWritingButton.current?.focus();
    } else {
      if (dialog.open) dialog.close();
      if (shouldRestoreFocus.current && confirmationTrigger.current?.isConnected) {
        confirmationTrigger.current.focus();
      }
      shouldRestoreFocus.current = false;
    }
  }, [pendingAction]);

  function requestConfirmation(action: PendingAction, trigger?: HTMLElement | null) {
    confirmationTrigger.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPendingAction(action);
  }

  function keepWriting() {
    shouldRestoreFocus.current = true;
    setPendingAction(null);
    setStatus("Your current writing was kept.");
  }

  function applySavedCopy(entries: SavedExperience[]) {
    const loaded = entries.map(entry => ({ ...entry, id: `experience-${++nextId.current}` }));
    setExperiences(loaded);
    setKeptCopy(serializedTimeline(loaded));
    setStatus(`Saved copy loaded. ${entries.length} ${entries.length === 1 ? "experience" : "experiences"} restored.`);
  }

  function confirmAction() {
    if (!pendingAction) return;
    shouldRestoreFocus.current = false;
    setPendingAction(null);
    if (pendingAction.kind === "remove") {
      setExperiences(current => current.filter(entry => entry.id !== pendingAction.id));
      setStatus("Experience removed.");
    } else if (pendingAction.kind === "load") {
      applySavedCopy(pendingAction.entries);
    } else {
      router.push("/foundations/01#ruined-timeline");
    }
  }

  function updateExperience(id: string, field: keyof SavedExperience, value: string) {
    setExperiences(current => current.map(experience => experience.id === id ? { ...experience, [field]: value } : experience));
    setStatus("");
    setError("");
  }

  function addExperience() {
    if (experiences.length >= MAX_EXPERIENCES) return;
    const id = `experience-${++nextId.current}`;
    focusId.current = id;
    setExperiences(current => [...current, blankExperience(id)]);
    setStatus("A blank experience was added.");
  }

  function removeExperience(experience: Experience) {
    if (hasWriting(experience)) {
      requestConfirmation({ kind: "remove", id: experience.id });
      return;
    }
    setExperiences(current => current.filter(entry => entry.id !== experience.id));
    setStatus("Experience removed.");
  }

  function downloadCopy() {
    const blob = new Blob([currentCopy], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ruined-timeline-part-i.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setKeptCopy(currentCopy);
    setError("");
    setStatus("Copy prepared for download. Keep the JSON file to reopen your writing here.");
  }

  async function loadCopy(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLoading(true);
    setError("");
    setStatus("");
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("This file is too large. Choose a Timeline JSON file of 8 MB or smaller.");
      const entries = parseTimelineFile(await file.text());
      if (experiences.some(hasWriting)) {
        requestConfirmation({ kind: "load", entries }, loadCopyButton.current);
        return;
      }
      applySavedCopy(entries);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This file could not be loaded. Your writing has been kept.");
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.worksheet}>
    <div className={styles.sheet}>
      <nav className={styles.navigation} aria-label="Foundations">
        <Link href="/foundations/01#ruined-timeline" onClick={event => {
          if (hasUnsavedWriting && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            requestConfirmation({ kind: "leave" });
          }
        }}>← Return to Foundations 01</Link>
        <span>YOUR STORY / PART I</span>
      </nav>

      <header className={styles.header}>
        <Image className={styles.wordmark} src="/ruined-wordmark.svg" width={174} height={52} alt="Ruined" priority />
        <p className={styles.eyebrow}>FOUNDATIONS 01 / PART I</p>
        <h1>Ruined Timeline<span>What happened. What you made it mean.</span></h1>
        <div className={styles.lifeLine} aria-label="A life timeline from birth to today"><span>Birth</span><div aria-hidden="true" /><span>Today</span></div>
        <p className={styles.introduction}>Begin with meaningful experiences, positive and negative. Look for moments with emotional weight, or experiences that changed what happened next.</p>
      </header>

      <section className={styles.instructions} aria-label="Reflection prompts">
        <div><h2>What comes to mind?</h2><p className={styles.categories}>{CATEGORIES.map((category, index) => <span key={category}>{category}{index < CATEGORIES.length - 1 && <span aria-hidden="true"> · </span>}</span>)}</p></div>
        <div><h2>What did I make it mean?</h2><ul>{MEANING_PROMPTS.map(prompt => <li key={prompt}>{prompt}</li>)}</ul></div>
      </section>

      <div className={styles.tools}>
        <p>Your writing stays in this tab.<br /><strong>Download a copy to keep it.</strong></p>
        <div className={styles.actions}>
          <button type="button" onClick={downloadCopy} disabled={loading}>Download copy</button>
          <button type="button" ref={loadCopyButton} onClick={() => fileInput.current?.click()} disabled={loading}>{loading ? "Loading copy…" : "Load saved copy"}</button>
          <button type="button" onClick={() => window.print()} disabled={loading}>Print / Save PDF</button>
        </div>
        <input className={styles.fileInput} ref={fileInput} type="file" accept=".json,application/json" aria-label="Load a saved Ruined Timeline JSON file" onChange={loadCopy} tabIndex={-1} />
      </div>
      <p className={styles.status} role="status">{status}</p>
      {error && <p className={styles.error} role="alert">{error} Your current writing has not been changed.</p>}

      <section className={styles.experiences} aria-label="Your experiences">
        {experiences.map((experience, index) => <article className={styles.experience} key={experience.id} aria-label={`Experience ${index + 1}`} data-long={experience.event.length + experience.meaning.length > 1800 || undefined}>
          <div className={styles.experienceMeta}>
            <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
            <label htmlFor={`${experience.id}-when`}>Year / age <span>Optional</span></label>
            <input id={`${experience.id}-when`} className={styles.input} type="text" autoComplete="off" maxLength={LIMITS.when} placeholder="Year or age" value={experience.when} disabled={loading} onChange={event => updateExperience(experience.id, "when", event.target.value)} />
            <p className={styles.printValue}>{experience.when || " "}</p>
            <button className={styles.remove} type="button" aria-label={`Remove experience ${index + 1}`} onClick={() => removeExperience(experience)} disabled={loading}>Remove</button>
          </div>
          <div className={styles.writingField}>
            <label htmlFor={`${experience.id}-event`}>What happened?</label>
            <textarea id={`${experience.id}-event`} rows={5} maxLength={LIMITS.event} placeholder="The experience." value={experience.event} disabled={loading} onChange={event => updateExperience(experience.id, "event", event.target.value)} />
            <p className={styles.printValue}>{experience.event || " "}</p>
          </div>
          <div className={styles.writingField}>
            <label htmlFor={`${experience.id}-meaning`}>What did I make it mean?</label>
            <textarea id={`${experience.id}-meaning`} rows={5} maxLength={LIMITS.meaning} placeholder="The meaning or story I carried." value={experience.meaning} disabled={loading} onChange={event => updateExperience(experience.id, "meaning", event.target.value)} />
            <p className={styles.printValue}>{experience.meaning || " "}</p>
          </div>
        </article>)}
        {!experiences.length && <p className={styles.empty}>Start with one experience. Add it when you’re ready.</p>}
      </section>

      <div className={styles.addRow}>
        <button type="button" onClick={addExperience} disabled={loading || experiences.length >= MAX_EXPERIENCES}>+ Add experience</button>
        <span>{experiences.length >= MAX_EXPERIENCES ? `This worksheet holds up to ${MAX_EXPERIENCES} experiences.` : "You can continue between calls."}</span>
      </div>

      <footer className={styles.footer}>
        <p>Do not force gratitude, forgiveness, a positive lesson, or a reframe.<br /><strong>Just get curious.</strong></p>
        <span>AFTER THE FEAR.</span>
      </footer>
    </div>
    <dialog className={styles.confirmation} ref={confirmationDialog} aria-labelledby="timeline-confirmation-title" aria-describedby="timeline-confirmation-description" onCancel={event => {
      event.preventDefault();
      keepWriting();
    }}>
      <p className={styles.eyebrow}>YOUR TIMELINE</p>
      <h2 id="timeline-confirmation-title">{pendingAction?.kind === "remove" ? "Remove this experience?" : pendingAction?.kind === "load" ? "Replace your writing?" : "Leave the worksheet?"}</h2>
      <p id="timeline-confirmation-description">{pendingAction?.kind === "remove"
        ? "This experience and its writing will be removed from this tab."
        : pendingAction?.kind === "load"
          ? "The saved copy will replace the writing currently in this tab. Keep writing and download your current copy first if you want to keep it."
          : "Your latest writing has not been downloaded. Keep writing and download a copy first if you want to keep it."}</p>
      <div className={styles.confirmationActions}>
        <button type="button" ref={keepWritingButton} onClick={keepWriting}>Keep writing</button>
        <button type="button" onClick={confirmAction}>{pendingAction?.kind === "remove" ? "Remove experience" : pendingAction?.kind === "load" ? "Replace writing" : "Leave worksheet"}</button>
      </div>
    </dialog>
  </main>;
}
