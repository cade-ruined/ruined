import type { Metadata } from "next";
import OperationsAnnouncementsPage from "../announcements/page";
import OperationsNotificationsPage from "../notifications/page";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function OperationsMessagesPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return mode === "alerts" ? <OperationsNotificationsPage /> : <OperationsAnnouncementsPage />;
}
