import Link from "next/link";

import MemberPageHeader, {
  MemberEmptyRoom,
} from "@/components/membership/MemberPageHeader";
import type {
  MemberLearningResourceSummary,
  MemberLearningSnapshot,
} from "@/lib/membership/model";

function ResourceRow({
  index,
  resource,
}: {
  index: number;
  resource: MemberLearningResourceSummary;
}) {
  return (
    <li className="border-b border-black/20">
      <Link className="group grid gap-5 py-8 sm:grid-cols-[2.5rem_minmax(12rem,0.55fr)_minmax(0,1fr)_auto] sm:gap-8 sm:px-2 sm:py-10" href={resource.href}>
        <span className="font-[var(--font-body)] text-xs text-black/30">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <p className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.14em] text-[var(--color-poster)]">{resource.resourceType.replaceAll("_", " ")}</p>
          <h3 className="mt-3 font-[var(--font-display)] text-3xl leading-[0.96] tracking-[-0.03em]">{resource.title}</h3>
        </div>
        <p className="max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-black/52">{resource.summary ?? "Ruined member resource."}</p>
        <span aria-hidden className="text-xl text-black/32 transition-transform group-hover:translate-x-1 group-hover:text-black">→</span>
      </Link>
    </li>
  );
}

export default function MemberLearningLibrary({ learning }: { learning: MemberLearningSnapshot }) {
  const hasResources = learning.collections.some((collection) => collection.resources.length > 0) || learning.uncollected.length > 0;
  let offset = 0;
  return (
    <main>
      <MemberPageHeader
        eyebrow="Ruined Membership / Learn"
        imageIntent="A marked-up field note, black pencil, raw worktable. Cropped close and quiet."
        imageSequence="04"
        note="keep what earns a return"
        summary="A restrained library of working notes, films, audio, and materials made for the member practice."
        title="Not content. Material."
      />

      <section className="mt-20">
        {!hasResources ? (
          <MemberEmptyRoom
            body="Ruined has not published approved member material for your Circle, Block, or progression yet. Nothing appears here simply to make the library look full."
            title="The library is still quiet."
          />
        ) : (
          <div>
            {learning.collections.map((collection) => {
              const start = offset;
              offset += collection.resources.length;
              return (
                <section className="mb-20" id={collection.slug} key={collection.id}>
                  <div className="grid gap-5 border-b border-black/20 pb-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(20rem,1.3fr)] lg:items-end lg:gap-16">
                    <div>
                      <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">Collection</p>
                      <h2 className="mt-4 font-[var(--font-display)] text-5xl leading-none tracking-[-0.04em] sm:text-6xl">{collection.name}</h2>
                    </div>
                    {collection.description ? <p className="max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-black/50 sm:text-base">{collection.description}</p> : null}
                  </div>
                  <ol>{collection.resources.map((resource, index) => <ResourceRow index={start + index} key={resource.id} resource={resource} />)}</ol>
                </section>
              );
            })}
            {learning.uncollected.length ? (
              <section>
                <div className="border-b border-black/20 pb-7">
                  <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">Individual notes</p>
                  <h2 className="mt-4 font-[var(--font-display)] text-5xl leading-none tracking-[-0.04em]">Outside a collection.</h2>
                </div>
                <ol>{learning.uncollected.map((resource, index) => <ResourceRow index={offset + index} key={resource.id} resource={resource} />)}</ol>
              </section>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
