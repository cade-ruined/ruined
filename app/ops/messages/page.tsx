import type { Metadata } from "next";
import OperationsAnnouncementsPage from "../announcements/page";
import OperationsNotificationsPage from "../notifications/page";
import OperationsEmailsPage from "../emails/page";
import OperationsEmailAutomationsPage from "../email-automations/page";

export const metadata: Metadata = { title: "Communications" };
export const dynamic = "force-dynamic";

export default async function OperationsMessagesPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  if (mode === "emails") return <OperationsEmailsPage />;
  if (mode === "alerts") return <OperationsNotificationsPage />;
  if (mode === "posts") return <OperationsAnnouncementsPage />;
  return <OperationsEmailAutomationsPage />;
}
