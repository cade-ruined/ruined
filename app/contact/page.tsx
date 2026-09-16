import type { Metadata } from "next";

import ContactSurface from "@/components/contact/ContactSurface";
import { sharingMetadata } from "@/lib/sharing";

const description = "Get in touch with Ruined about a project, apparel, or an experience.";

export const metadata: Metadata = {
  title: "Contact",
  description,
  alternates: { canonical: "/contact" },
  ...sharingMetadata({ title: "Contact", description, path: "/contact" }),
};

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bone)] px-5 pb-24 pt-16 text-[var(--color-faded)] sm:px-10 sm:pb-32 sm:pt-24">
      <div className="mx-auto max-w-[80rem]">
        <ContactSurface />
      </div>
    </main>
  );
}
