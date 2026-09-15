"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  OperatorAcademyCollectionActions,
  OperatorAcademyCollectionCreate,
  OperatorAcademyCreateResource,
} from "@/components/platform/OperatorAcademyActions";
import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorAcademyThumbnail from "@/components/platform/OperatorAcademyThumbnail";
import OperatorDialog from "@/components/platform/OperatorDialog";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import { OPERATOR_FIELD_CLASS, OPERATOR_LABEL_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
import type {
  OpsAcademyReferenceOptions,
  OpsAcademySnapshot,
} from "@/lib/platform/ops-academy-model";

export default function OperatorAcademy({
  academy,
  options,
  preview = false,
}: {
  academy: OpsAcademySnapshot;
  options: OpsAcademyReferenceOptions;
  preview?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("current");
  const [view, setView] = useState<"lessons" | "collections">("lessons");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    function readLocation() {
      // A browser history change must not discard an open draft.
      if (workspace) return;
      const hash = window.location.hash;
      if (hash === "#academy-collections" || hash === "#new-collection") setView("collections");
      if (hash === "#academy-lessons" || hash === "#new-lesson") setView("lessons");
      if (academy.canManage && (hash === "#new-lesson" || hash === "#new-collection")) setWorkspace(hash.slice(1));
    }
    readLocation();
    window.addEventListener("hashchange", readLocation);
    return () => window.removeEventListener("hashchange", readLocation);
  }, [academy.canManage, workspace]);
  function openWorkspace(id: string) {
    setNotice("");
    setWorkspace(id);
    window.history.replaceState(window.history.state, "", `#${id}`);
  }
  function closeWorkspace() {
    setWorkspace(null);
    window.history.replaceState(window.history.state, "", `#academy-${view}`);
  }
  function showView(next: "lessons" | "collections") {
    setView(next);
    window.history.replaceState(window.history.state, "", `#academy-${next}`);
  }
  const collection = academy.collections.find((item) => workspace === `collection-${item.collectionId}`);
  const collections = academy.collections.filter((item) =>
    (status === "all" || (status === "current" ? item.status !== "retired" : item.status === status))
    && `${item.name} ${item.summary ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const resources = academy.resources.filter((resource) =>
    (status === "all" || (status === "current" ? resource.status !== "retired" : resource.status === status))
    && `${resource.title} ${resource.collectionName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <OperatorPageFrame title="Academy">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Academy views" className="inline-flex flex-wrap gap-1 rounded-[4px] bg-black/[0.04] p-1">
          {(["lessons", "collections"] as const).map((item) => <button aria-pressed={view === item} className={`min-h-11 rounded-[3px] px-4 text-sm font-semibold ${view === item ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "text-black/60 hover:bg-black/5"}`} key={item} onClick={() => showView(item)} type="button">{item === "lessons" ? "Lessons" : "Collections"}</button>)}
        </nav>
        {academy.canManage ? <button className={OPERATOR_PRIMARY_ACTION_CLASS} id={view === "lessons" ? "open-new-lesson" : "open-new-collection"} onClick={() => openWorkspace(view === "lessons" ? "new-lesson" : "new-collection")} type="button">{view === "lessons" ? "+ New lesson" : "+ New collection"}</button> : null}
      </div>
      <p aria-label="Academy snapshot" className="mb-3 text-xs text-black/55">{academy.counts.published} published · {academy.counts.draft} drafts · {academy.counts.unpublished} unpublished</p>
      {notice ? <p role="status" className="mb-4 text-sm">{notice}</p> : null}
      <section aria-label={view === "lessons" ? "Academy lessons" : "Academy collections"} className="space-y-3" id={`academy-${view}`}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className={OPERATOR_LABEL_CLASS}><span className="sr-only">{view === "lessons" ? "Find a lesson" : "Find a collection"}</span><input className={OPERATOR_FIELD_CLASS} onChange={(event) => setQuery(event.target.value)} placeholder={view === "lessons" ? "Search title or collection" : "Search collections"} type="search" value={query} /></label>
          <label className={OPERATOR_LABEL_CLASS}><span className="sr-only">Show</span><select className={OPERATOR_FIELD_CLASS} onChange={(event) => setStatus(event.target.value)} value={status}><option value="current">Current {view}</option><option value="all">All {view}</option><option value="draft">Drafts</option><option value="published">Published</option><option value="unpublished">Unpublished</option><option value="retired">Retired</option></select></label>
        </div>
        {view === "lessons" ? <>
        <p className="text-xs text-black/50" aria-live="polite">{resources.length} of {academy.resources.length} lessons</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {resources.map((resource) => (
          <Link
            className="operator-bento-card group flex min-w-0 flex-col gap-3 transition-colors hover:bg-black/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2"
            href={`/ops/academy/${resource.resourceId}`}
            key={resource.resourceId}
          >
            <span className="flex min-w-0 items-start gap-3"><OperatorAcademyThumbnail src={resource.thumbnailUrl} format={resource.contentType} />
            <span className="min-w-0">
              <span className="block text-xs text-black/45">
                {resource.collectionName ?? "No collection"}
              </span>
              <span className="mt-1 block text-lg font-semibold leading-tight">{resource.title}</span>
            </span></span>
            <span className="line-clamp-2 text-xs text-black/55">
              {resource.audiences.length
                ? resource.audiences.map((audience) => audience.label).join(", ")
                : "Audience needed"}
            </span>
            <span className="mt-auto flex flex-wrap items-center justify-between gap-2">
              <StateLabel state={resource.status} />
              {resource.hasUnpublishedChanges ? <span className="text-xs text-[var(--color-poster)]">Draft changes</span> : <span className="text-xs text-black/45">v{resource.latestVersion}</span>}
            </span>
          </Link>
        ))}
        </div>
        {academy.resources.length > 0 && resources.length === 0 ? <p className="rounded-[4px] bg-black/[0.035] p-5 text-sm text-black/55">No matches. Try another title or show all lessons.</p> : null}
        {!academy.resources.length ? (
          <OperatorEmptyState
            detail={academy.canManage ? "Add a video or resource, choose its audience, then publish when ready." : "Published lessons will appear here when they are available to you."}
            eyebrow="Lessons"
            title="No lessons yet."
          />
        ) : null}
        </> : <>
        <p className="text-xs text-black/50" aria-live="polite">{collections.length} of {academy.collections.length} collections</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {collections.map((collection) => (
            <article className="operator-bento-card" key={collection.collectionId}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-black/42">{collection.resourceCount} {collection.resourceCount === 1 ? "lesson" : "lessons"}</p>
                  <h3 className="mt-1 text-lg font-semibold leading-tight">{collection.name}</h3>
                </div>
                <StateLabel state={collection.status} />
              </div>
              {collection.summary ? <p className="mt-2 line-clamp-2 text-sm text-black/55">{collection.summary}</p> : null}
              {academy.canManage && collection.status !== "retired" ? <button className="mt-2 min-h-11 text-sm font-semibold underline underline-offset-4" id={`open-collection-${collection.collectionId}`} onClick={() => openWorkspace(`collection-${collection.collectionId}`)} type="button">Manage collection</button> : null}
            </article>
          ))}
        </div>
        {!collections.length ? <p className="rounded-[4px] bg-black/[0.035] p-5 text-sm text-black/55">{academy.collections.length ? "No matching collections. Try another name or status." : academy.canManage ? "No collections yet. Use New collection to group your lessons." : "Collections will appear here when available."}</p> : null}
        </>}
      </section>
      {academy.canManage && workspace ? <OperatorDialog open title={workspace === "new-lesson" ? "New lesson" : workspace === "new-collection" ? "New collection" : collection?.name ?? "Collection"} onClose={closeWorkspace} returnFocusId={`open-${workspace}`}>
        {workspace === "new-lesson" ? <section id="new-lesson"><OperatorAcademyCreateResource options={options} preview={preview} /></section>
          : workspace === "new-collection" ? <section id="new-collection"><OperatorAcademyCollectionCreate preview={preview} onCreated={() => { closeWorkspace(); setNotice("Collection draft created."); }} /></section>
          : collection ? <OperatorAcademyCollectionActions collection={collection} expanded preview={preview} /> : null}
      </OperatorDialog> : null}
    </OperatorPageFrame>
  );
}
