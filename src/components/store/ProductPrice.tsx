"use client";

import type { Product, ProductVariant } from "@/data/products";
import { isRanchProduct } from "@/lib/store/ranch-catalog.js";
import { isRanchSaleActive, ranchPromotionPrice, RANCH_SALE_COPY, RANCH_SALE_PERCENT } from "@/lib/store/ranch-promotion.js";
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
  const promotion = ranchPromotionPrice(product, pricedVariant, now);
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 ${className}`}>
      {promotion ? <>
        <span className="sr-only">Sale price </span><span>{promotion.price}</span>
        <span className="sr-only">Regular price </span><del className="text-[0.7em] font-normal opacity-55">{promotion.regularPrice}</del>
      </> : <span>{variant?.price ?? fallbackPrice ?? product.price}</span>}
    </span>
  );
}

export function RanchSaleNotice({ product, className = "", compact = false, fallback }: {
  product: Product;
  className?: string;
  compact?: boolean;
  fallback?: string;
}) {
  const now = usePromotionTime(product.pricingAsOf);
  if (!isRanchProduct(product) || !isRanchSaleActive(now)) return fallback ? <span className={className}>{fallback}</span> : null;
  return <span className={className}>{compact ? `${RANCH_SALE_PERCENT}% off · through Monday` : RANCH_SALE_COPY}</span>;
}
