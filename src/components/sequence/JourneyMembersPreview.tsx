import Image from "next/image";
import Link from "next/link";
import { MEMBERSHIP_INTRO, MEMBERSHIP_LINKS, MEMBERSHIP_PILLARS } from "@/data/public-membership";
import styles from "./JourneyMembersPreview.module.css";

export default function JourneyMembersPreview({ headingId }: { headingId: string }) {
  return (
    <section className={styles.preview} aria-labelledby={headingId} data-journey-members-preview>
      <div className={styles.story}>
        <div className={styles.copy}>
          <p className={styles.label}>Members</p>
          <h2 id={headingId} className="ui-heading">{MEMBERSHIP_INTRO.headline}</h2>
          <p className={styles.description}>
            A small Circle. A shared practice. Space to make something of what matters to you.
          </p>
        </div>
        <div className={styles.image}>
          <Image src={MEMBERSHIP_INTRO.image} alt={MEMBERSHIP_INTRO.alt} fill sizes="(min-width: 1025px) 320px, 38vw" />
          <span className={styles.imageCaption}>A place for you.</span>
        </div>
      </div>
      <nav className={styles.pillars} aria-label="Explore membership">
        {MEMBERSHIP_PILLARS.map((pillar) => (
          <Link key={pillar.id} href={`/members#${pillar.id}`}>{pillar.title}<span aria-hidden="true">↗</span></Link>
        ))}
      </nav>
      <div className={styles.actions}>
        <Link className={styles.primary} href="/members">Explore membership <span aria-hidden="true">→</span></Link>
        <a className={styles.signIn} href={MEMBERSHIP_LINKS.signIn}>Member sign-in</a>
      </div>
    </section>
  );
}
