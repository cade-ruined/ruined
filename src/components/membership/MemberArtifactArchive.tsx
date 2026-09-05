import Image from "next/image";
import Link from "next/link";

import MemberPageHeader, {
  MemberEmptyRoom,
} from "@/components/membership/MemberPageHeader";
import type { MemberArtifactsSnapshot } from "@/lib/membership/model";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value));
}

const acquisitionLabels = {
  earned: "Earned",
  gifted: "Gifted",
  purchased: "Purchased",
} as const;

export default function MemberArtifactArchive({ artifacts }: { artifacts: MemberArtifactsSnapshot }) {
  return (
    <main>
      <MemberPageHeader
        eyebrow="Ruined Membership / Artifacts"
        imageIntent="A single dark object wrapped in tissue on a raw workbench. Evidence of handwork, not product styling."
        imageSequence="05"
        note="leave evidence"
        summary="The physical record of what you earn, choose, make, and carry forward through Ruined Membership."
        title="What remains afterward."
      />

      <section className="mt-20">
        {artifacts.awards.length ? (
          <ol className="grid gap-px bg-black/15 md:grid-cols-2">
            {artifacts.awards.map((artifact, index) => (
              <li className="bg-[var(--color-bone)] p-6 sm:p-9" key={artifact.awardId}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-[4px] bg-black/[0.04]">
                  {artifact.imageUrl ? (
                    <Image
                      alt={artifact.product?.imageAlt ?? artifact.name}
                      className="object-cover saturate-[0.82] contrast-[1.04]"
                      fill
                      sizes="(min-width: 768px) 45vw, 100vw"
                      src={artifact.imageUrl}
                      unoptimized
                    />
                  ) : (
                    <div className="size-full border border-dashed border-black/20 p-5">
                      <p className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.08em] text-black/32">
                        Artifact image / {String(index + 1).padStart(2, "0")}
                      </p>
                      <div className="flex h-[calc(100%-2rem)] items-end">
                        <p className="font-[var(--font-handwritten)] text-2xl text-[var(--color-poster)]">physical record</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
                  <p className="font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.14em] text-[var(--color-poster)]">{artifact.artifactState.replaceAll("_", " ")}</p>
                  <time className="font-[var(--font-body)] text-xs text-black/35">{formatDate(artifact.earnedAt)}</time>
                </div>
                <h2 className="mt-4 font-[var(--font-display)] text-4xl leading-[0.94] tracking-[-0.035em] sm:text-5xl">{artifact.name}</h2>
                {artifact.description ? <p className="mt-3 font-[var(--font-body)] text-base leading-relaxed text-black/68">{artifact.description}</p> : null}
                <p className="mt-5 font-[var(--font-body)] text-sm leading-relaxed text-black/52">
                  {acquisitionLabels[artifact.acquisitionType]} — {artifact.earnedReason}
                </p>
                {artifact.inputRequired ? (
                  <p className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 font-[var(--font-body)] text-sm leading-relaxed text-black/58">Ruined still needs fulfillment inputs for this artifact. The operator will open the approved collection step here when it is ready.</p>
                ) : null}
                {artifact.product?.href || artifact.trackingUrl ? (
                  <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3">
                    {artifact.product?.href ? (
                      <Link className="inline-flex font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.08em] text-black/62 underline decoration-black/25 underline-offset-8 hover:text-black" href={artifact.product.href}>
                        View product →
                      </Link>
                    ) : null}
                    {artifact.trackingUrl ? (
                      <a className="inline-flex font-[var(--font-body)] text-xs uppercase tracking-[0.08em] text-black/52 underline decoration-black/25 underline-offset-8 hover:text-black" href={artifact.trackingUrl} rel="noreferrer" target="_blank">Track shipment ↗</a>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <MemberEmptyRoom
            body="Artifacts appear only when a durable award exists. A mock object or generic reward would weaken the meaning of the archive, so this room stays empty until something has been earned."
            title="Nothing has been awarded yet."
          />
        )}
      </section>
    </main>
  );
}
