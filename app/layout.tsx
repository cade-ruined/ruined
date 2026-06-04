import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "@/styles/index.css";
import BottomMenu from "@/components/BottomMenu";

// Self-hosted via next/font (no render-blocking external CSS request, with
// font-display: swap and automatic preload). Exposed as CSS variables that
// theme.css feeds into --font-body / --font-header / --font-display.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Immersive Parallax App",
  description: "Immersive parallax experience.",
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
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        {children}
        <BottomMenu />
      </body>
    </html>
  );
}
