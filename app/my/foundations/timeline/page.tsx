import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Timeline | Journal" };
export const dynamic = "force-dynamic";

export default function MyTimelinePage() {
  // The profile owns authentication and the shared Journal. Keep existing
  // Foundations links working without loading a second copy of its entries.
  redirect("/my#timeline");
}
