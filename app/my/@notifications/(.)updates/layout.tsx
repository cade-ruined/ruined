import type { ReactNode } from "react";
import MemberNotificationsDrawer from "@/components/membership/MemberNotificationsDrawer";

export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return <MemberNotificationsDrawer intercepted>{children}</MemberNotificationsDrawer>;
}
