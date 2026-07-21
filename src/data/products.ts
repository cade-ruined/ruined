// Catalogue types + the LOCAL FALLBACK drop.
//
// In production, products are fetched live from Shopify via `getProducts()`
// in `@/lib/shopify` (Storefront API). This file stays client-safe (no Shopify
// imports / tokens) and provides:
//   - the shared `Product` type both data sources map to,
//   - `PRODUCTS`: a static fallback so the site builds & renders with no creds
//     and so the home dive's store-room teaser has curated items,
//   - the art-direction tokens (`PRODUCT_TONES`) and a `handle → tone` map so
//     Shopify products inherit the right gradient even without a metafield.

export type ProductTone = "warm" | "shadow" | "atelier";

export type Product = {
  id: string;
  code: string; // e.g. "RU—001"
  name: string; // e.g. "Field Coat"
  subtitle: string; // e.g. "FOR WEATHER"
  price: string; // e.g. "£ 420" (preformatted for display)
  description: string;
  material: string;
  origin: string;
  care: string;
  tone: ProductTone;
  // Product photography from Shopify (featuredImage). When absent (e.g. local
  // fallback), surfaces render the `tone` gradient art instead.
  image?: { url: string; alt: string };
  // Commerce fields — only present on live Shopify products. When `variantId`
  // is set, the plate's CTA creates a real Shopify cart + checkout; otherwise
  // it falls back to the "Enquire" affordance.
  variantId?: string;
  available?: boolean;
};

export const PRODUCTS: Product[] = [
  {
    id: "ru-001",
    code: "RU—001",
    name: "Field Coat",
    subtitle: "For weather",
    price: "£ 420",
    description:
      "Heavy waxed cotton outerwear with brass hardware. Hand-finished seams and a deep poacher pocket. Ages with character.",
    material: "Waxed cotton · brass",
    origin: "Made in EU",
    care: "Re-wax annually",
    tone: "warm",
    image: { url: "/art/loft.jpg", alt: "Field Coat campaign study" },
  },
  {
    id: "ru-002",
    code: "RU—002",
    name: "Selvedge Trouser",
    subtitle: "For the long walk",
    price: "£ 285",
    description:
      "Cut for a slim regular fit through the leg. Raw 14oz Japanese selvedge that softens with wear.",
    material: "Raw selvedge · 14oz",
    origin: "Woven in Japan",
    care: "Cold wash · hang dry",
    tone: "shadow",
    image: { url: "/art/store.jpg", alt: "Selvedge Trouser campaign study" },
  },
  {
    id: "ru-003",
    code: "RU—003",
    name: "Cinder Hooded",
    subtitle: "For the cold months",
    price: "£ 240",
    description:
      "Heavyweight 480gsm loopback fleece. Cinder-dyed in small batches; no two are identical.",
    material: "Loopback · 480gsm",
    origin: "Knit in Portugal",
    care: "Cold wash · lay flat",
    tone: "atelier",
    image: { url: "/art/records.jpg", alt: "Cinder Hooded campaign study" },
  },
  {
    id: "ru-004",
    code: "RU—004",
    name: "Workwear Vest",
    subtitle: "For the studio",
    price: "£ 180",
    description:
      "Heavy canvas vest with five front pockets. Cut wide for layering. Becomes more itself with use.",
    material: "Cotton canvas · 10oz",
    origin: "Made in EU",
    care: "Cold wash · hang dry",
    tone: "warm",
    image: { url: "/art/lounge.jpg", alt: "Workwear Vest campaign study" },
  },
];

// Shared gradient palette — the tone tokens used by both the StoreSection
// preview plates and ProductPlate (full-bleed art plates). Defined here so
// a single change updates the look of a product in both surfaces. Keys
// match ProductTone above.
export const PRODUCT_TONES = {
  warm: "linear-gradient(135deg, #1c1108 0%, #3a2615 35%, #1d1410 70%, #0a0707 100%)",
  shadow: "linear-gradient(160deg, #0a0908 0%, #181513 50%, #0a0807 100%)",
  atelier:
    "linear-gradient(120deg, #14110e 0%, #2c2419 35%, #1a1612 65%, #0a0807 100%)",
} as const;

// Art direction stays in code: map a Shopify product handle → tone gradient so
// merchandising can edit copy/price/inventory in Shopify while the look stays
// curated here. A `custom.tone` metafield (if set) overrides this; otherwise we
// fall back to this map, then cycle the palette by position.
export const TONE_BY_HANDLE: Record<string, ProductTone> = {
  "field-coat": "warm",
  "selvedge-trouser": "shadow",
  "cinder-hooded": "atelier",
  "workwear-vest": "warm",
};

export const TONE_CYCLE: ProductTone[] = ["warm", "shadow", "atelier"];
