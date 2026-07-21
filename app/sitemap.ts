import type { MetadataRoute } from "next";
import { PRODUCTS } from "@/data/products";
import { PROJECTS, projectSlug } from "@/data/projects";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ruined.studio";
  const paths = [
    "", "/store", ...PRODUCTS.map((product) => `/store/${product.id}`),
    "/work", ...PROJECTS.map((project) => `/work/${projectSlug(project)}`),
    "/about", "/contact", "/shipping-returns", "/terms", "/privacy",
  ];
  return paths.map((path, index) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: index < 6 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : 0.8,
  }));
}
