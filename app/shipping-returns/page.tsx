import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
import { getShopPolicies } from "@/lib/shopify";
export async function generateMetadata(): Promise<Metadata> { const { shipping } = await getShopPolicies(); return { title: "Shipping + Returns", alternates: { canonical: "/shipping-returns" }, robots: shipping ? undefined : { index: false, follow: true } }; }
export default async function Page() { const { shipping } = await getShopPolicies(); return <EditorialPage eyebrow="Customer service" title="Shipping + Returns" intro={shipping ? "The current shipping and return policy from our Shopify store." : "Shipping and returns will be published with the first collection."} sections={shipping ? [{ title: shipping.title, body: <div dangerouslySetInnerHTML={{ __html: shipping.body }} /> }] : []} />; }
