import type { Metadata } from "next";
import AboutSection from "@/components/sections/AboutSection";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About · Studio No. 17",
  description:
    "Ruined is a studio for artifacts and projects — established RU / MMXXVI.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return <><AboutSection /><section className="bg-[#11100e] px-6 py-20 text-[var(--color-bone)] sm:px-10 sm:py-28"><div className="mx-auto max-w-6xl"><p className="font-mono text-[0.6rem] uppercase tracking-[0.34em] text-[var(--color-signal)]">Studio No. 17 · Practice</p><div className="mt-7 grid gap-12 md:grid-cols-12"><div className="md:col-span-7"><h1 className="display text-[clamp(3rem,8vw,6.5rem)] leading-[0.9]">A multidisciplinary studio for what survives.</h1><p className="mt-7 max-w-2xl text-lg leading-relaxed text-white/65">Ruined develops limited objects and garments alongside interiors, installations, identity systems, and self-initiated project records. The work begins with material memory: what has been used, marked, discarded, or left unfinished.</p></div><dl className="space-y-5 border-l border-white/15 pl-6 font-mono text-[0.62rem] uppercase tracking-[0.2em] md:col-span-4 md:col-start-9"><Info label="Location" value="Utah · 40.4633° N"/><Info label="Availability" value="Selected commissions"/><Info label="Contact" value="studio@ruined.studio"/><Info label="Established" value="RU / MMXXVI"/></dl></div>
  <div className="mt-16 grid gap-px bg-white/15 sm:grid-cols-2 lg:grid-cols-4">{[["Objects","Furniture, editions, artifacts, and material studies."],["Garments","Limited clothing and utility pieces made in small numbers."],["Spaces","Interior concepts, installations, and adaptive reuse."],["Direction","Identity, campaigns, image systems, and creative direction."]].map(([title,body],i)=><article key={title} className="bg-[#11100e] p-6"><span className="font-mono text-[0.52rem] tracking-[0.25em] text-white/30">0{i+1}</span><h2 className="display mt-8 text-2xl">{title}</h2><p className="mt-3 text-sm leading-relaxed text-white/55">{body}</p></article>)}</div>
  <div className="mt-16 flex flex-col items-start justify-between gap-6 border-t border-white/15 pt-8 sm:flex-row sm:items-end"><div><p className="font-mono text-[0.58rem] uppercase tracking-[0.3em] text-white/40">Projects · Objects · Collaborations</p><p className="display mt-3 text-3xl">Bring us the difficult part.</p></div><Link href="/contact" className="border border-white px-5 py-3 font-mono text-[0.62rem] uppercase tracking-[0.28em] hover:bg-white hover:text-black">Contact the studio →</Link></div></div></section></>;
}

function Info({label,value}:{label:string;value:string}) { return <div><dt className="text-white/35">{label}</dt><dd className="mt-1 text-white/80">{value}</dd></div>; }
