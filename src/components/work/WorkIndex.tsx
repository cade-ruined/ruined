import Image from "next/image";
import Link from "next/link";
import { PROJECTS, projectSlug, type Project } from "@/data/projects";

const PROJECT_TONES = {
  warm: "linear-gradient(145deg,#3b2412,#6b4522 50%,#110b08)",
  shadow: "linear-gradient(150deg,#13110f,#302720 55%,#090807)",
  atelier: "linear-gradient(135deg,#1b1712,#514027 48%,#0d0a08)",
} as const;

export default function WorkIndex() {
  return (
    <main className="min-h-screen bg-[var(--color-bone)] text-[var(--color-faded)]">
      <header className="border-b border-black/15 px-5 pb-12 pt-14 sm:px-10 sm:pb-16 sm:pt-20">
        <div className="mx-auto max-w-[90rem]">
          <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-[0.56rem] uppercase tracking-[0.28em] text-black/45">
            <Link href="/#work" className="transition-colors hover:text-[var(--color-poster)]">
              ← Return to the walk
            </Link>
            <span>Archive · 2024—2026</span>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-12 md:items-end">
            <h1 className="display text-[clamp(4rem,12vw,10rem)] leading-[0.78] md:col-span-8">
              Selected <span className="italic text-[var(--color-verdigris)]">work.</span>
            </h1>
            <div className="md:col-span-4">
              <p className="max-w-md text-sm leading-relaxed text-black/60 sm:text-base">
                Objects, spaces, garments, and systems filed by project rather
                than discipline. Each record starts with a material and the
                question of what it can become next.
              </p>
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-black/15 pt-4 font-mono text-[0.5rem] uppercase tracking-[0.2em] text-black/45">
                <span>Objects</span>
                <span>Spaces</span>
                <span>Textiles</span>
                <span>Direction</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section aria-labelledby="work-grid-heading" className="px-3 py-3 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-[96rem]">
          <div className="flex items-end justify-between gap-4 px-2 pb-4 pt-2 sm:px-4 sm:pb-6">
            <div>
              <p className="font-mono text-[0.52rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">
                Featured records
              </p>
              <h2 id="work-grid-heading" className="display mt-2 text-2xl sm:text-4xl">
                Latest from the archive
              </h2>
            </div>
            <span className="font-mono text-[0.52rem] uppercase tracking-[0.22em] text-black/40">
              {String(PROJECTS.length).padStart(2, "0")} projects
            </span>
          </div>

          <div className="grid grid-cols-12 gap-px bg-black/15">
            {PROJECTS.map((project, index) => (
              <ProjectCard
                key={project.no}
                project={project}
                index={index}
                className={projectSpan(index)}
              />
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="work-index-heading" className="px-5 pb-24 pt-20 sm:px-10 sm:pb-32 sm:pt-28">
        <div className="mx-auto max-w-[90rem]">
          <div className="flex items-end justify-between gap-5 border-b border-black/20 pb-5">
            <div>
              <p className="font-mono text-[0.52rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">
                Project index
              </p>
              <h2 id="work-index-heading" className="display mt-2 text-3xl sm:text-5xl">
                All records
              </h2>
            </div>
            <span className="hidden font-mono text-[0.52rem] uppercase tracking-[0.2em] text-black/40 sm:block">
              Title / discipline / year
            </span>
          </div>

          {PROJECTS.map((project) => (
            <Link
              key={project.no}
              href={`/work/${projectSlug(project)}`}
              className="group grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-3 border-b border-black/15 py-5 transition-colors hover:text-[var(--color-poster)] sm:grid-cols-[5rem_1fr_12rem_4rem] sm:gap-6 sm:py-6"
            >
              <span className="font-mono text-[0.52rem] tracking-[0.2em] text-black/38">{project.no}</span>
              <span className="ui-heading text-xl leading-none sm:text-3xl">{project.title}</span>
              <span className="hidden font-mono text-[0.5rem] uppercase tracking-[0.18em] text-black/40 sm:block">
                {project.medium} · {project.year}
              </span>
              <span className="justify-self-end transition-transform group-hover:translate-x-1">↗</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function ProjectCard({
  project,
  index,
  className,
}: {
  project: Project;
  index: number;
  className: string;
}) {
  return (
    <Link
      href={`/work/${projectSlug(project)}`}
      className={`group bg-[var(--color-bone)] p-2.5 sm:p-4 ${className}`}
    >
      <div
        className={`relative overflow-hidden ${projectRatio(index)}`}
        style={{ background: PROJECT_TONES[project.tone] }}
      >
        {project.image && (
          <Image
            src={project.image}
            alt={project.title}
            fill
            priority={index === 0}
            sizes={index === 0 ? "(min-width: 768px) 67vw, 100vw" : "(min-width: 768px) 42vw, 100vw"}
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.018]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/10" />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between font-mono text-[0.48rem] uppercase tracking-[0.2em] text-white/65 sm:inset-x-5 sm:top-5 sm:text-[0.54rem]">
          <span>RU / {project.no}</span>
          <span>{project.year}</span>
        </div>
        {!project.image && (
          <span className="display absolute inset-0 flex items-center justify-center text-[clamp(5rem,14vw,13rem)] text-white/[0.08]">
            {project.no}
          </span>
        )}
        <span className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center border border-white/35 bg-black/20 text-lg text-white transition-colors group-hover:bg-[var(--color-poster)] sm:bottom-5 sm:right-5 sm:h-12 sm:w-12">
          ↗
        </span>
      </div>
      <div className="px-0.5 pb-2 pt-3 sm:pt-4">
        <div className="flex items-start justify-between gap-4">
          <h3 className="ui-heading text-xl leading-none sm:text-3xl">{project.title}</h3>
          <span className="font-mono text-[0.48rem] uppercase tracking-[0.18em] text-black/40 sm:text-[0.52rem]">
            {project.medium}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-black/55 sm:text-sm">{project.brief}</p>
      </div>
    </Link>
  );
}

function projectSpan(index: number) {
  if (index === 0) return "col-span-12 md:col-span-8";
  if (index === 1) return "col-span-12 sm:col-span-6 md:col-span-4";
  if (index === 2) return "col-span-12 sm:col-span-6 md:col-span-5";
  if (index === 3) return "col-span-12 md:col-span-7";
  if (index === 7) return "col-span-12";
  return "col-span-12 sm:col-span-6 md:col-span-4";
}

function projectRatio(index: number) {
  if (index === 0 || index === 3) return "aspect-[16/10]";
  if (index === 7) return "aspect-[16/7]";
  if (index === 1 || index === 2) return "aspect-[4/5]";
  return "aspect-[5/4]";
}
