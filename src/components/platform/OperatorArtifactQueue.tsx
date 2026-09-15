import Link from "next/link";
import { cloneElement, type ReactElement, type ReactNode } from "react";

import OperatorEmptyState from "@/components/platform/OperatorEmptyState";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import { OperatorArtifactAction } from "@/components/platform/OperatorWorkActions";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsArtifactQueueItem } from "@/lib/platform/ops-model";

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function OperatorArtifactQueue({
  artifacts,
  controls,
  preview = false,
}: {
  artifacts: OpsArtifactQueueItem[];
  controls?: ReactElement<{ production?: ReactNode }>;
  preview?: boolean;
}) {
  const production = (
      <section className="space-y-3" aria-label="Artifact production queue" id="artifact-production">
        {artifacts.length ? <p className="text-sm text-black/55">{artifacts.length} {artifacts.length === 1 ? "Artifact" : "Artifacts"} in production</p> : null}
        <div className="grid gap-3 xl:grid-cols-2">
        {artifacts.map((artifact) => (
          <article
            className="operator-bento-card min-w-0"
            id={`artifact-${artifact.artifactJobId ?? artifact.artifactAwardId}`}
            key={artifact.artifactAwardId}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">{artifact.name}</h2>
                <Link className="inline-flex min-h-11 items-center text-sm underline decoration-black/25 underline-offset-4 hover:text-black" href={`/ops/members/${artifact.memberId}#journey`}>
                  {artifact.memberName}
                </Link>
              </div>
              <StateLabel state={artifact.state} />
            </div>
            <p className="text-sm text-black/60">{artifact.reason}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-black/45">Earned</dt><dd className="mt-1">{formatDate(artifact.earnedAt)}</dd></div><div><dt className="text-xs text-black/45">Due</dt><dd className="mt-1">{formatDate(artifact.dueAt)}</dd></div></dl>
            {artifact.artifactJobId ? (
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Update production</summary>
                <div className="pt-2 [&_form]:!grid-cols-1 [&_form>span]:!col-span-1">
                <OperatorArtifactAction artifactJobId={artifact.artifactJobId} state={artifact.state} preview={preview} />
                </div>
              </details>
            ) : (
              <p className="mt-3 text-xs text-black/55">
                Award recorded. Production work has not been created.
              </p>
            )}
          </article>
        ))}
        </div>
        {artifacts.length === 0 ? (
          <OperatorEmptyState
            actionHref={controls ? "#award-artifact" : undefined}
            actionLabel={controls ? "Award an Artifact" : undefined}
            detail="New production work will appear here as soon as an Artifact is awarded."
            eyebrow="Queue clear"
            title="No Artifact work is open."
          />
        ) : null}
      </section>
  );
  return <OperatorPageFrame title="Artifacts">{controls ? cloneElement(controls, { production }) : production}</OperatorPageFrame>;
}
