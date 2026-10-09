import Image from "next/image";

// Verified against this store's Shopify paymentSettings; provenance lives with the SVGs.
const PAYMENT_METHODS = [
  { name: "Visa", icon: "visa" },
  { name: "Mastercard", icon: "master" },
  { name: "American Express", icon: "american_express" },
  { name: "Discover", icon: "discover" },
  { name: "Diners Club", icon: "diners_club" },
  { name: "Shop Pay", icon: "shopify_pay" },
  { name: "Apple Pay", icon: "apple_pay" },
  { name: "Google Pay", icon: "google_pay" },
] as const;

export default function StorePaymentMethods() {
  return (
    <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-5 border-t border-black/15 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="shrink-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <svg aria-hidden="true" width="15" height="17" viewBox="0 0 18 20" fill="none" className="shrink-0">
            <path d="M5 8V5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.25" />
            <rect x="2" y="8" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
            <path d="M9 12v2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
          Secure checkout
        </p>
        <p className="mt-1.5 text-xs opacity-65">Store payments powered by Shopify.</p>
      </div>
      <ul aria-label="Accepted store payment methods" className="grid w-fit grid-cols-4 gap-2 lg:flex lg:flex-wrap lg:justify-end">
        {PAYMENT_METHODS.map(({ name, icon }) => (
          <li key={icon}>
            <Image
              src={`/payment-methods/${icon}.svg`}
              alt={name}
              width={44}
              height={28}
              className="h-7 w-11 object-contain"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
