"use client";

import { useId, useState, type FC } from "react";
import styles from "./MembershipFoundationsSection.module.css";

const foundationsPurpose = [
  {
    title: "Understand Ruined",
    description: "Learn what Ruined is, why it exists, what we believe, and what we are building together. Honesty, vulnerability, ownership, contribution, accountability, and doing the real work shape the culture.",
  },
  {
    title: "Understand your story",
    description: "Explore the experiences, decisions, and defining moments that shaped who you are today. Use the Ruined Timeline to examine what happened and the meaning you gave it.",
  },
  {
    title: "Understand yourself",
    description: "Recognize the beliefs, behaviors, and patterns that continue to influence your life. Get honest about where you are today: what is working, what is not, and what needs your attention.",
  },
  {
    title: "Understand what comes next",
    description: "Learn how to show up as a Ruined member. Understand the monthly experience, SEE / FACE / CUT / GROW, Circles, accountability, and your role in the community.",
  },
] as const;

// Fictional exercise material, never presented as member data or testimonials.
const timelineExamples = [
  {
    year: "2019",
    title: "Moving somewhere new",
    detail: "I moved to a city where I knew almost no one.",
    then: "Everyone else seemed to have their people already. I thought starting over meant I was behind.",
    now: "I was learning how to reach out. The friendships I have now started with a few uncomfortable first conversations.",
  },
  {
    year: "2022",
    title: "A job I didn’t get",
    detail: "The role I had been working toward went to someone else.",
    then: "I took the decision as proof that I wasn’t good enough. I couldn’t see another direction.",
    now: "The disappointment was real. It also made me ask whether I wanted that work, or just wanted to be chosen.",
  },
  {
    year: "2025",
    title: "Making a different choice",
    detail: "I stepped away from a project I no longer believed in.",
    then: "I thought changing my mind meant I had wasted the time I put into it.",
    now: "That time taught me what I care about. I can use what I learned without continuing in the same direction.",
  },
] as const;

const letterExample = [
  { prompt: "This is where I am.", response: "I am at the beginning of something I cannot see all the way through yet." },
  { prompt: "This is what I am leaving behind.", response: "Waiting until I feel certain before taking the first step." },
  { prompt: "This is who I am rebuilding into.", response: "Someone who follows through on small decisions, even when no one is watching." },
  { prompt: "These are the promises I am making.", response: "I will make time for the people I care about. I will ask for help sooner. I will make something before deciding I cannot." },
  { prompt: "If you are reading this…", response: "Remember what mattered enough to begin. Make room for it again." },
] as const;

const MembershipFoundationsSection: FC<{ ctaLabel: string }> = () => {
  const [selectedExample, setSelectedExample] = useState(1);
  const example = timelineExamples[selectedExample];
  const timelinePanelId = useId();

  return (
    <section className={styles.section} id="foundations" aria-labelledby="foundations-heading">
      <div className={styles.wrap}>
        <div className={styles.exhibit}>
          <header className={styles.introduction}>
            <h2 className={styles.title} id="foundations-heading">Your starting point</h2>
            <p className={styles.sessionMeta}><span>4 live virtual sessions</span><span>90 minutes each</span></p>
            <p className={styles.introDescription}>Complete Foundations once at the start of membership, before the ongoing monthly work. Understand Ruined, your story, and how to show up for what comes next.</p>
          </header>

          <div className={styles.cards}>
          <details className={styles.disclosure} data-tone="blue">
            <summary>
              <span className={styles.cardHeading}><span>Your Timeline</span><span>Revisit a moment. See it differently.</span></span>
              <span className={styles.expandIcon} aria-hidden="true">+</span>
            </summary>
            <div className={styles.cardBody}>
          <figure className={styles.timeline}>
            <figcaption className={styles.timelineCaption}>
              <span>Your Timeline</span>
              <span>Illustrative exercise</span>
            </figcaption>
            <div className={styles.timelineChoices} role="group" aria-label="Choose a fictional Timeline moment">
              {timelineExamples.map((moment, index) => (
                <button
                  className={styles.momentButton}
                  type="button"
                  key={moment.year}
                  aria-pressed={index === selectedExample}
                  aria-controls={timelinePanelId}
                  onClick={() => setSelectedExample(index)}
                >
                  <span className={styles.timelineDot} aria-hidden="true" />
                  <span className={styles.momentYear}>{moment.year}</span>
                  <span className={styles.momentName}>{moment.title}</span>
                </button>
              ))}
            </div>
            <div className={styles.timelinePanel} id={timelinePanelId} aria-live="polite" aria-atomic="true">
              <div className={styles.event}>
                <p className={styles.eventYear}>{example.year}</p>
                <h3>{example.title}</h3>
                <p className={styles.eventDetail}>{example.detail}</p>
              </div>
              <div className={styles.perspectives}>
                <div className={styles.perspective}>
                  <h4>Then</h4>
                  <p className={styles.perspectiveLabel}>What I believed it meant</p>
                  <p className={styles.perspectiveText}>{example.then}</p>
                </div>
                <div className={`${styles.perspective} ${styles.perspectiveNow}`}>
                  <h4>Now</h4>
                  <p className={styles.perspectiveLabel}>What I can see today</p>
                  <p className={styles.perspectiveText}>{example.now}</p>
                </div>
              </div>
            </div>
            <p className={styles.fictionNotice}>Select a year to explore. These are fictional examples, not member stories.</p>
          </figure>
            </div>
          </details>

          <details className={styles.disclosure} data-tone="green">
            <summary>
              <span className={styles.cardHeading}><span>The 4 live virtual sessions</span><span>90 minutes each. A shared starting point.</span></span>
              <span className={styles.expandIcon} aria-hidden="true">+</span>
            </summary>
            <div className={styles.cardBody}>
              <div className={styles.foundationsIntro}>
                <h3>The starting point for every member.</h3>
                <p>Foundations helps you understand the community, understand yourself, and learn how to show up for the work ahead. Everyone completes it once before entering the ongoing Membership experience.</p>
              </div>
              <p className={styles.sectionLabel}>Foundations does four things</p>
              <ol className={styles.sessions} aria-label="What Foundations helps you understand">
                {foundationsPurpose.map(purpose => (
                  <li className={styles.session} key={purpose.title}>
                    <div className={styles.sessionHeading}><h4>{purpose.title}</h4></div>
                    <p className={styles.sessionDescription}>{purpose.description}</p>
                  </li>
                ))}
              </ol>
              <div className={styles.outcome}>
                <p className={styles.sectionLabel}>The outcome</p>
                <h3>Enter Membership ready.</h3>
                <p>With shared language, clear expectations, a better understanding of your story and patterns, and an understanding of what it means to be part of Ruined.</p>
              </div>
            </div>
          </details>

          <details className={styles.disclosure} data-tone="yellow">
            <summary>
              <span className={styles.cardHeading}><span>Read an example</span><span>A letter to your future self.</span></span>
              <span className={styles.expandIcon} aria-hidden="true">+</span>
            </summary>
            <div className={`${styles.cardBody} ${styles.letterContent}`}>
              <div className={styles.letterIntroduction}>
                <p className={styles.body}>Five prompts help you name what you are carrying forward. Write from where you are today, in your own words.</p>
                <p className={styles.exerciseNote}>Illustrative exercise. This letter is fictional.</p>
              </div>
              <div className={styles.letterPage}>
                <p className={styles.letterSalutation}>To my future self,</p>
                <ol className={styles.letterPrompts}>
                  {letterExample.map(part => (
                    <li key={part.prompt}><h3>{part.prompt}</h3><p>{part.response}</p></li>
                  ))}
                </ol>
                <p className={styles.letterSignoff}>Keep going.</p>
              </div>
            </div>
          </details>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MembershipFoundationsSection;
