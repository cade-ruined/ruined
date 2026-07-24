import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/data/products";
import { projectSlug, type Project } from "@/data/projects";
import type { StudioEvent } from "@/data/events";

export function JourneyStoreIndex({ products }: { products: Product[] }) {
  const featuredProducts = products.slice(0, 3);
  if (!featuredProducts.length) return null;

  return (
    <div className="grid grid-cols-3 gap-px border border-white/20 bg-white/20 shadow-[7px_8px_0_rgba(0,0,0,0.5)]">
      {featuredProducts.map((product, index) => (
        <Link
          key={product.id}
          href={`/store/${product.id}`}
          className="group relative aspect-[4/5] overflow-hidden bg-black/85 text-[var(--color-bone)]"
        >
          {product.image && (
            <Image
              src={product.image.url}
              alt={product.image.alt}
              fill
              sizes="(min-width: 640px) 22rem, 28vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
            />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          <span className="absolute left-2 top-2 font-mono text-[0.4rem] uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:text-[0.52rem] sm:tracking-[0.2em]">
            {index === 0 ? "Featured · " : ""}
            {product.code}
          </span>
          <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
            <strong className="block text-[0.62rem] leading-tight text-white sm:text-lg">
              {product.name}
            </strong>
            <span className="mt-1 flex items-center justify-between font-mono text-[0.4rem] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:text-[0.52rem] sm:tracking-[0.16em]">
              <span>{product.price}</span>
              <span className="transition-transform group-hover:translate-x-1">
                ↗
              </span>
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function JourneyWorkIndex({ projects }: { projects: Project[] }) {
  const featuredProjects = projects.slice(0, 3);
  if (!featuredProjects.length) return null;

  return (
    <div className="grid grid-cols-3 gap-px border border-white/20 bg-white/20 shadow-[7px_8px_0_rgba(0,0,0,0.5)]">
      {featuredProjects.map((project, index) => (
        <Link
          key={project.no}
          href={`/work/${projectSlug(project)}`}
          className="group relative aspect-[4/5] overflow-hidden bg-[#17130f] text-[var(--color-bone)]"
        >
          {project.image && (
            <Image
              src={project.image}
              alt={project.title}
              fill
              sizes="(min-width: 640px) 22rem, 28vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
            />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          <span className="absolute left-2 top-2 font-mono text-[0.4rem] uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:text-[0.52rem] sm:tracking-[0.2em]">
            {index === 0 ? "Featured · " : ""}
            RU / {project.no}
          </span>
          <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
            <strong className="block text-[0.62rem] leading-tight text-white sm:text-lg">
              {project.title}
            </strong>
            <span className="mt-1 flex items-center justify-between font-mono text-[0.4rem] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:text-[0.52rem] sm:tracking-[0.16em]">
              <span>
                {project.medium} · {project.year}
              </span>
              <span className="transition-transform group-hover:translate-x-1">
                ↗
              </span>
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function JourneyAboutIndex() {
  return (
    <div className="grid min-h-32 grid-cols-[1.15fr_0.85fr] gap-px border border-white/20 bg-white/20 shadow-[5px_6px_0_rgba(0,0,0,0.45)] sm:min-h-40 sm:grid-cols-[1.4fr_1fr_1fr]">
      <Link
        href="/about"
        className="group relative row-span-2 overflow-hidden bg-black/85"
      >
        <Image
          src="/ruined-hero-lounge.jpg"
          alt="The lounge at Studio No. 17"
          fill
          sizes="(min-width: 640px) 20rem, 55vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.02]"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/10" />
        <span className="absolute left-2 top-2 font-mono text-[0.46rem] uppercase tracking-[0.18em] text-white/60 sm:left-3 sm:top-3">
          Studio No. 17
        </span>
        <span className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-3">
          <strong className="block text-sm leading-none text-white sm:text-lg">
            What remains, remains.
          </strong>
          <span className="mt-1 block font-mono text-[0.46rem] uppercase tracking-[0.12em] text-white/55">
            Practice / Utah / MMXXVI
          </span>
        </span>
      </Link>
      <Link
        href="/about"
        className="group relative overflow-hidden bg-black/85"
      >
        <Image
          src="/art/shelf.jpg"
          alt=""
          fill
          sizes="16rem"
          className="object-cover opacity-75 transition-transform duration-700 group-hover:scale-[1.02]"
        />
        <span className="absolute inset-0 bg-black/25" />
        <span className="absolute bottom-2 left-2 right-2 text-[0.68rem] font-bold text-white sm:text-sm">
          Objects / Garments
        </span>
      </Link>
      <Link
        href="/about"
        className="group relative overflow-hidden bg-black/85"
      >
        <Image
          src="/art/loft.jpg"
          alt=""
          fill
          sizes="16rem"
          className="object-cover opacity-75 transition-transform duration-700 group-hover:scale-[1.02]"
        />
        <span className="absolute inset-0 bg-black/25" />
        <span className="absolute bottom-2 left-2 right-2 text-[0.68rem] font-bold text-white sm:text-sm">
          Spaces / Direction
        </span>
      </Link>
      <Link
        href="/about"
        className="hidden items-center justify-between bg-[var(--color-signal)] px-3 font-mono text-[0.48rem] uppercase tracking-[0.16em] text-black sm:col-span-2 sm:flex"
      >
        <span>About the studio</span>
        <span>→</span>
      </Link>
    </div>
  );
}

export function JourneyEventsIndex({ events }: { events: StudioEvent[] }) {
  return (
    <div className="border border-white/20 bg-black/82 shadow-[5px_6px_0_rgba(0,0,0,0.45)] backdrop-blur-sm">
      {events.slice(0, 3).map((event, index) => (
        <Link
          key={event.id}
          href={`/events#${event.id}`}
          className="group grid grid-cols-[2.4rem_1fr_auto] items-center gap-2 border-b border-white/15 px-2.5 py-2 text-[var(--color-bone)] last:border-b-0 sm:grid-cols-[3.5rem_1fr_10rem_auto] sm:px-4 sm:py-3"
        >
          <span className="font-mono text-[0.44rem] tracking-[0.16em] text-white/35">
            0{index + 1}
          </span>
          <span>
            <strong className="block text-[0.68rem] leading-tight sm:text-sm">
              {event.title}
            </strong>
            <span className="mt-0.5 block font-mono text-[0.42rem] uppercase tracking-[0.12em] text-white/45 sm:hidden">
              {event.date}
            </span>
          </span>
          <span className="hidden font-mono text-[0.46rem] uppercase tracking-[0.14em] text-white/45 sm:block">
            {event.date}
          </span>
          <span className="font-mono text-[0.48rem] text-[var(--color-poster)] transition-transform group-hover:translate-x-1">
            ↗
          </span>
        </Link>
      ))}
    </div>
  );
}
