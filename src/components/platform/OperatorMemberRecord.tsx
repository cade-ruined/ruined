import Link from "next/link";

import {
  OperatorNoteAction,
  OperatorOverrideAction,
  OperatorTaskCreateAction,
} from "@/components/platform/OperatorMemberActions";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorProfileSupport from "@/components/platform/OperatorProfileSupport";
import OperatorProgress from "@/components/platform/OperatorProgress";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsMemberRecord } from "@/lib/platform/ops-model";
import type { OpsMemberProfileSupport } from "@/lib/platform/ops-profile-repository";

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
      <h2 className="font-[var(--font-display)] text-3xl leading-none tracking-[-0.03em] sm:text-4xl">{title}</h2>
    </header>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[4px] bg-black/[0.025] px-4 py-5 text-sm leading-relaxed text-black/42">{children}</p>;
}

export default function OperatorMemberRecord({
  profileSupport,
  record,
}: {
  profileSupport?: OpsMemberProfileSupport | null;
  record: OpsMemberRecord;
}) {
  const { access, community, header, journey, membership, operational } = record;
  const canManageTasks = access.capabilities.includes("task.manage");
  const canOverride = access.capabilities.includes("member.override.write");
  const canWriteNote = access.capabilities.includes("member.note.write");

  const stateRows = [
    ["Admission", header.states.admission],
    ["Account", header.states.account],
    ["Onboarding", header.states.administrativeOnboarding],
    ["Billing", header.states.billing],
    ["Standing", header.states.standing],
    ["Foundations", header.states.foundations],
    ["Artifact", header.states.artifact],
  ];
  const nextDecisionHref = !header.circleName
    ? "/ops/circles#manage-circles"
    : header.states.billing === "attention_required"
      ? "#membership"
      : header.states.foundations !== "completed"
        ? "#journey"
        : "#record";

  return (
    <OperatorPageFrame title={header.preferredName}>
      <div className="mt-2 grid gap-7 rounded-[4px] bg-[#080605] p-5 text-[var(--color-bone)] sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.45fr)] lg:items-end">
        <div>
          <Link className="text-sm text-white/48 transition-colors hover:text-white" href="/ops/members">
            ← All members
          </Link>
          <h2 className="mt-8 font-[var(--font-display)] text-[clamp(2.8rem,6vw,5.5rem)] leading-[0.86] tracking-[-0.04em]">
            {header.preferredName}
          </h2>
          <p className="mt-5 text-sm text-white/52">
            {header.circleName ?? "No Circle"}{header.blockName ? ` · ${header.blockName}` : ""}
          </p>
        </div>
        <div>
          <p className="font-[var(--font-display)] text-2xl leading-tight text-white/88">{header.nextDecision}</p>
          <p className="mt-5 text-sm text-white/48">{header.openWorkCount} open work item{header.openWorkCount === 1 ? "" : "s"}</p>
          {header.primaryEmail ? <p className="mt-2 text-sm text-white/40">{header.primaryEmail}</p> : null}
          <Link className="ui-heading mt-5 inline-flex min-h-11 items-center rounded-[4px] bg-[var(--color-bone)] px-4 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-highlight)]" href={nextDecisionHref}>
            Take action →
          </Link>
        </div>
      </div>

      <nav
        aria-label="Member record sections"
        className="sticky top-[var(--ruined-header-height)] z-20 -mx-4 flex overflow-x-auto border-b border-black/20 bg-[var(--color-bone)]/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
      >
        {[
          ["Overview", "#overview"],
          ["Membership", "#membership"],
          ["Journey", "#journey"],
          ["Community", "#community"],
          ["Record", "#record"],
        ].map(([label, href]) => (
          <a
            className="whitespace-nowrap border-b border-transparent px-4 py-4 text-sm text-black/45 transition-colors first:pl-0 hover:border-black hover:text-black"
            href={href}
            key={href}
          >
            {label}
          </a>
        ))}
      </nav>

      <section className="scroll-mt-36 pt-10" id="overview">
        <SectionHeading title="Overview" />
        <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {stateRows.map(([label, state]) => (
            <div
              className="min-h-24 rounded-[4px] bg-black/[0.025] px-4 py-4"
              key={label}
            >
              <p className="mb-4 text-sm text-black/42">{label}</p>
              <StateLabel state={state} />
            </div>
          ))}
        </div>
      </section>

      <section className="scroll-mt-36 pt-16" id="membership">
        <SectionHeading title="Membership" />

        <div className="mt-10">
          <div className="rounded-[4px] bg-black/[0.025] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="ui-heading text-xl font-semibold">Administrative onboarding</h3>
              <StateLabel state={membership.onboarding.state} />
            </div>
            <div className="mt-6 grid gap-2">
              {membership.onboarding.requirements.map((requirement) => (
                <div className="grid gap-3 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center" key={requirement.key}>
                  <div>
                    <p className="text-sm text-black/72">{requirement.label}</p>
                    <p className="mt-1 text-xs text-black/38">
                      {requirement.required ? "Required" : "Collected when needed"}
                    </p>
                  </div>
                  <StateLabel state={requirement.state === "complete" ? "completed" : requirement.state === "missing" ? "pending" : "not_started"} />
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-black/42">
              Completed {formatDate(membership.onboarding.completedAt)}
            </p>
          </div>

          <div className="rounded-[4px] bg-black/[0.025] p-5 sm:p-6">
            <h3 className="ui-heading text-xl font-semibold">Contact</h3>
            <dl className="mt-6 grid gap-2">
              {[
                ["Preferred name", membership.contact.preferredName],
                ["Legal name", membership.contact.legalName ?? "Restricted or not recorded"],
                ["Email", membership.contact.email ?? "Restricted"],
                ["Mobile", membership.contact.phone ?? "Restricted or not recorded"],
              ].map(([label, value]) => (
                <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]" key={label}>
                  <dt className="text-sm text-black/42">{label}</dt>
                  <dd className="text-sm text-black/68">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {profileSupport ? <OperatorProfileSupport memberId={header.memberId} profile={profileSupport} /> : null}

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-[4px] bg-black/[0.025] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="ui-heading text-2xl font-semibold">Agreement</h3>
                <p className="mt-2 text-sm text-black/42">Version {membership.agreement.version ?? "not recorded"}</p>
              </div>
              <StateLabel state={membership.agreement.acceptedAt ? "completed" : "pending"} />
            </div>
            <dl className="mt-7 grid gap-2">
              <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]">
                <dt className="text-xs text-black/42">Accepted</dt>
                <dd className="text-sm">{formatDate(membership.agreement.acceptedAt)}</dd>
              </div>
              <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]">
                <dt className="text-xs text-black/42">Receipt</dt>
                <dd className="text-sm capitalize">{membership.agreement.receiptState.replaceAll("_", " ")}</dd>
              </div>
              <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]">
                <dt className="text-xs text-black/42">Content proof</dt>
                <dd className="truncate font-mono text-xs text-black/52">{membership.agreement.contentSha256 ?? "Not recorded"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-[4px] bg-black/[0.025] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <h3 className="ui-heading text-2xl font-semibold">Membership billing</h3>
              <StateLabel state={header.states.billing} />
            </div>
            {membership.billing ? (
              <dl className="mt-7 grid gap-2">
                <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Stripe state</dt>
                  <dd className="text-sm capitalize">{membership.billing.stripeState?.replaceAll("_", " ") ?? "Not recorded"}</dd>
                </div>
                <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Paid through</dt>
                  <dd className="text-sm">{formatDate(membership.billing.currentPeriodEnd)}</dd>
                </div>
                <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Period end</dt>
                  <dd className="text-sm">{membership.billing.cancelAtPeriodEnd ? "Cancellation scheduled" : "Continues"}</dd>
                </div>
                <div className="grid gap-2 bg-[var(--color-bone)] px-4 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Latest payment</dt>
                  <dd className="text-sm">{formatMoney(membership.billing.latestInvoiceAmountPaid, membership.billing.latestInvoiceCurrency)}</dd>
                </div>
              </dl>
            ) : (
              <EmptyRow>Financial detail is restricted for this operator role.</EmptyRow>
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
      </section>

      <section className="scroll-mt-36 pt-16" id="journey">
        <SectionHeading title="Journey" />
        <div className="mt-6 rounded-[4px] bg-black/[0.025] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-sm text-black/42">Foundations</p>
              <p className="mt-4 text-5xl tracking-[-0.04em]">{journey.foundations.progressPercent}%</p>
            </div>
            <StateLabel state={journey.foundations.state} />
          </div>
          <div className="mt-6"><OperatorProgress label={`${header.preferredName} Foundations`} value={journey.foundations.progressPercent} /></div>
          <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {journey.foundations.stages.map((stage) => (
              <div className="bg-[var(--color-bone)] px-4 py-5" key={stage.key}>
                <p className="text-sm text-black/42">{stage.label}</p>
                <p className="mt-4 text-lg tabular-nums">{stage.completed} / {stage.total}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 text-sm text-black/56 sm:grid-cols-3">
            <p>Timeline proof · {formatDate(journey.foundations.timelineCompletedAt)}</p>
            <p>Future Letter proof · {formatDate(journey.foundations.futureLetterCompletedAt)}</p>
            <p>Completed · {formatDate(journey.foundations.completedAt)}</p>
          </div>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-4">
              <h3 className="ui-heading text-xl font-semibold">Artifacts</h3>
              <Link className="text-sm underline underline-offset-5" href="/ops/artifacts">Open queue</Link>
            </div>
            <div className="mt-5 grid gap-2">
              {journey.artifacts.map((artifact) => (
                <Link
                  className="grid gap-3 rounded-[4px] bg-black/[0.025] px-4 py-5 transition-colors hover:bg-black/[0.045] sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
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
              <h3 className="ui-heading text-xl font-semibold">Participation</h3>
              <Link className="text-sm underline underline-offset-5" href="/ops/experiences">All experiences</Link>
            </div>
            <div className="mt-5 grid gap-2">
              {journey.experiences.map((experience) => (
                <Link
                  className="grid gap-3 rounded-[4px] bg-black/[0.025] px-4 py-5 transition-colors hover:bg-black/[0.045] sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
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

      <section className="scroll-mt-36 pt-16" id="community">
        <SectionHeading title="Community" />
        <div className="mt-10 grid gap-3 lg:grid-cols-2">
          <div className="rounded-[4px] bg-black/[0.025] p-5 sm:p-6">
            <p className="text-sm text-black/42">Circle</p>
            {community.circle ? (
              <>
                <Link className="mt-4 inline-block text-4xl tracking-[-0.035em]" href={`/ops/circles#circle-${community.circle.circleId}`}>
                  {community.circle.name}
                </Link>
                <div className="mt-7 grid gap-3 text-sm text-black/58 sm:grid-cols-2">
                  <p>Shaper · {community.circle.shaperName ?? "Not assigned"}</p>
                  <p>Members · {community.circle.members.length}</p>
                  <p>Block · {community.block?.name ?? "Not assigned"}</p>
                  <p>Guides · {community.circle.guides.join(", ") || "Not assigned"}</p>
                </div>
              </>
            ) : <EmptyRow>No current Circle assignment.</EmptyRow>}
          </div>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="ui-heading text-xl font-semibold">Meetings</h3>
            <div className="mt-5 grid gap-2">
              {community.meetings.map((meeting) => (
                <Link
                  className="grid gap-3 rounded-[4px] bg-black/[0.025] px-4 py-5 transition-colors hover:bg-black/[0.045] sm:grid-cols-[minmax(0,1fr)_9rem]"
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
            <h3 className="ui-heading text-xl font-semibold">Resources</h3>
            <div className="mt-5 grid gap-2">
              {community.resources.map((resource) => (
                <a className="block rounded-[4px] bg-black/[0.025] px-4 py-5 text-sm underline decoration-black/25 underline-offset-5 transition-colors hover:bg-black/[0.045]" href={resource.url} key={resource.resourceId}>
                  {resource.label}
                </a>
              ))}
              {community.resources.length === 0 ? <EmptyRow>No Circle resources are assigned.</EmptyRow> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="scroll-mt-36 pt-16" id="record">
        <SectionHeading title="Record" />
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="ui-heading text-xl font-semibold">Tasks</h3>
            <div className="mt-5 grid gap-2">
              {operational.tasks.map((task) => (
                <div className="grid gap-3 rounded-[4px] bg-black/[0.025] px-4 py-5 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center" key={task.taskId}>
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
            <h3 className="ui-heading text-xl font-semibold">Notes</h3>
            <div className="mt-5 grid gap-2">
              {operational.notes.map((note) => (
                <article className="rounded-[4px] bg-black/[0.025] px-4 py-5" key={note.noteId}>
                  <div className="flex flex-wrap justify-between gap-3 text-xs text-black/38">
                    <span>{note.category.replaceAll("_", " ")}</span>
                    <span>{formatDate(note.createdAt)} · {note.createdBy}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-black/68">{note.body}</p>
                </article>
              ))}
              {operational.notes.length === 0 ? <EmptyRow>No operator notes.</EmptyRow> : null}
            </div>
          </div>
        </div>

        <div className="mt-14">
          <h3 className="ui-heading text-xl font-semibold">History</h3>
          <div className="mt-5 grid gap-2">
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

        {canManageTasks || canWriteNote || canOverride ? (
          <details className="group mt-12 rounded-[4px] bg-[var(--color-surface)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-sm font-medium marker:content-none sm:px-6">
              <span>Manage member record</span>
              <span aria-hidden="true" className="text-xl font-normal text-[var(--color-poster)] group-open:rotate-45">+</span>
            </summary>
            <div className="grid gap-12 border-t border-black/10 px-5 pb-6 pt-5 sm:px-6 lg:grid-cols-2">
              {canManageTasks ? <OperatorTaskCreateAction memberId={header.memberId} /> : null}
              {canWriteNote ? <OperatorNoteAction memberId={header.memberId} /> : null}
              {canOverride ? <OperatorOverrideAction lifecycleVersion={header.lifecycleVersion} memberId={header.memberId} /> : null}
            </div>
          </details>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
