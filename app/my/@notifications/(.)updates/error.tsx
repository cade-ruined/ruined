"use client";

import styles from "@/components/membership/MemberNotificationsDrawer.module.css";

export default function NotificationsError({ reset }: { reset: () => void }) {
  return <div className={styles.status} role="alert">Notifications couldn’t load.<br /><button type="button" onClick={reset}>Try again</button></div>;
}
