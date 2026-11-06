"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  MemberLearningResourceSummary,
  MemberLearningSnapshot,
} from "@/lib/membership/model";

import styles from "./member-academy.module.css";

const ALL_RESOURCES = "all";

function lessonAction(resource: MemberLearningResourceSummary) {
  switch (resource.resourceType) {
    case "video": return "Watch";
    case "audio": return "Listen";
    case "article": return "Read";
    case "download": return "Open";
    case "external_link": return "Visit";
  }
}

function LibraryResourceCard({ resource }: { resource: MemberLearningResourceSummary }) {
  return (
    <Link
      aria-label={`${lessonAction(resource)} ${resource.title}${resource.durationLabel ? `, ${resource.durationLabel}` : ""}`}
      className={styles.lessonCard}
      data-library-resource-card
      href={resource.href}
    >
      <div
        aria-hidden="true"
        className={`${styles.artwork} ${resource.thumbnailUrl ? "" : styles.artworkPlaceholder}`}
        style={resource.thumbnailUrl ? { backgroundImage: `url(${JSON.stringify(resource.thumbnailUrl)})` } : undefined}
      />
      <div className={styles.cardMeta}>
        <span>{resource.collectionName ?? "Library"}</span>
        {resource.durationLabel ? <span>{resource.durationLabel}</span> : null}
      </div>
      <div className={styles.lessonCardCopy}>
        {resource.featured ? <p className={styles.featuredLabel}>Featured</p> : null}
        <h2>{resource.title}</h2>
        {resource.presenter ? <p className={styles.presenter}>With {resource.presenter}</p> : null}
        {resource.summary ? <p className={styles.cardSummary}>{resource.summary}</p> : null}
        <span className={styles.cardAction}>
          <span>{resource.resourceType === "video" ? "Watch recording" : `${lessonAction(resource)} resource`}</span>
          <span aria-hidden="true" className={styles.playMark}>{resource.resourceType === "video" ? "▶" : "↗"}</span>
        </span>
      </div>
    </Link>
  );
}

export default function MemberLearningLibrary({ learning }: { learning: MemberLearningSnapshot }) {
  const [activeCollection, setActiveCollection] = useState(ALL_RESOURCES);
  const [query, setQuery] = useState("");
  const allResources = useMemo(
    () => [
      ...learning.collections.flatMap((collection) => collection.resources),
      ...learning.uncollected,
    ],
    [learning],
  );
  const orderedResources = [...allResources].sort((a, b) => Number(b.featured) - Number(a.featured));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtering = activeCollection !== ALL_RESOURCES || normalizedQuery.length > 0;
  const filteredResources = orderedResources.filter((resource) => {
    const belongsToCollection = activeCollection === ALL_RESOURCES || resource.collectionName === activeCollection;
    const searchable = `${resource.title} ${resource.summary ?? ""} ${resource.collectionName ?? ""} ${resource.presenter ?? ""}`.toLocaleLowerCase();
    return belongsToCollection && (!normalizedQuery || searchable.includes(normalizedQuery));
  });

  return (
    <main className={`member-journey-page ${styles.academy}`} data-member-library>
      <header className={styles.academyHeader}>
        <div>
          <p className={styles.handNote}>come back to what matters</p>
          <h1>Library</h1>
        </div>
        <label className={styles.search}>
          <span className="sr-only">Search Library</span>
          <svg aria-hidden viewBox="0 0 24 24">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            aria-label="Search Library"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the library"
            type="search"
            value={query}
          />
        </label>
      </header>

      {allResources.length ? (
        <>
          <nav aria-label="Library categories" className={styles.categoryRail}>
            <button
              aria-pressed={activeCollection === ALL_RESOURCES}
              onClick={() => setActiveCollection(ALL_RESOURCES)}
              type="button"
            >
              All
            </button>
            {learning.collections.filter((collection) => collection.resources.length).map((collection) => (
              <button
                aria-pressed={activeCollection === collection.name}
                key={collection.id}
                onClick={() => setActiveCollection(collection.name)}
                type="button"
              >
                {collection.name}
              </button>
            ))}
          </nav>

          {filtering ? (
            <section aria-labelledby="library-results-title" className={styles.librarySection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>Library</p>
                  <h2 aria-live="polite" id="library-results-title">
                    {filteredResources.length === 1 ? "1 resource" : `${filteredResources.length} resources`}
                  </h2>
                </div>
                <button
                  className={styles.clearButton}
                  onClick={() => {
                    setActiveCollection(ALL_RESOURCES);
                    setQuery("");
                  }}
                  type="button"
                >
                  Clear
                </button>
              </div>
              {filteredResources.length ? (
                <div className={styles.lessonGrid} data-single={filteredResources.length === 1 ? "true" : undefined}>
                  {filteredResources.map((resource) => <LibraryResourceCard key={resource.id} resource={resource} />)}
                </div>
              ) : (
                <p aria-live="polite" className={styles.noResults} role="status">
                  Nothing matches yet. Try another word or clear your filters.
                </p>
              )}
            </section>
          ) : (
            <section aria-label="Available recordings and resources" className={styles.lessonGrid} data-single={orderedResources.length === 1 ? "true" : undefined}>
              {orderedResources.map((resource) => <LibraryResourceCard key={resource.id} resource={resource} />)}
            </section>
          )}
        </>
      ) : (
        <section className={styles.emptyLibrary}>
          <p className={styles.kicker}>Library</p>
          <h2>Nothing here yet.</h2>
          <p>Your available recordings and resources will appear here. You can find your current exercises in The Work.</p>
          <Link className={styles.primaryAction} href="/my/practice">Open The Work <span aria-hidden>→</span></Link>
        </section>
      )}
    </main>
  );
}
