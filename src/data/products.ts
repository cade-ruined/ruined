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

export type ProductOptionValue = {
  name: string;
  value: string;
};

export type ProductOption = {
  name: string;
  values: string[];
};

export type ProductVariant = {
  id: string;
  title: string;
  available: boolean;
  selectedOptions: ProductOptionValue[];
  price: string;
  priceAmount: string;
  currencyCode: string;
};

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
  // The complete option/variant model. Local fallback items use stable
  // `local:` IDs so selection and the persistent bag can be tested without
  // exposing a Storefront token or pretending checkout is live.
  options: ProductOption[];
  variants: ProductVariant[];
  // Compatibility field for older catalogue surfaces. New purchase controls
  // use `variants` and always require the shopper to choose an available one.
  variantId?: string;
  available?: boolean;
};

function localVariants(
  productId: string,
  values: string[],
  amount: string,
  currencyCode = "GBP"
): ProductVariant[] {
  return values.map((value) => ({
    id: `local:${productId}:${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title: value,
    available: true,
    selectedOptions: [{ name: "Size", value }],
    price: `£ ${Number(amount).toLocaleString("en-GB")}`,
    priceAmount: amount,
    currencyCode,
  }));
}

function sizeOption(values: string[]): ProductOption[] {
  return [{ name: "Size", values }];
}

const LETTER_SIZES = ["XS", "S", "M", "L", "XL"];

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
    image: { url: "/catalog/field-coat-placeholder.png", alt: "Charcoal waxed-cotton Field Coat in the Ruined studio" },
    options: sizeOption(LETTER_SIZES),
    variants: localVariants("ru-001", LETTER_SIZES, "420"),
    available: true,
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
    image: { url: "/catalog/selvedge-trouser-placeholder.png", alt: "Near-black selvedge trousers on a steel bench" },
    options: sizeOption(["28", "30", "32", "34", "36"]),
    variants: localVariants("ru-002", ["28", "30", "32", "34", "36"], "285"),
    available: true,
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
    image: { url: "/catalog/cinder-hoodie-placeholder.png", alt: "Cinder-washed heavyweight hoodie on concrete" },
    options: sizeOption([...LETTER_SIZES, "XXL"]),
    variants: localVariants("ru-003", [...LETTER_SIZES, "XXL"], "240"),
    available: true,
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
    image: { url: "/catalog/workwear-vest-placeholder.png", alt: "Black canvas Workwear Vest on a steel rail" },
    options: sizeOption(["S", "M", "L", "XL"]),
    variants: localVariants("ru-004", ["S", "M", "L", "XL"], "180"),
    available: true,
  },
  {
    id: "ru-005",
    code: "RU—005",
    name: "Raw Edge Overshirt",
    subtitle: "For the threshold",
    price: "£ 310",
    description:
      "Washed heavyweight twill with exposed seam allowances and blackened snap closures. Cut square for use as a shirt or light outer layer.",
    material: "Cotton twill · 12oz",
    origin: "Made in EU",
    care: "Cold wash · hang dry",
    tone: "atelier",
    image: { url: "/catalog/raw-edge-overshirt-placeholder.png", alt: "Washed-bone Raw Edge Overshirt in the Ruined studio" },
    options: sizeOption(LETTER_SIZES),
    variants: localVariants("ru-005", LETTER_SIZES, "310"),
    available: true,
  },
  {
    id: "ru-006",
    code: "RU—006",
    name: "Utility Tote",
    subtitle: "For carrying the work",
    price: "£ 165",
    description:
      "Oversized waxed-canvas carryall with reinforced handles, external tool pockets, and aged brass rivets. Built to mark with use.",
    material: "Waxed canvas · brass",
    origin: "Made in UK",
    care: "Spot clean · re-wax",
    tone: "shadow",
    image: { url: "/catalog/utility-tote-placeholder.png", alt: "Black waxed-canvas Utility Tote on concrete" },
    options: sizeOption(["One size"]),
    variants: localVariants("ru-006", ["One size"], "165"),
    available: true,
  },
  {
    id: "ru-007",
    code: "RU—007",
    name: "Signal Cap",
    subtitle: "For outside",
    price: "£ 95",
    description:
      "Washed six-panel cap with an extended adjustment strap and blackened hardware. Unstructured, low profile, and hand-finished.",
    material: "Cotton drill · steel",
    origin: "Made in Portugal",
    care: "Hand wash",
    tone: "warm",
    image: { url: "/catalog/signal-cap-placeholder.png", alt: "Washed charcoal Signal Cap on blackened steel" },
    options: sizeOption(["One size"]),
    variants: localVariants("ru-007", ["One size"], "95"),
    available: true,
  },
  {
    id: "ru-008",
    code: "RU—008",
    name: "Ash Knit",
    subtitle: "For the last room",
    price: "£ 260",
    description:
      "Dense rib-knit crewneck with visible hand-mended interruptions throughout the body and sleeves. Each repair pattern is different.",
    material: "Merino wool · cotton repair yarn",
    origin: "Knit in Scotland",
    care: "Hand wash · dry flat",
    tone: "atelier",
    image: { url: "/catalog/ash-knit-placeholder.png", alt: "Ash-grey repaired rib-knit crewneck in the Ruined studio" },
    options: sizeOption(LETTER_SIZES),
    variants: localVariants("ru-008", LETTER_SIZES, "260"),
    available: true,
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
  "raw-edge-overshirt": "atelier",
  "utility-tote": "shadow",
  "signal-cap": "warm",
  "ash-knit": "atelier",
};

export const TONE_CYCLE: ProductTone[] = ["warm", "shadow", "atelier"];
