import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
export const metadata: Metadata = { title: "Shipping + Returns", robots: { index: true }, alternates: { canonical: "/shipping-returns" } };
export default function Page() { return <EditorialPage eyebrow="Customer service" title="Shipping + Returns" intro="The operational details below are a launch-ready framework and should be updated to match the studio's final carriers, regions, and return window before accepting orders." sections={[
  { title: "Dispatch", body: <p>In-stock objects are prepared in small batches. A dispatch estimate appears at checkout and in the order confirmation.</p> },
  { title: "Shipping", body: <p>Rates, duties, and available services are calculated at Shopify checkout. International customers are responsible for local import charges unless stated otherwise.</p> },
  { title: "Returns", body: <p>Contact the studio before returning an item. Goods must be unused, unworn, and returned with original packaging. Custom and final-sale work may not be returnable.</p> },
  { title: "Damage", body: <p>Photograph the item and packaging immediately and contact studio@ruined.studio with the order number.</p> },
]} />; }
