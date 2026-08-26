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
  return (
    <OperatorPageFrame
      eyebrow="Experiences"
      introduction="Events, Academy sessions, challenges, and Circle meetings share one operating history. Audience and attendance stay explicit."
      title="Experiences"
    >
      <section className="mt-14 border-t border-black/25" aria-label="Experience directory">
        {experiences.map((experience) => (
          <article
            className="grid gap-5 border-b border-black/15 py-7 lg:grid-cols-[minmax(15rem,1fr)_10rem_10rem_8rem] lg:items-center"
            id={`experience-${experience.experienceId}`}
            key={experience.experienceId}
          >
            <div>
              <p className="text-[0.6rem] font-medium uppercase tracking-[0.15em] text-black/38">{experience.kind.replaceAll("_", " ")}</p>
              <h2 className="mt-3 text-3xl leading-none tracking-[-0.025em]">{experience.title}</h2>
              <p className="mt-3 text-sm text-black/48">{experience.scope}</p>
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
          <p className="border-b border-black/15 py-10 text-sm text-black/50">No Experiences are visible to this operator.</p>
        ) : null}
      </section>
    </OperatorPageFrame>
  );
}
