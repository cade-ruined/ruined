import "server-only";
import { getOperatorRole } from "@/lib/platform/repository";
import { getArtifactShopifyProduct } from "@/lib/shopify";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export async function requireArtifactCatalogAdmin(authUserId: string) {
  if (await getOperatorRole(authUserId) !== "ops_admin") {
    throw new OpsOperatingRepositoryError("forbidden", "Only Administrators can select Artifact products.");
  }
}

export async function verifyArtifactShopifySelection(authUserId: string, productGid: unknown, productHandle: unknown) {
  await requireArtifactCatalogAdmin(authUserId);
  if (typeof productGid !== "string" || !/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(productGid)
    || typeof productHandle !== "string" || productHandle.length > 255 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(productHandle)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose a Shopify product first.");
  }
  // Provider work happens before (not during) the repository's locked transaction.
  // The repository rechecks current Administrator access when saving.
  const product = await getArtifactShopifyProduct(productGid);
  if (!product || product.id !== productGid || product.handle !== productHandle) {
    throw new OpsOperatingRepositoryError("conflict", "This product changed or is not published to the storefront. Search and select it again.");
  }
  return product;
}
