import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
import { getShopPolicies } from "@/lib/shopify";

export const revalidate = 3600;

function PolicyBody({ html }: { html: string }) {
  return (
    <div
      className="[&_a]:underline [&_a]:underline-offset-4 [&_h1]:mb-4 [&_h1]:font-mono [&_h1]:text-xs [&_h1]:uppercase [&_h1]:tracking-[0.2em] [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:font-medium [&_li]:mb-2 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-4 [&_strong]:font-medium [&_ul]:ml-5 [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { shipping, returns } = await getShopPolicies();

  return {
    title: "Shipping + Returns",
    alternates: { canonical: "/shipping-returns" },
    robots: shipping || returns ? undefined : { index: false, follow: true },
  };
}

export default async function Page() {
  const { shipping, returns } = await getShopPolicies();
  const sections = [
    ...(shipping
      ? [{ title: shipping.title, body: <PolicyBody html={shipping.body} /> }]
      : []),
    ...(returns
      ? [{ title: returns.title, body: <PolicyBody html={returns.body} /> }]
      : []),
  ];

  return (
    <EditorialPage
      eyebrow="Customer service"
      title="Shipping + Returns"
      intro="Current terms for dispatch, delivery, and returns."
      sections={sections}
    />
  );
}
