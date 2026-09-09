import type { Metadata } from "next";

import ContactSurface from "@/components/contact/ContactSurface";
import { contactTopicFromQuery } from "@/lib/contact-topic";

export const metadata: Metadata = {
  title: "Contact",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const initialTopic = contactTopicFromQuery((await searchParams).topic);
  return (
    <main className="min-h-screen bg-[var(--color-bone)] px-5 pb-24 pt-16 text-[var(--color-faded)] sm:px-10 sm:pb-32 sm:pt-24">
      <div className="mx-auto max-w-[80rem]">
        <ContactSurface initialTopic={initialTopic} />
      </div>
    </main>
  );
}
