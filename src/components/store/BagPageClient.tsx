"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Product } from "@/data/products";
import { isShopifyVariantId, type BagItem, useBag } from "./bag-store";

type DisplayBagItem = BagItem & {
  canonical: boolean;
  available: boolean;
};

function resolveBagItems(items: BagItem[], products: Product[]): DisplayBagItem[] {
  const variants = new Map(
    products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, { product, variant }] as const)
    )
  );

  return items.map((item) => {
    const current = variants.get(item.variantId);
    if (!current) return { ...item, canonical: false, available: false };

    return {
      ...item,
      productId: current.product.id,
      productName: current.product.name,
      productCode: current.product.code,
      variantTitle: current.variant.title,
      selectedOptions: current.variant.selectedOptions,
      unitPrice: current.variant.price,
      priceAmount: current.variant.priceAmount,
      currencyCode: current.variant.currencyCode,
      image: current.product.image,
      expectedShipDate: current.product.expectedShipDate,
      canonical: true,
      available: current.variant.available,
    };
  });
}

function formatTotal(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

function formatPriceForSentence(price: string): string {
  return price.replace(/^([£$€])\s+/, "$1");
}

function formatExpectedShipDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default function BagPageClient({
  email,
  products,
}: {
  email: string;
  products: Product[];
}) {
  const { items, count, hydrated, setQuantity, remove, clear } = useBag();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const displayItems = useMemo(() => resolveBagItems(items, products), [items, products]);
  const currencies = new Set(displayItems.map((item) => item.currencyCode));
  const currency = currencies.size === 1 ? displayItems[0]?.currencyCode : undefined;
  const total = displayItems.reduce(
    (sum, item) => sum + Number(item.priceAmount || 0) * item.quantity,
    0
  );
  const hasChangedItem = displayItems.some((item) => !item.canonical || !item.available);
  const canCheckout = displayItems.length > 0 && displayItems.every(
    (item) => item.canonical && item.available && isShopifyVariantId(item.variantId)
  );
  const preorderShipDates = Array.from(
    new Set(
      displayItems.flatMap((item) => {
        const formatted = formatExpectedShipDate(item.expectedShipDate);
        return formatted ? [formatted] : [];
      })
    )
  );
  const enquiryHref = useMemo(() => {
    const body = [
      "I would like to enquire about this bag:",
      "",
      ...displayItems.map((item) => {
        const options = item.selectedOptions.map((option) => `${option.name}: ${option.value}`).join(", ");
        const preorder = item.expectedShipDate
          ? ` — Preorder — pay in full; expected to ship ${formatExpectedShipDate(item.expectedShipDate)}`
          : "";
        return `${item.quantity} × ${item.productName}${options ? ` (${options})` : ""} — ${item.unitPrice}${preorder}`;
      }),
    ].join("\n");
    return `mailto:${email}?subject=${encodeURIComponent("Ruined bag enquiry")}&body=${encodeURIComponent(body)}`;
  }, [displayItems, email]);

  async function beginCheckout() {
    if (!canCheckout || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: displayItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        }),
      });
      const payload = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Checkout is temporarily unavailable.");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Checkout is temporarily unavailable.");
      setSubmitting(false);
    }
  }

  if (!hydrated) {
    return <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/45">Opening bag…</p>;
  }

  if (!items.length) {
    return (
      <div className="border-y border-white/15 py-16 text-center sm:py-24">
        <p className="display text-4xl sm:text-6xl">The bag is empty.</p>
        <Link href="/store" className="mt-8 inline-flex border border-white px-6 py-4 font-mono text-[0.62rem] uppercase tracking-[0.24em] transition-colors hover:bg-white hover:text-black">
          View all pieces
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
      <section aria-label="Bag items" className="border-t border-white/15 lg:col-span-8">
        {displayItems.map((item) => (
          <article key={item.key} className="grid grid-cols-[6.5rem_1fr] gap-4 border-b border-white/15 py-5 sm:grid-cols-[9rem_1fr] sm:gap-7 sm:py-7">
            <Link href={`/store/${item.productId}`} className="relative aspect-[4/5] overflow-hidden bg-white/5">
              {item.image && (
                <Image src={item.image.url} alt={item.image.alt} fill sizes="144px" className="object-cover" />
              )}
            </Link>
            <div className="flex min-w-0 flex-col justify-between gap-5">
              <div>
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
                  <div>
                    <p className="font-mono text-[0.52rem] uppercase tracking-[0.22em] text-white/40">{item.productCode}</p>
                    <Link href={`/store/${item.productId}`} className="display mt-2 block text-2xl leading-none transition-colors hover:text-[var(--color-poster)] sm:text-4xl">{item.productName}</Link>
                  </div>
                  <p className="display shrink-0 text-lg sm:text-2xl">{item.unitPrice}</p>
                </div>
                <p className="mt-3 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/50">
                  {item.selectedOptions.map((option) => `${option.name} · ${option.value}`).join(" / ") || item.variantTitle}
                </p>
                {item.expectedShipDate && (
                  <div className="mt-4 border-l border-[var(--color-poster)] pl-3">
                    <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-[var(--color-poster)]">
                      Preorder — pay in full
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">
                      Pay {formatPriceForSentence(item.unitPrice)} now. Expected to ship {formatExpectedShipDate(item.expectedShipDate)}.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex h-11 items-center border border-white/25" role="group" aria-label={`Quantity for ${item.productName}`}>
                  <button type="button" onClick={() => setQuantity(item.key, item.quantity - 1)} className="h-11 w-11 text-lg hover:bg-white hover:text-black" aria-label="Decrease quantity">−</button>
                  <span className="w-9 text-center font-mono text-xs tabular-nums" aria-live="polite">{item.quantity}</span>
                  <button type="button" onClick={() => setQuantity(item.key, item.quantity + 1)} className="h-11 w-11 text-lg hover:bg-white hover:text-black" aria-label="Increase quantity">+</button>
                </div>
                <button type="button" onClick={() => remove(item.key)} className="inline-flex min-h-11 min-w-11 items-center justify-center font-mono text-[0.6rem] uppercase tracking-[0.16em] text-white/65 underline decoration-white/30 underline-offset-4 hover:text-white">Remove</button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <aside className="lg:col-span-4">
        <div className="border border-white/20 p-6 lg:sticky lg:top-32">
          <div className="flex justify-between font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/55">
            <span>{count} {count === 1 ? "piece" : "pieces"}</span>
            <button type="button" onClick={clear} className="inline-flex min-h-11 min-w-11 items-center justify-end underline decoration-white/30 underline-offset-4 hover:text-white">Clear</button>
          </div>
          {currency && (
            <div className="mt-8 flex items-baseline justify-between border-t border-white/15 pt-5">
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/55">Subtotal</span>
              <span className="display text-3xl">{formatTotal(total, currency)}</span>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-white/65">
            {preorderShipDates.length === 1
              ? `Preorders are paid in full now and expected to ship ${preorderShipDates[0]}. `
              : preorderShipDates.length > 1
                ? "Preorders are paid in full now; expected ship dates are shown with each item. "
                : ""}
            Shipping and taxes are calculated at checkout.
          </p>

          {canCheckout ? (
            <button type="button" onClick={beginCheckout} disabled={submitting} className="mt-7 min-h-11 w-full border border-white bg-white px-5 py-4 font-mono text-xs uppercase tracking-[0.28em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50">
              <span aria-live="polite">{submitting ? "Preparing secure checkout…" : "Secure checkout"}</span>
            </button>
          ) : (
            <a href={enquiryHref} className="mt-7 block w-full border border-white bg-white px-5 py-4 text-center font-mono text-xs uppercase tracking-[0.28em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white">
              Send bag to studio
            </a>
          )}
          {error && <p role="alert" className="mt-4 text-xs leading-relaxed text-[var(--color-poster)]">{error}</p>}
          {!canCheckout && (
            <p className="mt-4 text-xs leading-relaxed text-white/65">
              {hasChangedItem
                ? "One or more selections changed. Remove the affected piece and choose its current version before checkout."
                : "Online payment is not open for these pieces yet. Your exact selections are included in the enquiry."}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
