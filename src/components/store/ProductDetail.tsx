"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import type { Product } from "@/data/products";
import { getProductColorImages, getProductColorOption } from "@/lib/store/product-colors";
import { getProductFitImages, getProductFitOption } from "@/lib/store/product-fit-images";
import { productSelectionHref, requestedProductFit, requestedProductVariant } from "@/lib/store/product-links";
import { MARKETING_CONSENT_EVENT } from "@/lib/marketing/consent";
import { trackStoreEvent } from "@/lib/analytics/storefront";
import { trackMetaProductView } from "@/lib/marketing/meta";
import type { ProductVariant } from "@/data/products";
import ProductPurchase from "./ProductPurchase";
import ProductGallery from "./ProductGallery";

export default function ProductDetail({ product, children }: {
  product: Product;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const viewedProduct = useRef<string | null>(null);
  const colorOption = getProductColorOption(product);
  const requestedVariant = requestedProductVariant(product, searchParams.get("variant"));
  const requestedColor = requestedVariant?.selectedOptions.find((option) => option.name === colorOption?.name)?.value ?? searchParams.get("color");
  const color = colorOption?.values.find((value) => value === requestedColor) ?? colorOption?.values[0];
  const fitOption = getProductFitOption(product);
  const selectedFit = requestedVariant?.selectedOptions.find((option) => option.name === fitOption?.name)?.value ?? requestedProductFit(product, searchParams.get("fit"));
  const galleryFit = selectedFit ?? fitOption?.values[0];
  const images = getProductFitImages(product, galleryFit) ?? getProductColorImages(product, color);
  const variants = product.variants.filter((variant) => (!color || variant.selectedOptions.some(
    (option) => option.name === colorOption?.name && option.value === color
  )) && (!selectedFit || variant.selectedOptions.some((option) => option.name === fitOption?.name && option.value === selectedFit)));
  const viewVariant = requestedVariant ?? variants.find((variant) => variant.available) ?? variants[0];
  const status = !variants.some((variant) => variant.available)
    ? "Sold out"
    : product.expectedShipDate
      ? "Preorder — pay in full"
      : variants.some((variant) => variant.id.startsWith("gid://shopify/ProductVariant/"))
        ? "Available"
        : "Studio confirmation";
  const specs = [
    { label: "Material", value: product.material },
    { label: "Origin", value: product.origin },
    { label: "Care", value: product.care },
    { label: "Status", value: status },
  ].filter((spec) => spec.value.trim());

  useEffect(() => {
    const view = () => trackMetaProductView(product, viewVariant);
    view();
    window.addEventListener(MARKETING_CONSENT_EVENT, view);
    return () => window.removeEventListener(MARKETING_CONSENT_EVENT, view);
  }, [product, viewVariant]);

  useEffect(() => {
    const view = () => {
      if (viewedProduct.current === product.id) return;
      const variant = viewVariant;
      if (trackStoreEvent("store_product_opened", {
        product_id: product.shopifyProductGid ?? product.id,
        product_handle: product.id,
        source: "product_page",
        ...(variant ? { variant_id: variant.id, quantity: 1, value: Number(variant.priceAmount), currency: variant.currencyCode } : {}),
      })) viewedProduct.current = product.id;
    };
    view();
    window.addEventListener(MARKETING_CONSENT_EVENT, view);
    return () => window.removeEventListener(MARKETING_CONSENT_EVENT, view);
  }, [product.id, product.shopifyProductGid, viewVariant]);

  function chooseColor(value: string) {
    if (!colorOption?.values.includes(value) || value === color) return;
    // Next synchronizes native history with useSearchParams without another
    // server response remounting the shopper's size selection.
    window.history.replaceState(null, "", productSelectionHref(window.location.pathname, window.location.search, { color: value, variant: null }));
  }

  function chooseVariant(variant: ProductVariant) {
    window.history.replaceState(null, "", productSelectionHref(window.location.pathname, window.location.search, { variant: variant.id }));
  }

  function chooseFit(value: string) {
    if (!fitOption?.values.includes(value) || value === selectedFit) return;
    window.history.replaceState(null, "", productSelectionHref(window.location.pathname, window.location.search, { fit: value, variant: null }));
  }

  return (
    <div className="mt-6 grid gap-6 md:mt-10 md:grid-cols-12 md:gap-14">
      <ProductGallery
        key={`${product.id}:${color ?? ""}:${galleryFit ?? ""}`}
        images={images}
        tone={product.tone}
        label={fitOption ? `${galleryFit} product photographs` : color ? `${color} product photographs` : "Product photographs"}
      />
      <article className="self-start md:sticky md:top-28 md:col-span-5 md:pt-8">
        {product.subtitle && (
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.28em] text-[var(--color-poster)]">{product.subtitle}</p>
        )}
        <h1 className="display mt-2 text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.95] md:mt-4 md:leading-[0.9]">{product.name}</h1>
        <ProductPurchase key={`${requestedVariant?.id ?? color ?? product.id}:${selectedFit ?? ""}`} product={product} initialColor={color} initialFit={selectedFit} initialVariant={requestedVariant} onColorChange={chooseColor} onFitChange={chooseFit} onVariantChange={chooseVariant} />
        {children}
        <dl className="mt-8 space-y-3 border-y border-white/15 py-6 font-mono text-[0.64rem] uppercase tracking-[0.16em]">
          {specs.map((spec) => (
            <div key={spec.label} className="grid grid-cols-3 gap-3">
              <dt className="text-white/40">{spec.label}</dt>
              <dd className="col-span-2">{spec.value}</dd>
            </div>
          ))}
        </dl>
      </article>
    </div>
  );
}
