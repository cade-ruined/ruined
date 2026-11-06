import styles from "@/components/membership/MemberNotificationsDrawer.module.css";

export default function NotificationsLoading() {
  return <p className={styles.status} role="status">Loading notifications…</p>;
}
