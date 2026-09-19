import Link from "next/link";
import styles from "@/components/membership/MemberInvitation.module.css";

export default function InvitationNotFound() {
  return <main className={styles.empty}><h1>This invitation is unavailable.</h1><p>It may have expired or been replaced. Ask the person who invited you for a new invitation.</p><Link href="https://theruinedproject.com/#members">Explore membership ↗</Link></main>;
}
