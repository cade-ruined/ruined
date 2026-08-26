import Link from "next/link";

import {
  OperatorAccountabilityAction,
  OperatorNoteAction,
  OperatorOverrideAction,
  OperatorTaskCreateAction,
} from "@/components/platform/OperatorMemberActions";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsMemberRecord } from "@/lib/platform/ops-model";

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

function SectionHeading({
  eyebrow,
  introduction,
  title,
}: {
  eyebrow: string;
  introduction: string;
  title: string;
}) {
  return (
    <header className="grid gap-5 border-t border-black/25 pt-5 lg:grid-cols-[minmax(0,0.75fr)_minmax(18rem,0.35fr)] lg:items-end">
      <div>
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.17em] text-black/42">{eyebrow}</p>
        <h2 className="mt-4 text-[clamp(2.4rem,5vw,5rem)] leading-[0.9] tracking-[-0.04em]">{title}</h2>
      </div>
      <p className="max-w-md text-sm leading-relaxed text-black/52">{introduction}</p>
    </header>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="border-b border-black/15 py-6 text-sm leading-relaxed text-black/42">{children}</p>;
}

export default function OperatorMemberRecord({ record }: { record: OpsMemberRecord }) {
  const { access, community, header, journey, membership, operational } = record;
  const canManageAccountability = access.capabilities.includes("accountability.manage");
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

  return (
    <OperatorPageFrame
      eyebrow="Members / Record"
      introduction={`${header.circleName ?? "No Circle"}${header.blockName ? ` · ${header.blockName}` : ""}. ${header.openWorkCount} open work item${header.openWorkCount === 1 ? "" : "s"}.`}
      title={header.preferredName}
    >
      <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-y border-black/25 py-4">
        <Link
          className="text-[0.64rem] font-medium uppercase tracking-[0.15em] text-black/52 underline decoration-black/25 underline-offset-6 hover:text-black"
          href="/ops/members"
        >
          ← All members
        </Link>
        <p className="text-sm text-black/42">{header.primaryEmail ?? "Contact is restricted"}</p>
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
            className="whitespace-nowrap border-b border-transparent px-4 py-4 text-[0.64rem] font-medium uppercase tracking-[0.15em] text-black/45 transition-colors first:pl-0 hover:border-black hover:text-black"
            href={href}
            key={href}
          >
            {label}
          </a>
        ))}
      </nav>

      <section className="scroll-mt-36 pt-16" id="overview">
        <SectionHeading
          eyebrow="Current position"
          introduction="The dimensions remain independent. Payment never silently rewrites standing, progress, or Circle history."
          title="Overview"
        />
        <div className="mt-10 grid border-y border-black/25 sm:grid-cols-2 xl:grid-cols-4">
          {stateRows.map(([label, state], index) => (
            <div
              className={`min-h-28 py-5 sm:px-5 ${index > 0 ? "border-t border-black/15 sm:border-l sm:border-t-0" : ""} ${index === 4 ? "xl:border-l-0" : ""}`}
              key={label}
            >
              <p className="mb-5 text-[0.6rem] font-medium uppercase tracking-[0.15em] text-black/38">{label}</p>
              <StateLabel state={state} />
            </div>
          ))}
        </div>
        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.4fr)]">
          <div className="border-t border-black/25 py-6">
            <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Next decision</p>
            <p className="mt-5 max-w-4xl text-[clamp(1.8rem,4vw,3.8rem)] leading-[1.02] tracking-[-0.035em] text-black/82">
              {header.nextDecision}
            </p>
          </div>
          <div className="border-t border-black/25 py-6">
            <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Open work</p>
            <p className="mt-5 text-5xl tracking-[-0.04em]">{header.openWorkCount}</p>
            <a className="mt-7 inline-block text-xs uppercase tracking-[0.14em] underline underline-offset-5" href="#record">
              Review the record
            </a>
          </div>
        </div>
      </section>

      <section className="scroll-mt-36 pt-24" id="membership">
        <SectionHeading
          eyebrow="Administrative entry"
          introduction="Identity, onboarding, agreement evidence, and payment are visible together without becoming one status."
          title="Membership"
        />

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between border-y border-black/25 py-5">
              <h3 className="ui-heading text-xl font-semibold">Administrative onboarding</h3>
              <StateLabel state={membership.onboarding.state} />
            </div>
            <div className="divide-y divide-black/15">
              {membership.onboarding.requirements.map((requirement) => (
                <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center" key={requirement.key}>
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
            <p className="border-t border-black/20 pt-4 text-xs text-black/42">
              Completed {formatDate(membership.onboarding.completedAt)}
            </p>
          </div>

          <div>
            <div className="border-y border-black/25 py-5">
              <h3 className="ui-heading text-xl font-semibold">Contact</h3>
            </div>
            <dl className="divide-y divide-black/15">
              {[
                ["Preferred name", membership.contact.preferredName],
                ["Legal name", membership.contact.legalName ?? "Restricted or not recorded"],
                ["Email", membership.contact.email ?? "Restricted"],
                ["Mobile", membership.contact.phone ?? "Restricted or not recorded"],
              ].map(([label, value]) => (
                <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]" key={label}>
                  <dt className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/38">{label}</dt>
                  <dd className="text-sm text-black/68">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <div className="border-t border-black/25 py-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Agreement</p>
                <h3 className="ui-heading mt-3 text-2xl font-semibold">Version {membership.agreement.version ?? "not recorded"}</h3>
              </div>
              <StateLabel state={membership.agreement.acceptedAt ? "completed" : "pending"} />
            </div>
            <dl className="mt-7 divide-y divide-black/15 border-b border-black/15">
              <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]">
                <dt className="text-xs text-black/42">Accepted</dt>
                <dd className="text-sm">{formatDate(membership.agreement.acceptedAt)}</dd>
              </div>
              <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]">
                <dt className="text-xs text-black/42">Receipt</dt>
                <dd className="text-sm capitalize">{membership.agreement.receiptState.replaceAll("_", " ")}</dd>
              </div>
              <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]">
                <dt className="text-xs text-black/42">Content proof</dt>
                <dd className="truncate font-mono text-xs text-black/52">{membership.agreement.contentSha256 ?? "Not recorded"}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-black/25 py-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Payment standing</p>
                <h3 className="ui-heading mt-3 text-2xl font-semibold">Membership billing</h3>
              </div>
              <StateLabel state={header.states.billing} />
            </div>
            {membership.billing ? (
              <dl className="mt-7 divide-y divide-black/15 border-b border-black/15">
                <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Stripe state</dt>
                  <dd className="text-sm capitalize">{membership.billing.stripeState?.replaceAll("_", " ") ?? "Not recorded"}</dd>
                </div>
                <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Paid through</dt>
                  <dd className="text-sm">{formatDate(membership.billing.currentPeriodEnd)}</dd>
                </div>
                <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Period end</dt>
                  <dd className="text-sm">{membership.billing.cancelAtPeriodEnd ? "Cancellation scheduled" : "Continues"}</dd>
                </div>
                <div className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-xs text-black/42">Latest payment</dt>
                  <dd className="text-sm">{formatMoney(membership.billing.latestInvoiceAmountPaid, membership.billing.latestInvoiceCurrency)}</dd>
                </div>
              </dl>
            ) : (
              <EmptyRow>Financial detail is restricted for this operator role.</EmptyRow>
            )}
            {membership.cancellation ? (
              <div className="mt-5 border-t border-[var(--color-poster)]/35 pt-5 text-sm leading-relaxed text-black/58">
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

      <section className="scroll-mt-36 pt-24" id="journey">
        <SectionHeading
          eyebrow="Cultural path"
          introduction="Operators see proof of completion and timing. Private reflections, Timeline entries, and Future Letter content never enter this view."
          title="Journey"
        />
        <div className="mt-10 border-y border-black/25 py-7">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Foundations</p>
              <p className="mt-4 text-5xl tracking-[-0.04em]">{journey.foundations.progressPercent}%</p>
            </div>
            <StateLabel state={journey.foundations.state} />
          </div>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4">
            {journey.foundations.stages.map((stage, index) => (
              <div className={`py-5 sm:px-5 ${index > 0 ? "border-t border-black/15 sm:border-l sm:border-t-0" : ""}`} key={stage.key}>
                <p className="text-[0.62rem] font-medium uppercase tracking-[0.15em] text-black/38">{stage.label}</p>
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

        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between border-b border-black/25 pb-4">
              <h3 className="ui-heading text-xl font-semibold">Artifacts</h3>
              <Link className="text-xs uppercase tracking-[0.14em] underline underline-offset-5" href="/ops/artifacts">Open queue</Link>
            </div>
            <div className="divide-y divide-black/15">
              {journey.artifacts.map((artifact) => (
                <Link
                  className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
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
            <div className="flex items-center justify-between border-b border-black/25 pb-4">
              <h3 className="ui-heading text-xl font-semibold">Participation</h3>
              <Link className="text-xs uppercase tracking-[0.14em] underline underline-offset-5" href="/ops/experiences">All experiences</Link>
            </div>
            <div className="divide-y divide-black/15">
              {journey.experiences.map((experience) => (
                <Link
                  className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center"
                  href={`/ops/experiences?focus=${encodeURIComponent(experience.experienceId)}#experience-${experience.experienceId}`}
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

      <section className="scroll-mt-36 pt-24" id="community">
        <SectionHeading
          eyebrow="Belonging"
          introduction="Circle relationships, accountability, meetings, and resources remain visible as durable history—not disposable assignments."
          title="Community"
        />
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <div className="border-t border-black/25 py-6">
            <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Circle</p>
            {community.circle ? (
              <>
                <Link className="mt-4 inline-block text-4xl tracking-[-0.035em]" href={`/ops/circles#circle-${community.circle.circleId}`}>
                  {community.circle.name}
                </Link>
                <div className="mt-7 grid gap-3 text-sm text-black/58 sm:grid-cols-2">
                  <p>Leader · {community.circle.leaderName ?? "Not assigned"}</p>
                  <p>Members · {community.circle.members.length}</p>
                  <p>Block · {community.block?.name ?? "Not assigned"}</p>
                  <p>Guides · {community.circle.guides.join(", ") || "Not assigned"}</p>
                </div>
              </>
            ) : <EmptyRow>No current Circle assignment.</EmptyRow>}
          </div>
          <div className="border-t border-black/25 py-6">
            <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Accountability</p>
            <p className="mt-4 text-3xl tracking-[-0.03em]">
              {community.accountabilityPartner?.preferredName ?? "No partner assigned"}
            </p>
            {community.accountabilityPartner ? (
              <p className="mt-4 text-sm text-black/48">Paired {formatDate(community.accountabilityPartner.assignedAt)}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <div>
            <h3 className="border-b border-black/25 pb-4 ui-heading text-xl font-semibold">Meetings</h3>
            <div className="divide-y divide-black/15">
              {community.meetings.map((meeting) => (
                <Link
                  className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_9rem]"
                  href={`/ops/experiences?focus=${encodeURIComponent(meeting.experienceId)}#experience-${meeting.experienceId}`}
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
            <h3 className="border-b border-black/25 pb-4 ui-heading text-xl font-semibold">Resources</h3>
            <div className="divide-y divide-black/15">
              {community.resources.map((resource) => (
                <a className="block py-5 text-sm underline decoration-black/25 underline-offset-5" href={resource.url} key={resource.resourceId}>
                  {resource.label}
                </a>
              ))}
              {community.resources.length === 0 ? <EmptyRow>No Circle resources are assigned.</EmptyRow> : null}
            </div>
          </div>
        </div>
        {canManageAccountability ? <div className="mt-12"><OperatorAccountabilityAction record={record} /></div> : null}
      </section>

      <section className="scroll-mt-36 pt-24" id="record">
        <SectionHeading
          eyebrow="Internal record"
          introduction="Tasks, notes, corrections, and state movement stay attributable. Nothing here is member-visible."
          title="Record"
        />
        <div className="mt-10 grid gap-12 lg:grid-cols-2">
          <div>
            <h3 className="border-b border-black/25 pb-4 ui-heading text-xl font-semibold">Tasks</h3>
            <div className="divide-y divide-black/15">
              {operational.tasks.map((task) => (
                <div className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center" key={task.taskId}>
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
            <h3 className="border-b border-black/25 pb-4 ui-heading text-xl font-semibold">Notes</h3>
            <div className="divide-y divide-black/15">
              {operational.notes.map((note) => (
                <article className="py-5" key={note.noteId}>
                  <div className="flex flex-wrap justify-between gap-3 text-[0.6rem] uppercase tracking-[0.13em] text-black/38">
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
          <h3 className="border-b border-black/25 pb-4 ui-heading text-xl font-semibold">History</h3>
          <div className="divide-y divide-black/15">
            {operational.history.map((event) => (
              <div className="grid gap-3 py-4 sm:grid-cols-[9rem_minmax(0,1fr)_12rem]" key={`${event.occurredAt}:${event.source}:${event.summary}`}>
                <time className="text-xs text-black/42">{formatDate(event.occurredAt)}</time>
                <p className="text-sm text-black/68">{event.summary}</p>
                <p className="text-xs text-black/40">{event.actor ?? event.source}</p>
              </div>
            ))}
            {operational.history.length === 0 ? <EmptyRow>No durable history is available.</EmptyRow> : null}
          </div>
        </div>

        <div className="mt-16 grid gap-12 lg:grid-cols-2">
          {canManageTasks ? <OperatorTaskCreateAction memberId={header.memberId} /> : null}
          {canWriteNote ? <OperatorNoteAction memberId={header.memberId} /> : null}
          {canOverride ? <OperatorOverrideAction lifecycleVersion={header.lifecycleVersion} memberId={header.memberId} /> : null}
        </div>
      </section>
    </OperatorPageFrame>
  );
}
