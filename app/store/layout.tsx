import type { Metadata } from "next";

// The Store exists inside the walk for launch. Keep the dormant commerce
// routes out of search until Shopify content replaces their placeholders.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
