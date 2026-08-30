import Link from "next/link";

import styles from "@/components/membership/MemberLearningArticle.module.css";
import type {
  MemberLearningResourceDetail,
  MemberLearningResourceSummary,
} from "@/lib/membership/model";

type AcademyResourceDetail = MemberLearningResourceDetail & Partial<{
  captionsUrl: string | null;
  durationLabel: string | null;
  featured: boolean;
  presenter: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
}>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function formatKind(value: MemberLearningResourceDetail["resourceType"]) {
  return value.replaceAll("_", " ");
}

function PlayMark() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="m9 7 8 5-8 5V7Z" fill="currentColor" />
    </svg>
  );
}

function ResourceCopy({ body }: { body: string | null }) {
  const paragraphs = body?.split(/\n\s*\n/g).filter(Boolean) ?? [];

  if (!paragraphs.length) {
    return null;
  }

  return (
    <div className="max-w-[46rem]">
      {paragraphs.map((paragraph, index) => (
        <p
          className={`${index === 0 ? "font-[var(--font-display)] text-[clamp(1.85rem,4vw,3.25rem)] leading-[0.96] tracking-[-0.035em]" : "mt-7 font-[var(--font-body)] text-[0.98rem] leading-7 text-black/68 sm:text-base sm:leading-8"} whitespace-pre-wrap`}
          key={`${index}-${paragraph.slice(0, 24)}`}
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function AcademyPlayer({ resource }: { resource: AcademyResourceDetail }) {
  const videoSrc = resource.videoUrl ?? (
    resource.storageBucket && resource.storagePath
      ? `/api/my/learn/${resource.slug}/stream`
      : null
  );

  if (videoSrc) {
    return (
      <video
        className="h-full w-full bg-black object-contain"
        controls
        playsInline
        poster={resource.thumbnailUrl ?? undefined}
        preload="metadata"
      >
        <source src={videoSrc} />
        {resource.captionsUrl ? (
          <track default kind="captions" label="English" src={resource.captionsUrl} srcLang="en" />
        ) : null}
        Your browser does not support embedded video. You can still open the lesson below.
      </video>
    );
  }

  return (
    <div
      className="relative flex h-full w-full items-end overflow-hidden bg-[#151515] p-6 text-white sm:p-9"
      style={resource.thumbnailUrl ? {
        backgroundImage: `linear-gradient(180deg, transparent 20%, rgb(0 0 0 / 0.82)), url(${JSON.stringify(resource.thumbnailUrl)})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      } : undefined}
    >
      <div aria-hidden="true" className="absolute left-0 top-0 h-2 w-28 bg-[var(--color-highlight)]" />
      <div className="relative max-w-xl">
        <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-black/40">
          <PlayMark />
        </span>
        <p className="font-[var(--font-body)] text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-white/58">
          Hosted lesson
        </p>
        <p className="mt-2 font-[var(--font-display)] text-[clamp(1.8rem,4vw,3.4rem)] leading-[0.9] tracking-[-0.04em]">
          {resource.title}
        </p>
        {resource.externalUrl ? (
          <a
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[0.2rem] bg-white px-5 font-[var(--font-body)] text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-black transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            href={resource.externalUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open lesson <span aria-hidden="true">↗</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function RelatedLessons({ resources }: { resources: MemberLearningResourceSummary[] }) {
  if (!resources.length) {
    return null;
  }

  return (
    <aside aria-labelledby="academy-up-next" className={`${styles.relatedRail} min-w-0 lg:max-h-[min(39vw,34rem)] lg:overflow-y-auto lg:pr-2`}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="[font-family:var(--font-cadehandy2)] text-[1.25rem] leading-none text-[var(--color-poster)]">
            Keep going
          </p>
          <h2 className="mt-1 font-[var(--font-display)] text-2xl leading-none tracking-[-0.025em]" id="academy-up-next">
            Up next
          </h2>
        </div>
        <span className="font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.1em] text-black/42">
          {resources.length} {resources.length === 1 ? "lesson" : "lessons"}
        </span>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {resources.map((item, index) => (
          <li key={item.id}>
            <Link
              className="group grid min-h-[6.2rem] grid-cols-[7rem_minmax(0,1fr)] gap-3 rounded-[0.35rem] bg-black/[0.045] p-2 transition-colors hover:bg-black/[0.085] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              href={item.href}
            >
              <span
                className="relative flex aspect-video items-center justify-center self-start overflow-hidden rounded-[0.2rem] bg-[#242424] bg-cover bg-center text-white"
                style={item.thumbnailUrl ? {
                  backgroundImage: `linear-gradient(rgb(0 0 0 / 0.12), rgb(0 0 0 / 0.28)), url(${JSON.stringify(item.thumbnailUrl)})`,
                } : undefined}
              >
                <span className="absolute left-2 top-2 font-[var(--font-body)] text-[0.52rem] tracking-[0.1em] text-white/45">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-transform group-hover:scale-110">
                  <PlayMark />
                </span>
                {item.durationLabel ? (
                  <span className="absolute bottom-1.5 right-1.5 rounded-[0.15rem] bg-black/78 px-1.5 py-0.5 font-[var(--font-body)] text-[0.52rem] font-semibold tracking-[0.04em] text-white">
                    {item.durationLabel}
                  </span>
                ) : null}
              </span>
              <span className="min-w-0 py-1">
                <span className="block font-[var(--font-body)] text-[0.58rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-poster)]">
                  {item.collectionName ?? formatKind(item.resourceType)}
                </span>
                <span className="mt-1 block font-[var(--font-display)] text-xl leading-[0.95] tracking-[-0.025em]">
                  {item.title}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ResourceAction({ resource }: { resource: AcademyResourceDetail }) {
  const actionHref = resource.externalUrl
    ? resource.externalUrl
    : resource.storageBucket && resource.storagePath
      ? `/api/my/learn/${resource.slug}/download`
      : null;

  if (!actionHref || resource.resourceType === "video") {
    return null;
  }

  const label = resource.resourceType === "download"
    ? "Download material"
    : resource.resourceType === "audio"
      ? "Open audio"
      : "Open resource";

  return (
    <a
      className="mt-7 inline-flex min-h-11 items-center rounded-[0.2rem] bg-black px-5 font-[var(--font-body)] text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
      href={actionHref}
      rel={resource.externalUrl ? "noopener noreferrer" : undefined}
      target={resource.externalUrl ? "_blank" : undefined}
    >
      {label} <span aria-hidden="true" className="ml-2">{resource.externalUrl ? "↗" : "↓"}</span>
    </a>
  );
}

type MemberLearningArticleProps = {
  related?: MemberLearningResourceSummary[];
  resource: AcademyResourceDetail;
};

export default function MemberLearningArticle({
  related = [],
  resource,
}: MemberLearningArticleProps) {
  const isVideo = resource.resourceType === "video";
  const hasBody = Boolean(resource.bodyMarkdown?.trim());

  return (
    <main className="member-profile-dossier mx-auto max-w-[88rem] pb-20 pt-1 sm:pb-24" data-member-academy-lesson>
      <Link
        className="inline-flex min-h-11 items-center gap-2 font-[var(--font-body)] text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-black/48 transition-colors hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        href="/my/learn"
      >
        <span aria-hidden="true">←</span> Academy
      </Link>

      {isVideo ? (
        <>
          <section
            aria-label={`${resource.title} lesson`}
            className={`mt-3 grid gap-7 ${related.length ? "lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.34fr)]" : ""} lg:items-start`}
          >
            <div className="min-w-0">
              <div className={`${styles.mediaFrame} aspect-video overflow-hidden rounded-[0.45rem] bg-black shadow-[6px_6px_0_#2a2a2a] sm:shadow-[9px_9px_0_#2a2a2a]`}>
                <AcademyPlayer resource={resource} />
              </div>

              <header className="mt-7 max-w-[58rem] sm:mt-9">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-[var(--font-body)] text-[0.62rem] font-semibold uppercase tracking-[0.11em] text-black/42">
                  <span className="text-[var(--color-poster)]">{resource.collectionName ?? "Academy"}</span>
                  {resource.durationLabel ? <><span aria-hidden="true">/</span><span>{resource.durationLabel}</span></> : null}
                  {resource.presenter ? <><span aria-hidden="true">/</span><span>With {resource.presenter}</span></> : null}
                </div>
                <h1 className="mt-3 max-w-[18ch] font-[var(--font-display)] text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.86] tracking-[-0.045em]">
                  {resource.title}
                </h1>
                {resource.summary ? (
                  <p className="mt-5 max-w-2xl font-[var(--font-body)] text-[0.96rem] leading-7 text-black/62 sm:text-base">
                    {resource.summary}
                  </p>
                ) : null}
                <p className="mt-5 font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.1em] text-black/35">
                  Added {formatDate(resource.publishedAt)}
                </p>
              </header>
            </div>

            <RelatedLessons resources={related.filter((item) => item.href !== `/my/learn/${resource.slug}`)} />
          </section>

          {hasBody ? (
            <section
              aria-labelledby="lesson-notes-heading"
              className="mt-14 grid gap-6 rounded-[0.45rem] bg-black/[0.045] px-5 py-7 sm:mt-20 sm:px-8 sm:py-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12"
            >
              <div>
                <p className="[font-family:var(--font-cadehandy2)] text-[1.35rem] leading-none text-[var(--color-poster)]">Mark it up</p>
                <h2 className="mt-2 font-[var(--font-display)] text-3xl leading-none tracking-[-0.03em]" id="lesson-notes-heading">Lesson notes</h2>
              </div>
              <ResourceCopy body={resource.bodyMarkdown} />
            </section>
          ) : null}
        </>
      ) : (
        <article className="mt-7 max-w-[72rem]">
          <header className="max-w-[58rem]">
            <p className="[font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none text-[var(--color-poster)] sm:text-[1.7rem]">
              {resource.collectionName ?? "Ruined Academy"}
            </p>
            <p className="mt-4 font-[var(--font-body)] text-[0.62rem] font-semibold uppercase tracking-[0.11em] text-black/42">
              {formatKind(resource.resourceType)} / {formatDate(resource.publishedAt)}
            </p>
            <h1 className="mt-4 max-w-[15ch] font-[var(--font-display)] text-[clamp(3rem,8vw,7.2rem)] leading-[0.84] tracking-[-0.05em]">
              {resource.title}
            </h1>
            {resource.summary ? (
              <p className="mt-7 max-w-2xl font-[var(--font-body)] text-base leading-7 text-black/62 sm:text-lg sm:leading-8">
                {resource.summary}
              </p>
            ) : null}
            <ResourceAction resource={resource} />
          </header>

          {hasBody ? (
            <section aria-label="Resource text" className="mt-14 rounded-[0.45rem] bg-black/[0.045] px-5 py-8 sm:mt-20 sm:px-9 sm:py-12">
              <ResourceCopy body={resource.bodyMarkdown} />
            </section>
          ) : !resource.externalUrl && !resource.storagePath ? (
            <p className="mt-14 max-w-2xl font-[var(--font-body)] text-sm leading-7 text-black/48">
              This lesson is published, but its member material has not been attached yet.
            </p>
          ) : null}
        </article>
      )}
    </main>
  );
}
