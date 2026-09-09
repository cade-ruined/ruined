import ContactModal from "@/components/contact/ContactModal";
import { contactTopicFromQuery } from "@/lib/contact-topic";

export default async function ContactModalPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const initialTopic = contactTopicFromQuery((await searchParams).topic);
  return <ContactModal initialTopic={initialTopic} />;
}
