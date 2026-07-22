import Image from "next/image";
import Link from "next/link";

const PRACTICE = [
  { no: "01", title: "Objects", body: "Furniture, editions, artifacts, and material studies.", image: "/art/shelf.jpg" },
  { no: "02", title: "Garments", body: "Limited clothing and utility pieces made in small numbers.", image: "/catalog/field-coat-placeholder.png" },
  { no: "03", title: "Spaces", body: "Interiors, installations, and adaptive reuse without erasure.", image: "/ruined-hero-lounge.jpg" },
  { no: "04", title: "Direction", body: "Identity, campaigns, image systems, and creative direction.", image: "/art/records.jpg" },
] as const;

export default function AboutIndex() {
  return (
    <main className="min-h-screen bg-[var(--color-bone)] text-[var(--color-faded)]">
      <section className="relative min-h-[calc(100svh-5rem)] overflow-hidden bg-black text-[var(--color-bone)]">
        <Image src="/ruined-hero-1.jpg" alt="The raw interior of Studio No. 17" fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-black/20" />
        <div className="relative mx-auto flex min-h-[calc(100svh-5rem)] max-w-[96rem] flex-col justify-between px-5 py-7 sm:px-10 sm:py-10">
          <div className="flex flex-wrap justify-between gap-3 font-mono text-[0.52rem] uppercase tracking-[0.26em] text-white/60">
            <Link href="/#about" className="hover:text-white">← Return to the walk</Link>
            <span>Studio No. 17 · Utah</span>
          </div>
          <div className="grid gap-8 md:grid-cols-12 md:items-end">
            <div className="md:col-span-9">
              <p className="font-mono text-[0.54rem] uppercase tracking-[0.32em] text-[var(--color-poster)]">Independent practice · MMXXVI</p>
              <h1 className="display mt-4 max-w-6xl text-[clamp(4rem,11vw,10rem)] leading-[0.79]">
                A studio for what <span className="italic">survives.</span>
              </h1>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-white/65 md:col-span-3 sm:text-base">
              Objects, garments, spaces, and visual systems beginning with what
              has already been used, marked, or left unfinished.
            </p>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-10 sm:py-32">
        <div className="mx-auto max-w-[96rem]">
          <div className="grid gap-12 md:grid-cols-12 md:gap-16">
            <div className="md:col-span-7">
              <p className="font-mono text-[0.52rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">Position / 001</p>
              <h2 className="display mt-5 text-[clamp(2.8rem,7vw,7rem)] leading-[0.88]">
                The ruin is not the end of the object. It is where the object becomes <span className="italic text-[var(--color-verdigris)]">specific.</span>
              </h2>
            </div>
            <div className="md:col-span-4 md:col-start-9 md:pt-16">
              <p className="text-base leading-relaxed text-black/65">
                Ruined develops its own limited releases alongside selected
                commissions. The work moves between clothing, furniture,
                interiors, installation, identity, and image-making without
                separating the material from the story it already carries.
              </p>
              <dl className="mt-9 space-y-4 border-t border-black/20 pt-5 font-mono text-[0.52rem] uppercase tracking-[0.2em]">
                <Info label="Location" value="Utah · 40.4633° N" />
                <Info label="Structure" value="Independent / project collaborators" />
                <Info label="Availability" value="Selected commissions" />
                <Info label="Contact" value="studio@ruined.studio" />
              </dl>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-12 gap-3 sm:mt-24 sm:gap-5">
            <div className="relative col-span-8 min-h-[28rem] overflow-hidden sm:min-h-[48rem]">
              <Image src="/ruined-hero-lounge.jpg" alt="The lounge inside Studio No. 17" fill sizes="67vw" className="object-cover" />
              <span className="absolute bottom-4 left-4 border border-white/30 bg-black/35 px-3 py-2 font-mono text-[0.48rem] uppercase tracking-[0.22em] text-white backdrop-blur-sm">Room study · Lounge</span>
            </div>
            <div className="relative col-span-4 mt-20 min-h-[20rem] overflow-hidden sm:mt-36 sm:min-h-[34rem]">
              <Image src="/art/loft.jpg" alt="A material study in the studio" fill sizes="33vw" className="object-cover" />
              <span className="absolute bottom-3 left-3 font-mono text-[0.44rem] uppercase tracking-[0.18em] text-white/75">Material / light</span>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="practice-heading" className="bg-[#11100e] px-3 py-16 text-[var(--color-bone)] sm:px-6 sm:py-24">
        <div className="mx-auto max-w-[96rem]">
          <div className="flex items-end justify-between gap-5 px-2 pb-7 sm:px-4">
            <div>
              <p className="font-mono text-[0.52rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">Field of practice</p>
              <h2 id="practice-heading" className="display mt-2 text-3xl sm:text-5xl">What the studio makes</h2>
            </div>
            <span className="hidden font-mono text-[0.5rem] uppercase tracking-[0.2em] text-white/40 sm:block">One practice / four outputs</span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/15">
            {PRACTICE.map((item) => (
              <article key={item.no} className="bg-[#11100e] p-2 sm:p-4 lg:grid lg:grid-cols-12 lg:gap-5">
                <div className="relative aspect-[4/5] overflow-hidden lg:col-span-8">
                  <Image src={item.image} alt="" fill sizes="(min-width: 1024px) 34vw, 50vw" className="object-cover" />
                  <span className="absolute left-3 top-3 font-mono text-[0.48rem] uppercase tracking-[0.2em] text-white/65">{item.no}</span>
                </div>
                <div className="flex flex-col justify-end px-1 py-4 lg:col-span-4 lg:px-0">
                  <h3 className="ui-heading text-xl sm:text-3xl">{item.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/50 sm:text-sm">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-10 sm:py-32">
        <div className="mx-auto grid max-w-[96rem] gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="font-mono text-[0.52rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">Method / 004 stages</p>
            <h2 className="display mt-4 text-[clamp(3rem,7vw,6.5rem)] leading-[0.88]">Use is part of the finish.</h2>
          </div>
          <ol className="border-t border-black/20 md:col-span-6 md:col-start-7">
            {[['01','Find','Begin with what exists.'],['02','Reduce','Remove what does not carry meaning.'],['03','Repair','Make the intervention visible.'],['04','Release','Let use finish the object.']].map(([no,title,body]) => (
              <li key={no} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-black/15 py-6 sm:grid-cols-[4rem_1fr_1fr]">
                <span className="font-mono text-[0.5rem] tracking-[0.2em] text-black/35">{no}</span>
                <strong className="ui-heading text-xl">{title}</strong>
                <span className="col-start-2 text-sm text-black/55 sm:col-start-auto">{body}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="relative min-h-[70svh] overflow-hidden bg-black text-[var(--color-bone)]">
        <Image src="/ruined-work-shelf.jpg" alt="The project archive at Studio No. 17" fill sizes="100vw" className="object-cover opacity-65" />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative mx-auto flex min-h-[70svh] max-w-[96rem] flex-col justify-between px-5 py-8 sm:px-10 sm:py-12">
          <p className="font-mono text-[0.52rem] uppercase tracking-[0.3em] text-white/60">Projects · Objects · Collaborations</p>
          <div className="flex flex-wrap items-end justify-between gap-8">
            <h2 className="display max-w-4xl text-[clamp(3.5rem,9vw,8rem)] leading-[0.82]">Bring us the difficult part.</h2>
            <Link href="/contact" className="ui-heading border border-white bg-black/25 px-5 py-4 text-[0.6rem] uppercase tracking-[0.26em] backdrop-blur-sm transition-colors hover:bg-white hover:text-black">Contact the studio →</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-3 gap-3"><dt className="text-black/35">{label}</dt><dd className="col-span-2">{value}</dd></div>;
}
