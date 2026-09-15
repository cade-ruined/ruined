"use client";

import { useState } from "react";
import type { Product, ProductVariant } from "@/data/products";
import { useBag } from "@/components/store/bag-store";
import { getProductColorOption, getVariantImage } from "@/lib/store/product-colors";

function matches(variant: ProductVariant, selection: Record<string, string>) {
  return Object.entries(selection).every(([name, value]) =>
    variant.selectedOptions.some((option) => option.name === name && option.value === value)
  );
}

export default function JourneyQuickBuy({ product, color }: { product: Product; color?: string }) {
  const options = product.options.filter((option) =>
    !(option.name === "Title" && option.values.length === 1 && option.values[0] === "Default Title")
  );
  const colorOption = getProductColorOption(product);
  const fixedColor = colorOption?.values.find((value) => value === color);
  const fixedSelection = Object.fromEntries(
    options.filter((option) => option.values.length === 1).map((option) => [option.name, option.values[0]])
  );
  if (colorOption && fixedColor) fixedSelection[colorOption.name] = fixedColor;
  const choices = options.filter((option) => !fixedSelection[option.name]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);
  const { add } = useBag();
  const resolvedSelection = { ...fixedSelection, ...selection };
  const complete = options.every((option) => Boolean(resolvedSelection[option.name]));
  const selectedVariant = complete
    ? product.variants.find((variant) => matches(variant, resolvedSelection))
    : undefined;
  const soldOut = !product.variants.some((variant) => variant.available && matches(variant, fixedSelection));
  const purchasable = selectedVariant?.available === true;
  const selectionSummary = selectedVariant?.selectedOptions
    .filter((option) => option.value !== "Default Title")
    .map((option) => option.value)
    .join(", ");

  function selectionThrough(name: string, value: string) {
    const index = choices.findIndex((option) => option.name === name);
    return {
      ...fixedSelection,
      ...Object.fromEntries(choices.slice(0, index).flatMap((option) =>
        selection[option.name] ? [[option.name, selection[option.name]]] : []
      )),
      [name]: value,
    };
  }

  function choose(name: string, value: string) {
    setSelection(selectionThrough(name, value));
    setAdded(false);
    setError(false);
  }

  function addSelectedVariant() {
    if (!selectedVariant?.available) return;
    try {
      add({
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        variantId: selectedVariant.id,
        variantTitle: selectedVariant.title,
        selectedOptions: selectedVariant.selectedOptions,
        unitPrice: selectedVariant.price,
        priceAmount: selectedVariant.priceAmount,
        currencyCode: selectedVariant.currencyCode,
        image: getVariantImage(product, selectedVariant),
        expectedShipDate: product.expectedShipDate,
      });
      setAdded(true);
      setError(false);
    } catch {
      setAdded(false);
      setError(true);
    }
  }

  return (
    <div
      data-journey-quick-buy={product.id}
      role="group"
      aria-label={`Quick buy ${product.name}`}
      className="mt-auto border-t border-white/15 p-1.5 sm:p-2"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="grid grid-cols-2 gap-1.5">
        {choices.map((option) => (
          <label key={option.name} className="relative block min-w-0">
            <span className="sr-only">{option.name} for {product.name}</span>
            <select
              value={selection[option.name] ?? ""}
              disabled={soldOut}
              onChange={(event) => choose(option.name, event.currentTarget.value)}
              className="min-h-11 w-full min-w-0 appearance-none rounded-none border border-white/30 bg-black py-2 pl-3 pr-9 font-sans text-base leading-5 text-white [color-scheme:dark] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:text-white/35 [@media(hover:hover)_and_(pointer:fine)]:text-sm"
            >
              <option value="" disabled>{option.name}</option>
              {option.values.map((value) => (
                <option
                  key={value}
                  value={value}
                  disabled={!product.variants.some((variant) =>
                    variant.available && matches(variant, selectionThrough(option.name, value))
                  )}
                >
                  {value}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className={`pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${soldOut ? "text-white/35" : "text-white/75"}`}
            >
              <path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </label>
        ))}
        <button
          type="button"
          disabled={!purchasable}
          onClick={addSelectedVariant}
          className={`min-h-11 border border-white bg-white px-1.5 py-2 font-sans text-xs font-semibold text-black transition-colors hover:border-[var(--color-poster)] hover:bg-[var(--color-poster)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-transparent disabled:text-white/40 ${choices.length % 2 === 0 ? "col-span-2" : ""}`}
        >
          {soldOut ? "Sold out" : added ? "Added ✓" : "Add to bag"}
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {added ? `${product.name}${selectionSummary ? `, ${selectionSummary}` : ""} added to bag.` : ""}
      </span>
      {selectedVariant && selectedVariant.price !== product.price && (
        <p className="mt-1.5 text-xs text-white" aria-live="polite">{selectedVariant.price}</p>
      )}
      {error && <p role="alert" className="mt-1.5 text-xs leading-snug text-[var(--color-poster)]">Couldn’t save to bag. Please try again.</p>}
    </div>
  );
}
