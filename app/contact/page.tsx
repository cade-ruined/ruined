import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";

export const metadata: Metadata = { title: "Contact", description: "Projects, objects, collaborations, press, and wholesale enquiries.", alternates: { canonical: "/contact" } };

export default function ContactPage() {
  return <EditorialPage eyebrow="Studio No. 17 · Contact" title="Start with what remains." intro="Ruined works across objects, garments, spaces, and visual direction. Tell us what you are making, salvaging, or trying to understand." sections={[
    { title: "Projects + Collaborations", body: <p><a className="underline underline-offset-4" href="mailto:studio@ruined.studio?subject=Project%20enquiry">studio@ruined.studio</a><br/>Commissions, creative direction, interiors, objects, and installations.</p> },
    { title: "Press + Wholesale", body: <p><a className="underline underline-offset-4" href="mailto:studio@ruined.studio?subject=Press%20or%20wholesale">studio@ruined.studio</a><br/>Image requests, interviews, stockists, and collection notes.</p> },
    { title: "Location", body: <p>Utah, United States<br/>40.4633° N · 111.7780° W<br/>Visits by appointment.</p> },
    { title: "Response", body: <p>Include a useful subject line, timeline, location, and budget range where applicable. The studio typically responds within three working days.</p> },
  ]} />;
}
