"use client";

import styles from "@/components/membership/MemberProfileModal.module.css";

export default function ProfileModalError({ reset }: { reset: () => void }) {
  return <div className={styles.status} role="alert"><h1>This profile couldn’t load.</h1>
    <p>Please try again.</p><button type="button" onClick={reset}>Try again</button></div>;
}
