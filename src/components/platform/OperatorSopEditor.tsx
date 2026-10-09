"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import OperatorDialog from "@/components/platform/OperatorDialog";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorSopBody, { safeSopDocumentUrl } from "@/components/platform/OperatorSopBody";
import StateLabel from "@/components/platform/StateLabel";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS, OPERATOR_LABEL_TEXT_CLASS } from "@/components/platform/operatorStyles";
import type { OpsSop, OpsSopEditorData, OpsSopRevision, OpsSopStatus } from "@/lib/platform/ops-sop-model";

type SopFields = Pick<OpsSop, "title" | "summary" | "category" | "bodyText"> & { externalUrl: string };

function fieldsFor(procedure?: OpsSop | null): SopFields {
  return {
    title: procedure?.title ?? "",
    summary: procedure?.summary ?? "",
    category: procedure?.category ?? "",
    bodyText: procedure?.bodyText ?? "",
    externalUrl: procedure?.externalUrl ?? "",
  };
}

function updatedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export default function OperatorSopEditor({ editor = null, preview = false }: { editor?: OpsSopEditorData | null; preview?: boolean }) {
  const router = useRouter();
  const [procedure, setProcedure] = useState<OpsSop | null>(editor?.procedure ?? null);
  const [history, setHistory] = useState<OpsSopRevision[]>(editor?.history ?? []);
  const [editing, setEditing] = useState(!editor);
  const [draft, setDraft] = useState<SopFields>(() => fieldsFor(editor?.procedure));
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<OpsSopStatus | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [readingRevision, setReadingRevision] = useState<OpsSopRevision | null>(null);
  const pendingRef = useRef(false);
  const canManage = editor?.canManage ?? true;
  const sourceUrl = safeSopDocumentUrl(procedure?.externalUrl);
  const revisionSourceUrl = safeSopDocumentUrl(readingRevision?.externalUrl);

  useEffect(() => {
    if (!(editing && dirty) && !pending) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, editing, pending]);

  function openEditor() {
    setDraft(fieldsFor(procedure));
    setDirty(false);
    setError("");
    setConflict(false);
    setEditing(true);
  }

  function changeField(field: keyof SopFields, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
  }

  async function save(status: OpsSopStatus, fields: SopFields) {
    if (pendingRef.current || !canManage) return;
    setError("");
    setConflict(false);
    const title = fields.title.trim();
    const externalUrl = safeSopDocumentUrl(fields.externalUrl);
    if (!title) { setError("Give this SOP a title."); return; }
    if (fields.externalUrl.trim() && !externalUrl) { setError("Use a valid https:// document link without a username or password."); return; }
    if (status === "published" && !fields.bodyText.trim() && !externalUrl) { setError("Add the procedure or a document link before publishing."); return; }
    pendingRef.current = true;
    setPending(status);
    try {
      const payload = { ...fields, title, summary: fields.summary.trim(), category: fields.category.trim() || "General", externalUrl, status, ...(procedure ? { expectedRevision: procedure.revision } : {}) };
      let saved: OpsSop;
      if (preview) {
        const now = new Date().toISOString();
        saved = { ...payload, id: procedure?.id ?? `preview-sop-${Date.now()}`, revision: (procedure?.revision ?? 0) + 1, createdAt: procedure?.createdAt ?? now, updatedAt: now, updatedBy: null, publishedAt: procedure?.publishedAt ?? (status === "published" ? now : null) };
      } else {
        const response = await fetch(procedure ? `/api/ops/sops/${procedure.id}` : "/api/ops/sops", {
          method: procedure ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => null) as { procedure?: OpsSop; error?: string } | null;
        if (response.status === 409) {
          setConflict(true);
          throw new Error("Another operator updated this SOP. Your edits are still here. Open the latest version to compare before saving again.");
        }
        if (!response.ok || !result?.procedure) throw new Error(result?.error || "This SOP could not be saved. Please try again.");
        saved = result.procedure;
      }
      setProcedure(saved);
      setHistory((current) => [saved, ...current.filter((item) => item.revision !== saved.revision)]);
      setDraft(fieldsFor(saved));
      setDirty(false);
      setEditing(false);
      setArchiveOpen(false);
      setNotice(`${status === "published" ? "SOP published." : status === "archived" ? "SOP archived. You can restore it by editing." : "Draft saved."}${preview ? " Preview only — reloading resets these changes." : ""}`);
      if (!preview && !procedure) router.replace(`/ops/sops/${saved.id}`);
      if (!preview) router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This SOP could not be saved. Please try again.");
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const status = submitter?.value === "published" ? "published" : procedure?.status === "published" ? "published" : "draft";
    await save(status, draft);
  }

  return <OperatorPageFrame title={procedure ? `SOPs / ${procedure.title}` : "New SOP"}>
    <Link className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-[color:var(--operator-muted)] hover:text-[color:var(--operator-ink)]" href="/ops/sops"><span aria-hidden="true">←</span> All SOPs</Link>
    <header className="operator-record-header">
      <div className="min-w-0 max-w-3xl">
        <p className="operator-compact-label mb-2">{procedure?.category || "Standard operating procedures"}</p>
        <h2 className="operator-record-title">{procedure?.title || "New SOP"}</h2>
        {procedure?.summary ? <p className="mt-3 max-w-2xl whitespace-pre-line break-words text-sm leading-relaxed text-[color:var(--operator-muted)]">{procedure.summary}</p> : null}
      </div>
      {canManage ? <button className={OPERATOR_BUTTON_CLASS} id="edit-sop" onClick={openEditor} type="button">{procedure ? "Edit SOP" : "Create SOP"}</button> : null}
    </header>
    {notice ? <p className="mb-5 text-sm text-[color:var(--operator-success-text)]" role="status">{notice}</p> : null}
    {preview && !notice ? <p className="mb-5 text-xs text-[color:var(--operator-muted)]">Preview workspace. Changes stay here until you reload.</p> : null}
    {procedure ? <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_15rem] xl:gap-8">
      <article className="operator-bento-card !p-5 sm:!p-7" aria-label="Standard operating procedure">
        {procedure.status !== "published" ? <p className="mb-6 border-l-2 border-[color:var(--operator-ink)]/20 pl-3 text-sm text-[color:var(--operator-muted)]">{procedure.status === "archived" ? "This SOP is archived and hidden from the operator library." : "This draft is visible to administrators. Publish it when it is ready for the team."}</p> : null}
        {procedure.bodyText.trim() ? <OperatorSopBody body={procedure.bodyText} /> : <p className="text-sm text-[color:var(--operator-muted)]">{sourceUrl ? "The full procedure is in the linked document." : "No procedure added yet."}</p>}
        {sourceUrl ? <div className="mt-7 border-t border-[color:var(--operator-ink)]/10 pt-4"><a className="inline-flex min-h-11 items-center gap-2 break-words text-sm font-semibold underline underline-offset-4" href={sourceUrl} rel="noopener noreferrer" target="_blank">Open procedure document <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></div> : null}
      </article>
      <aside className="min-w-0 space-y-6" aria-label="SOP details">
        <section className="operator-bento-card">
          <h3 className="operator-compact-label mb-4">Publication</h3>
          <StateLabel state={procedure.status} />
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm lg:grid-cols-1">
            <div><dt className="text-xs text-[color:var(--operator-muted)]">Revision</dt><dd className="mt-1">{procedure.revision}</dd></div>
            <div><dt className="text-xs text-[color:var(--operator-muted)]">Last updated</dt><dd className="mt-1"><time dateTime={procedure.updatedAt}>{updatedDate(procedure.updatedAt)}</time></dd></div>
          </dl>
          {canManage && procedure.status !== "archived" ? <button className="mt-4 min-h-11 text-sm text-[color:var(--operator-muted)] underline underline-offset-4 hover:text-[color:var(--operator-ink)]" id="archive-sop" onClick={() => { setError(""); setConflict(false); setArchiveOpen(true); }} type="button">Archive SOP</button> : null}
        </section>
        {canManage && history.length > 0 ? <details className="rounded-none border border-[color:var(--operator-ink)]/10 bg-[var(--operator-surface-muted)] px-4">
          <summary className="cursor-pointer py-4 text-sm font-medium">Revision history <span className="ml-1 text-[color:var(--operator-muted)]">{history.length}</span></summary>
          <ol className="max-h-80 space-y-4 overflow-y-auto pb-4">{history.map((revision) => <li className="border-t border-[color:var(--operator-ink)]/10 pt-3" key={revision.revision}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Revision {revision.revision}</span><StateLabel state={revision.status} /></div>
            <p className="mt-2 break-words text-xs text-[color:var(--operator-muted)]">{revision.title}</p>
            <time className="mt-1 block text-xs text-[color:var(--operator-muted)]" dateTime={revision.updatedAt}>{updatedDate(revision.updatedAt)}</time>
            <button aria-label={`Read revision ${revision.revision}`} className="mt-1 min-h-11 text-xs font-medium underline underline-offset-4" id={`read-sop-revision-${revision.revision}`} onClick={() => setReadingRevision(revision)} type="button">Read revision</button>
          </li>)}</ol>
        </details> : null}
      </aside>
    </div> : <section className="operator-bento-card max-w-3xl !py-8"><p className="max-w-xl text-sm leading-relaxed text-[color:var(--operator-muted)]">Write a procedure here or link to an existing document. Save a draft while you work, then publish it for the operator team.</p></section>}

    {readingRevision && canManage ? <OperatorDialog open title={`Revision ${readingRevision.revision}`} context={<StateLabel state={readingRevision.status} />} onClose={() => setReadingRevision(null)} returnFocusId={`read-sop-revision-${readingRevision.revision}`}>
      <article aria-label={`Saved content for revision ${readingRevision.revision}`} className="mx-auto max-w-3xl space-y-6 pb-3 pt-3">
        <header className="border-b border-[color:var(--operator-ink)]/10 pb-5">
          <p className="operator-compact-label mb-2">{readingRevision.category || "General"}</p>
          <h3 className="operator-section-heading">{readingRevision.title}</h3>
          <time className="mt-2 block text-xs text-[color:var(--operator-muted)]" dateTime={readingRevision.updatedAt}>Saved {updatedDate(readingRevision.updatedAt)}</time>
          {readingRevision.summary ? <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-[color:var(--operator-muted)]">{readingRevision.summary}</p> : null}
        </header>
        {readingRevision.bodyText.trim() ? <OperatorSopBody body={readingRevision.bodyText} /> : <p className="text-sm text-[color:var(--operator-muted)]">{revisionSourceUrl ? "The procedure for this revision is in the linked document." : "No procedure was added in this revision."}</p>}
        {revisionSourceUrl ? <div className="border-t border-[color:var(--operator-ink)]/10 pt-4"><a className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4" href={revisionSourceUrl} rel="noopener noreferrer" target="_blank">Open saved document <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></div> : null}
      </article>
    </OperatorDialog> : null}

    {editing && canManage ? <OperatorDialog open title={procedure ? "Edit SOP" : "Create SOP"} onClose={() => { setEditing(false); setDirty(false); }} pending={pending !== null} returnFocusId="edit-sop">
      <form className="space-y-5 pt-2" data-operator-dirty={dirty} data-operator-pending={pending !== null} onSubmit={submit}>
        <fieldset className="space-y-5" disabled={pending !== null}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)]">
            <label className="block min-w-0"><span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span><input autoComplete="off" className={OPERATOR_FIELD_CLASS} maxLength={200} name="title" onChange={(event) => changeField("title", event.target.value)} required value={draft.title} /></label>
            <label className="block min-w-0"><span className={OPERATOR_LABEL_TEXT_CLASS}>Category</span><input autoComplete="off" className={OPERATOR_FIELD_CLASS} list="sop-categories" maxLength={80} name="category" onChange={(event) => changeField("category", event.target.value)} placeholder="e.g. Member support" value={draft.category} /></label>
          </div>
          <datalist id="sop-categories">{["Member support", "Circle operations", "Experiences", "Communications", "Creative production", "General operations"].map((category) => <option key={category} value={category} />)}</datalist>
          <label className="block"><span className={OPERATOR_LABEL_TEXT_CLASS}>Summary</span><textarea className={`${OPERATOR_FIELD_CLASS} min-h-20 resize-y`} maxLength={2000} name="summary" onChange={(event) => changeField("summary", event.target.value)} placeholder="What this procedure covers and when to use it." rows={2} value={draft.summary} /></label>
          <label className="block"><span className={OPERATOR_LABEL_TEXT_CLASS}>Procedure</span><textarea aria-describedby="sop-format-help" className={`${OPERATOR_FIELD_CLASS} min-h-64 resize-y leading-7`} maxLength={100000} name="bodyText" onChange={(event) => changeField("bodyText", event.target.value)} placeholder={"# Purpose\nExplain when to use this procedure.\n\n# Steps\n1. Start here.\n2. Describe the next action."} rows={12} value={draft.bodyText} /><span className="mt-2 block text-xs leading-relaxed text-[color:var(--operator-muted)]" id="sop-format-help">Use plain text, # section headings, numbered steps, or - bullet points.</span></label>
          <label className="block"><span className={OPERATOR_LABEL_TEXT_CLASS}>Document link <span className="text-sm">(optional)</span></span><input aria-describedby="sop-document-help" className={OPERATOR_FIELD_CLASS} maxLength={2048} name="externalUrl" onChange={(event) => changeField("externalUrl", event.target.value)} placeholder="https://" type="url" value={draft.externalUrl} /><span className="mt-2 block text-xs leading-relaxed text-[color:var(--operator-muted)]" id="sop-document-help">Link an existing document, PDF, or reference. Make sure your team can access it.</span></label>
          {error ? <div className="operator-emphasis rounded-none bg-[var(--operator-error)] p-3 text-sm text-[var(--operator-danger)]" data-operator-tone="error" role="alert"><p>{error}</p>{conflict && procedure && !preview ? <a className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4" href={`/ops/sops/${procedure.id}`} target="_blank" rel="noopener noreferrer">Open latest version ↗</a> : null}</div> : null}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-[color:var(--operator-ink)]/10 pt-4">
            <p className="max-w-sm text-xs leading-relaxed text-[color:var(--operator-muted)]">{procedure?.status === "published" ? "Saving updates the procedure the operator team can see." : "Drafts are visible to administrators. Publishing makes this SOP available to all operators."}</p>
            <div className="flex flex-wrap gap-2">
              {procedure?.status !== "published" ? <button className="min-h-11 rounded-none border border-[color:var(--operator-ink)]/25 px-4 text-sm font-medium disabled:opacity-50" disabled={pending !== null} name="status" type="submit" value="draft">{pending === "draft" ? "Saving…" : procedure?.status === "archived" ? "Restore as draft" : "Save draft"}</button> : null}
              <button className={OPERATOR_BUTTON_CLASS} disabled={pending !== null} name="status" type="submit" value="published">{pending === "published" ? "Publishing…" : procedure?.status === "published" ? "Save & publish" : procedure?.status === "archived" ? "Restore & publish" : "Publish SOP"}</button>
            </div>
          </div>
        </fieldset>
      </form>
    </OperatorDialog> : null}

    {archiveOpen && canManage && procedure ? <OperatorDialog open title="Archive SOP" onClose={() => setArchiveOpen(false)} pending={pending !== null} returnFocusId="archive-sop">
      <div className="max-w-2xl space-y-4 pt-2" data-operator-pending={pending !== null}>
        <p className="text-sm leading-relaxed">Archive “{procedure.title}”? It will be removed from the operator library. Administrators can still find it in Archived and restore it later.</p>
        {error ? <p role="alert" className="text-sm text-[var(--operator-danger)]">{error}</p> : null}
        <div className="flex flex-wrap gap-2"><button className="min-h-11 rounded-none border border-[color:var(--operator-ink)]/25 px-4 text-sm" disabled={pending !== null} onClick={() => setArchiveOpen(false)} type="button">Keep SOP</button><button className={OPERATOR_BUTTON_CLASS} disabled={pending !== null} onClick={() => void save("archived", fieldsFor(procedure))} type="button">{pending ? "Archiving…" : "Archive SOP"}</button></div>
      </div>
    </OperatorDialog> : null}
  </OperatorPageFrame>;
}
