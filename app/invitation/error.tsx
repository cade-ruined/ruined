"use client";
import styles from "@/components/membership/MemberInvitation.module.css";

export default function InvitationError({ reset }: { reset: () => void }) {
  return <main className={styles.empty}><h1>A moment, please.</h1><p>This invitation couldn’t be loaded.</p><button type="button" onClick={reset}>Try again ↗</button></main>;
}
