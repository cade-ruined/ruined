import "server-only";
import { unstable_cache } from "next/cache";
import { createStorefrontApiClient } from "@shopify/storefront-api-client";
import type { ShopifyAnalyticsConfig } from "./shopify";

const SHOP_METADATA_QUERY = `query StorefrontAnalyticsMetadata {
  shop { id }
  localization { country { currency { isoCode } } language { isoCode } }
}`;

type ShopMetadata = {
  shop?: { id?: string };
  localization?: { country?: { currency?: { isoCode?: string } }; language?: { isoCode?: string } };
};

/** Only public shop metadata crosses the server/client boundary. */
export async function publicStorefrontAnalyticsConfig(
  environment: Record<string, string | undefined> = process.env,
): Promise<ShopifyAnalyticsConfig | null> {
  if (environment.STOREFRONT_ANALYTICS_ENABLED !== "true") return null;
  const domain = environment.SHOPIFY_STORE_DOMAIN?.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, "");
  const token = environment.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();
  if (!domain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)
    || !token || !/^[a-f0-9]{32}$/i.test(token)) return null;
  const configuredVersion = environment.SHOPIFY_API_VERSION?.trim() || "2026-07";
  if (!/^\d{4}-(?:01|04|07|10)$/.test(configuredVersion)) return null;
  const apiVersion = configuredVersion < "2025-10" ? "2025-10" : configuredVersion;

  try {
    // This cache contains no visitor state and is scoped to the store/version.
    // Failed lookups throw inside the cache so temporary outages are not cached.
    return await unstable_cache(async () => {
      const client = createStorefrontApiClient({
        storeDomain: domain, publicAccessToken: token, apiVersion, retries: 0,
        customFetchApi: (input, options) => fetch(input, {
          ...options, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
        }),
      });
      const { data, errors } = await client.request<ShopMetadata>(SHOP_METADATA_QUERY);
      const shopId = data?.shop?.id;
      const currency = data?.localization?.country?.currency?.isoCode;
      const acceptedLanguage = data?.localization?.language?.isoCode;
      if (errors || !shopId || !/^gid:\/\/shopify\/Shop\/\d+$/.test(shopId)
        || !currency || !/^[A-Z]{3}$/.test(currency)
        || !acceptedLanguage || !/^[A-Z]{2}(?:_[A-Z]{2})?$/.test(acceptedLanguage)) {
        throw new Error("Storefront analytics metadata is unavailable.");
      }
      return { shopId, currency, acceptedLanguage };
    }, ["storefront-analytics-shop-v1", domain, apiVersion], { revalidate: 3600 })();
  } catch {
    // Analytics configuration must not prevent the storefront from rendering.
    return null;
  }
}
