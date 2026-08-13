import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/data/products";
import { PRODUCT_TONES } from "@/data/products";
import { EXPLORE_ROOMS } from "@/data/navigation";
import DropCountdown from "./DropCountdown";

export default function StoreGallery({
  products,
  dropEnd,
}: {
  products: Product[];
  dropEnd?: string;
}) {
  return (
    <main className="min-h-screen bg-black text-[var(--color-bone)]">
      <header className="border-b border-white/15 px-4 pb-8 pt-12 sm:px-8 sm:pb-10 sm:pt-14 lg:px-10">
        <div className="mx-auto grid max-w-[96rem] gap-8 md:grid-cols-12 md:items-end">
          <div className="md:col-span-7 lg:col-span-8">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.52rem] uppercase tracking-[0.24em] text-white/45">
              <Link href="/#store" className="transition-colors hover:text-white">
                ← Return to the walk
              </Link>
              <span aria-hidden="true" className="h-px w-6 bg-white/25" />
              <span>Drop 01 · SS / MMXXVI</span>
            </div>
            <h1
              id="catalogue-heading"
              className="display mt-7 text-[clamp(3.5rem,8vw,7.5rem)] leading-[0.8]"
            >
              The <span className="italic text-[var(--color-poster)]">catalog.</span>
            </h1>
          </div>

          <div className="md:col-span-5 lg:col-span-4">
            <div className="flex items-end justify-between gap-6 border-b border-white/15 pb-4 font-mono text-[0.5rem] uppercase tracking-[0.2em] text-white/45">
              <span>{String(products.length).padStart(2, "0")} pieces</span>
              <span>Finite release</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
              {EXPLORE_ROOMS[1].description}
            </p>
            <div className="mt-5 border-t border-white/15 pt-4">
              <DropCountdown endsAt={dropEnd} />
            </div>
          </div>
        </div>
      </header>

      <section
        aria-labelledby="catalogue-heading"
        className="bg-[var(--color-bone)] px-3 py-3 text-[var(--color-faded)] sm:px-6 sm:py-6"
      >
        <div className="mx-auto max-w-[96rem]">
          <div className="grid grid-cols-2 border-l border-t border-black/15 lg:grid-cols-4">
            {products.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                index={index}
                featured={index === 0}
              />
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

function ProductCard({
  product,
  index,
  featured = false,
}: {
  product: Product;
  index: number;
  featured?: boolean;
}) {
  const availability = product.available === false
    ? "Sold out"
    : product.variants.some((variant) => variant.available)
      ? "Available"
      : "Enquire";
  return (
    <Link
      href={`/store/${product.id}`}
      className={`group border-b border-r border-black/15 bg-[var(--color-bone)] p-2 sm:p-3 ${
        featured ? "col-span-2" : ""
      }`}
    >
      <div
        className={`relative overflow-hidden ${featured ? "aspect-[5/4] sm:aspect-[4/3] lg:aspect-[5/4]" : "aspect-[4/5]"}`}
        style={{ background: PRODUCT_TONES[product.tone] }}
      >
        {product.image && (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            priority={featured}
            sizes={featured ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.018]"
          />
        )}
        <div className="absolute inset-x-2 top-2 flex justify-between font-mono text-[0.44rem] uppercase tracking-[0.16em] text-white/65 sm:inset-x-3 sm:top-3">
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span>{product.code}</span>
        </div>
        <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center border border-white/40 bg-black/30 text-white transition-colors group-hover:bg-[var(--color-poster)] sm:bottom-3 sm:right-3">↗</span>
      </div>
      <div className="px-1 pb-3 pt-3 sm:pt-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className={`ui-heading leading-tight ${featured ? "text-xl sm:text-3xl" : "text-sm sm:text-lg"}`}>
            {product.name}
          </h2>
          <span className={`ui-heading tabular-nums ${featured ? "text-xl sm:text-3xl" : "text-sm sm:text-lg"}`}>
            {product.price}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[0.44rem] uppercase tracking-[0.14em] text-black/42 sm:text-[0.5rem]">
          <span className="truncate">{product.subtitle || product.material}</span>
          <span className={availability === "Sold out" ? "text-black/35" : "text-[var(--color-poster)]"}>{availability}</span>
        </div>
      </div>
    </Link>
  );
}
