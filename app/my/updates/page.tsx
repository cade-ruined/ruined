import type { Metadata } from "next";
import { Suspense } from "react";
import MemberNotificationsDrawer from "@/components/membership/MemberNotificationsDrawer";
import MemberUpdatesContent from "@/components/membership/MemberUpdatesContent";

export const metadata: Metadata = { title: "Notifications | Ruined Membership" };
export const dynamic = "force-dynamic";

export default function MyUpdatesPage() {
  return <MemberNotificationsDrawer><Suspense fallback={<p role="status">Loading notifications…</p>}><MemberUpdatesContent /></Suspense></MemberNotificationsDrawer>;
}
