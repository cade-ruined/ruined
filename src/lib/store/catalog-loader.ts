import type { Product } from "@/data/products";
import type { CatalogResult } from "./catalog";

export const CATALOG_REQUEST_TIMEOUT_MS = 5000;

type CatalogResponse<Node> = {
  data?: { products?: { nodes?: Node[] | null } | null } | null;
  errors?: unknown;
};

/** A failed read is never interpreted as a deliberately empty catalog. */
export async function loadCatalog<Node>(
  request: ((signal: AbortSignal) => Promise<CatalogResponse<Node>>) | null,
  mapProduct: (node: Node, index: number) => Product,
  timeoutMs = CATALOG_REQUEST_TIMEOUT_MS,
): Promise<CatalogResult> {
  if (!request) return { status: "unconfigured", products: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { data, errors } = await request(controller.signal);
    const nodes = data?.products?.nodes;
    if (controller.signal.aborted || errors || !Array.isArray(nodes)) {
      return { status: "unavailable", products: [] };
    }
    if (!nodes.length) return { status: "empty", products: [] };
    return { status: "ready", products: nodes.map(mapProduct) };
  } catch {
    return { status: "unavailable", products: [] };
  } finally {
    clearTimeout(timeout);
  }
}
