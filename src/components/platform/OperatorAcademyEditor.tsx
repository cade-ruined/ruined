"use client";

import Link from "next/link";
import { useState } from "react";

import {
  OperatorAcademyEditorForm,
  OperatorAcademyResourceStateActions,
} from "@/components/platform/OperatorAcademyActions";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorAcademyThumbnail from "@/components/platform/OperatorAcademyThumbnail";
import OperatorDialog from "@/components/platform/OperatorDialog";
import StateLabel from "@/components/platform/StateLabel";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import type { OpsAcademyEditorData } from "@/lib/platform/ops-academy-model";

export default function OperatorAcademyEditor({ editor, preview = false }: { editor: OpsAcademyEditorData; preview?: boolean }) {
  const resource = editor.resource;
  const [workspace, setWorkspace] = useState<"edit" | "notes" | null>(null);
  const [notice, setNotice] = useState("");
  const sourceUrl = resource.videoUrl || resource.externalUrl;
  return (
    <OperatorPageFrame title={`Academy / ${resource.title}`}>
      <Link className="inline-flex min-h-11 items-center gap-2 text-sm text-black/60 hover:text-black" href="/ops/academy">
        <span aria-hidden="true">←</span> Academy
      </Link>

      <header className="operator-record-header">
        <div className="min-w-0"><h1 className="operator-record-title">{resource.title}</h1><p className="mt-1 text-sm text-black/55">{resource.collectionName ?? "No collection"} · <span className="capitalize">{resource.contentType}</span>{resource.durationLabel ? ` · ${resource.durationLabel}` : ""}</p></div>
        {editor.canManage && resource.status !== "retired" ? <button id="edit-academy-lesson" className={OPERATOR_BUTTON_CLASS} onClick={() => setWorkspace("edit")} type="button">Edit lesson</button> : null}
      </header>
      {notice ? <p role="status" className="mb-3 text-sm text-[var(--color-verdigris)]">{notice}</p> : null}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Lesson overview">
        <article className="operator-bento-card md:col-span-2 xl:col-span-1">
          <h2 className="operator-compact-label">Content</h2>
          <OperatorAcademyThumbnail src={resource.thumbnailUrl} format={resource.contentType} detail />
          {resource.summary ? <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-black/65">{resource.summary}</p> : <p className="mt-2 text-sm text-black/50">No summary added.</p>}
          {resource.presenter ? <p className="mt-2 text-xs text-black/55">With {resource.presenter}</p> : null}
          <div className="mt-2 flex flex-wrap gap-x-5">
            {sourceUrl ? <a className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href={sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}
            {resource.bodyText ? <button id="read-academy-notes" className="min-h-11 text-sm font-semibold underline underline-offset-4" onClick={() => setWorkspace("notes")} type="button">Read lesson notes</button> : null}
          </div>
        </article>
        <article className="operator-bento-card">
          <h2 className="operator-compact-label">Audience</h2>
          {resource.audiences.length ? <ul className="mt-3 space-y-2">{resource.audiences.map((audience) => <li className="text-sm" key={`${audience.kind}-${audience.id}`}>{audience.label}</li>)}</ul> : <p className="mt-2 text-sm text-[var(--color-poster)]">Choose an audience before publishing.</p>}
          {resource.featured ? <span className="mt-3 inline-block rounded-[4px] bg-[var(--color-highlight)] px-2 py-1 text-xs font-semibold">Featured lesson</span> : null}
        </article>
        <article className="operator-bento-card">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="operator-compact-label">Publication</h2><StateLabel state={resource.status} /></div>
          <dl className="my-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-black/50">Live version</dt><dd className="mt-1 font-semibold">{resource.currentVersion === null ? "Not published" : `v${resource.currentVersion}`}</dd></div><div><dt className="text-xs text-black/50">Latest version</dt><dd className="mt-1 font-semibold">v{resource.latestVersion}</dd></div></dl>
          {resource.hasUnpublishedChanges ? <p className="mb-3 text-xs text-[var(--color-poster)]">Changes not published</p> : null}
          {editor.canManage ? <OperatorAcademyResourceStateActions resourceId={resource.resourceId} revision={resource.revision} status={resource.status} hasUnpublishedChanges={resource.hasUnpublishedChanges} preview={preview} /> : null}
        </article>
      </section>
      {workspace === "edit" && editor.canManage && resource.status !== "retired" ? <OperatorDialog open title="Edit lesson" onClose={() => setWorkspace(null)} returnFocusId="edit-academy-lesson"><section aria-label="Lesson editor"><OperatorAcademyEditorForm options={editor.options} resource={resource} preview={preview} onSaved={() => { setWorkspace(null); setNotice("Draft saved. Publish when ready."); }} /></section></OperatorDialog> : null}
      {workspace === "notes" ? <OperatorDialog open title="Lesson notes" onClose={() => setWorkspace(null)} returnFocusId="read-academy-notes"><div className="whitespace-pre-wrap text-sm leading-relaxed">{resource.bodyText}</div></OperatorDialog> : null}
    </OperatorPageFrame>
  );
}
