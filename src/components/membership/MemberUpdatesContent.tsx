import Link from "next/link";
import { redirect } from "next/navigation";
import MemberUpdates from "./MemberUpdates";
import { getMembershipPageContext } from "@/lib/membership/page-context";
import { PREVIEW_MEMBER_UPDATES } from "@/lib/membership/preview";
import { getMemberUpdates } from "@/lib/membership/repository";
import styles from "./MemberNotificationsDrawer.module.css";

export default async function MemberUpdatesContent() {
  const context = await getMembershipPageContext(PREVIEW_MEMBER_UPDATES, getMemberUpdates, "updates");
  if (context.state === "signed_out") redirect("/my/access");
  if (context.state === "denied") return <p className={styles.status}>Notifications aren’t available for this account.</p>;
  if (!context.data) return <div className={styles.status} role="alert">Notifications couldn’t load. Close this panel and try again.<br /><Link href="/my/support">Get help</Link></div>;
  return <MemberUpdates initialUpdates={context.data} writable={context.state === "authenticated"} />;
}
