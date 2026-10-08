import { proxyShopifyConsent } from "@/lib/marketing/shopify-consent-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return proxyShopifyConsent(request, process.env);
}
