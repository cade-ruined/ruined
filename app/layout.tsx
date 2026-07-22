import type { Metadata, Viewport } from "next";
import "@/styles/index.css";
import SiteHeader from "@/components/SiteHeader";
import WebVitals from "@/components/WebVitals";
import SiteFooter from "@/components/SiteFooter";
import "@fontsource-variable/inter";

// Absolute base for OG/canonical URLs. Vercel injects the production URL at
// build time; falls back to the brand domain locally / on first deploy.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.NEXT_PUBLIC_SITE_URL ?? "https://ruined.studio";

const SITE_NAME = "Ruined";
const SITE_DESC =
  "Ruined — a studio for artifacts and projects. Drop 01 / SS MMXXVI. Walk the warehouse: store, work, studio, and fireside events, after the fear.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Deep pages set their own title; "%s — Ruined" wraps them. Home uses the
  // default below.
  title: {
    default: "Ruined — After the Fear",
    template: "%s — Ruined",
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  keywords: [
    "Ruined studio", "Utah design studio", "independent fashion label",
    "limited edition clothing", "furniture and object design", "creative direction",
    "interior design", "experimental retail", "design events", "artifacts", "After the Fear", "SS26",
  ],
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon.png", type: "image/png" }],
    apple: "/apple-icon.png",
    other: [{ rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#d0312d" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Ruined — After the Fear",
    description: SITE_DESC,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "Ruined — After the Fear",
    description: SITE_DESC,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: siteUrl,
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "studio@ruined.studio",
    description: SITE_DESC,
  };

  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema).replace(/</g, "\\u003c") }}
        />
        <SiteHeader />
        {children}
        <SiteFooter />
        <WebVitals />
      </body>
    </html>
  );
}
