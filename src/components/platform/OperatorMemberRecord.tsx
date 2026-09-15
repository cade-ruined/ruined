import Link from "next/link";

import {
  OperatorNoteAction,
  OperatorOverrideAction,
  OperatorTaskCreateAction,
} from "@/components/platform/OperatorMemberActions";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorMemberSetup from "@/components/platform/OperatorMemberSetup";
import OperatorProfileSupport from "@/components/platform/OperatorProfileSupport";
import OperatorProgress from "@/components/platform/OperatorProgress";
import OperatorMemberAvatar from "@/components/platform/OperatorMemberAvatar";
import OperatorMemberWorkspace from "@/components/platform/OperatorMemberWorkspace";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsMemberRecord } from "@/lib/platform/ops-model";
import { guidanceForMemberRecord, memberGuidanceAction } from "@/lib/platform/operator-member-guidance";
import type { OpsMemberProfileSupport } from "@/lib/platform/ops-profile-repository";
import { operatorMemberReturnLocation } from "@/lib/platform/operator-return-location";

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) return "Not recorded";
  return new Intl.NumberFormat("en-US", {
    currency: currency.toUpperCase(),
    style: "currency",
  }).format(amount / 100);
}

function SectionHeading({ title }: { title: string }) {
  return (
    <header>
      <h2 className="operator-compact-label">{title}</h2>
    </header>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-black/[0.025] px-3 py-3 text-sm leading-relaxed text-black/42">{children}</p>;
}

export default function OperatorMemberRecord({
  profileSupport,
  record,
  preview = false,
  returnTo,
}: {
  profileSupport?: OpsMemberProfileSupport | null;
  record: OpsMemberRecord;
  preview?: boolean;
  returnTo?: string;
}) {
  const { access, community, header, journey, membership, operational } = record;
  const canManageTasks = access.capabilities.includes("task.manage");
  const canOverride = access.capabilities.includes("member.override.write");
  const canWriteNote = access.capabilities.includes("member.note.write");
  const canManageSetup = access.roles.includes("ops_admin");
  const next = guidanceForMemberRecord(record);
  const nextAction = memberGuidanceAction(next, header.memberId, canManageSetup);
  const circlePlacementHref = next.key === "ongoing-review" ? "#journey" : next.placement === "blocked" ? "#membership" : `/ops/circles?memberId=${encodeURIComponent(header.memberId)}#assign-member`;

  const stateRows = [
    ["Admission", header.states.admission],
    ["Account", header.states.account],
    ["Onboarding", header.states.administrativeOnboarding],
    ["Billing", header.states.billing],
    ["Standing", header.states.standing],
    ["Foundations", header.states.foundations],
    ["Artifact", header.states.artifact],
  ];

  return (
    <OperatorPageFrame title={header.preferredName}>
      <div className="mx-auto max-w-6xl">
          <Link className="inline-flex min-h-11 items-center text-sm text-black/55 transition-colors hover:text-black" href={operatorMemberReturnLocation(returnTo)}>
            ← Back to members
          </Link>
      <header className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:items-start">
        <div className="flex min-w-0 items-start gap-4">
          <OperatorMemberAvatar memberId={header.memberId} className="h-14 w-14 sm:h-16 sm:w-16" />
          <div className="min-w-0">
          <h2 className="operator-record-title break-words">
            {header.preferredName}
          </h2>
          <p className="mt-2 text-sm text-black/60">
            {header.circleName ?? "No Circle"}{header.blockName ? ` · ${header.blockName}` : ""}
          </p>
          {header.primaryEmail ? <p className="mt-1 break-all text-sm text-black/55">{header.primaryEmail}</p> : null}
          <p className="mt-2 text-xs text-black/50">{header.openWorkCount} open work item{header.openWorkCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        <section aria-label="Next member step" className="operator-bento-card bg-black/[0.04]">
          <p className="operator-compact-label text-[var(--color-poster)]">{next.status} · {next.actor}</p>
          <h3 className="ui-heading mt-1 text-base font-semibold leading-tight">{next.title}</h3>
          <div className="mt-1 flex flex-wrap items-start gap-x-4">
          <Link className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href={nextAction.href}>
            {nextAction.label} →
          </Link>
          <details aria-labelledby="member-next-step-guidance" className="text-sm text-black/60 open:basis-full">
            <summary className="min-h-11 cursor-pointer content-center text-xs font-medium" id="member-next-step-guidance">Why this step?</summary>
            <p className="pb-1 leading-relaxed">{next.detail}</p>
          </details>
          </div>
        </section>
      </header>

      {canManageTasks || canWriteNote || profileSupport ? (
        <nav aria-label="Member actions" className="flex flex-wrap gap-x-4 gap-y-1 py-1 text-sm">
          {canManageTasks ? <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="#new-member-task">Create task</a> : null}
          {canWriteNote ? <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="#new-member-note">Add internal note</a> : null}
          {profileSupport ? <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="#profile-support">Correct profile detail</a> : null}
        </nav>
      ) : null}

      <OperatorMemberWorkspace>

      <section className="scroll-mt-36" id="overview">
        <SectionHeading title="Overview" />
        <OperatorMemberSetup record={record} />
        {!canManageSetup ? <p className="mt-4 text-sm text-black/60">Review this member’s joining, progress, and Circle below. An Administrator manages Circle placement and operator access.</p> : null}
      </section>

      <section className="scroll-mt-36" id="membership">
        <SectionHeading title="Membership" />

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="operator-bento-card">
            <div className="flex items-center justify-between gap-4">
              <h3 className="ui-heading text-base font-semibold">Joining progress</h3>
              <StateLabel state={membership.onboarding.state} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-black/60">The member completes these steps in their own account. This record is for review, not accepting an agreement or making a payment for them.</p>
            <p className="mt-2 text-sm text-black/60">Sign-in address to share: <a className="inline-flex min-h-11 items-center break-all underline underline-offset-4" href="https://members.theruinedproject.com/access">members.theruinedproject.com/access</a></p>
            <div className="mt-3 grid gap-2">
              {membership.onboarding.requirements.map((requirement) => (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/25 px-3 py-2" key={requirement.key}>
                  <div>
                    <p className="text-sm text-black/72">{requirement.key === "private_profile" ? "Profile details" : requirement.key === "agreement" ? "Agreement accepted by member" : requirement.key === "billing" ? (membership.membershipFunding === "operator" ? requirement.label : "Payment confirmation") : requirement.key === "verified_email" ? "Email verified by member" : requirement.label}</p>
                    <p className="mt-1 text-xs text-black/38">
                      {requirement.state === "not_required" ? "Not required" : requirement.required ? "Required" : "Collected when needed"}
                    </p>
                  </div>
                  <StateLabel state={requirement.state === "complete" ? "completed" : requirement.state === "missing" ? "pending" : requirement.state === "not_required" ? "not_required" : "not_started"} />
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-black/42">
              Completed {formatDate(membership.onboarding.completedAt)}
            </p>
          </div>

          <div className="operator-bento-card">
            <h3 className="ui-heading text-base font-semibold">Contact</h3>
            <dl className="mt-3 grid gap-2">
              {[
                ["Preferred name", membership.contact.preferredName],
                ["Legal name", membership.contact.legalName ?? "Restricted or not recorded"],
                ["Email", membership.contact.email ?? "Restricted"],
                ["Mobile", membership.contact.phone ?? "Restricted or not recorded"],
              ].map(([label, value]) => (
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2" key={label}>
                  <dt className="text-sm text-black/42">{label}</dt>
                  <dd className="min-w-0 break-words text-sm text-black/68">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {profileSupport ? <OperatorProfileSupport memberId={header.memberId} profile={profileSupport} preview={preview} /> : null}

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="operator-bento-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="ui-heading text-base font-semibold">Agreement</h3>
                <p className="mt-2 text-sm text-black/42">Version {membership.agreement.version ?? "not recorded"}</p>
              </div>
              <StateLabel state={membership.agreement.acceptedAt ? "completed" : "pending"} />
            </div>
            <dl className="mt-3 grid gap-2">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                <dt className="text-xs text-black/42">Accepted</dt>
                <dd className="text-sm">{formatDate(membership.agreement.acceptedAt)}</dd>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                <dt className="text-xs text-black/42">Receipt</dt>
                <dd className="text-sm capitalize">{membership.agreement.receiptState.replaceAll("_", " ")}</dd>
              </div>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                <dt className="text-xs text-black/42">Content proof</dt>
                <dd className="truncate font-mono text-xs text-black/52">{membership.agreement.contentSha256 ?? "Not recorded"}</dd>
              </div>
            </dl>
          </div>

          <div className="operator-bento-card">
            <div className="flex items-start justify-between gap-4">
              <h3 className="ui-heading text-base font-semibold">Membership billing</h3>
              <StateLabel state={header.states.billing} />
            </div>
            {membership.billing ? (
              <dl className="mt-3 grid gap-2">
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                  <dt className="text-xs text-black/42">Stripe state</dt>
                  <dd className="text-sm capitalize">{membership.billing.stripeState?.replaceAll("_", " ") ?? "Not recorded"}</dd>
                </div>
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                  <dt className="text-xs text-black/42">Paid through</dt>
                  <dd className="text-sm">{formatDate(membership.billing.currentPeriodEnd)}</dd>
                </div>
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                  <dt className="text-xs text-black/42">Period end</dt>
                  <dd className="text-sm">{membership.billing.cancelAtPeriodEnd ? "Cancellation scheduled" : "Continues"}</dd>
                </div>
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-2">
                  <dt className="text-xs text-black/42">Latest payment</dt>
                  <dd className="text-sm">{formatMoney(membership.billing.latestInvoiceAmountPaid, membership.billing.latestInvoiceCurrency)}</dd>
                </div>
              </dl>
            ) : (
              <EmptyRow>{access.capabilities.includes("member.billing_detail.read") ? (membership.membershipFunding === "operator" ? "Complimentary operator membership. No subscription is required." : "No billing record yet.") : "Financial detail is restricted for this operator role."}</EmptyRow>
            )}
            {membership.cancellation ? (
              <div className="mt-5 bg-[var(--color-poster)]/[0.07] px-4 py-4 text-sm leading-relaxed text-black/58">
                <p className="font-medium capitalize text-[var(--color-poster)]">
                  Cancellation {membership.cancellation.state.replaceAll("_", " ")}
                </p>
                <p className="mt-2">
                  Requested {formatDate(membership.cancellation.requestedAt)} · Effective {formatDate(membership.cancellation.effectiveAt)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <details className="mt-3 operator-bento-card" aria-labelledby="member-state-details">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold" id="member-state-details">Detailed account states</summary>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {stateRows.map(([label, state]) => (
              <div className="rounded-[4px] bg-black/[0.025] px-4 py-3" key={label}>
                <dt className="mb-2 text-sm text-black/55">{label}</dt>
                <dd><StateLabel state={state} /></dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <section className="scroll-mt-36" id="journey">
        <SectionHeading title="Journey" />
        <div className="mt-3 operator-bento-card">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-sm text-black/42">Foundations</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums tracking-[-0.03em]">{journey.foundations.progressPercent}%</p>
            </div>
            <StateLabel state={journey.foundations.state} />
          </div>
          <div className="mt-3"><OperatorProgress label={`${header.preferredName} Foundations`} value={journey.foundations.progressPercent} /></div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {journey.foundations.stages.map((stage) => (
              <div className="rounded-md bg-white/25 px-3 py-3" key={stage.key}>
                <p className="text-sm text-black/42">{stage.label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums">{stage.completed} / {stage.total}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 text-xs text-black/56 sm:grid-cols-3">
            <p>Timeline proof · {formatDate(journey.foundations.timelineCompletedAt)}</p>
            <p>Future Letter proof · {formatDate(journey.foundations.futureLetterCompletedAt)}</p>
            <p>Completed · {formatDate(journey.foundations.completedAt)}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-4">
              <h3 className="ui-heading text-base font-semibold">Artifacts</h3>
              <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/ops/artifacts">Open queue</Link>
            </div>
            <div className="mt-3 grid gap-2">
              {journey.artifacts.map((artifact) => (
                <Link
                  className="grid gap-3 rounded-lg bg-black/[0.025] px-3 py-3 transition-colors hover:bg-black/[0.045] sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
                  href={`/ops/artifacts?focus=${encodeURIComponent(artifact.artifactJobId ?? artifact.artifactAwardId)}#artifact-${artifact.artifactJobId ?? artifact.artifactAwardId}`}
                  key={artifact.artifactAwardId}
                >
                  <div>
                    <p className="ui-heading font-semibold">{artifact.name}</p>
                    <p className="mt-2 text-sm text-black/48">{artifact.reason} · Earned {formatDate(artifact.earnedAt)}</p>
                  </div>
                  <StateLabel state={artifact.state} />
                </Link>
              ))}
              {journey.artifacts.length === 0 ? <EmptyRow>No Artifact has been awarded.</EmptyRow> : null}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-4">
              <h3 className="ui-heading text-base font-semibold">Participation</h3>
              <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/ops/experiences">All experiences</Link>
            </div>
            <div className="mt-3 grid gap-2">
              {journey.experiences.map((experience) => (
                <Link
                  className="grid gap-3 rounded-lg bg-black/[0.025] px-3 py-3 transition-colors hover:bg-black/[0.045] sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
                  href={`/ops/experiences/${experience.experienceId}`}
                  key={experience.experienceId}
                >
                  <div>
                    <p className="ui-heading font-semibold">{experience.title}</p>
                    <p className="mt-2 text-sm capitalize text-black/48">{experience.kind.replaceAll("_", " ")} · {formatDate(experience.occurredAt)}</p>
                  </div>
                  <StateLabel state={experience.state} />
                </Link>
              ))}
              {journey.experiences.length === 0 ? <EmptyRow>No participation has been recorded.</EmptyRow> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="scroll-mt-36" id="community">
        <SectionHeading title="Community" />
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="operator-bento-card">
            <p className="text-sm text-black/42">Circle</p>
            {community.circle ? (
              <>
                <Link className="mt-1 inline-flex min-h-11 items-center text-xl font-semibold" href={`/ops/circles?circleId=${encodeURIComponent(community.circle.circleId)}#circle-${community.circle.circleId}`}>
                  {community.circle.name}
                </Link>
                <div className="mt-3 grid gap-2 text-sm text-black/58 sm:grid-cols-2">
                  <p>Shaper · {community.circle.shaperName ?? "Not assigned"}</p>
                  <p>Members · {community.circle.members.length}</p>
                  <p>Block · {community.block?.name ?? "Not assigned"}</p>
                  <p>Guides · {community.circle.guides.join(", ") || "Not assigned"}</p>
                </div>
              </>
            ) : (
              <>
                <EmptyRow>No current Circle assignment.</EmptyRow>
                {canManageSetup ? (
                  <Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={circlePlacementHref}>
                    {next.key === "ongoing-review" ? "Review ongoing participation" : next.placement === "blocked" ? "Review joining & billing" : "Review Circle placement"} →
                  </Link>
                ) : <p className="mt-3 text-sm text-black/50">An Administrator can place this member in a Circle.</p>}
              </>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <h3 className="ui-heading text-base font-semibold">Meetings</h3>
            <div className="mt-3 grid gap-2">
              {community.meetings.map((meeting) => (
                <Link
                  className="grid gap-3 rounded-lg bg-black/[0.025] px-3 py-3 transition-colors hover:bg-black/[0.045] sm:grid-cols-[minmax(0,1fr)_9rem]"
                  href={`/ops/experiences/${meeting.experienceId}`}
                  key={meeting.experienceId}
                >
                  <div>
                    <p className="font-medium">{meeting.title}</p>
                    <p className="mt-2 text-sm text-black/45">{formatDate(meeting.occurredAt)}</p>
                  </div>
                  <StateLabel state={meeting.state} />
                </Link>
              ))}
              {community.meetings.length === 0 ? <EmptyRow>No Circle meetings are recorded.</EmptyRow> : null}
            </div>
          </div>
          <div>
            <h3 className="ui-heading text-base font-semibold">Resources</h3>
            <div className="mt-3 grid gap-2">
              {community.resources.map((resource) => (
                <a className="block rounded-lg bg-black/[0.025] px-3 py-3 text-sm underline decoration-black/25 underline-offset-5 transition-colors hover:bg-black/[0.045]" href={resource.url} key={resource.resourceId}>
                  {resource.label}
                </a>
              ))}
              {community.resources.length === 0 ? <EmptyRow>No Circle resources are assigned.</EmptyRow> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="scroll-mt-36" id="record">
        <SectionHeading title="Record" />
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <h3 className="ui-heading text-base font-semibold">Tasks</h3>
            <div className="mt-3 grid gap-2">
              {operational.tasks.map((task) => (
                <div className="grid gap-3 rounded-lg bg-black/[0.025] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center" key={task.taskId}>
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="mt-2 text-sm text-black/45">Due {formatDate(task.dueAt)} · {task.assignedTo ?? "Unassigned"}</p>
                  </div>
                  <StateLabel state={task.state} />
                </div>
              ))}
              {operational.tasks.length === 0 ? <EmptyRow>No open tasks.</EmptyRow> : null}
            </div>
          </div>
          <div>
            <h3 className="ui-heading text-base font-semibold">Notes</h3>
            <div className="mt-3 grid gap-2">
              {operational.notes.map((note) => (
                <article className="rounded-lg bg-black/[0.025] px-3 py-3" key={note.noteId}>
                  <div className="flex flex-wrap justify-between gap-3 text-xs text-black/38">
                    <span>{note.category.replaceAll("_", " ")}</span>
                    <span>{formatDate(note.createdAt)} · {note.createdBy}</span>
                  </div>
                  <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-relaxed text-black/68">{note.body}</p>
                </article>
              ))}
              {operational.notes.length === 0 ? <EmptyRow>No operator notes.</EmptyRow> : null}
            </div>
          </div>
        </div>

        {canManageTasks || canWriteNote || canOverride ? (
          <section aria-label="Member record actions" className="mt-3 grid gap-3 lg:grid-cols-2">
            {canManageTasks ? <div className="scroll-mt-36 operator-bento-card" id="new-member-task"><OperatorTaskCreateAction memberId={header.memberId} preview={preview} /></div> : null}
            {canWriteNote ? <div className="scroll-mt-36 operator-bento-card" id="new-member-note"><OperatorNoteAction memberId={header.memberId} preview={preview} /></div> : null}
            {canOverride ? <div className="operator-bento-card lg:col-span-2"><OperatorOverrideAction lifecycleVersion={header.lifecycleVersion} memberId={header.memberId} preview={preview} /></div> : null}
          </section>
        ) : null}

        <div className="mt-4">
          <h3 className="ui-heading text-base font-semibold">History</h3>
          <div className="mt-3 grid gap-2">
            {operational.history.map((event) => (
              <div className="grid gap-3 rounded-[4px] bg-black/[0.025] px-4 py-4 sm:grid-cols-[9rem_minmax(0,1fr)_12rem]" key={`${event.occurredAt}:${event.source}:${event.summary}`}>
                <time className="text-xs text-black/42">{formatDate(event.occurredAt)}</time>
                <p className="text-sm text-black/68">{event.summary}</p>
                <p className="text-xs text-black/40">{event.actor ?? event.source}</p>
              </div>
            ))}
            {operational.history.length === 0 ? <EmptyRow>No durable history is available.</EmptyRow> : null}
          </div>
        </div>

      </section>
      </OperatorMemberWorkspace>
      </div>
    </OperatorPageFrame>
  );
}
