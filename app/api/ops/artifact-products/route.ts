import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, opsRepositoryErrorResponse } from "@/lib/platform/ops-api";
import { requireArtifactCatalogAdmin } from "@/lib/platform/ops-artifact-products";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { searchArtifactShopifyProducts } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return opsJson({ error: "Sign in with your operator account." }, 401);
  try {
    await requireArtifactCatalogAdmin(viewer.authUserId);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    if (query.length > 100) return opsJson({ error: "Use a shorter product name." }, 400);
    return opsJson(await searchArtifactShopifyProducts(query));
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    return opsJson({ error: "Shopify products could not be loaded. Try again. If this continues, ask your system owner to check the Shopify connection." }, 503);
  }
}
