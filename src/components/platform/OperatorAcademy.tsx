import Link from "next/link";

import {
  OperatorAcademyCollectionActions,
  OperatorAcademyCollectionCreate,
  OperatorAcademyCreateResource,
} from "@/components/platform/OperatorAcademyActions";
import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import type {
  OpsAcademyReferenceOptions,
  OpsAcademySnapshot,
} from "@/lib/platform/ops-academy-model";

export default function OperatorAcademy({
  academy,
  options,
}: {
  academy: OpsAcademySnapshot;
  options: OpsAcademyReferenceOptions;
}) {
  return (
    <OperatorPageFrame title="Academy">
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

      {academy.canManage ? (
        <details
          className={`group mt-6 rounded-[4px] bg-[var(--color-highlight)] ${academy.resources.length === 0 ? "shadow-[5px_5px_0_#080605]" : ""}`}
          id="new-lesson"
          open={academy.resources.length === 0}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 font-[var(--font-display)] text-2xl tracking-[-0.02em] marker:content-none sm:px-6">
            New lesson
            <span aria-hidden="true" className="text-3xl transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="bg-white/45 px-5 py-6 sm:px-6">
            <OperatorAcademyCreateResource options={options} />
          </div>
        </details>
      ) : null}

      <section aria-label="Academy lessons" className="mt-8 space-y-3">
        {academy.resources.map((resource) => (
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
        {!academy.resources.length ? (
          <OperatorEmptyState
            detail="Create a lesson, add it to a collection when useful, then choose exactly who can see it before publishing."
            eyebrow="The first lesson"
            title="Build the Academy one useful resource at a time."
          />
        ) : null}
      </section>

      <section aria-labelledby="academy-collections" className="mt-12">
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
              {academy.canManage ? <OperatorAcademyCollectionActions collection={collection} /> : null}
            </article>
          ))}
        </div>
        {academy.canManage ? (
          <details className="group mt-5 rounded-[4px] bg-black/[0.03]" open={academy.collections.length === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 font-[var(--font-display)] text-2xl marker:content-none">
              New collection <span aria-hidden="true" className="text-3xl transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="px-5 pb-6"><OperatorAcademyCollectionCreate /></div>
          </details>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
