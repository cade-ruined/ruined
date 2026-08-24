import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { getProducts, getShopPolicies } from "@/lib/shopify";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ shipping, returns, terms }, products] = await Promise.all([
    getShopPolicies(),
    getProducts(),
  ]);
  const routes: Array<{
    path: string;
    changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
    priority: number;
  }> = [
    { path: "", changeFrequency: "weekly", priority: 1 },
    { path: "/about", changeFrequency: "monthly", priority: 0.9 },
    { path: "/community", changeFrequency: "weekly", priority: 0.9 },
    { path: "/store", changeFrequency: "weekly", priority: 0.9 },
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
  ];
}
