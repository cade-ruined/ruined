import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
import { getShopPolicies } from "@/lib/shopify";
import { sharingMetadata } from "@/lib/sharing";

export async function generateMetadata(): Promise<Metadata> {
  const { terms } = await getShopPolicies();
  const description = "Terms for purchasing from Ruined.";
  return {
    title: "Terms",
    description,
    alternates: { canonical: "/terms" },
    robots: terms ? undefined : { index: false, follow: true },
    ...sharingMetadata({ title: "Terms", description, path: "/terms" }),
  };
}
export default async function Page() { const { terms } = await getShopPolicies(); return <EditorialPage eyebrow="Legal" title="Terms" intro={terms ? "The current terms from our Shopify store." : "Terms will be published with the first collection."} sections={terms ? [{ title: terms.title, body: <div dangerouslySetInnerHTML={{ __html: terms.body }} /> }] : []} />; }
