import Link from "next/link";

import type { MemberLearningResourceDetail } from "@/lib/membership/model";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value));
}

export default function MemberLearningArticle({ resource }: { resource: MemberLearningResourceDetail }) {
  const paragraphs = resource.bodyMarkdown?.split(/\n\s*\n/g).filter(Boolean) ?? [];
  const actionHref = resource.externalUrl
    ? resource.externalUrl
    : resource.storageBucket && resource.storagePath
      ? `/api/my/learn/${resource.slug}/download`
      : null;

  return (
    <main className="border-t border-black/20 pt-5">
      <Link className="font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black/45 underline decoration-black/20 underline-offset-8 hover:text-black" href="/my/learn">← Learn</Link>
      <header className="mt-14 grid gap-10 border-b border-black/20 pb-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:items-end lg:gap-20 lg:pb-16">
        <div>
          <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">{resource.collectionName ?? "Ruined Learn"} / {resource.resourceType.replaceAll("_", " ")}</p>
          <h1 className="mt-6 max-w-[13ch] font-[var(--font-display)] text-[clamp(3.8rem,8vw,8rem)] leading-[0.82] tracking-[-0.055em]">{resource.title}</h1>
        </div>
        <div>
          {resource.summary ? <p className="font-[var(--font-body)] text-base leading-relaxed text-black/58">{resource.summary}</p> : null}
          <p className="mt-5 font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/34">Published {formatDate(resource.publishedAt)} / Version {resource.version}</p>
        </div>
      </header>

      {paragraphs.length ? (
        <article className="mx-auto max-w-3xl py-14 sm:py-20">
          {paragraphs.map((paragraph, index) => (
            <p className={`${index === 0 ? "font-[var(--font-display)] text-3xl leading-[1.08] tracking-[-0.025em] sm:text-4xl" : "mt-8 font-[var(--font-body)] text-base leading-8 text-black/68 sm:text-lg"} whitespace-pre-wrap`} key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </article>
      ) : actionHref ? (
        <section className="py-16 text-center">
          <p className="font-[var(--font-handwritten)] text-2xl text-[var(--color-poster)]">leave this room, carry the material</p>
          <a className="mt-8 inline-flex min-h-12 items-center border border-black bg-black px-7 font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-white hover:bg-[var(--color-poster)]" href={actionHref} rel="noreferrer" target={resource.externalUrl ? "_blank" : undefined}>Open resource ↗</a>
        </section>
      ) : (
        <section className="py-16">
          <p className="border-y border-black/20 py-12 font-[var(--font-body)] text-sm leading-relaxed text-black/48">This resource record is published, but its member-facing material is not connected yet.</p>
        </section>
      )}
    </main>
  );
}
