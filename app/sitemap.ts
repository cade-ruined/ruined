import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { getProducts, getShopPolicies } from "@/lib/shopify";
import { getPublicCommunityEvents } from "@/lib/events/community-event-repository";
import { publicEventHref } from "@/lib/events/public-event-page";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ shipping, returns, terms }, products, events] = await Promise.all([
    getShopPolicies(),
    getProducts(),
    getPublicCommunityEvents(),
  ]);
  const routes: Array<{
    path: string;
    changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
    priority: number;
  }> = [
    { path: "", changeFrequency: "weekly", priority: 1 },
    { path: "/store", changeFrequency: "weekly", priority: 0.9 },
    { path: "/about", changeFrequency: "monthly", priority: 0.9 },
    { path: "/community", changeFrequency: "weekly", priority: 0.9 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.6 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
    ...(terms
      ? [{ path: "/terms", changeFrequency: "yearly", priority: 0.4 } as const]
      : []),
    ...(shipping || returns
      ? [{ path: "/shipping-returns", changeFrequency: "yearly", priority: 0.4 } as const]
      : []),
  ];

  return [
    ...routes.map(({ path, changeFrequency, priority }) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency,
      priority,
    })),
    ...products.map((product) => ({
      url: `${SITE_URL}/store/${encodeURIComponent(product.id)}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...events.map((event) => ({
      url: `${SITE_URL}${publicEventHref(event.id)}`,
      changeFrequency: event.status === "Ended" ? "monthly" as const : "weekly" as const,
      priority: event.status === "Ended" ? 0.6 : 0.8,
    })),
  ];
}
