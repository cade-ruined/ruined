import type { Metadata } from "next";
import CallDeck from "@/components/call-deck/CallDeck";

export const metadata: Metadata = {
  title: "Memberships — Opportunity Call",
  description: "A guided introduction to Ruined Memberships.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/call-deck" },
};

export default function CallDeckPage() {
  return <CallDeck />;
}
