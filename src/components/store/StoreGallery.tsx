import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/data/products";
import { PRODUCT_TONES } from "@/data/products";
import DropCountdown from "./DropCountdown";

export default function StoreGallery({
  products,
  dropEnd,
}: {
  products: Product[];
  dropEnd?: string;
}) {
  const featured = products[0];

  return (
    <main className="min-h-screen bg-black text-[var(--color-bone)]">
      <header className="border-b border-white/15 px-5 pb-12 pt-14 sm:px-10 sm:pb-16 sm:pt-20">
        <div className="mx-auto max-w-[96rem]">
          <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-[0.56rem] uppercase tracking-[0.28em] text-white/45">
            <Link href="/#store" className="transition-colors hover:text-white">← Return to the walk</Link>
            <span>Drop 01 · SS / MMXXVI</span>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-12 md:items-end">
            <h1 className="display text-[clamp(4rem,12vw,10rem)] leading-[0.78] md:col-span-8">
              The <span className="italic text-[var(--color-poster)]">catalog.</span>
            </h1>
            <div className="md:col-span-4">
              <p className="max-w-md text-sm leading-relaxed text-white/60 sm:text-base">
                Eight artifacts for weather, work, and the rooms between. Every
                piece is numbered, materially documented, and released in a
                finite run.
              </p>
              <div className="mt-6 border-t border-white/15 pt-4"><DropCountdown endsAt={dropEnd} /></div>
            </div>
          </div>
        </div>
      </header>

      {featured && <FeaturedProduct product={featured} />}

      <section aria-labelledby="catalogue-heading" className="bg-[var(--color-bone)] px-3 py-10 text-[var(--color-faded)] sm:px-6 sm:py-16">
        <div className="mx-auto max-w-[96rem]">
          <div className="flex items-end justify-between gap-5 border-b border-black/20 px-1 pb-5 sm:pb-7">
            <div>
              <p className="font-mono text-[0.52rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">Drop 01 / complete</p>
              <h2 id="catalogue-heading" className="display mt-2 text-3xl sm:text-5xl">All pieces</h2>
            </div>
            <div className="text-right font-mono text-[0.5rem] uppercase tracking-[0.2em] text-black/40">
              <p>{String(products.length).padStart(2, "0")} objects</p>
              <p className="mt-1">View · 02 / 04 columns</p>
            </div>
          </div>

          <div className="grid grid-cols-2 border-l border-t border-black/15 lg:grid-cols-4">
            {products.map((product, index) => (
              <ProductCard key={product.id} product={product} index={index} />
            ))}
          </div>

          <div className="grid gap-4 border border-t-0 border-black/15 px-5 py-6 font-mono text-[0.48rem] uppercase tracking-[0.18em] text-black/45 sm:grid-cols-3 sm:px-7">
            <p>Numbered <span className="text-black">and dated</span></p>
            <p className="sm:text-center">Produced <span className="text-black">in small runs</span></p>
            <p className="sm:text-right">Dispatch <span className="text-black">from Studio No. 17</span></p>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto grid max-w-[96rem] gap-10 border-t border-white/15 pt-8 md:grid-cols-12">
          <div className="md:col-span-7">
            <p className="font-mono text-[0.54rem] uppercase tracking-[0.3em] text-white/40">The release rule</p>
            <p className="display mt-5 max-w-4xl text-[clamp(2.6rem,6vw,6rem)] leading-[0.9]">
              Made to become more <span className="italic text-[var(--color-poster)]">itself</span> with use.
            </p>
          </div>
          <div className="md:col-span-4 md:col-start-9">
            <p className="text-sm leading-relaxed text-white/55 sm:text-base">
              Select a piece for dimensions, material, origin, care, and current
              availability. Natural variation and the marks of production are
              part of every numbered release.
            </p>
            <Link href="/shipping-returns" className="ui-heading mt-7 inline-flex border border-white/40 px-5 py-3 text-[0.58rem] uppercase tracking-[0.24em] transition-colors hover:bg-white hover:text-black">
              Shipping + returns →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function FeaturedProduct({ product }: { product: Product }) {
  const availability = product.available === false ? "Sold out" : product.variantId ? "Available" : "By enquiry";
  return (
    <section className="px-3 py-3 sm:px-6 sm:py-6">
      <Link href={`/store/${product.id}`} className="group mx-auto grid max-w-[96rem] overflow-hidden border border-white/15 bg-[#11100e] md:grid-cols-12">
        <div className="relative aspect-[4/5] md:col-span-7">
          {product.image && <Image src={product.image.url} alt={product.image.alt} fill priority sizes="(min-width: 768px) 58vw, 100vw" className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.012]" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          <span className="absolute left-4 top-4 border border-white/30 bg-black/35 px-3 py-2 font-mono text-[0.5rem] uppercase tracking-[0.24em] backdrop-blur-sm sm:left-6 sm:top-6">
            Featured object · {product.code}
          </span>
        </div>
        <article className="flex min-h-[30rem] flex-col justify-between border-t border-white/15 p-6 md:col-span-5 md:border-l md:border-t-0 md:p-10 lg:p-14">
          <div className="flex items-center justify-between font-mono text-[0.52rem] uppercase tracking-[0.24em] text-white/45">
            <span>Plate 001</span><span className="text-[var(--color-poster)]">{availability}</span>
          </div>
          <div>
            <p className="font-mono text-[0.54rem] uppercase tracking-[0.28em] text-[var(--color-poster)]">{product.subtitle}</p>
            <h2 className="display mt-4 text-[clamp(3rem,7vw,6.8rem)] leading-[0.84]">{product.name}</h2>
            <p className="mt-6 max-w-lg text-sm leading-relaxed text-white/60 sm:text-base">{product.description}</p>
          </div>
          <div className="mt-10 flex items-end justify-between border-t border-white/20 pt-5">
            <span className="ui-heading text-2xl tabular-nums sm:text-4xl">{product.price}</span>
            <span className="ui-heading text-[0.58rem] uppercase tracking-[0.22em]">Inspect object ↗</span>
          </div>
        </article>
      </Link>
    </section>
  );
}

function ProductCard({ product, index }: { product: Product; index: number }) {
  const availability = product.available === false ? "Sold out" : product.variantId ? "Available" : "Enquire";
  return (
    <Link href={`/store/${product.id}`} className="group border-b border-r border-black/15 bg-[var(--color-bone)] p-2 sm:p-3">
      <div className="relative aspect-[4/5] overflow-hidden" style={{ background: PRODUCT_TONES[product.tone] }}>
        {product.image && <Image src={product.image.url} alt={product.image.alt} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.018]" />}
        <div className="absolute inset-x-2 top-2 flex justify-between font-mono text-[0.44rem] uppercase tracking-[0.16em] text-white/65 sm:inset-x-3 sm:top-3">
          <span>{String(index + 1).padStart(2, "0")}</span><span>{product.code}</span>
        </div>
        <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center border border-white/40 bg-black/30 text-white transition-colors group-hover:bg-[var(--color-poster)] sm:bottom-3 sm:right-3">↗</span>
      </div>
      <div className="px-1 pb-3 pt-3 sm:pt-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="ui-heading text-sm leading-tight sm:text-lg">{product.name}</h3>
          <span className="ui-heading text-sm tabular-nums sm:text-lg">{product.price}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[0.44rem] uppercase tracking-[0.14em] text-black/42 sm:text-[0.5rem]">
          <span className="truncate">{product.subtitle || product.material}</span>
          <span className={availability === "Sold out" ? "text-black/35" : "text-[var(--color-poster)]"}>{availability}</span>
        </div>
      </div>
    </Link>
  );
}
