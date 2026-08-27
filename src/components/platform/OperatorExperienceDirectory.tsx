import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsExperienceDirectoryItem } from "@/lib/platform/ops-model";

function formatDate(value: string | null): string {
  if (!value) return "Schedule not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Schedule not set";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function OperatorExperienceDirectory({ experiences }: { experiences: OpsExperienceDirectoryItem[] }) {
  const registeredCount = experiences.reduce(
    (total, experience) => total + experience.registeredCount,
    0,
  );
  const scheduledCount = experiences.filter((experience) => experience.startsAt).length;

  return (
    <OperatorPageFrame title="Experiences">
      <dl
        aria-label="Experience snapshot"
        className="grid gap-6 bg-[#080605] px-6 py-6 text-[var(--color-bone)] sm:grid-cols-3 sm:px-8 sm:py-8"
      >
        {[
          ["Experiences", experiences.length],
          ["Scheduled", scheduledCount],
          ["Registrations", registeredCount],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-white/48">{label}</dt>
            <dd className="mt-2 font-[var(--font-display)] text-4xl leading-none tracking-[-0.03em] sm:text-5xl">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-8 space-y-3" aria-label="Experience directory">
        {experiences.map((experience) => (
          <article
            className="grid gap-5 bg-black/[0.025] px-5 py-6 transition-colors hover:bg-black/[0.055] sm:px-6 lg:grid-cols-[minmax(15rem,1fr)_12rem_9rem_8rem] lg:items-center"
            id={`experience-${experience.experienceId}`}
            key={experience.experienceId}
          >
            <div>
              <p className="text-sm capitalize text-black/45">
                {experience.kind.replaceAll("_", " ")} · {experience.scope}
              </p>
              <h2 className="mt-2 text-3xl leading-none tracking-[-0.025em]">
                {experience.title}
              </h2>
            </div>
            <div className="text-sm leading-relaxed text-black/55">
              <p>{formatDate(experience.startsAt)}</p>
              {experience.endsAt ? <p className="mt-1 text-black/38">Ends {formatDate(experience.endsAt)}</p> : null}
            </div>
            <div>
              <p className="text-3xl tabular-nums tracking-[-0.03em]">{experience.registeredCount}</p>
              <p className="mt-2 text-xs text-black/42">Registrations</p>
            </div>
            <StateLabel state={experience.state} />
          </article>
        ))}
        {experiences.length === 0 ? (
          <p className="bg-black/[0.025] px-5 py-10 text-sm text-black/50">
            No Experiences are visible to this operator.
          </p>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
