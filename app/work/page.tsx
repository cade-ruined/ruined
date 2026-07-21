import type { Metadata } from "next";
import ProjectShelf from "@/components/sections/ProjectShelf";
import Link from "next/link";
import { PROJECTS, projectSlug } from "@/data/projects";

export const metadata: Metadata = {
  title: "Work · The Ruined Projects",
  description:
    "Project archives, filed in the crate. Flip through the rack and pull a record forward to read it.",
  alternates: { canonical: "/work" },
};

export default function WorkPage() {
  return <>
    <section id="index" className="relative bg-[var(--color-bone)] px-6 pb-16 pt-32 text-[var(--color-faded)] sm:px-10 sm:pt-40">
      <span id="record-index" className="absolute top-0" aria-hidden />
      <div className="mx-auto max-w-6xl"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="font-mono text-[0.6rem] uppercase tracking-[0.35em] text-[var(--color-poster)]">Archive index · 08 records</p><h1 className="display mt-4 text-[clamp(3rem,8vw,6.5rem)] leading-[0.9]">The work, without the crate.</h1></div><a href="#crate" className="font-mono text-[0.58rem] uppercase tracking-[0.28em] underline underline-offset-8">Enter crate view ↓</a></div>
      <div className="mt-12 border-t border-black/20">{PROJECTS.map((project) => <Link key={project.no} href={`/work/${projectSlug(project)}`} className="group grid grid-cols-[3rem_1fr_auto] items-baseline gap-4 border-b border-black/15 py-5 transition-colors hover:text-[var(--color-poster)] sm:grid-cols-[5rem_1fr_10rem_auto]"><span className="font-mono text-[0.58rem] tracking-[0.2em] opacity-45">{project.no}</span><span className="display text-2xl sm:text-3xl">{project.title}</span><span className="hidden font-mono text-[0.55rem] uppercase tracking-[0.2em] opacity-45 sm:block">{project.medium} · {project.year}</span><span aria-hidden>↗</span></Link>)}</div></div>
    </section>
    <div id="crate"><ProjectShelf /></div>
  </>;
}
