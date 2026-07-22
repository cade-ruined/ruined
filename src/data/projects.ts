// Single source of truth for the RUINED project archive.
//
// Consumed by:
//   - <WorkSection /> on the home page (the record-rack carousel)
//   - the record-store "project hub" overlay in the hero dive
//
// Adding a project here reflects in both surfaces.

import type { Project } from "@/components/sections/RecordCarousel";

export type { Project };

const SLUG_BY_NO: Record<string, string> = {
  "08": "ash-oak", "07": "tarpaulin-no-3", "06": "concrete-hours",
  "05": "salt-print-series", "04": "objet-trouve", "03": "warehouse-17",
  "02": "loom-no-7", "01": "ru-pilot",
};
export const projectSlug = (project: Project) => SLUG_BY_NO[project.no];

// Local asset convention — drop files in `public/work/<slug>/`:
//   cover.jpg              → the sleeve face (falls back to the drawn motif)
//   1.jpg, 2.jpg, 3.jpg…   → the detail carousel (falls back to placeholders)
// See public/work/README.md. Missing files degrade gracefully, so you can
// wire a project now and add its photography later.
const COVER_BY_SLUG: Record<string, string> = {
  "ash-oak": "/work/ash-oak/cover.jpg",
  "tarpaulin-no-3": "/art/store.jpg",
  "concrete-hours": "/art/loft.jpg",
  "salt-print-series": "/art/lounge.jpg",
  "objet-trouve": "/art/shelf.jpg",
  "warehouse-17": "/ruined-hero-1.jpg",
  "loom-no-7": "/art/records.jpg",
  "ru-pilot": "/ruined-hero-store-4.webp",
};
const cover = (slug: string): string | undefined => COVER_BY_SLUG[slug];
// Add paths here only after the corresponding files exist. This prevents every
// project detail from issuing predictable 404 requests for placeholder slots.
const gallery = (): string[] => [];

export const PROJECTS: Project[] = [
  {
    no: "08",
    year: "2026",
    title: "Ash & Oak",
    brief: "Charred timber → cabinet.",
    medium: "Furniture",
    tone: "atelier",
    overview:
      "A storm-felled oak, half-lost to fire, broken down and rebuilt as a single standing cabinet. The charred faces are left raw and sealed; the joinery is new. What survived the burn becomes the structure.",
    materials: ["Storm-felled oak", "Charred timber", "Blackened steel", "Beeswax"],
    edition: "1 of 1",
    status: "In collection",
    image: cover("ash-oak"),
    images: gallery(),
  },
  {
    no: "07",
    year: "2026",
    title: "Tarpaulin Nº 3",
    brief: "Salvaged tarp → garments.",
    medium: "Textile",
    tone: "shadow",
    overview:
      "Three decades of industrial tarpaulin — sun-bleached, oil-stained, stitched and re-stitched — cut down into a small run of weatherproof garments. Every panel keeps the marks of the load it once covered.",
    materials: ["Salvaged tarpaulin", "Waxed thread", "Reclaimed hardware"],
    edition: "Edition of 12",
    status: "Available",
    image: cover("tarpaulin-no-3"),
    images: gallery(),
  },
  {
    no: "06",
    year: "2025",
    title: "Concrete Hours",
    brief: "Poured forms → seating.",
    medium: "Cast",
    tone: "warm",
    overview:
      "Off-cut formwork from a demolished pour, reassembled as moulds for a series of low seats. The grain of the old plywood is pressed permanently into each cast — a record of the wall that no longer stands.",
    materials: ["Reclaimed formwork", "Cement", "Steel reinforcement"],
    edition: "Edition of 6",
    status: "Archived",
    image: cover("concrete-hours"),
    images: gallery(),
  },
  {
    no: "05",
    year: "2025",
    title: "Salt Print Series",
    brief: "Seawater → photographic plates.",
    medium: "Print",
    tone: "atelier",
    overview:
      "A return to the earliest photographic process — paper sensitised by hand and developed in salt drawn from the same coast it depicts. The sea is both the subject and the chemistry.",
    materials: ["Seawater", "Cotton rag paper", "Silver nitrate", "Sunlight"],
    edition: "Edition of 20",
    status: "Available",
    image: cover("salt-print-series"),
    images: gallery(),
  },
  {
    no: "04",
    year: "2026",
    title: "Objet Trouvé",
    brief: "Found object → archive vessel.",
    medium: "Mixed media",
    tone: "warm",
    overview:
      "A single found object, origin unknown, encased rather than restored — sealed inside a hand-built vessel that preserves its anonymity. An archive of one thing nobody remembers.",
    materials: ["Found object", "Hand-blown glass", "Patinated brass"],
    edition: "1 of 1",
    status: "In collection",
    image: cover("objet-trouve"),
    images: gallery(),
  },
  {
    no: "03",
    year: "2025",
    title: "Warehouse 17",
    brief: "Industrial site → studio.",
    medium: "Site / Build",
    tone: "atelier",
    overview:
      "The conversion of a derelict goods warehouse into the Ruined studio. Nothing structural was hidden — the soot, the patched brick, the crane rails were kept and worked around. The ruin is the room.",
    materials: ["Reclaimed brick", "Cast iron", "Salvaged glazing", "Concrete"],
    edition: "Permanent site",
    status: "Built",
    image: cover("warehouse-17"),
    images: gallery(),
  },
  {
    no: "02",
    year: "2025",
    title: "Loom Nº 7",
    brief: "1947 textile loom → restoration.",
    medium: "Restoration",
    tone: "shadow",
    overview:
      "A 1947 dobby loom recovered from a closed mill, returned to working order over eight months. Replacement parts were machined to match, not modernise. It now weaves the cloth used across the studio.",
    materials: ["1947 dobby loom", "Machined brass", "Oak", "Linen warp"],
    edition: "1 of 1",
    status: "Operational",
    image: cover("loom-no-7"),
    images: gallery(),
  },
  {
    no: "01",
    year: "2024",
    title: "RU / Pilot",
    brief: "First drop, hand-numbered.",
    medium: "Goods",
    tone: "warm",
    overview:
      "The first release under the Ruined mark — a small set of hand-numbered goods made entirely from studio off-cuts. The pilot that set the rule: nothing new, everything finished by hand.",
    materials: ["Studio off-cuts", "Hand-stamped brass", "Waxed cotton"],
    edition: "Edition of 50",
    status: "Sold out",
    image: cover("ru-pilot"),
    images: gallery(),
  },
];
