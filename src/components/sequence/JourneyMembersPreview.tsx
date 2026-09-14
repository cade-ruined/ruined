import MembershipWaitlistForm from "@/components/public-members/MembershipWaitlistForm";
import { MEMBERSHIP_INTRO, MEMBERSHIP_LINKS } from "@/data/public-membership";
import styles from "./JourneyMembersPreview.module.css";

export default function JourneyMembersPreview({ headingId }: { headingId: string }) {
  return (
    <section className={styles.preview} aria-labelledby={headingId} data-journey-members-preview data-mobile-internal-scroll>
      <div className={styles.copy}>
        <p className={styles.label}>Members</p>
        <h2 id={headingId} className="ui-heading">{MEMBERSHIP_INTRO.headline}</h2>
        <p className={styles.description}>Leave your details. We’ll be in touch when membership opens.</p>
      </div>
      <div className={styles.signup}>
        <MembershipWaitlistForm tone="paper" />
        <a className={styles.signIn} href={MEMBERSHIP_LINKS.signIn}>Member sign-in</a>
      </div>
    </section>
  );
}
