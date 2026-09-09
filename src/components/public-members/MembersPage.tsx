import Image from "next/image";
import Link from "next/link";

import {
  MEMBERSHIP_INTRO,
  MEMBERSHIP_LINKS,
  MEMBERSHIP_PILLARS,
} from "@/data/public-membership";
import styles from "./MembersPage.module.css";

const [foundations, circle, academy, experiences] = MEMBERSHIP_PILLARS;
const [headlineLead, ...headlineClose] = MEMBERSHIP_INTRO.headline.split(". ");

function InquiryLink({ light = false }: { light?: boolean }) {
  return (
    <Link className={`${styles.inquiry} ${light ? styles.inquiryLight : ""}`} href={MEMBERSHIP_LINKS.inquire}>
      Ask about membership <span aria-hidden="true">↗</span>
    </Link>
  );
}

export default function MembersPage() {
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <section aria-labelledby="members-heading" className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.handwritten}>By invitation</p>
            <h1 className={`ui-heading ${styles.heroTitle}`} id="members-heading">
              {headlineLead}{headlineClose.length ? "." : ""}
              {headlineClose.length ? <em>{headlineClose.join(". ")}</em> : null}
            </h1>
            <p className={styles.heroDescription}>{MEMBERSHIP_INTRO.description}</p>
            <div className={styles.heroActions}>
              <InquiryLink />
              <a className={styles.signIn} href={MEMBERSHIP_LINKS.signIn}>Member sign-in <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <figure className={styles.heroFigure}>
            <div className={styles.heroImage}>
              <Image alt={MEMBERSHIP_INTRO.alt} className={styles.image} fill priority sizes="(min-width: 1440px) 660px, (min-width: 760px) 52vw, 100vw" src={MEMBERSHIP_INTRO.image} />
            </div>
            <figcaption className={styles.imageCaption}>A place to begin. <span>Editorial study</span></figcaption>
          </figure>
        </section>

        <section aria-labelledby="inside-membership-heading" className={styles.introduction}>
          <p className={styles.handwritten}>Inside membership</p>
          <div>
            <h2 className={styles.statement} id="inside-membership-heading">The work is personal.<br />You don’t have to do it alone.</h2>
            <nav aria-label="Explore membership" className={styles.pillarIndex}>
              {MEMBERSHIP_PILLARS.map((pillar) => <a href={`#${pillar.id}`} key={pillar.id}>{pillar.title}<span aria-hidden="true">↘</span></a>)}
            </nav>
          </div>
        </section>

        <section aria-labelledby="foundations-heading" className={styles.foundations} id={foundations.id}>
          <figure className={styles.foundationFigure}>
            <div className={styles.foundationImage}>
              <Image alt={foundations.alt} className={styles.image} fill sizes="(min-width: 1440px) 720px, (min-width: 760px) 55vw, 100vw" src={foundations.image} />
            </div>
            <figcaption className={styles.imageCaption}>Less noise. A clearer starting point. <span>Material study</span></figcaption>
          </figure>
          <div className={styles.foundationCopy}>
            <p className={styles.handwritten}>Begin here</p>
            <h2 className={`ui-heading ${styles.sectionTitle}`} id="foundations-heading">{foundations.title}</h2>
            <p className={styles.summary}>{foundations.summary}</p>
            <p className={styles.bodyCopy}>Reflection, a personal timeline, and practical work to return to. A beginning you can carry into the rest of your life.</p>
            <p className={styles.detailNote}>You can begin before joining a Circle. Completing Foundations requires an active Circle assignment.</p>
          </div>
        </section>

        <section aria-labelledby="circle-heading" className={styles.circle} id={circle.id}>
          <div className={styles.circleCopy}>
            <p className={styles.handwritten}>Small by design</p>
            <h2 className={`ui-heading ${styles.sectionTitle}`} id="circle-heading">{circle.title}</h2>
            <p className={styles.summary}>{circle.summary}</p>
            <p className={styles.bodyCopy}>Your Shaper helps guide the group. Your Circle gives the conversation somewhere to continue.</p>
            <span className={styles.circleNote}>A familiar place to return.</span>
          </div>
          <figure className={styles.circleFigure}>
            <div className={styles.circleImage}>
              <Image alt={circle.alt} className={styles.image} fill sizes="(min-width: 1440px) 760px, (min-width: 760px) 58vw, 100vw" src={circle.image} />
            </div>
            <figcaption className={styles.imageCaption}>The room, imagined. <span>Temporary editorial image</span></figcaption>
          </figure>
        </section>

        <div className={styles.continuing}>
          <section aria-labelledby="academy-heading" className={styles.academy} id={academy.id}>
            <div className={styles.sectionHeading}>
              <p className={styles.handwritten}>Keep learning</p>
              <h2 className={`ui-heading ${styles.sectionTitle}`} id="academy-heading">{academy.title}</h2>
            </div>
            <figure>
              <div className={styles.academyImage}>
                <Image alt={academy.alt} className={styles.image} fill sizes="(min-width: 1440px) 590px, (min-width: 760px) 45vw, 100vw" src={academy.image} />
                <span aria-hidden="true" className={styles.imageLabel}>Put it into practice.</span>
              </div>
              <figcaption className={styles.imageCaption}>A library to come back to. <span>Editorial study</span></figcaption>
            </figure>
            <p className={styles.summary}>{academy.summary}</p>
          </section>
          <section aria-labelledby="experiences-heading" className={styles.experiences} id={experiences.id}>
            <div className={styles.sectionHeading}>
              <p className={styles.handwritten}>Be there</p>
              <h2 className={`ui-heading ${styles.sectionTitle}`} id="experiences-heading">{experiences.title}</h2>
            </div>
            <figure>
              <div className={styles.experiencesImage}>
                <Image alt={experiences.alt} className={styles.image} fill sizes="(min-width: 1440px) 590px, (min-width: 760px) 45vw, 100vw" src={experiences.image} />
              </div>
              <figcaption className={styles.imageCaption}>BYOB at Tibble Fork. <span>From the community archive</span></figcaption>
            </figure>
            <p className={styles.summary}>{experiences.summary}</p>
            <Link className={styles.textLink} href="/community">See the Ruined community <span aria-hidden="true">↗</span></Link>
          </section>
        </div>

        <aside className={styles.artifactNote}>
          <p className={styles.handwritten}>What remains</p>
          <p>Sometimes the work leaves something tangible. Artifacts belong to the Ruined story; specific items and their availability are shared separately.</p>
        </aside>

        <section aria-labelledby="membership-invitation-heading" className={styles.invitation}>
          <div>
            <p className={styles.handwritten}>Start a conversation</p>
            <h2 className={`ui-heading ${styles.invitationTitle}`} id="membership-invitation-heading">There’s room<br /><em>for a beginning.</em></h2>
          </div>
          <div className={styles.invitationCopy}>
            <p>Membership is currently by invitation. Tell us a little about yourself and what brings you here.</p>
            <InquiryLink light />
            <p className={styles.invitationNote}>We’ll talk through the current experience, availability, and details before you decide to join.</p>
            <a className={styles.signIn} href={MEMBERSHIP_LINKS.signIn}>Already a member? Sign in <span aria-hidden="true">↗</span></a>
          </div>
        </section>
      </div>
    </main>
  );
}
