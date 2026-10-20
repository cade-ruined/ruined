"use client";

import Image from "next/image";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { trackStoreEvent } from "@/lib/analytics/storefront";
import Link from "next/link";
import type { Product } from "@/data/products";
import { PRODUCT_TONES } from "@/data/products";
import { catalogNotice, type CatalogStatus } from "@/lib/store/catalog";
import { getCatalogEntries } from "@/lib/store/product-colors";
import { CATALOG_CATEGORIES, catalogFiltersHref, filterCatalogProducts, getCollectionFilters, normalizeCatalogFilters } from "@/lib/store/catalog-filters";

export default function StoreGallery({
  products,
  catalogStatus = products.length ? "ready" : "unavailable",
}: {
  products: Product[];
  catalogStatus?: CatalogStatus;
}) {
  const searchParams = useSearchParams();
  const filters = normalizeCatalogFilters({
    category: searchParams.get("category") ?? undefined,
    collection: searchParams.get("collection") ?? undefined,
  }, products);
  const collections = getCollectionFilters(products);
  const visibleProducts = filterCatalogProducts(products, filters);
  const filtered = filters.category !== "all" || Boolean(filters.collection);

  function chooseFilters(next: { category?: string; collection?: string }) {
    const nextFilters = normalizeCatalogFilters({ ...filters, ...next }, products);
    window.history.pushState(null, "", catalogFiltersHref(window.location.pathname, searchParams.toString(), nextFilters));
  }
  if (!products.length) {
    const notice = catalogNotice(catalogStatus);
    return (
      <main className="min-h-screen bg-black px-5 pb-24 pt-12 text-[var(--color-bone)] sm:px-10 sm:pt-14">
        <div className="mx-auto max-w-[96rem]">
          <Link
            href="/#top"
            className="font-mono text-[0.64rem] uppercase tracking-[0.22em] text-white/45 transition-colors hover:text-white"
          >
            ← Return to the walk
          </Link>
          <div className="mt-16 max-w-3xl sm:mt-24" data-catalog-status={catalogStatus}>
            <p className="font-mono text-[0.64rem] uppercase tracking-[0.26em] text-[var(--color-poster)]">
              Store
            </p>
            <h1 className="display mt-5 text-[clamp(3.5rem,10vw,8rem)] leading-[0.82]">
              {notice.heading}
            </h1>
            <p className="mt-7 max-w-xl text-sm leading-relaxed text-white/55 sm:text-base">
              {notice.detail}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-6">
              {notice.retry && (
                // A document reload deliberately bypasses a cached client route
                // after a failed read; a same-route Link may do nothing.
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                <a href="/store" className="ui-heading inline-flex min-h-11 items-center rounded-sm bg-[var(--color-signal)] px-5 text-sm text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                  Try again
                </a>
              )}
              <Link href="/contact" className="ui-heading inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                Contact Ruined <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-[var(--color-bone)]">
      <header className="border-b border-white/15 px-4 pb-8 pt-12 sm:px-8 sm:pb-10 sm:pt-14 lg:px-10">
        <div className="mx-auto grid max-w-[96rem] gap-8 md:grid-cols-12 md:items-end">
          <div className="md:col-span-7 lg:col-span-8">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.64rem] uppercase tracking-[0.22em] text-white/45">
              <Link href="/#top" className="transition-colors hover:text-white">
                ← Return to the walk
              </Link>
              <span aria-hidden="true" className="h-px w-6 bg-white/25" />
              <span>Current pieces</span>
            </div>
            <h1
              id="catalogue-heading"
              className="display mt-7 text-[clamp(3.5rem,8vw,7.5rem)] leading-[0.8]"
            >
              The <span className="italic text-[var(--color-poster)]">catalog.</span>
            </h1>
          </div>

          <div className="md:col-span-5 lg:col-span-4">
            <div className="flex items-end justify-between gap-6 border-b border-white/15 pb-4 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-white/45">
              <span>{String(products.length).padStart(2, "0")} styles</span>
              <span>Available online</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
              Everyday pieces, made with intention. Find your fit, or explore
              the collection behind it.
            </p>
          </div>
        </div>
      </header>

      <section
        aria-labelledby="catalogue-heading"
        className="bg-[var(--color-bone)] px-3 py-3 text-[var(--color-faded)] sm:px-6 sm:py-6"
      >
        <div className="mx-auto max-w-[96rem]">
          <div className="border border-black/15 px-3 py-4 sm:px-5 sm:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div role="group" aria-label="Product category" className="flex flex-wrap gap-x-1 gap-y-1">
                {CATALOG_CATEGORIES.map(({ id, label }) => (
                  <button key={id} type="button" aria-pressed={filters.category === id}
                    onClick={() => chooseFilters({ category: id })}
                    className={`min-h-11 px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:px-4 ${filters.category === id ? "bg-black text-[var(--color-bone)]" : "text-black/60 hover:bg-black/5 hover:text-black"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-3 text-xs text-black/60">
                Collection
                <select aria-label="Collection" value={filters.collection}
                  onChange={(event) => chooseFilters({ collection: event.currentTarget.value })}
                  className="min-h-11 min-w-0 flex-1 rounded-none border border-black/25 bg-transparent px-3 text-sm text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black lg:min-w-52">
                  <option value="">All collections</option>
                  {collections.map(({ handle, title }) => <option key={handle} value={handle}>{title}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex min-h-8 items-center justify-between gap-4 text-xs text-black/55">
              <p role="status">{visibleProducts.length} {visibleProducts.length === 1 ? "style" : "styles"}{filtered ? ` of ${products.length}` : ""}</p>
              {filtered && <button type="button" onClick={() => chooseFilters({ category: "all", collection: "" })}
                className="min-h-11 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">Clear filters</button>}
            </div>
          </div>
          {visibleProducts.length ? (
            <div className="grid grid-cols-2 border-l border-black/15 lg:grid-cols-4">
              {visibleProducts.map((product, index) => (
                <ProductCard key={product.id} product={product} index={index} featured={product.id === "camo-hoodie"} />
              ))}
            </div>
          ) : (
            <div className="border-x border-b border-black/15 px-5 py-16 text-center">
              <h2 className="ui-heading text-xl">No pieces in this combination.</h2>
              <p className="mt-3 text-sm text-black/60">Try another category or collection.</p>
              <button type="button" onClick={() => chooseFilters({ category: "all", collection: "" })}
                className="mt-5 min-h-11 border border-black px-5 text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">View all pieces</button>
            </div>
          )}

          <div className="grid gap-4 border border-t-0 border-black/15 px-5 py-6 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-black/45 sm:grid-cols-3 sm:px-7">
            <p>Cut and size <span className="text-black">selected by you</span></p>
            <p className="sm:text-center">Payment <span className="text-black">made securely</span></p>
            <p className="sm:text-right">Dispatch <span className="text-black">shown per piece</span></p>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto grid max-w-[96rem] gap-10 border-t border-white/15 pt-8 md:grid-cols-12">
          <div className="md:col-span-7">
            <p className="font-mono text-[0.64rem] uppercase tracking-[0.26em] text-white/40">The piece</p>
            <p className="display mt-5 max-w-4xl text-[clamp(2.6rem,6vw,6rem)] leading-[0.9]">
              Made to become more <span className="italic text-[var(--color-poster)]">itself</span> with use.
            </p>
          </div>
          <div className="md:col-span-4 md:col-start-9 md:self-end">
            <Link href="/shipping-returns" className="ui-heading inline-flex border border-white/40 px-5 py-3 text-[0.58rem] uppercase tracking-[0.24em] transition-colors hover:bg-white hover:text-black">
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
  const entries = getCatalogEntries([product]);
  const [selectedColor, setSelectedColor] = useState(() => (entries.find((entry) => entry.available) ?? entries[0]).color);
  const entry = entries.find((candidate) => candidate.color === selectedColor) ?? entries[0];
  const { color, price, href } = entry;
  const [image, secondImage] = entry.images;
  const availability = !entry.available
    ? "Sold out"
    : product.expectedShipDate
      ? `Preorder · Ships ${formatExpectedShipDate(product.expectedShipDate)}`
      : "Available";
  return (
    <article className={`border-b border-r border-black/15 bg-[var(--color-bone)] p-2 sm:p-3 ${featured ? "col-span-2" : ""}`} data-product-handle={product.id}>
    <Link
      href={href}
      onClick={() => trackStoreEvent("store_product_selected", { product_id: product.shopifyProductGid ?? product.id, product_handle: product.id, source: "store" })}
      className="group block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
    >
      <div
        className={`relative overflow-hidden ${featured ? "aspect-[5/4] sm:aspect-[4/3] lg:aspect-[5/4]" : "aspect-[4/5]"}`}
        style={{ background: PRODUCT_TONES[product.tone] }}
      >
        {image && (
          <Image
            src={image.url}
            alt={image.alt}
            fill
            priority={featured}
            sizes={featured ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.018]"
          />
        )}
        {image && secondImage && secondImage.url !== image.url && (
          <Image
            src={secondImage.url}
            alt=""
            aria-hidden="true"
            fill
            sizes={featured ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
            className="pointer-events-none object-cover opacity-0 transition-opacity duration-300 motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
          />
        )}
        <div className="absolute inset-x-2 top-2 flex justify-between font-mono text-[0.64rem] uppercase tracking-[0.14em] text-white/75 sm:inset-x-3 sm:top-3">
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span>{featured ? "Featured" : product.code}</span>
        </div>
        <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center border border-white/40 bg-black/30 text-white transition-colors group-hover:bg-[var(--color-poster)] sm:bottom-3 sm:right-3">→</span>
      </div>
      <div className="px-1 pb-3 pt-3 sm:pt-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className={`ui-heading leading-tight ${featured ? "text-xl sm:text-3xl" : "text-sm sm:text-lg"}`}>
            {product.name}
          </h2>
          <span className={`ui-heading shrink-0 whitespace-nowrap tabular-nums ${featured ? "text-xl sm:text-3xl" : "text-sm sm:text-lg"}`}>
            {price}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-black/50">
          <span className="truncate">{color || product.subtitle || product.material}</span>
          <span className={availability === "Sold out" ? "text-black/35" : "text-[var(--color-poster)]"}>{availability}</span>
        </div>
      </div>
    </Link>
    {entries.length > 1 && (
      <div role="group" aria-label={`${product.name} colors`} className="flex flex-wrap px-1 pb-1">
        {entries.map((choice) => (
          <button key={choice.key} type="button" aria-label={`${product.name} — ${choice.color}`} aria-pressed={choice.color === color}
            title={choice.color} onClick={() => setSelectedColor(choice.color)}
            className="flex h-11 w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black">
            <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full border ${choice.color === color ? "border-black" : "border-transparent"}`}>
              <span className="block h-5 w-5 rounded-full border border-black/20" style={{ background: COLOR_SWATCHES[choice.color?.toLowerCase() ?? ""] ?? "#c8c1b4" }} />
            </span>
          </button>
        ))}
      </div>
    )}
    </article>
  );
}

const COLOR_SWATCHES: Record<string, string> = { black: "#202020", blue: "#476684", grey: "#a9a9a5", gray: "#a9a9a5", red: "#8e3330", white: "#f6f2e8" };

function formatExpectedShipDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
}
