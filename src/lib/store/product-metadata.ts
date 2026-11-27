import type { Product, ProductVariant } from "@/data/products";
import { ranchPromotionPrice, RANCH_SALE_END } from "./ranch-promotion.js";

/** An editorial excerpt, not a search-engine length requirement. */
export function productMetadataDescription(product: Pick<Product, "name" | "description">): string {
  const description = product.description.replace(/\s+/g, " ").trim();
  if (!description) return `${product.name} from Ruined. Explore details, fit, and available options.`;
  if (description.length <= 160) return description;

  let excerpt = "";
  for (const sentence of description.split(/(?<=[.!?])\s+/)) {
    const candidate = excerpt ? `${excerpt} ${sentence}` : sentence;
    if (candidate.length > 160) break;
    excerpt = candidate;
  }
  if (excerpt.length >= 70) return excerpt;

  const fragment = description.slice(0, 159);
  const boundary = fragment.lastIndexOf(" ");
  return `${(boundary > 0 ? fragment.slice(0, boundary) : fragment).replace(/[,;:\s]+$/, "")}…`;
}

/** Each purchasable variant has its own price, stock, and restorable selection URL. */
export function productOffers({ variants, productUrl, expectedShipDate, returnPolicyId, product }: {
  variants: ProductVariant[];
  productUrl: string;
  expectedShipDate?: string;
  returnPolicyId?: string;
  product?: Pick<Product, "shopifyProductGid" | "pricingAsOf">;
}) {
  return variants.flatMap((variant) => {
    const variantId = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(variant.id)?.[1];
    const amount = Number(variant.priceAmount);
    if (!variantId || !variant.priceAmount.trim() || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(variant.currencyCode)) return [];
    const url = new URL(productUrl);
    url.searchParams.set("variant", variantId);
    const promotion = product ? ranchPromotionPrice(product, variant, product.pricingAsOf) : undefined;
    return [{
      "@type": "Offer",
      url: url.href,
      priceCurrency: variant.currencyCode,
      price: promotion?.priceAmount ?? amount.toFixed(2),
      ...(promotion ? { validThrough: RANCH_SALE_END } : {}),
      availability: !variant.available
        ? "https://schema.org/OutOfStock"
        : expectedShipDate
          ? "https://schema.org/PreOrder"
          : "https://schema.org/InStock",
      ...(returnPolicyId ? { hasMerchantReturnPolicy: { "@id": returnPolicyId } } : {}),
    }];
  });
}
