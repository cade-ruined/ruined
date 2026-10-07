import type { Product, ProductImage, ProductOption } from "@/data/products";

export function getProductFitOption(product: Product): ProductOption | undefined {
  return product.id === "byob-tank"
    ? product.options.find((option) => option.name === "Fit")
    : undefined;
}

function byobPhoto(image: ProductImage): { fit: string; view: string } | undefined {
  const label = /^BYOB Tank\s*[—–-]\s*(Men's|Women's)\s*[—–-]\s*(back|front)$/i.exec(image.alt.trim());
  if (label) return { fit: label[1].toLowerCase(), view: label[2].toLowerCase() };
  try {
    const filename = decodeURIComponent(new URL(image.url, "https://theruinedproject.com").pathname.split("/").pop() ?? "");
    const knownFile = /^byob[ _-]tank[ _-](mens|womens)[ _-](back|front)\.png$/i.exec(filename);
    return knownFile ? { fit: knownFile[1].toLowerCase().replace(/s$/, "'s"), view: knownFile[2].toLowerCase() } : undefined;
  } catch {
    return undefined;
  }
}

/** BYOB's two cuts require their own photographs; never borrow the other fit's cover. */
export function getProductFitImages(product: Product, fit?: string): ProductImage[] | undefined {
  const option = getProductFitOption(product);
  if (!option || !fit || !option.values.includes(fit)) return undefined;
  const images = product.images?.length ? product.images : product.image ? [product.image] : [];
  return ["back", "front"].flatMap((view) => {
    const image = images.find((candidate) => {
      const photo = byobPhoto(candidate);
      return photo?.fit === fit.toLowerCase() && photo.view === view;
    });
    return image ? [image] : [];
  });
}
