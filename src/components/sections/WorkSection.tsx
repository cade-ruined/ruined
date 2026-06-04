"use client";

import { motion } from "motion/react";
import SectionHeader from "./SectionHeader";
import PlaceholderImage from "./PlaceholderImage";

type Project = {
  no: string;
  year: string;
  title: string;
  brief: string;
  medium: string;
  tone: "warm" | "shadow" | "atelier";
};

const PROJECTS: Project[] = [
  {
    no: "04",
    year: "2026",
    title: "Objet Trouvé",
    brief: "Found object → archive vessel.",
    medium: "Mixed media",
    tone: "warm",
  },
  {
    no: "03",
    year: "2025",
    title: "Warehouse 17",
    brief: "Industrial site → studio.",
    medium: "Site / Build",
    tone: "atelier",
  },
  {
    no: "02",
    year: "2025",
    title: "Loom Nº 7",
    brief: "1947 textile loom → restoration.",
    medium: "Restoration",
    tone: "shadow",
  },
  {
    no: "01",
    year: "2024",
    title: "RU / Pilot",
    brief: "First drop, hand-numbered.",
    medium: "Goods",
    tone: "warm",
  },
];

export default function WorkSection() {
  return (
    <section
      id="work"
      aria-label="Work"
      className="snap-frame snap-start relative text-[var(--foreground)] bg-[var(--color-surface)] flex flex-col"
    >
      {/* verdigris ambient wash + faint pinstripes — "archive" register */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          background:
            "radial-gradient(55% 50% at 20% 80%, rgba(59,93,79,0.7) 0%, rgba(59,93,79,0) 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(42,42,42,0.6) 0 1px, transparent 1px 96px)",
        }}
      />

      <div className="relative mx-auto w-full max-w-5xl px-6 sm:px-10 pt-6 sm:pt-8 pb-3 flex flex-col flex-1 min-h-0">
        <SectionHeader
          label="WORK"
          index="02"
          total="03"
          kicker="——  project archives"
        />

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
          className="display text-[clamp(1.75rem,5vw,3.5rem)] leading-[0.98] text-[var(--color-faded)] mb-4 sm:mb-6"
        >
          THE{" "}
          <span className="italic text-[var(--color-verdigris)]">RUINED</span>
          {" "}PROJECTS
        </motion.h2>

        <motion.ol
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.12 } },
          }}
          className="flex-1 min-h-0 flex flex-col justify-center border-y border-[var(--border)] divide-y divide-[var(--border)]"
        >
          {PROJECTS.map((p) => (
            <ProjectRow key={p.no} project={p} />
          ))}
        </motion.ol>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.5 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.0, ease: "easeOut" }}
          className="mt-3 text-center font-mono text-[0.65rem] tracking-[0.4em] uppercase text-[var(--muted-foreground)]"
        >
          ——  end of archive  ——
        </motion.p>
      </div>
    </section>
  );
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 14 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
        },
      }}
      // Compact inline layout — paired thumbnail + metadata + medium tag,
      // tuned so four rows fit cleanly inside the snap-frame.
      className="group flex items-center gap-3 sm:gap-5 py-2.5 sm:py-3"
    >
      <div className="w-16 sm:w-20 flex-shrink-0">
        <PlaceholderImage
          ratio="4/3"
          tone={project.tone}
          label={`Nº ${project.no}`}
          caption=""
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-mono text-[0.62rem] sm:text-[0.68rem] tracking-[0.32em] uppercase text-[var(--muted-foreground)] tabular-nums">
          Nº&nbsp;{project.no}
          <span className="mx-2 text-[var(--border)]">·</span>
          {project.year}
        </div>

        <h3 className="display mt-0.5 text-lg sm:text-xl leading-tight text-[var(--color-faded)] group-hover:text-[var(--color-verdigris)] transition-colors duration-300">
          {project.title}
        </h3>

        <p className="mt-1 text-xs sm:text-sm text-[var(--color-faded)]/75 leading-snug line-clamp-1">
          {project.brief}
        </p>
      </div>

      <span className="hidden sm:inline-block flex-shrink-0 font-mono text-[0.62rem] tracking-[0.28em] uppercase text-[var(--color-verdigris)] border-l border-[var(--color-verdigris)]/30 pl-3">
        {project.medium}
      </span>
    </motion.li>
  );
}
