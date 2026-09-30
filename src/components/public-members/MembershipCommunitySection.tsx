import Image from "next/image";
import type { CSSProperties, FC } from "react";
import styles from "./MembershipCommunitySection.module.css";

const circlePortraits = [
  { image: 1, x: 16, y: 4, size: 25, position: "50% 42%" },
  { image: 2, x: 39, y: 0, size: 27, position: "50% 42%" },
  { image: 3, x: 64, y: 7, size: 24, position: "50% 42%" },
  { image: 4, x: 3, y: 32, size: 24, position: "50% 42%" },
  { image: 5, x: 51, y: 30, size: 25, position: "50% 42%" },
  { image: 6, x: 74, y: 35, size: 23, position: "50% 42%" },
  { image: 7, x: 15, y: 60, size: 25, position: "50% 42%" },
  { image: 8, x: 39, y: 59, size: 28, position: "50% 42%" },
  { image: 9, x: 65, y: 61, size: 25, position: "50% 42%" },
];

const MembershipCommunitySection: FC<{ ctaLabel: string }> = () => {
  return <section className={styles.circles} id="circles" aria-labelledby="circle-heading">
    <div className={styles.layout}>
      <figure className={styles.documentary}>
        <div className={styles.photo}>
          <Image src="/events/byob-01/gallery/01-img-8059.webp" alt="People gathered on the shore of Tibble Fork Reservoir at a past Ruined event." fill sizes="(min-width: 760px) 55vw, 100vw" />
        </div>
      </figure>

      <div className={styles.copy}>
        <h2 id="circle-heading">Your Circle</h2>
        <div className={styles.circleOverview}>
          <p className={styles.lead}>8–12 people.<br /> Familiar faces,<br /> twice a month.</p>
          <div className={styles.circleCluster} role="img" aria-label="An illustrative Circle: you surrounded by nine people.">
            {circlePortraits.map(({ image, x, y, size, position }) => <span
              key={image}
              className={styles.portrait}
              style={{ "--x": `${x}%`, "--y": `${y}%`, "--size": `${size}%` } as CSSProperties}
              aria-hidden="true"
            >
              <Image src={`/membership/circle/portrait-${image}.webp`} alt="" fill sizes="(min-width: 760px) 90px, 100px" style={{ objectPosition: position }} />
            </span>)}
            <span className={styles.you} aria-hidden="true">You</span>
          </div>
        </div>

        <div className={styles.disclosures}>
          <details open>
            <summary>How your Circle works<span aria-hidden="true">+</span></summary>
            <div className={`${styles.detailContent} ${styles.circleDetails}`}>
              <div className={styles.detailIntro}>
                <h3>Smaller rooms.<br />Deeper work.<br />Real relationships.</h3>
                <p>Every Ruined member becomes part of a smaller Circle of 8–12 people, designed to create something the larger Membership calls can’t: space to be known, to contribute, to go deeper, and to be held accountable.</p>
                <p>Circles are designed for continuity and familiarity, while still having room to evolve as the Ruined community grows.</p>
              </div>

              <div className={styles.detailBlock}>
                <h3 className={styles.detailLabel}>Your Circle does two things</h3>
                <ol className={styles.purposes}>
                  <li>
                    <span className={styles.purposeNumber}>01</span>
                    <div>
                      <h4>Understand the WHY</h4>
                      <p>One Circle meeting each month goes underneath the monthly topic. Why does this matter to you? Where is it showing up? What patterns are you noticing? What are you avoiding? What’s underneath it?</p>
                      <p>This is where members have space to <strong>talk, listen, understand, and be understood.</strong></p>
                    </div>
                  </li>
                  <li>
                    <span className={styles.purposeNumber}>02</span>
                    <div>
                      <h4>Implement the work</h4>
                      <p>The second Circle meeting focuses on what you’re actually doing with the work. What did you change? What did you try? Where did you follow through? Where didn’t you? What are you doing next?</p>
                      <p>This turns <strong>insight into action and action into accountability.</strong></p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className={styles.detailBlock}>
                <h3 className={styles.detailLabel}>The Circle rhythm</h3>
                <dl className={styles.rhythm}>
                  <div><dt>8–12 members</dt><dd>Small enough to create meaningful conversation, trust, and connection.</dd></div>
                  <div><dt>2 calls each month</dt><dd>One focused on the WHY. One focused on IMPLEMENTATION.</dd></div>
                  <div className={styles.rhythmWide}><dt>Familiar faces. Room to evolve.</dt><dd>Circles are built for continuity, but they aren’t meant to stay frozen forever. As Membership grows, Circles may grow, evolve, or divide to form new groups. <strong>New relationships will form. Familiar faces will remain.</strong></dd></div>
                  <div className={styles.rhythmWide}><dt>Everyone participates</dt><dd>Circles aren’t something you watch. Members are expected to show up, contribute, listen, and help create the experience for everyone in the room.</dd></div>
                </dl>
              </div>

              <div className={styles.detailBlock}>
                <h3 className={styles.detailLabel}>Why Circles matter</h3>
                <p className={styles.circleStatement}>The big room helps you see the work.<br />The small room helps you live it.</p>
                <p>Over time, people begin to know your story, your patterns, your goals, your wins, your struggles, your commitments, and your progress. That’s when community becomes more than people attending the same calls. It becomes <strong>people who actually know you.</strong></p>
              </div>

              <div className={`${styles.detailBlock} ${styles.outcome}`}>
                <h3 className={styles.detailLabel}>The outcome</h3>
                <p className={styles.circleStatement}>Don’t go through the work anonymously.</p>
                <p>Circles create a smaller place inside Ruined where you can be seen, contribute to others, have honest conversations, and turn what you’re learning into something you actually live.</p>
              </div>
            </div>
          </details>
          <details open>
            <summary>The people and the commitment<span aria-hidden="true">+</span></summary>
            <div className={styles.detailContent}>
              <h3>Behind Foundations</h3>
              <dl className={styles.founders}>
                <div><dt>Tyler</dt><dd>The Story</dd></div><div><dt>Mitch</dt><dd>The Philosophy</dd></div><div><dt>Cade</dt><dd>The Culture</dd></div><div><dt>Libby</dt><dd>The Commitment</dd></div>
              </dl>
              <p>Show up, listen with curiosity, and speak honestly. Be willing to question your assumptions, try something between conversations, and contribute to someone else’s progress.</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  </section>;
};

export default MembershipCommunitySection;
