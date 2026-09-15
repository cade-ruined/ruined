"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { PRODUCT_TONES, type Product } from "@/data/products";
import { getProductColorHref, getProductColorImages, getProductColorOption } from "@/lib/store/product-colors";
import ProductPurchase from "./ProductPurchase";

export default function ProductDetail({ product, children }: {
  product: Product;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const colorOption = getProductColorOption(product);
  const requestedColor = searchParams.get("color");
  const color = colorOption?.values.find((value) => value === requestedColor) ?? colorOption?.values[0];
  const images = getProductColorImages(product, color).slice(0, 2);
  const variants = product.variants.filter((variant) => !color || variant.selectedOptions.some(
    (option) => option.name === colorOption?.name && option.value === color
  ));
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

  function chooseColor(value: string) {
    if (!colorOption?.values.includes(value) || value === color) return;
    // Next synchronizes native history with useSearchParams without another
    // server response remounting the shopper's size selection.
    window.history.replaceState(null, "", getProductColorHref(product, value));
  }

  return (
    <div className="mt-10 grid gap-10 md:grid-cols-12 md:gap-14">
      <div className="grid gap-3 md:col-span-7 sm:gap-5" aria-label={color ? `${color} product photographs` : "Product photographs"}>
        {images.length ? images.map((image, index) => (
          <div key={image.url} className="relative aspect-[4/5] overflow-hidden" style={{ background: PRODUCT_TONES[product.tone] }}>
            <Image src={image.url} alt={image.alt} fill priority={index === 0} sizes="(min-width: 768px) 58vw, 100vw" className="object-cover" />
          </div>
        )) : (
          <div className="aspect-[4/5]" aria-hidden="true" style={{ background: PRODUCT_TONES[product.tone] }} />
        )}
      </div>
      <article className="self-start md:sticky md:top-28 md:col-span-5 md:pt-8">
        {product.subtitle && (
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.28em] text-[var(--color-poster)]">{product.subtitle}</p>
        )}
        <h1 className="display mt-4 text-[clamp(3rem,7vw,5.5rem)] leading-[0.9]">{product.name}</h1>
        <ProductPurchase key={color ?? product.id} product={product} initialColor={color} onColorChange={chooseColor} />
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
