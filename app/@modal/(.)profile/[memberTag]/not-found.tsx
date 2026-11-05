import styles from "@/components/membership/MemberProfileModal.module.css";

export default function ProfileModalNotFound() {
  return <div className={styles.status}><h1>This profile isn’t available.</h1><p>Close this profile to return to members.</p></div>;
}
