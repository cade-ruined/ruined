"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  MemberLearningResourceSummary,
  MemberLearningSnapshot,
} from "@/lib/membership/model";

import styles from "./member-academy.module.css";

const ALL_LESSONS = "all";

function lessonAction(resource: MemberLearningResourceSummary) {
  switch (resource.resourceType) {
    case "video": return "Watch";
    case "audio": return "Listen";
    case "article": return "Read";
    case "download": return "Open";
    case "external_link": return "Visit";
  }
}

function LessonArtwork({
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
      {!resource.thumbnailUrl ? <span>{resource.collectionName ?? "Ruined Academy"}</span> : null}
      <span className={styles.artworkAction}>
        {resource.resourceType === "video" ? <span className={styles.playMark}>▶</span> : null}
        {resource.durationLabel ?? lessonAction(resource)}
      </span>
    </div>
  );
}

function AcademyVideoCard({ resource }: { resource: MemberLearningResourceSummary }) {
  return (
    <Link className={styles.lessonCard} data-academy-resource-card href={resource.href}>
      <LessonArtwork resource={resource} />
      <div className={styles.lessonCardCopy}>
        <p className={styles.cardMeta}>
          {resource.collectionName ?? "Academy"}
          {resource.presenter ? ` · ${resource.presenter}` : ""}
        </p>
        <h3>{resource.title}</h3>
        {resource.summary ? <p className={styles.cardSummary}>{resource.summary}</p> : null}
      </div>
    </Link>
  );
}

function FeaturedLesson({ resource }: { resource: MemberLearningResourceSummary }) {
  return (
    <section aria-labelledby="academy-featured-title" className={styles.featured}>
      <Link className={styles.featuredArtworkLink} href={resource.href}>
        <LessonArtwork prominent resource={resource} />
        <span className="sr-only">{lessonAction(resource)} {resource.title}</span>
      </Link>
      <div className={styles.featuredCopy}>
        <p className={styles.kicker}>Featured lesson</p>
        <h2 id="academy-featured-title">{resource.title}</h2>
        {resource.summary ? <p>{resource.summary}</p> : null}
        <div className={styles.featuredMeta}>
          <span>{resource.collectionName ?? "Academy"}</span>
          {resource.presenter ? <span>{resource.presenter}</span> : null}
          {resource.durationLabel ? <span>{resource.durationLabel}</span> : null}
        </div>
        <Link className={styles.primaryAction} href={resource.href}>
          {lessonAction(resource)} lesson <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

export default function MemberLearningLibrary({ learning }: { learning: MemberLearningSnapshot }) {
  const [activeCollection, setActiveCollection] = useState(ALL_LESSONS);
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
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtering = activeCollection !== ALL_LESSONS || normalizedQuery.length > 0;
  const filteredResources = allResources.filter((resource) => {
    const belongsToCollection = activeCollection === ALL_LESSONS || resource.collectionName === activeCollection;
    const searchable = `${resource.title} ${resource.summary ?? ""} ${resource.collectionName ?? ""} ${resource.presenter ?? ""}`.toLocaleLowerCase();
    return belongsToCollection && (!normalizedQuery || searchable.includes(normalizedQuery));
  });

  return (
    <main className={styles.academy} data-member-academy>
      <header className={styles.academyHeader}>
        <div>
          <p className={styles.handNote}>use what moves the work</p>
          <h1>Academy</h1>
        </div>
        <label className={styles.search}>
          <span className="sr-only">Search Academy</span>
          <svg aria-hidden viewBox="0 0 24 24">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            aria-label="Search Academy"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lessons"
            type="search"
            value={query}
          />
        </label>
      </header>

      {allResources.length ? (
        <>
          <nav aria-label="Academy categories" className={styles.categoryRail}>
            <button
              aria-pressed={activeCollection === ALL_LESSONS}
              onClick={() => setActiveCollection(ALL_LESSONS)}
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

          {!filtering && featured ? <FeaturedLesson resource={featured} /> : null}

          {filtering ? (
            <section aria-labelledby="academy-results-title" className={styles.librarySection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>Library</p>
                  <h2 id="academy-results-title">
                    {filteredResources.length === 1 ? "1 lesson" : `${filteredResources.length} lessons`}
                  </h2>
                </div>
                <button
                  className={styles.clearButton}
                  onClick={() => {
                    setActiveCollection(ALL_LESSONS);
                    setQuery("");
                  }}
                  type="button"
                >
                  Clear
                </button>
              </div>
              {filteredResources.length ? (
                <div className={styles.lessonGrid}>
                  {filteredResources.map((resource) => <AcademyVideoCard key={resource.id} resource={resource} />)}
                </div>
              ) : (
                <p aria-live="polite" className={styles.noResults} role="status">
                  No lessons match that search.
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
                    aria-labelledby={`academy-collection-${collection.id}`}
                    className={styles.librarySection}
                    id={collection.slug}
                    key={collection.id}
                  >
                    <div className={styles.sectionHeading}>
                      <div>
                        <p className={styles.kicker}>Series</p>
                        <h2 id={`academy-collection-${collection.id}`}>{collection.name}</h2>
                      </div>
                      {collection.description ? <p>{collection.description}</p> : null}
                    </div>
                    <div className={styles.lessonGrid}>
                      {resources.map((resource) => <AcademyVideoCard key={resource.id} resource={resource} />)}
                    </div>
                  </section>
                );
              })}

              {learning.uncollected.length ? (
                <section aria-labelledby="academy-more-title" className={styles.librarySection}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.kicker}>Library</p>
                      <h2 id="academy-more-title">More lessons</h2>
                    </div>
                  </div>
                  <div className={styles.lessonGrid}>
                    {learning.uncollected
                      .filter((resource) => resource.id !== featured?.id)
                      .map((resource) => <AcademyVideoCard key={resource.id} resource={resource} />)}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <section className={styles.emptyLibrary}>
          <p className={styles.kicker}>Academy</p>
          <h2>The library is still quiet.</h2>
          <p>New lessons will appear here when they are published for your Circle, Block, or membership.</p>
        </section>
      )}
    </main>
  );
}
