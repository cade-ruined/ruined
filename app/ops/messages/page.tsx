import type { Metadata } from "next";
import OperationsAnnouncementsPage from "../announcements/page";
import OperationsNotificationsPage from "../notifications/page";
import OperationsEmailsPage from "../emails/page";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function OperationsMessagesPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  if (mode === "emails") return <OperationsEmailsPage />;
  return mode === "alerts" ? <OperationsNotificationsPage /> : <OperationsAnnouncementsPage />;
}
