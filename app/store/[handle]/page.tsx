import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductDetail from "@/components/store/ProductDetail";
import ProductDescription from "@/components/store/ProductDescription";
import {
  type Product,
  type ProductImage,
} from "@/data/products";
import { SITE_URL } from "@/lib/site";
import { getProducts } from "@/lib/shopify";
import { privateSharingMetadata, sharingMetadata } from "@/lib/sharing";
import { getProductColorHref, getProductColorImages, getProductColorOption } from "@/lib/store/product-colors";

// Product visibility can change independently of a Vercel deployment. Resolve
// the active Headless catalogue at request time rather than from build output.
export const dynamic = "force-dynamic";

type ProductPageProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ color?: string | string[] }>;
};

function selectedColor(product: Product, requested?: string | string[]): string | undefined {
  const color = getProductColorOption(product);
  return typeof requested === "string" && color?.values.includes(requested)
    ? requested
    : color?.values[0];
}

function editorialImages(product: Product, color?: string): ProductImage[] {
  return getProductColorImages(product, color).slice(0, 2);
}

export async function generateMetadata({
  params,
  searchParams,
}: ProductPageProps): Promise<Metadata> {
  const { handle } = await params;
  const product = (await getProducts()).find((item) => item.id === handle);
  if (!product) return privateSharingMetadata;

  const color = selectedColor(product, (await searchParams).color);
  return {
    title: product.name,
    description: product.description,
    alternates: { canonical: `/store/${handle}` },
    ...sharingMetadata({
      title: product.name,
      description: product.description,
      path: getProductColorHref(product, color),
    }),
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: ProductPageProps) {
  const { handle } = await params;
  const product = (await getProducts()).find((item) => item.id === handle);
  if (!product) notFound();

  const color = selectedColor(product, (await searchParams).color);
  const images = editorialImages(product, color);
  const colorOption = getProductColorOption(product);
  const variants = product.variants.filter((variant) => !color || variant.selectedOptions.some(
    (option) => option.name === colorOption?.name && option.value === color
  ));
  const hasAvailableVariant = variants.some((variant) => variant.available);
  const hasOnlineVariant = variants.some((variant) =>
    variant.id.startsWith("gid://shopify/ProductVariant/")
  );

  const amounts = variants
    .map((variant) => Number(variant.priceAmount))
    .filter(Number.isFinite);
  const currencyCode = variants[0]?.currencyCode;
  const availability = !hasAvailableVariant
    ? "https://schema.org/OutOfStock"
    : product.expectedShipDate
      ? "https://schema.org/PreOrder"
      : "https://schema.org/InStock";
  const productUrl = `${SITE_URL}${getProductColorHref(product, color)}`;
  const offer = hasOnlineVariant && currencyCode && amounts.length
    ? {
        "@type": "AggregateOffer",
        url: productUrl,
        priceCurrency: currencyCode,
        lowPrice: Math.min(...amounts).toFixed(2),
        highPrice: Math.max(...amounts).toFixed(2),
        offerCount: variants.length,
        availability,
      }
    : undefined;
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.code,
    ...(color ? { color } : {}),
    url: productUrl,
    brand: { "@type": "Brand", name: "Ruined" },
    ...(images.length ? { image: images.map((image) => image.url) } : {}),
    ...(offer ? { offers: offer } : {}),
  };

  return (
    <main className="min-h-screen bg-black px-5 pb-24 pt-10 text-[var(--color-bone)] sm:px-10 sm:pt-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <div className="mx-auto max-w-6xl">
        <div className="flex justify-between gap-5 font-mono text-[0.64rem] uppercase tracking-[0.24em] text-white/45">
          <Link href="/store" className="transition-colors hover:text-white">
            ← Store index
          </Link>
          <span>{product.code}</span>
        </div>

        <ProductDetail key={product.id} product={product}>
          <ProductDescription
            description={product.description}
            descriptionHtml={product.descriptionHtml}
            expectedShipDate={product.expectedShipDate}
          />
        </ProductDetail>
      </div>
    </main>
  );
}
