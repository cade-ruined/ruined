import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import ProductPurchase from "@/components/store/ProductPurchase";
import {
  PRODUCT_TONES,
  type Product,
  type ProductImage,
} from "@/data/products";
import { SITE_URL } from "@/lib/site";
import { getProducts } from "@/lib/shopify";

// Product visibility can change independently of a Vercel deployment. Resolve
// the active Headless catalogue at request time rather than from build output.
export const dynamic = "force-dynamic";

function editorialImages(product: Product): ProductImage[] {
  const images = product.images?.length
    ? product.images
    : product.image
      ? [product.image]
      : [];

  return Array.from(new Map(images.map((image) => [image.url, image])).values()).slice(0, 2);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const product = (await getProducts()).find((item) => item.id === handle);
  if (!product) return {};

  const images = editorialImages(product);
  return {
    title: product.name,
    description: product.description,
    alternates: { canonical: `/store/${handle}` },
    openGraph: {
      title: `${product.name} — Ruined`,
      description: product.description,
      images: images.length ? images.map((image) => image.url) : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const product = (await getProducts()).find((item) => item.id === handle);
  if (!product) notFound();

  const images = editorialImages(product);
  const hasAvailableVariant = product.variants.some((variant) => variant.available);
  const hasOnlineVariant = product.variants.some((variant) =>
    variant.id.startsWith("gid://shopify/ProductVariant/")
  );
  const status = !hasAvailableVariant
    ? "Sold out"
    : product.expectedShipDate
      ? "Preorder — pay in full"
      : hasOnlineVariant
        ? "Available"
        : "Studio confirmation";
  const specs = [
    { label: "Material", value: product.material },
    { label: "Origin", value: product.origin },
    { label: "Care", value: product.care },
    { label: "Status", value: status },
  ].filter((spec) => spec.value.trim());

  const amounts = product.variants
    .map((variant) => Number(variant.priceAmount))
    .filter(Number.isFinite);
  const currencyCode = product.variants[0]?.currencyCode;
  const availability = !hasAvailableVariant
    ? "https://schema.org/OutOfStock"
    : product.expectedShipDate
      ? "https://schema.org/PreOrder"
      : "https://schema.org/InStock";
  const productUrl = `${SITE_URL}/store/${encodeURIComponent(product.id)}`;
  const offer = hasOnlineVariant && currencyCode && amounts.length
    ? {
        "@type": "AggregateOffer",
        url: productUrl,
        priceCurrency: currencyCode,
        lowPrice: Math.min(...amounts).toFixed(2),
        highPrice: Math.max(...amounts).toFixed(2),
        offerCount: product.variants.length,
        availability,
      }
    : undefined;
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.code,
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

        <div className="mt-10 grid gap-10 md:grid-cols-12 md:gap-14">
          <div className="grid gap-3 md:col-span-7 sm:gap-5">
            {images.length ? (
              images.map((image, index) => (
                <div
                  key={image.url}
                  className="relative aspect-[4/5] overflow-hidden"
                  style={{ background: PRODUCT_TONES[product.tone] }}
                >
                  <Image
                    src={image.url}
                    alt={image.alt}
                    fill
                    priority={index === 0}
                    sizes="(min-width: 768px) 58vw, 100vw"
                    className="object-cover"
                  />
                </div>
              ))
            ) : (
              <div
                className="aspect-[4/5]"
                aria-hidden="true"
                style={{ background: PRODUCT_TONES[product.tone] }}
              />
            )}
          </div>

          <article className="self-start md:sticky md:top-28 md:col-span-5 md:pt-8">
            {product.subtitle && (
              <p className="font-mono text-[0.64rem] uppercase tracking-[0.28em] text-[var(--color-poster)]">
                {product.subtitle}
              </p>
            )}
            <h1 className="display mt-4 text-[clamp(3rem,7vw,5.5rem)] leading-[0.9]">
              {product.name}
            </h1>

            <ProductPurchase product={product} />

            {product.description && (
              <p className="mt-10 max-w-prose border-t border-white/15 pt-7 text-base leading-relaxed text-white/70">
                {product.description}
              </p>
            )}

            {specs.length > 0 && (
              <dl className="mt-8 space-y-3 border-y border-white/15 py-6 font-mono text-[0.64rem] uppercase tracking-[0.16em]">
                {specs.map((spec) => (
                  <Row key={spec.label} label={spec.label} value={spec.value} />
                ))}
              </dl>
            )}
          </article>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <dt className="text-white/40">{label}</dt>
      <dd className="col-span-2">{value}</dd>
    </div>
  );
}
