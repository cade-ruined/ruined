import type { Metadata } from "next";
import StoreGallery from "@/components/store/StoreGallery";

export const metadata: Metadata = {
  title: "Store · Artifacts — Ruined",
  description:
    "Drop 01 / SS26 — the full Artifacts catalogue. Four pieces, hand-finished, made in small numbers.",
};

export default function StorePage() {
  return <StoreGallery />;
}
