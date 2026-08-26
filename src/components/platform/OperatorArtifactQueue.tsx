import Link from "next/link";

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

export default function OperatorArtifactQueue({ artifacts }: { artifacts: OpsArtifactQueueItem[] }) {
  return (
    <OperatorPageFrame
      eyebrow="Artifacts"
      introduction="An Artifact is earned before production begins. The award, member inputs, fulfillment proof, and each production transition remain one traceable record."
      title="Artifacts"
    >
      <section className="mt-14 border-t border-black/25" aria-label="Artifact production queue">
        {artifacts.map((artifact) => (
          <article className="border-b border-black/20 py-7" id={`artifact-${artifact.artifactJobId ?? artifact.artifactAwardId}`} key={artifact.artifactAwardId}>
            <div className="grid gap-5 lg:grid-cols-[minmax(14rem,1fr)_10rem_8rem_minmax(12rem,0.7fr)] lg:items-start">
              <div>
                <p className="text-[0.6rem] font-medium uppercase tracking-[0.15em] text-black/38">Earned {formatDate(artifact.earnedAt)}</p>
                <h2 className="mt-3 text-3xl leading-[0.95] tracking-[-0.025em]">{artifact.name}</h2>
                <p className="mt-3 text-sm text-black/48">{artifact.reason}</p>
              </div>
              <div>
                <Link className="ui-heading text-sm font-semibold underline decoration-black/25 underline-offset-4 hover:text-black" href={`/ops/members/${artifact.memberId}#journey`}>
                  {artifact.memberName}
                </Link>
                <p className="mt-2 text-xs text-black/42">Member record</p>
              </div>
              <div>
                <StateLabel state={artifact.state} />
                <p className="mt-2 text-xs text-black/42">Priority {artifact.priority}</p>
              </div>
              <div className="text-sm text-black/52">
                <p>Due {formatDate(artifact.dueAt)}</p>
                <p className="mt-2">Award {artifact.artifactAwardId.slice(0, 8)}</p>
              </div>
            </div>
            {artifact.artifactJobId ? (
              <div className="mt-7 border-t border-black/15 pt-5">
                <OperatorArtifactAction artifactJobId={artifact.artifactJobId} state={artifact.state} />
              </div>
            ) : (
              <p className="mt-7 border-t border-black/15 pt-5 text-sm text-black/45">Award recorded. Production work has not been created.</p>
            )}
          </article>
        ))}
        {artifacts.length === 0 ? (
          <p className="border-b border-black/15 py-10 text-sm text-black/50">No Artifact work is open.</p>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
