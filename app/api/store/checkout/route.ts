import { handleShopifyCartRequest } from "@/lib/store/shopify-cart";

export async function POST(request: Request) {
  return handleShopifyCartRequest(request, { checkout: true });
}
