import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };
export default function Page() { return <EditorialPage eyebrow="Legal · Draft" title="Privacy" intro="A concise description of the information used to operate the studio and storefront. Review against the final analytics, email, and commerce vendors before launch." sections={[
  { title: "Information", body: <p>Shopify processes checkout and order information. Ruined may receive contact, fulfilment, and purchase details needed to complete an order or answer an enquiry.</p> },
  { title: "Analytics", body: <p>Performance measurements are collected only when an analytics endpoint is configured. Document the final provider and retention period here.</p> },
  { title: "Sharing", body: <p>Information is shared only with services required for hosting, payment, fulfilment, communication, security, and legal compliance.</p> },
  { title: "Requests", body: <p>For access, correction, deletion, or privacy questions, contact studio@ruined.studio.</p> },
]} />; }
