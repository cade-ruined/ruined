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

function formatPriceForSentence(price: string): string {
  return price.replace(/^([£$€])\s+/, "$1");
}

function formatExpectedShipDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
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
  const expectedShipDate = formatExpectedShipDate(product.expectedShipDate);
  const isPreorder = Boolean(expectedShipDate);
  const isShopifyProduct = product.variants.some((variant) => isShopifyVariantId(variant.id));
  const missingOptions = options.filter((option) => !selection[option.name]);
  const selectionPrompt = missingOptions.length === 1
    ? `Select ${missingOptions[0].name.toLowerCase()}`
    : "Select options";

  function canSelect(name: string, value: string): boolean {
    const optionIndex = options.findIndex((option) => option.name === name);
    const next = Object.fromEntries([
      ...options.slice(0, optionIndex).flatMap((option) =>
        selection[option.name] ? [[option.name, selection[option.name]]] : []
      ),
      [name, value],
    ]);
    return product.variants.some((variant) => variant.available && variantMatches(variant, next));
  }

  function choose(name: string, value: string) {
    setAdded(false);
    const optionIndex = options.findIndex((option) => option.name === name);
    setSelection((current) =>
      Object.fromEntries([
        ...options.slice(0, optionIndex).flatMap((option) =>
          current[option.name] ? [[option.name, current[option.name]]] : []
        ),
        [name, value],
      ])
    );
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
      expectedShipDate: product.expectedShipDate,
    });
    setAdded(true);
  }

  return (
    <div className="mt-6">
      <p className="display text-3xl">{selectedVariant?.price ?? product.price}</p>

      {isPreorder && (
        <div className="mt-5 border-l border-[var(--color-poster)] pl-4">
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.18em] text-[var(--color-poster)]">
            Preorder — pay in full
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/65">
            Pay {formatPriceForSentence(selectedVariant?.price ?? product.price)} now. Expected to ship {expectedShipDate}.
          </p>
        </div>
      )}

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
        <span aria-live="polite">
          {!selectionComplete
            ? selectionPrompt
            : purchasable
              ? (added ? "Added to bag" : isPreorder ? "Preorder" : "Add to bag")
              : "Unavailable"}
        </span>
      </button>

      <div className="mt-4 flex items-center justify-between gap-4 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-white/65">
        <span>{isShopifyProduct ? "Secure checkout" : "Studio confirmation"}</span>
        <BagLink className="text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-[var(--color-poster)]" />
      </div>

      {!isShopifyProduct && (
        <p className="mt-5 text-xs leading-relaxed text-white/65">
          Studio confirmation is required before payment.
        </p>
      )}
      <Link href="/shipping-returns" className="mt-3 inline-flex min-h-11 items-center text-xs text-white/65 underline decoration-white/30 underline-offset-4 hover:text-white">
        Shipping + returns
      </Link>
    </div>
  );
}
