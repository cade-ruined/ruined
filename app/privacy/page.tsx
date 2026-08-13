import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
const contact = <a className="underline underline-offset-4" href="mailto:connect@theruinedproject.com">connect@theruinedproject.com</a>;
export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };
export default function Page() { return <EditorialPage eyebrow="Effective August 12, 2026" title="Privacy" intro="The Ruined Project respects your privacy and collects only the information needed to operate this site, communicate with you, and fulfill future orders." sections={[
  { title: "Information we collect", body: <p>We may collect contact details you submit, form and correspondence content, order and fulfillment information processed through Shopify, and limited technical data needed for security and site performance.</p> },
  { title: "How we use it", body: <p>We use personal data to answer submissions, manage email signups through HubSpot, operate Shopify commerce, provide customer service, prevent fraud, maintain security, and comply with law.</p> },
  { title: "Service providers", body: <p>Information may be processed by providers supporting hosting, HubSpot communications, Shopify commerce and payments, email delivery, security, and professional services. We do not sell personal data.</p> },
  { title: "Utah privacy rights", body: <p>Where the Utah Consumer Privacy Act applies, Utah residents may request confirmation and access, deletion, a portable copy of data they provided, and opt out of sale or targeted advertising. We do not currently sell personal data or use it for targeted advertising.</p> },
  { title: "Retention and security", body: <p>We retain information only as long as reasonably needed for the purpose collected, legal obligations, disputes, and security. We use reasonable administrative, technical, and physical safeguards.</p> },
  { title: "Requests and contact", body: <p>Send privacy requests to {contact}. We may verify your identity before completing a request and will respond within the period required by applicable law.</p> },
]} />; }
