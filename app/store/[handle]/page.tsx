import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProducts } from "@/lib/shopify";
import { PRODUCT_TONES } from "@/data/products";
import ProductPurchase from "@/components/store/ProductPurchase";

export async function generateStaticParams() {
  return (await getProducts()).map((product) => ({ handle: product.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const product = (await getProducts()).find((item) => item.id === handle);
  if (!product) return {};
  return { title: product.name, description: product.description, alternates: { canonical: `/store/${handle}` }, openGraph: { title: `${product.name} — Ruined`, description: product.description, images: product.image ? [product.image.url] : undefined } };
}

export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const product = (await getProducts()).find((item) => item.id === handle);
  if (!product) notFound();
  const hasAvailableVariant = product.variants.some((variant) => variant.available);
  const hasShopifyVariant = product.variants.some((variant) => variant.id.startsWith("gid://shopify/ProductVariant/"));
  const status = !hasAvailableVariant
    ? "Sold out"
    : hasShopifyVariant
      ? "Available"
      : "Studio confirmation";
  return (
    <main className="min-h-screen bg-black px-6 pb-24 pt-10 text-[var(--color-bone)] sm:px-10 sm:pt-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex justify-between font-mono text-[0.58rem] uppercase tracking-[0.3em] text-white/45"><Link href="/#store">← Store index</Link><span>{product.code}</span></div>
        <div className="mt-10 grid gap-10 md:grid-cols-12 md:gap-14">
          <div className="relative aspect-[4/5] overflow-hidden md:col-span-7" style={{ background: PRODUCT_TONES[product.tone] }}>{product.image && <Image src={product.image.url} alt={product.image.alt} fill priority sizes="(min-width: 768px) 58vw, 100vw" className="object-cover" />}</div>
          <article className="md:col-span-5 md:pt-8"><p className="font-mono text-[0.6rem] uppercase tracking-[0.3em] text-[var(--color-poster)]">{product.subtitle}</p><h1 className="display mt-4 text-[clamp(3rem,7vw,5.5rem)] leading-[0.9]">{product.name}</h1><p className="mt-7 max-w-prose text-base leading-relaxed text-white/70">{product.description}</p>
            <dl className="mt-8 space-y-3 border-y border-white/15 py-6 font-mono text-[0.62rem] uppercase tracking-[0.18em]"><Row label="Material" value={product.material}/><Row label="Origin" value={product.origin}/><Row label="Care" value={product.care}/><Row label="Status" value={status}/></dl>
            <ProductPurchase product={product} />
          </article>
        </div>
      </div>
    </main>
  );
}

function Row({label,value}:{label:string;value:string}) { return <div className="grid grid-cols-3 gap-3"><dt className="text-white/40">{label}</dt><dd className="col-span-2">{value}</dd></div>; }
