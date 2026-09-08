"use client";

import Link from "next/link";
import { useState } from "react";

import {
  OperatorAcademyCollectionActions,
  OperatorAcademyCollectionCreate,
  OperatorAcademyCreateResource,
} from "@/components/platform/OperatorAcademyActions";
import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import { OPERATOR_FIELD_CLASS, OPERATOR_LABEL_CLASS, OPERATOR_LABEL_TEXT_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
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
  const [status, setStatus] = useState("all");
  const resources = academy.resources.filter((resource) =>
    (status === "all" || resource.status === status)
    && `${resource.title} ${resource.collectionName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <OperatorPageFrame title="Academy">
      <nav aria-label="Academy tasks" className="mb-4 flex flex-wrap items-center gap-3">
        {academy.canManage ? <a className={OPERATOR_PRIMARY_ACTION_CLASS} href="#new-lesson">+ New lesson</a> : null}
        <a className="inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-4" href="#academy-collections">Collections</a>
        {academy.canManage ? <a className="inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-4" href="#new-collection">+ New collection</a> : null}
      </nav>
      <dl
        aria-label="Academy snapshot"
        className="grid gap-5 rounded-[4px] bg-[#080605] px-6 py-6 text-[var(--color-bone)] sm:grid-cols-4 sm:px-8 sm:py-8"
      >
        {[
          ["Live", academy.counts.published],
          ["Drafts", academy.counts.draft],
          ["Offline", academy.counts.unpublished],
          ["Collections", academy.collections.filter((collection) => collection.status !== "retired").length],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-white/48">{label}</dt>
            <dd className="mt-2 font-[var(--font-display)] text-4xl leading-none tracking-[-0.03em] sm:text-5xl">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Academy lessons" className="mt-8 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>Find a lesson</span><input className={OPERATOR_FIELD_CLASS} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or collection" type="search" value={query} /></label>
          <label className={OPERATOR_LABEL_CLASS}><span className={OPERATOR_LABEL_TEXT_CLASS}>Show</span><select className={OPERATOR_FIELD_CLASS} onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All lessons</option><option value="draft">Drafts</option><option value="published">Published</option><option value="unpublished">Unpublished</option><option value="retired">Retired</option></select></label>
        </div>
        <p className="py-2 text-sm text-black/50" aria-live="polite">{resources.length} of {academy.resources.length} lessons</p>
        {resources.map((resource) => (
          <Link
            className="group grid gap-5 rounded-[4px] bg-black/[0.03] px-5 py-5 transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-black/[0.065] sm:grid-cols-[5.5rem_minmax(0,1fr)_9rem_8rem] sm:items-center sm:px-6"
            href={`/ops/academy/${resource.resourceId}`}
            key={resource.resourceId}
          >
            <span
              aria-hidden="true"
              className="flex aspect-video items-end rounded-[3px] bg-[#222] bg-cover bg-center p-2 text-[0.55rem] uppercase tracking-[0.1em] text-white/55 sm:aspect-square"
              style={resource.thumbnailUrl ? { backgroundImage: `linear-gradient(rgb(0 0 0 / 0.1), rgb(0 0 0 / 0.48)), url(${JSON.stringify(resource.thumbnailUrl)})` } : undefined}
            >
              {resource.contentType}
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-black/45">
                {resource.collectionName ?? "Uncollected"} · v{resource.latestVersion}
              </span>
              <span className="mt-1 block font-[var(--font-display)] text-3xl leading-[0.92] tracking-[-0.03em]">{resource.title}</span>
              {resource.summary ? <span className="mt-3 line-clamp-2 block text-sm leading-relaxed text-black/50">{resource.summary}</span> : null}
            </span>
            <span className="text-sm leading-relaxed text-black/48">
              {resource.audiences.length
                ? resource.audiences.map((audience) => audience.label).join(", ")
                : "Audience needed"}
            </span>
            <span>
              <StateLabel state={resource.status} />
              {resource.hasUnpublishedChanges ? <span className="mt-2 block text-xs text-[var(--color-poster)]">Draft changes</span> : null}
            </span>
          </Link>
        ))}
        {academy.resources.length > 0 && resources.length === 0 ? <p className="rounded-[4px] bg-black/[0.035] p-5 text-sm text-black/55">No matches. Try another title or show all lessons.</p> : null}
        {!academy.resources.length ? (
          <OperatorEmptyState
            actionHref={academy.canManage ? "#new-lesson" : undefined}
            actionLabel={academy.canManage ? "Create first lesson" : undefined}
            detail={academy.canManage ? "Add a video or resource, choose its audience, then publish when ready." : "Published lessons will appear here when they are available to you."}
            eyebrow="Lessons"
            title="No lessons yet."
          />
        ) : null}
      </section>

      {academy.canManage ? (
        <section className="mt-8 scroll-mt-28 rounded-[4px] bg-[var(--color-shop)]/25 p-5 sm:p-6" id="new-lesson" aria-labelledby="new-lesson-title">
          <h2 className="font-[var(--font-display)] text-3xl" id="new-lesson-title">New lesson</h2>
          <p className="mb-5 mt-2 text-sm text-black/60">Save a draft first. Members only see it after you publish.</p>
          <OperatorAcademyCreateResource options={options} preview={preview} />
        </section>
      ) : null}

      <section aria-labelledby="academy-collections" className="mt-8 scroll-mt-28">
        <h2 className="font-[var(--font-display)] text-4xl leading-none tracking-[-0.035em]" id="academy-collections">Collections</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {academy.collections.map((collection) => (
            <article className="rounded-[4px] bg-black/[0.03] p-5" key={collection.collectionId}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-black/42">{collection.resourceCount} {collection.resourceCount === 1 ? "lesson" : "lessons"}</p>
                  <h3 className="mt-2 font-[var(--font-display)] text-3xl leading-none tracking-[-0.03em]">{collection.name}</h3>
                </div>
                <StateLabel state={collection.status} />
              </div>
              {collection.summary ? <p className="mt-4 text-sm leading-relaxed text-black/52">{collection.summary}</p> : null}
              {academy.canManage ? <OperatorAcademyCollectionActions collection={collection} preview={preview} /> : null}
            </article>
          ))}
        </div>
        {academy.canManage ? (
          <section className="mt-5 scroll-mt-28 rounded-[4px] bg-black/[0.03] p-5" id="new-collection" aria-labelledby="new-collection-title">
            <h3 className="mb-5 font-[var(--font-display)] text-2xl" id="new-collection-title">New collection</h3>
            <OperatorAcademyCollectionCreate preview={preview} />
          </section>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
