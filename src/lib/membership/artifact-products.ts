import type { Product } from "@/data/products";
import type {
  MemberArtifactSummary,
  MemberArtifactsSnapshot,
  MemberHomeSnapshot,
} from "@/lib/membership/model";

const SHOPIFY_PRODUCT_GID = /^gid:\/\/shopify\/Product\/[1-9]\d*$/;
const SHOPIFY_PRODUCT_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeProductImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shopifyArtifactProductFromSpecification(
  value: unknown,
): MemberArtifactSummary["product"] {
  const specification = record(value);
  const shopify = record(specification?.shopify);
  const productGid = cleanString(shopify?.product_gid);
  const productHandle = cleanString(shopify?.product_handle);

  if (
    !productGid ||
    !productHandle ||
    !SHOPIFY_PRODUCT_GID.test(productGid) ||
    !SHOPIFY_PRODUCT_HANDLE.test(productHandle)
  ) {
    return null;
  }

  return {
    href: null,
    imageAlt: null,
    imageUrl: null,
    name: null,
    productGid,
    productHandle,
    provider: "shopify",
  };
}

function resolveArtifactProduct(
  artifact: MemberArtifactSummary,
  products: Product[],
): MemberArtifactSummary {
  if (!artifact.product) return artifact;
  const liveProduct = products.find(
    (product) => product.shopifyProductGid === artifact.product?.productGid,
  );
  if (!liveProduct) return artifact;

  const imageUrl = safeProductImageUrl(liveProduct.image?.url);
  return {
    ...artifact,
    imageUrl: imageUrl ?? artifact.imageUrl,
    product: {
      ...artifact.product,
      href: `/store/${encodeURIComponent(liveProduct.id)}`,
      imageAlt: imageUrl ? liveProduct.image?.alt || liveProduct.name : null,
      imageUrl,
      name: liveProduct.name,
      productHandle: liveProduct.id,
    },
  };
}

export function resolveMemberArtifactProducts(
  snapshot: MemberArtifactsSnapshot,
  products: Product[],
): MemberArtifactsSnapshot {
  return {
    ...snapshot,
    awards: snapshot.awards.map((artifact) => resolveArtifactProduct(artifact, products)),
  };
}

export function resolveMemberHomeArtifactProducts(
  snapshot: MemberHomeSnapshot,
  products: Product[],
): MemberHomeSnapshot {
  const artifacts = snapshot.artifacts.map((artifact) =>
    resolveArtifactProduct(artifact, products),
  );
  return {
    ...snapshot,
    artifact: snapshot.artifact
      ? resolveArtifactProduct(snapshot.artifact, products)
      : null,
    artifacts,
  };
}
