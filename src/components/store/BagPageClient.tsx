"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { isShopifyVariantId, useBag } from "./bag-store";

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

export default function BagPageClient({ email }: { email: string }) {
  const { items, count, hydrated, setQuantity, remove, clear } = useBag();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const currencies = new Set(items.map((item) => item.currencyCode));
  const currency = currencies.size === 1 ? items[0]?.currencyCode : undefined;
  const total = items.reduce(
    (sum, item) => sum + Number(item.priceAmount || 0) * item.quantity,
    0
  );
  const canCheckout = items.length > 0 && items.every((item) => isShopifyVariantId(item.variantId));
  const enquiryHref = useMemo(() => {
    const body = [
      "I would like to enquire about this bag:",
      "",
      ...items.map((item) => {
        const options = item.selectedOptions.map((option) => `${option.name}: ${option.value}`).join(", ");
        return `${item.quantity} × ${item.productName}${options ? ` (${options})` : ""} — ${item.unitPrice}`;
      }),
    ].join("\n");
    return `mailto:${email}?subject=${encodeURIComponent("Ruined bag enquiry")}&body=${encodeURIComponent(body)}`;
  }, [email, items]);

  async function beginCheckout() {
    if (!canCheckout || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
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
        {items.map((item) => (
          <article key={item.key} className="grid grid-cols-[6.5rem_1fr] gap-4 border-b border-white/15 py-5 sm:grid-cols-[9rem_1fr] sm:gap-7 sm:py-7">
            <Link href={`/store/${item.productId}`} className="relative aspect-[4/5] overflow-hidden bg-white/5">
              {item.image && (
                <Image src={item.image.url} alt={item.image.alt} fill sizes="144px" className="object-cover" />
              )}
            </Link>
            <div className="flex min-w-0 flex-col justify-between gap-5">
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[0.52rem] uppercase tracking-[0.22em] text-white/40">{item.productCode}</p>
                    <Link href={`/store/${item.productId}`} className="display mt-2 block text-2xl leading-none transition-colors hover:text-[var(--color-poster)] sm:text-4xl">{item.productName}</Link>
                  </div>
                  <p className="display shrink-0 text-lg sm:text-2xl">{item.unitPrice}</p>
                </div>
                <p className="mt-3 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/50">
                  {item.selectedOptions.map((option) => `${option.name} · ${option.value}`).join(" / ") || item.variantTitle}
                </p>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex h-10 items-center border border-white/25" aria-label={`Quantity for ${item.productName}`}>
                  <button type="button" onClick={() => setQuantity(item.key, item.quantity - 1)} className="h-full w-10 text-lg hover:bg-white hover:text-black" aria-label="Decrease quantity">−</button>
                  <span className="w-9 text-center font-mono text-xs tabular-nums" aria-live="polite">{item.quantity}</span>
                  <button type="button" onClick={() => setQuantity(item.key, item.quantity + 1)} className="h-full w-10 text-lg hover:bg-white hover:text-black" aria-label="Increase quantity">+</button>
                </div>
                <button type="button" onClick={() => remove(item.key)} className="font-mono text-[0.54rem] uppercase tracking-[0.18em] text-white/45 underline decoration-white/20 underline-offset-4 hover:text-white">Remove</button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <aside className="lg:col-span-4">
        <div className="border border-white/20 p-6 lg:sticky lg:top-32">
          <div className="flex justify-between font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/55">
            <span>{count} {count === 1 ? "piece" : "pieces"}</span>
            <button type="button" onClick={clear} className="underline decoration-white/20 underline-offset-4 hover:text-white">Clear</button>
          </div>
          {currency && (
            <div className="mt-8 flex items-baseline justify-between border-t border-white/15 pt-5">
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/55">Subtotal</span>
              <span className="display text-3xl">{formatTotal(total, currency)}</span>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-white/40">Shipping, duties, and final availability are confirmed before payment.</p>

          {canCheckout ? (
            <button type="button" onClick={beginCheckout} disabled={submitting} className="mt-7 w-full border border-white bg-white px-5 py-4 font-mono text-xs uppercase tracking-[0.28em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white disabled:cursor-wait disabled:opacity-50">
              {submitting ? "Preparing checkout…" : "Checkout"}
            </button>
          ) : (
            <a href={enquiryHref} className="mt-7 block w-full border border-white bg-white px-5 py-4 text-center font-mono text-xs uppercase tracking-[0.28em] text-black transition-colors hover:bg-[var(--color-poster)] hover:text-white">
              Send bag to studio
            </a>
          )}
          {error && <p role="alert" className="mt-4 text-xs leading-relaxed text-[var(--color-poster)]">{error}</p>}
          {!canCheckout && <p className="mt-4 text-xs leading-relaxed text-white/40">Online payment is not open for these pieces yet. Your exact selections are included in the enquiry.</p>}
        </div>
      </aside>
    </div>
  );
}
