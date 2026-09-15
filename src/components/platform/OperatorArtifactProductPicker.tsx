"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS, OPERATOR_LABEL_TEXT_CLASS } from "@/components/platform/operatorStyles";
import type { ArtifactShopifyProduct } from "@/lib/shopify";

export type ArtifactProductSelection = Pick<ArtifactShopifyProduct, "id" | "handle" | "title">;

export default function OperatorArtifactProductPicker({ selected, onSelect, disabled, preview }: {
  selected: ArtifactProductSelection | null;
  onSelect: (product: ArtifactProductSelection | null) => void;
  disabled: boolean;
  preview: boolean;
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ArtifactShopifyProduct[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);

  async function search() {
    if (inFlight.current || disabled) return;
    if (preview) {
      setProducts([{ id: "preview-product-first-coin", handle: "the-first-coin", title: "The First Coin (example)", featuredImage: null }]);
      setMessage("Example product only. Nothing will be saved or ordered.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(false);
    setProducts([]);
    setMessage("");
    try {
      const response = await fetch(`/api/ops/artifact-products?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.products)) throw new Error(body.error ?? "Products could not be loaded. Try again.");
      setProducts(body.products);
      setMessage(body.hasMore ? "Showing the first 20. Refine the name to find more." : body.products.length ? "Choose a product below." : "No matching published products. Check the name and storefront publication in Shopify.");
    } catch (failure) {
      setError(true);
      setMessage(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "Shopify took too long to respond. Try again.");
    } finally { setLoading(false); inFlight.current = false; }
  }

  return <fieldset className="min-w-0 sm:col-span-full" disabled={disabled || loading}>
    <legend className={OPERATOR_LABEL_TEXT_CLASS}>Shopify product</legend>
    <input type="hidden" name="productGid" value={selected?.id ?? ""} />
    <input type="hidden" name="productHandle" value={selected?.handle ?? ""} />
    {selected ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[6px] bg-[var(--color-shop)]/35 px-3 py-1">
      <p className="min-w-0 break-words text-sm font-semibold">{selected.title}</p>
      <button className="min-h-11 px-2 text-sm font-semibold underline underline-offset-4" type="button" onClick={() => onSelect(null)}>Change product</button>
    </div> : <>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">Search Shopify product names</span><input className={OPERATOR_FIELD_CLASS} type="search" maxLength={100} placeholder="Search by product name" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /></label>
        <button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => void search()}>{loading ? "Searching…" : "Find products"}</button>
      </div>
      {message ? <p className={`mt-2 text-sm ${error ? "text-[var(--color-poster)]" : "text-black/60"}`} role={error ? "alert" : "status"}>{message}</p> : <p className="mt-2 text-xs text-black/55">Published storefront products only. No order is created.</p>}
      {products.length ? <ul className="mt-3 grid max-h-80 gap-2 overflow-y-auto">{products.map((product) => <li key={product.id}>
        <button className="flex min-h-14 w-full items-center gap-3 rounded-[4px] bg-black/[0.035] p-3 text-left hover:bg-black/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--color-poster)]" type="button" onClick={() => { onSelect(product); setProducts([]); }}>
          {product.featuredImage ? <Image src={product.featuredImage.url} alt="" width={48} height={48} className="size-12 rounded-[4px] object-cover" /> : null}
          <span className="min-w-0 flex-1 break-words text-sm font-semibold">{product.title}</span><span className="text-xs">Select →</span>
        </button>
      </li>)}</ul> : null}
    </>}
  </fieldset>;
}
