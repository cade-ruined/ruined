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
import { getProducts, getShopPolicies } from "@/lib/shopify";
import { sharingMetadata } from "@/lib/sharing";
import { getProductColorHref, getProductColorImages, getProductColorOption } from "@/lib/store/product-colors";
import { requestedProductVariant } from "@/lib/store/product-links";
import { productMetadataDescription, productOffers } from "@/lib/store/product-metadata";
import { merchantReturnPolicy } from "@/lib/store/return-policy";

// Product visibility can change independently of a Vercel deployment. Resolve
// the active Headless catalogue at request time rather than from build output.
export const dynamic = "force-dynamic";

type ProductSearchParams = { color?: string | string[]; variant?: string | string[] };
type ProductPageProps = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<ProductSearchParams>;
};

function selectedColor(product: Product, search: ProductSearchParams): string | undefined {
  const color = getProductColorOption(product);
  const variant = requestedProductVariant(product, typeof search.variant === "string" ? search.variant : null);
  const requested = variant?.selectedOptions.find((option) => option.name === color?.name)?.value ?? search.color;
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
  if (!product) notFound();

  const color = selectedColor(product, await searchParams);
  const description = productMetadataDescription(product);
  return {
    title: product.name,
    description,
    alternates: { canonical: `/store/${handle}` },
    ...sharingMetadata({
      title: product.name,
      description,
      path: getProductColorHref(product, color),
      image: getProductColorImages(product, color)[0],
    }),
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: ProductPageProps) {
  const { handle } = await params;
  const [products, policies] = await Promise.all([getProducts(), getShopPolicies()]);
  const product = products.find((item) => item.id === handle);
  if (!product) notFound();

  const color = selectedColor(product, await searchParams);
  const images = editorialImages(product, color);
  const colorOption = getProductColorOption(product);
  const variants = product.variants.filter((variant) => !color || variant.selectedOptions.some(
    (option) => option.name === colorOption?.name && option.value === color
  ));
  const productUrl = `${SITE_URL}${getProductColorHref(product, color)}`;
  const returnPolicy = merchantReturnPolicy(policies, SITE_URL);
  const offers = productOffers({ variants, productUrl, expectedShipDate: product.expectedShipDate, returnPolicyId: returnPolicy?.["@id"] });
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
    ...(offers.length ? { offers } : {}),
  };

  return (
    <main className="min-h-screen bg-[var(--color-bone)] px-5 pb-24 pt-6 text-[var(--color-faded)] sm:px-10 sm:pt-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 font-mono text-xs uppercase tracking-[0.12em] text-black/65">
          <Link href="/store" className="inline-flex min-h-11 items-center transition-colors hover:text-black">
            ← Back to the store
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
