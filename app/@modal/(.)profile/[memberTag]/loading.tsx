import styles from "@/components/membership/MemberProfileModal.module.css";

export default function ProfileModalLoading() {
  return <div className={styles.status} role="status" aria-live="polite">Loading profile…</div>;
}
