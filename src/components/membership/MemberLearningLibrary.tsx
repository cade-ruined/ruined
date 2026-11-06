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

function ResourceArtwork({
  prominent = false,
  resource,
}: {
  prominent?: boolean;
  resource: MemberLearningResourceSummary;
}) {
  return (
    <div
      aria-hidden="true"
      className={`${styles.artwork} ${prominent ? styles.artworkFeatured : ""} ${
        resource.thumbnailUrl ? styles.artworkImage : styles.artworkPlaceholder
      }`}
      style={resource.thumbnailUrl ? { backgroundImage: `url(${JSON.stringify(resource.thumbnailUrl)})` } : undefined}
    >
      {!resource.thumbnailUrl ? <span>{resource.collectionName ?? "Ruined Library"}</span> : null}
      <span className={styles.artworkAction}>
        {resource.resourceType === "video" ? <span className={styles.playMark}>▶</span> : null}
        {resource.durationLabel ?? lessonAction(resource)}
      </span>
    </div>
  );
}

function LibraryResourceCard({ resource }: { resource: MemberLearningResourceSummary }) {
  return (
    <Link className={styles.lessonCard} data-library-resource-card href={resource.href}>
      <ResourceArtwork resource={resource} />
      <div className={styles.lessonCardCopy}>
        <p className={styles.cardMeta}>
          {resource.collectionName ?? "Library"}
          {resource.presenter ? ` · ${resource.presenter}` : ""}
        </p>
        <h3>{resource.title}</h3>
        {resource.summary ? <p className={styles.cardSummary}>{resource.summary}</p> : null}
      </div>
    </Link>
  );
}

function FeaturedResource({ resource }: { resource: MemberLearningResourceSummary }) {
  return (
    <section aria-labelledby="library-featured-title" className={styles.featured}>
      <Link className={styles.featuredArtworkLink} href={resource.href}>
        <ResourceArtwork prominent resource={resource} />
        <span className="sr-only">{lessonAction(resource)} {resource.title}</span>
      </Link>
      <div className={styles.featuredCopy}>
        <p className={styles.kicker}>{resource.resourceType === "video" ? "Featured recording" : "Featured resource"}</p>
        <h2 id="library-featured-title">{resource.title}</h2>
        {resource.summary ? <p>{resource.summary}</p> : null}
        <div className={styles.featuredMeta}>
          <span>{resource.collectionName ?? "Library"}</span>
          {resource.presenter ? <span>{resource.presenter}</span> : null}
          {resource.durationLabel ? <span>{resource.durationLabel}</span> : null}
        </div>
        <Link className={styles.primaryAction} href={resource.href}>
          {resource.resourceType === "video" ? "Watch recording" : `${lessonAction(resource)} resource`} <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
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
  const featured =
    allResources.find((resource) => resource.featured) ??
    allResources.find((resource) => resource.resourceType === "video") ??
    allResources[0] ??
    null;
  const additionalResources = learning.uncollected.filter((resource) => resource.id !== featured?.id);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtering = activeCollection !== ALL_RESOURCES || normalizedQuery.length > 0;
  const filteredResources = allResources.filter((resource) => {
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
          <p className={styles.introduction}>Recordings and material to return to, in your own time.</p>
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

          {!filtering && featured ? <FeaturedResource resource={featured} /> : null}

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
                <div className={styles.lessonGrid}>
                  {filteredResources.map((resource) => <LibraryResourceCard key={resource.id} resource={resource} />)}
                </div>
              ) : (
                <p aria-live="polite" className={styles.noResults} role="status">
                  Nothing matches yet. Try another word or clear your filters.
                </p>
              )}
            </section>
          ) : (
            <div className={styles.collectionStack}>
              {learning.collections.map((collection) => {
                const resources = collection.resources.filter((resource) => resource.id !== featured?.id);
                if (!resources.length) return null;
                return (
                  <section
                    aria-labelledby={`library-collection-${collection.id}`}
                    className={styles.librarySection}
                    id={collection.slug}
                    key={collection.id}
                  >
                    <div className={styles.sectionHeading}>
                      <div>
                        <p className={styles.kicker}>Collection</p>
                        <h2 id={`library-collection-${collection.id}`}>{collection.name}</h2>
                      </div>
                      {collection.description ? <p>{collection.description}</p> : null}
                    </div>
                    <div className={styles.lessonGrid}>
                      {resources.map((resource) => <LibraryResourceCard key={resource.id} resource={resource} />)}
                    </div>
                  </section>
                );
              })}

              {additionalResources.length ? (
                <section aria-labelledby="library-more-title" className={styles.librarySection}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.kicker}>Library</p>
                      <h2 id="library-more-title">More to explore</h2>
                    </div>
                  </div>
                  <div className={styles.lessonGrid}>
                    {additionalResources.map((resource) => <LibraryResourceCard key={resource.id} resource={resource} />)}
                  </div>
                </section>
              ) : null}
            </div>
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
