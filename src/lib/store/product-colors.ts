import type { Product, ProductImage, ProductOption, ProductVariant } from "@/data/products";

export type CatalogEntry = {
  key: string;
  product: Product;
  color?: string;
  href: string;
  images: ProductImage[];
  available: boolean;
  price: string;
};

export function getProductColorOption(product: Product): ProductOption | undefined {
  return product.options?.find((option) => /^colou?r$/i.test(option.name.trim()));
}

function resolveColor(product: Product, color?: string): string | undefined {
  if (!color) return undefined;
  return getProductColorOption(product)?.values.find(
    (value) => value.toLowerCase() === color.trim().toLowerCase(),
  );
}

function distinctImages(images: (ProductImage | undefined)[]): ProductImage[] {
  const seen = new Set<string>();
  return images.filter((image): image is ProductImage => {
    if (!image) return false;
    const identity = imageIdentity(image);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function imageIdentity(image: ProductImage): string {
  try {
    const url = new URL(image.url, "https://theruinedproject.com");
    return `${url.origin}${url.pathname}`;
  } catch {
    return image.url;
  }
}

function productImages(product: Product): ProductImage[] {
  return distinctImages([product.image, ...(product.images ?? [])]);
}

function colorVariants(product: Product, color: string): ProductVariant[] {
  const option = getProductColorOption(product);
  return product.variants.filter((variant) => variant.selectedOptions.some(
    (selection) => selection.name === option?.name && selection.value === color,
  ));
}

function filename(image: ProductImage): string | undefined {
  try {
    return decodeURIComponent(new URL(image.url, "https://theruinedproject.com").pathname.split("/").pop() ?? "");
  } catch {
    return undefined;
  }
}

function sundayClothesPhoto(product: Product, image: ProductImage) {
  if (product.id !== "sunday-clothes-hoodie") return undefined;
  const match = /^SundayClothes-(Black|Blue|Grey|Red)Hoodie(Front|Back)\.png$/.exec(filename(image) ?? "");
  return match ? { color: match[1], view: match[2] } : undefined;
}

function colorImageLabel(product: Product, image: ProductImage): ProductImage {
  const photo = sundayClothesPhoto(product, image);
  return photo && (!image.alt.trim() || image.alt.trim() === product.name)
    ? { ...image, alt: `${product.name} — ${photo.color}, ${photo.view.toLowerCase()}` }
    : image;
}

function associatedVariantImage(product: Product, variant: ProductVariant, color: string): ProductImage | undefined {
  const image = variant.image;
  if (!image) return undefined;
  const photo = sundayClothesPhoto(product, image);
  if (photo) return photo.color.toLowerCase() === color.toLowerCase() ? colorImageLabel(product, image) : undefined;
  const cover = product.image ?? product.images?.[0];
  // Storefront variant.image falls back to the product cover when unassigned.
  // A shared cover therefore cannot establish a multi-color association.
  if (getProductColorOption(product)!.values.length > 1 && cover && imageIdentity(image) === imageIdentity(cover)) return undefined;
  return image;
}

function sundayClothesImages(product: Product, color: string): ProductImage[] {
  // These eight uploaded filenames are verified color associations. Never
  // infer another product's color from a substring or the global image order.
  if (product.id !== "sunday-clothes-hoodie") return [];
  const knownColor = ["Black", "Blue", "Grey", "Red"].find(
    (value) => value.toLowerCase() === color.toLowerCase(),
  );
  if (!knownColor) return [];
  const images = productImages(product);
  return ["Front", "Back"].flatMap((view) => {
    const image = images.find((candidate) => filename(candidate) === `SundayClothes-${knownColor}Hoodie${view}.png`);
    return image ? [colorImageLabel(product, image)] : [];
  });
}

export function getProductColorImages(product: Product, color?: string): ProductImage[] {
  const resolvedColor = resolveColor(product, color);
  if (!resolvedColor) return productImages(product);
  // A one-color garment's full editorial sequence is unambiguous, including
  // when Shopify returns its cover as the fallback for every variant.
  const singleColorImages = getProductColorOption(product)?.values.length === 1 ? productImages(product) : [];
  return distinctImages([
    ...colorVariants(product, resolvedColor).map((variant) => associatedVariantImage(product, variant, resolvedColor)),
    ...sundayClothesImages(product, resolvedColor),
    ...singleColorImages,
  ]);
}

export function getProductColorHref(product: Product, color?: string): string {
  const base = `/store/${encodeURIComponent(product.id)}`;
  const resolvedColor = resolveColor(product, color);
  return resolvedColor ? `${base}?color=${encodeURIComponent(resolvedColor)}` : base;
}

export function getVariantImage(product: Product, variant?: ProductVariant): ProductImage | undefined {
  if (!variant) return productImages(product)[0];
  const option = getProductColorOption(product);
  if (!option) return variant.image ?? productImages(product)[0];
  const color = variant.selectedOptions.find((selection) => selection.name === option.name)?.value;
  const resolvedColor = resolveColor(product, color);
  if (!resolvedColor) return option.values.length === 1 ? variant.image ?? productImages(product)[0] : undefined;
  return associatedVariantImage(product, variant, resolvedColor) ?? getProductColorImages(product, resolvedColor)[0];
}

export function getCatalogEntries(products: Product[]): CatalogEntry[] {
  return products.flatMap((product) => {
    const option = getProductColorOption(product);
    const colors = option && option.values.length > 1 ? option.values : [undefined];
    return colors.map((color) => {
      const variants = color ? colorVariants(product, color) : product.variants;
      const priced = variants.filter((variant) => Number.isFinite(Number(variant.priceAmount)));
      const leastExpensive = priced.reduce<ProductVariant | undefined>((lowest, variant) =>
        !lowest || Number(variant.priceAmount) < Number(lowest.priceAmount) ? variant : lowest,
      undefined);
      return {
        key: color ? `${product.id}:${encodeURIComponent(color)}` : product.id,
        product,
        ...(color ? { color } : {}),
        href: getProductColorHref(product, color),
        images: getProductColorImages(product, color),
        available: variants.some((variant) => variant.available),
        price: color ? leastExpensive?.price ?? product.price : product.price,
      };
    });
  });
}
