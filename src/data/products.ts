// Single source of truth for the Artifacts drop catalogue.
//
// Consumed by:
//   - <ProductStack /> inside the home Store section (preview carousel)
//   - <StoreGallery /> on the /store route (full art-gallery catalogue)
//
// Adding a product here automatically reflects in both surfaces.

import type { Product } from "@/components/sections/ProductStack";

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
  },
];

// Shared gradient palette — the tone tokens used by both ProductStack
// (small card backgrounds) and ProductPlate (full-bleed art plates).
// Defined here so a single change updates the look of a product in
// both surfaces. Keys match ProductTone in ProductStack.
export const PRODUCT_TONES = {
  warm: "linear-gradient(135deg, #1c1108 0%, #3a2615 35%, #1d1410 70%, #0a0707 100%)",
  shadow: "linear-gradient(160deg, #0a0908 0%, #181513 50%, #0a0807 100%)",
  atelier:
    "linear-gradient(120deg, #14110e 0%, #2c2419 35%, #1a1612 65%, #0a0807 100%)",
} as const;
