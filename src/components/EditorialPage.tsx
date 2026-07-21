import Link from "next/link";

export default function EditorialPage({
  eyebrow,
  title,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  sections: { title: string; body: React.ReactNode }[];
}) {
  return (
    <main className="min-h-screen bg-[var(--color-bone)] px-6 pb-28 pt-32 text-[var(--color-faded)] sm:px-10 sm:pt-40">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.38em] text-[var(--color-poster)]">{eyebrow}</p>
        <h1 className="display mt-5 max-w-4xl text-[clamp(3rem,9vw,7rem)] leading-[0.88]">{title}</h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed opacity-75">{intro}</p>
        <div className="mt-16 grid gap-x-12 gap-y-12 border-t border-black/15 pt-10 md:grid-cols-2">
          {sections.map((section) => <section key={section.title}><h2 className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-poster)]">{section.title}</h2><div className="mt-4 space-y-3 text-sm leading-relaxed opacity-75">{section.body}</div></section>)}
        </div>
        <Link href="/" className="mt-16 inline-block font-mono text-xs uppercase tracking-[0.3em] underline underline-offset-8">← Return home</Link>
      </div>
    </main>
  );
}
