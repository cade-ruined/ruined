"use client";

import type { Product, ProductVariant } from "@/data/products";
import { isStoreSaleProduct, isStoreSaleActive, storePromotionPrice, STORE_SALE_COPY, STORE_SALE_PERCENT } from "@/lib/store/store-promotion.js";
import { usePromotionTime } from "@/lib/store/use-promotion-time";

export default function ProductPrice({ product, variant, fallbackPrice, className = "" }: {
  product: Product;
  variant?: ProductVariant;
  fallbackPrice?: string;
  className?: string;
}) {
  const now = usePromotionTime(product.pricingAsOf);
  const pricedVariant = variant ?? product.variants.filter((item) => item.priceAmount.trim() && Number.isFinite(Number(item.priceAmount))).reduce<ProductVariant | undefined>((lowest, item) =>
    !lowest || Number(item.priceAmount) < Number(lowest.priceAmount) ? item : lowest, undefined);
  const promotion = storePromotionPrice(product, pricedVariant, now);
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 ${className}`}>
      {promotion ? <>
        <span className="sr-only">Sale price </span><span>{promotion.price}</span>
        <span className="sr-only">Regular price </span><del className="text-[0.7em] font-normal opacity-55">{promotion.regularPrice}</del>
      </> : <span>{variant?.price ?? fallbackPrice ?? product.price}</span>}
    </span>
  );
}

export function StoreSaleNotice({ product, className = "", compact = false, fallback }: {
  product: Product;
  className?: string;
  compact?: boolean;
  fallback?: string;
}) {
  const now = usePromotionTime(product.pricingAsOf);
  if (!isStoreSaleProduct(product) || !isStoreSaleActive(now)) return fallback ? <span className={className}>{fallback}</span> : null;
  return <span className={className}>{compact ? `${STORE_SALE_PERCENT}% off storewide · through Monday` : STORE_SALE_COPY}</span>;
}
