import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "@/styles/index.css";
import SiteHeader from "@/components/SiteHeader";
import WebVitals from "@/components/WebVitals";
import SiteFooter from "@/components/SiteFooter";
import BrandCursor from "@/components/BrandCursor";
import { SITE_URL } from "@/lib/site";
import "@fontsource-variable/inter";

const cadeHandy2 = localFont({
  src: "../public/fonts/CadeHandy2.otf",
  variable: "--font-cadehandy2",
  display: "swap",
  preload: true,
  weight: "400",
  style: "normal",
});

const SITE_NAME = "Ruined";
const SITE_DESC =
  "Ruined refines potential into identity through clothing, brands, products, and experiences. Based in Alpine, Utah.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Deep pages set their own title; "%s — Ruined" wraps them. Home uses the
  // default below.
  title: {
    default: "Ruined — A Creative Company in Alpine, Utah",
    template: "%s — Ruined",
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon-ruined-mark-v2.svg", type: "image/svg+xml" },
      { url: "/favicon-ruined-mark-v2.png", type: "image/png", sizes: "512x512" },
    ],
    apple: {
      url: "/apple-touch-icon-ruined-mark-v2.png",
      type: "image/png",
      sizes: "180x180",
    },
    other: [{ rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#080605" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESC,
    url: SITE_URL,
    images: [
      {
        url: "/opengraph-image.jpg",
        width: 1200,
        height: 630,
        alt: "The Ruined Project",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESC,
    images: ["/twitter-image.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "connect@theruinedproject.com",
    description: SITE_DESC,
    address: {
      "@type": "PostalAddress",
      streetAddress: "395 S Main Street",
      addressLocality: "Alpine",
      addressRegion: "UT",
      postalCode: "84004",
      addressCountry: "US",
    },
    sameAs: ["https://www.instagram.com/theruinedproject"],
  };

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={cadeHandy2.variable}
    >
      <body>
        <a href="#main-content" className="ruined-skip-link">
          Skip to content
        </a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema).replace(/</g, "\\u003c") }}
        />
        <BrandCursor />
        <SiteHeader />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <SiteFooter />
        {modal}
        <WebVitals />
      </body>
    </html>
  );
}
