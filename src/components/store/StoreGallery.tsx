"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { catalogAnalyticsSelection, configureCatalogAnalytics, trackStoreEvent } from "@/lib/analytics/storefront";
import { MARKETING_CONSENT_EVENT } from "@/lib/marketing/consent";
import Link from "next/link";
import type { Product } from "@/data/products";
import { PRODUCT_TONES } from "@/data/products";
import { catalogNotice, type CatalogStatus } from "@/lib/store/catalog";
import { getCatalogEntries } from "@/lib/store/product-colors";
import { getProductFitImages } from "@/lib/store/product-fit-images";
import { getProductFitHref } from "@/lib/store/product-links";
import { CATALOG_CATEGORIES, CATALOG_FITS, catalogFiltersHref, filterCatalogProducts, getCollectionFilters, getCatalogFitSelection, normalizeCatalogFilters, type CatalogFit } from "@/lib/store/catalog-filters";
import StoreVideoHeader from "./StoreVideoHeader";
import StoreFilterDrawer from "./StoreFilterDrawer";
import styles from "./StoreGallery.module.css";

const CATEGORY_LABELS = { all: "All", "tees-tanks": "Tees", hoodies: "Hoodies", "collared-shirts": "Collared" };

export default function StoreGallery({
  products,
  catalogStatus = products.length ? "ready" : "unavailable",
}: {
  products: Product[];
  catalogStatus?: CatalogStatus;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [catalogSearch, setCatalogSearch] = useState(() => searchParams.toString());
  const isCatalog = pathname === "/store";
  // Product modals share the URL while the gallery retains its own filters.
  const catalogParams = isCatalog ? searchParams : new URLSearchParams(catalogSearch);
  useEffect(() => {
    if (isCatalog) setCatalogSearch(searchParams.toString());
  }, [isCatalog, searchParams]);
  const filters = normalizeCatalogFilters({
    category: catalogParams.get("category") ?? undefined,
    collection: catalogParams.get("collection") ?? undefined,
    fit: catalogParams.get("fit") ?? undefined,
  }, products);
  const collections = getCollectionFilters(products);
  const visibleProducts = filterCatalogProducts(products, filters);
  const filtered = filters.category !== "all" || Boolean(filters.collection) || filters.fit !== "all";
  const selection = catalogAnalyticsSelection(filters);
  const lastReportedView = useRef<string | null>(null);
  const resultCount = visibleProducts.length;

  useEffect(() => {
    configureCatalogAnalytics(getCollectionFilters(products));
    if (!products.length || !isCatalog) return;
    const view = () => {
      const key = `${selection}:${resultCount}`;
      if (lastReportedView.current !== key && trackStoreEvent("store_catalog_viewed", { selection, results: resultCount })) {
        lastReportedView.current = key;
      }
    };
    view();
    window.addEventListener(MARKETING_CONSENT_EVENT, view);
    return () => window.removeEventListener(MARKETING_CONSENT_EVENT, view);
  }, [products, selection, resultCount, isCatalog]);

  function chooseFilters(next: { category?: string; collection?: string; fit?: string }) {
    const nextFilters = normalizeCatalogFilters({ ...filters, ...next }, products);
    if (catalogAnalyticsSelection(nextFilters) === selection) return;
    const key = Object.keys(next).length > 1 ? "reset" : Object.keys(next)[0] as "category" | "collection" | "fit";
    const value = key === "reset" ? "all" : nextFilters[key] || "all";
    trackStoreEvent("store_filter_changed", { filter: `${key}:${value}`, results: filterCatalogProducts(products, nextFilters).length });
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
            ← Back to the walk
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
                <a href="/store" className={`${styles.action} ${styles.onDark} ui-heading px-5 text-sm`}>
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
      <StoreVideoHeader />
      <h1 id="catalogue-heading" className="sr-only">Shop Ruined apparel</h1>

      <section
        aria-labelledby="catalogue-heading"
        className="bg-[var(--color-bone)] px-3 py-3 text-[var(--color-faded)] sm:px-6 sm:py-6"
      >
        <div className="mx-auto max-w-[96rem]">
          <div className={styles.toolbar}>
            <div role="group" aria-label="Product category" className={styles.categories}>
              {CATALOG_CATEGORIES.map(({ id }) => (
                <button key={id} type="button" aria-pressed={filters.category === id}
                  onClick={() => chooseFilters({ category: id })}
                  className={styles.category}>
                  {CATEGORY_LABELS[id]}
                </button>
              ))}
            </div>
            <StoreFilterDrawer
              activeCount={Number(Boolean(filters.collection)) + Number(filters.fit !== "all")}
              hasFilters={filtered}
              resultCount={resultCount}
              onClear={() => chooseFilters({ category: "all", collection: "", fit: "all" })}
            >
              <label className={styles.drawerField}>
                Collection
                <select aria-label="Collection" value={filters.collection}
                  onChange={(event) => chooseFilters({ collection: event.currentTarget.value })}
                  className={styles.drawerSelect}>
                  <option value="">All collections</option>
                  {collections.map(({ handle, title }) => <option key={handle} value={handle}>{title}</option>)}
                </select>
              </label>
              <label className={styles.drawerField}>
                Fit
                <select aria-label="Fit" value={filters.fit}
                  onChange={(event) => chooseFilters({ fit: event.currentTarget.value })}
                  className={styles.drawerSelect}>
                  {CATALOG_FITS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </StoreFilterDrawer>
          </div>
          <p role="status" className="sr-only">{visibleProducts.length} {visibleProducts.length === 1 ? "style" : "styles"}{filtered ? ` of ${products.length}` : ""}</p>
          {visibleProducts.length ? (
            <div className="grid grid-cols-2 border-l border-black/15 lg:grid-cols-4">
              {visibleProducts.map((product, index) => (
                <ProductCard key={product.id} product={product} index={index} selection={selection} fit={filters.fit} featured={product.id === "camo-hoodie"} />
              ))}
            </div>
          ) : (
            <div className="border-x border-b border-black/15 px-5 py-16 text-center">
              <h2 className="ui-heading text-xl">No pieces in this combination.</h2>
              <p className="mt-3 text-sm text-black/60">Try another category, collection, or fit.</p>
              <button type="button" onClick={() => chooseFilters({ category: "all", collection: "", fit: "all" })}
                className={`${styles.action} mt-5 px-5 text-sm`}>View all pieces</button>
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
            <Link href="/shipping-returns" className={`${styles.action} ${styles.onDark} ui-heading px-5 py-3 text-[0.58rem] uppercase tracking-[0.24em]`}>
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
  selection,
  fit,
  featured = false,
}: {
  product: Product;
  index: number;
  selection: string;
  fit: CatalogFit;
  featured?: boolean;
}) {
  const entries = getCatalogEntries([product]);
  const [selectedColor, setSelectedColor] = useState(() => (entries.find((entry) => entry.available) ?? entries[0]).color);
  const entry = entries.find((candidate) => candidate.color === selectedColor) ?? entries[0];
  const { color } = entry;
  const selectedFit = getCatalogFitSelection(product, fit);
  const fitVariants = selectedFit ? product.variants.filter((variant) => variant.selectedOptions.some(
    (option) => option.name.toLowerCase() === "fit" && option.value === selectedFit,
  ) && (!color || variant.selectedOptions.some((option) => /^colou?r$/i.test(option.name) && option.value === color))) : undefined;
  const price = fitVariants?.filter((variant) => Number.isFinite(Number(variant.priceAmount)))
    .reduce<(typeof product.variants)[number] | undefined>((lowest, variant) => !lowest || Number(variant.priceAmount) < Number(lowest.priceAmount) ? variant : lowest, undefined)?.price ?? entry.price;
  const href = selectedFit ? getProductFitHref(product, entry.href, selectedFit) : entry.href;
  const [image, secondImage] = (selectedFit ? getProductFitImages(product, selectedFit) : undefined) ?? entry.images;
  const availability = !(fitVariants ? fitVariants.some((variant) => variant.available) : entry.available)
    ? "Sold out"
    : product.expectedShipDate
      ? `Preorder · Ships ${formatExpectedShipDate(product.expectedShipDate)}`
      : "Available";
  return (
    <article className={`border-b border-r border-black/15 bg-[var(--color-bone)] p-2 sm:p-3 ${featured ? "col-span-2" : ""}`} data-product-handle={product.id}>
    <Link
      href={href}
      scroll={false}
      onClick={() => {
        trackStoreEvent("store_product_selected", { product_id: product.shopifyProductGid ?? product.id, product_handle: product.id, source: "store" });
        trackStoreEvent("store_catalog_product_selected", { product_handle: product.id, selection });
      }}
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
        <span aria-hidden="true" className={`${styles.cardAction} absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center sm:bottom-4 sm:right-4`}>→</span>
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
          <span className="truncate">{[color, selectedFit].filter(Boolean).join(" · ") || product.subtitle || product.material}</span>
          <span className={availability === "Sold out" ? "text-black/35" : "text-[var(--color-poster)]"}>{availability}</span>
        </div>
      </div>
    </Link>
    {entries.length > 1 && (
      <div role="group" aria-label={`${product.name} colors`} className="flex flex-wrap px-1 pb-1">
        {entries.map((choice) => (
          <button key={choice.key} type="button" aria-label={`${product.name} — ${choice.color}`} aria-pressed={choice.color === color}
            title={choice.color} onClick={() => {
              if (choice.color === color) return;
              setSelectedColor(choice.color);
              trackStoreEvent("store_color_selected", { product_handle: product.id, option_value: choice.color });
            }}
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
