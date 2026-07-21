"use server";

import { redirect } from "next/navigation";
import { createCheckoutUrl } from "@/lib/shopify";

// Server action invoked by the product plate's "Acquire" form. Creates a real
// Shopify cart for the chosen variant and redirects to Shopify's hosted
// checkout. Runs only on the server, so the Storefront token never reaches the
// client. Safe to import into client components and pass to <form action>.
export async function checkout(formData: FormData) {
  const variantId = String(formData.get("variantId") ?? "");
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)) return;

  const url = await createCheckoutUrl(variantId);
  // redirect() throws internally, so it must sit outside try/catch.
  if (url) redirect(url);
}
