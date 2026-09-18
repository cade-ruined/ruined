import Link from "next/link";
import styles from "@/components/membership/MemberInvitation.module.css";

export default function InvitationNotFound() {
  return <main className={styles.empty}><h1>This invitation is unavailable.</h1><p>Its owner may have turned off sharing.</p><Link href="https://theruinedproject.com/#members">Explore membership ↗</Link></main>;
}
