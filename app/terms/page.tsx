import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
export const metadata: Metadata = { title: "Terms", alternates: { canonical: "/terms" } };
export default function Page() { return <EditorialPage eyebrow="Legal · Draft" title="Terms" intro="These terms are a practical launch framework, not jurisdiction-specific legal advice. Have them reviewed before opening checkout." sections={[
  { title: "Orders", body: <p>An order is accepted when payment is confirmed and a confirmation is issued. Ruined may cancel and refund orders affected by stock or pricing errors.</p> },
  { title: "Intellectual property", body: <p>Site imagery, writing, graphics, product designs, and project documentation remain the property of their respective rights holders.</p> },
  { title: "Liability", body: <p>Use objects according to supplied care and safety instructions. Nothing here limits rights that cannot legally be excluded.</p> },
  { title: "Contact", body: <p>Questions about these terms: studio@ruined.studio.</p> },
]} />; }
