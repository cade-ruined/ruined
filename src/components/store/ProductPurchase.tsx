"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Product, ProductOption, ProductVariant } from "@/data/products";
import BagLink from "./BagLink";
import { useBag, isShopifyVariantId } from "./bag-store";

function optionValue(variant: ProductVariant, name: string): string | undefined {
  return variant.selectedOptions.find((option) => option.name === name)?.value;
}

function variantMatches(variant: ProductVariant, selection: Record<string, string>): boolean {
  return Object.entries(selection).every(
    ([name, value]) => optionValue(variant, name) === value
  );
}

function visibleOptions(product: Product): ProductOption[] {
  return product.options.filter(
    (option) =>
      !(option.name === "Title" && option.values.length === 1 && option.values[0] === "Default Title")
  );
}

export default function ProductPurchase({ product }: { product: Product }) {
  const options = useMemo(() => visibleOptions(product), [product]);
  const firstAvailable = product.variants.find((variant) => variant.available) ?? product.variants[0];
  const [selection, setSelection] = useState<Record<string, string>>(() =>
    options.every((option) => option.values.length <= 1)
      ? Object.fromEntries(
          options.map((option) => [
            option.name,
            optionValue(firstAvailable, option.name) ?? option.values[0] ?? "",
          ])
        )
      : {}
  );
  const [added, setAdded] = useState(false);
  const { add } = useBag();

  const selectionComplete = options.every((option) => Boolean(selection[option.name]));
  const selectedVariant = selectionComplete
    ? product.variants.find((variant) => variantMatches(variant, selection))
    : undefined;
  const purchasable = selectedVariant?.available === true;
  const isShopifyProduct = product.variants.some((variant) => isShopifyVariantId(variant.id));
  const missingOptions = options.filter((option) => !selection[option.name]);
  const selectionPrompt = missingOptions.length === 1
    ? `Select ${missingOptions[0].name.toLowerCase()}`
    : "Select options";

  function canSelect(name: string, value: string): boolean {
    const next = { ...selection, [name]: value };
    return product.variants.some((variant) => variant.available && variantMatches(variant, next));
  }

  function choose(name: string, value: string) {
    setAdded(false);
    setSelection((current) => ({ ...current, [name]: value }));
  }

  function addSelectedVariant() {
    if (!selectedVariant?.available) return;
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
      image: product.image,
    });
    setAdded(true);
  }

  return (
    <div className="mt-6">
      <p className="display text-3xl">{selectedVariant?.price ?? product.price}</p>

      {options.map((option) => (
        <fieldset key={option.name} className="mt-8">
          <legend className="flex w-full justify-between font-mono text-[0.58rem] uppercase tracking-[0.24em] text-white/55">
            <span>Select {option.name}</span>
            <span className="text-white">{selection[option.name] || "Required"}</span>
          </legend>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {option.values.map((value) => {
              const active = selection[option.name] === value;
              const available = canSelect(option.name, value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => choose(option.name, value)}
                  disabled={!available}
                  aria-pressed={active}
                  className={`min-h-11 border px-2 py-3 font-mono text-[0.6rem] uppercase tracking-[0.18em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/20 ${
                    active
                      ? "border-white bg-white text-black"
                      : "border-white/30 text-white hover:border-white"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <button
        type="button"
        onClick={addSelectedVariant}
        disabled={!purchasable}
        className="mt-8 w-full border border-white bg-white px-5 py-4 font-mono text-xs uppercase tracking-[0.28em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-transparent disabled:text-white/35"
      >
        {!selectionComplete
          ? selectionPrompt
          : purchasable
            ? (added ? "Added to bag" : "Add to bag")
            : "Unavailable"}
      </button>

      <div className="mt-4 flex items-center justify-between gap-4 font-mono text-[0.54rem] uppercase tracking-[0.2em] text-white/45">
        <span>{isShopifyProduct ? "Checkout secured by Shopify" : "Confirmed by the studio"}</span>
        <BagLink className="text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-[var(--color-poster)]" />
      </div>

      {!isShopifyProduct && (
        <p className="mt-5 text-xs leading-relaxed text-white/40">
          Your selection is held in this browser. Send the bag to the studio for availability and completion.
        </p>
      )}
      <Link href="/shipping-returns" className="mt-3 inline-block text-xs text-white/40 underline decoration-white/20 underline-offset-4 hover:text-white">
        Shipping + returns
      </Link>
    </div>
  );
}
