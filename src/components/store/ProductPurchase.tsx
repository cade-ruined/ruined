"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Product, ProductOption, ProductVariant } from "@/data/products";
import {
  getProductSizeGuide,
  getProductSizeGuideConfig,
} from "@/data/product-size-guides";
import { FREE_STANDARD_SHIPPING_COPY } from "@/data/store-policies";
import { getProductColorOption, getVariantImage } from "@/lib/store/product-colors";
import { getProductFitOption } from "@/lib/store/product-fit-images";
import { trackStoreEvent } from "@/lib/analytics/storefront";
import { trackMetaAddToCart } from "@/lib/marketing/meta";
import BagLink from "./BagLink";
import ProductSizeGuideDialog from "./ProductSizeGuideDialog";
import { useBag, isShopifyVariantId } from "./bag-store";

function optionValue(variant: ProductVariant | undefined, name: string): string | undefined {
  return variant?.selectedOptions.find((option) => option.name === name)?.value;
}

function variantMatches(variant: ProductVariant, selection: Record<string, string>): boolean {
  return Object.entries(selection).every(
    ([name, value]) => optionValue(variant, name) === value
  );
}

function visibleOptions(product: Product): ProductOption[] {
  const options = product.options.filter(
    (option) =>
      !(option.name === "Title" && option.values.length === 1 && option.values[0] === "Default Title")
  );
  const color = getProductColorOption(product);
  return color ? [color, ...options.filter((option) => option !== color)] : options;
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

export default function ProductPurchase({ product, initialColor, initialFit, initialVariant, onColorChange, onFitChange, onVariantChange }: {
  product: Product;
  initialColor?: string;
  initialFit?: string;
  initialVariant?: ProductVariant;
  onColorChange?: (color: string) => void;
  onFitChange?: (fit: string) => void;
  onVariantChange?: (variant: ProductVariant) => void;
}) {
  const options = useMemo(() => visibleOptions(product), [product]);
  const colorOption = getProductColorOption(product);
  const fitOption = getProductFitOption(product);
  const firstAvailable = product.variants.find((variant) => variant.available) ?? product.variants[0];
  const [selection, setSelection] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(
      options.filter((option) => option.values.length === 1).map((option) => [
        option.name,
        optionValue(firstAvailable, option.name) ?? option.values[0] ?? "",
      ])
    ),
    ...(colorOption && initialColor && colorOption.values.includes(initialColor)
      ? { [colorOption.name]: initialColor } : {}),
    ...(fitOption && initialFit && fitOption.values.includes(initialFit)
      ? { [fitOption.name]: initialFit } : {}),
    ...(initialVariant && product.variants.some((variant) => variant.id === initialVariant.id)
      ? Object.fromEntries(initialVariant.selectedOptions.map((option) => [option.name, option.value])) : {}),
  }));
  const [added, setAdded] = useState(false);
  const { add } = useBag();

  const selectionComplete = options.every((option) => Boolean(selection[option.name]));
  const selectedVariant = selectionComplete
    ? product.variants.find((variant) => variantMatches(variant, selection))
    : undefined;
  const selectedColor = colorOption ? selection[colorOption.name] : undefined;
  const selectedFit = fitOption ? selection[fitOption.name] : undefined;
  const hasAvailableVariant = product.variants.some((variant) =>
    variant.available
      && (!colorOption || !selectedColor || optionValue(variant, colorOption.name) === selectedColor)
      && (!fitOption || !selectedFit || optionValue(variant, fitOption.name) === selectedFit)
  );
  const purchasable = selectedVariant?.available === true;
  const expectedShipDate = formatExpectedShipDate(product.expectedShipDate);
  const isPreorder = Boolean(expectedShipDate);
  const isShopifyProduct = product.variants.some((variant) => isShopifyVariantId(variant.id));
  const missingOptions = options.filter((option) => !selection[option.name]);
  const sizeGuideConfig = getProductSizeGuideConfig(product.id);
  const sizeGuide = getProductSizeGuide(
    product.id,
    sizeGuideConfig ? selection[sizeGuideConfig.fitOption] : undefined
  );
  const selectionPrompt = missingOptions.length === 1
    ? `Select ${missingOptions[0].name.toLowerCase()}`
    : "Select options";

  function canSelect(name: string, value: string): boolean {
    // Sold-out colors and BYOB fits remain viewable; sizes and purchase stay disabled.
    if (name === colorOption?.name || name === fitOption?.name) {
      return product.variants.some((variant) => optionValue(variant, name) === value);
    }
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
    if (selection[name] !== value && options.some((option) => option.name === name && option.values.includes(value))) {
      if (/^colou?r$/i.test(name.trim())) trackStoreEvent("store_color_selected", { product_handle: product.id, option_value: value });
      trackStoreEvent("store_variant_selected", {
        product_id: product.shopifyProductGid ?? product.id,
        product_handle: product.id,
        source: "product_page",
        option_name: name,
        option_value: value,
      });
    }
    setAdded(false);
    if (name === colorOption?.name) onColorChange?.(value);
    if (name === fitOption?.name) onFitChange?.(value);
    const optionIndex = options.findIndex((option) => option.name === name);
    const next = Object.fromEntries([
        ...options.slice(0, optionIndex).flatMap((option) =>
          selection[option.name] ? [[option.name, selection[option.name]]] : []
        ),
        [name, value],
      ]);
    setSelection(next);
    if (options.every((option) => Boolean(next[option.name]))) {
      const variant = product.variants.find((item) => variantMatches(item, next));
      if (variant) onVariantChange?.(variant);
    }
  }

  function addSelectedVariant() {
    if (!selectedVariant?.available) return;
    const addedQuantity = add({
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
    if (addedQuantity > 0) {
      trackStoreEvent("store_add_to_bag", {
        product_id: product.shopifyProductGid ?? product.id,
        product_handle: product.id,
        variant_id: selectedVariant.id,
        source: "product_page",
        quantity: addedQuantity,
        value: Number(selectedVariant.priceAmount) * addedQuantity,
        currency: selectedVariant.currencyCode,
      });
      trackMetaAddToCart(product, selectedVariant, addedQuantity);
    }
    setAdded(addedQuantity > 0);
  }

  return (
    <div className="mt-6">
      <p className="display text-3xl">{selectedVariant?.price ?? product.price}</p>

      {isPreorder && (
        <div className="mt-5 border-l border-[var(--color-poster)] pl-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-poster)]">
            Preorder — pay in full
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/65">
            Pay {formatPriceForSentence(selectedVariant?.price ?? product.price)} now. Expected to ship {expectedShipDate}.
          </p>
        </div>
      )}

      {options.map((option) => (
        <fieldset key={option.name} className="mt-8">
          <legend className="flex w-full flex-wrap justify-between gap-2 font-mono text-xs uppercase tracking-[0.12em] text-white/70">
            <span>Select {option.name}</span>
            <span className="text-white">{selection[option.name] || "Required"}</span>
          </legend>
          {option.name === sizeGuideConfig?.sizeOption && (
            <div className="mt-1 flex min-h-11 items-center justify-end">
              {sizeGuide ? (
                <ProductSizeGuideDialog guide={sizeGuide} onOpen={() => trackStoreEvent("store_size_guide_opened", {
                  product_id: product.shopifyProductGid ?? product.id,
                  product_handle: product.id,
                  source: "product_page",
                })} />
              ) : (
                <span className="font-mono text-xs uppercase tracking-[0.12em] text-white/65">
                  Select fit for size guide
                </span>
              )}
            </div>
          )}
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
                  className={`min-h-11 min-w-11 border px-2 py-3 font-mono text-xs uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/20 ${
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
          {!hasAvailableVariant
            ? "Sold out"
            : !selectionComplete
              ? selectionPrompt
              : purchasable
                ? (added ? "Added to bag" : isPreorder ? "Preorder" : "Add to bag")
                : "Unavailable"}
        </span>
      </button>

      {isShopifyProduct && (
        <p className="mt-4 text-sm leading-relaxed text-white/70">
          {FREE_STANDARD_SHIPPING_COPY}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.1em] text-white/70">
        <span>{isShopifyProduct ? "Secure checkout" : "Studio confirmation"}</span>
        <BagLink className="inline-flex min-h-11 min-w-11 items-center justify-end text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-[var(--color-poster)]" />
      </div>

      {!isShopifyProduct && (
        <p className="mt-5 text-sm leading-relaxed text-white/70">
          Studio confirmation is required before payment.
        </p>
      )}
      <Link href="/shipping-returns" className="mt-3 inline-flex min-h-11 items-center text-sm text-white/70 underline decoration-white/30 underline-offset-4 hover:text-white">
        Shipping + returns
      </Link>
    </div>
  );
}
