"use client";

import { useId, useState, type ComponentType } from "react";
import styles from "./MembershipMonthlySection.module.css";

const stages = [
  {
    name: "SEE",
    title: "Notice what is there.",
    description: "Observe what gets most of your time. Notice the routines, demands, and distractions that shape an ordinary day.",
    question: "Where is your time actually going?",
    exercise: "Map a typical day. Look at what takes your attention, what restores you, and what gets pushed aside.",
    action: "Keep a simple time log for one day. Record what happened without trying to fix it yet.",
  },
  {
    name: "FACE",
    title: "Get honest about it.",
    description: "Compare where your time goes with where you want it to go. Get honest about the gaps, including what you can and cannot control.",
    question: "Does your time reflect what matters to you?",
    exercise: "Put your time log beside your priorities. Name one gap you have been avoiding and what it is costing you.",
    action: "Bring that gap to your Circle. Talk through the choices and real constraints behind it.",
  },
  {
    name: "CUT",
    title: "Make room for change.",
    description: "Decide what deserves less of your time so something that matters can have more of it.",
    question: "What needs less of your time?",
    exercise: "Choose one habit, commitment, or distraction to reduce. Be specific about what that will make room for.",
    action: "Try one boundary: a shorter scroll, a declined obligation, or a protected hour. Notice what becomes possible.",
  },
  {
    name: "GROW",
    title: "Put it into practice.",
    description: "Build a small daily practice that brings your time closer to your priorities. Try it, reflect, and adjust.",
    question: "What will you make time for each day?",
    exercise: "Choose one priority and a realistic daily commitment. Decide when it will happen and what could get in the way.",
    action: "Put that time on your calendar. Share what you tried with your Circle and decide what to keep.",
  },
] as const;

const confirmedMonths = [
  { date: "2026-11", month: "November", year: "2026", topic: "Foundations", note: "Foundations only. Our shared starting point." },
  { date: "2026-12", month: "December", year: "2026", topic: "TIME", note: "Where it goes. What matters. What changes." },
  { date: "2027-01", month: "January", year: "2027", topic: "Reinvention", note: "Who you are becoming. What comes next." },
] as const;

const MembershipMonthlySection: ComponentType<{ ctaLabel: string }> = () => {
  const [selectedStage, setSelectedStage] = useState(0);
  const selectorId = useId();
  const stage = stages[selectedStage];

  return (
    <section className={styles.monthly} id="monthly-work" aria-labelledby="monthly-work-heading">
      <div className={styles.wrap}>
        <div className={styles.overview}>
          <header className={styles.intro}>
            <p className={styles.eyebrow}>The monthly work</p>
            <h2 id="monthly-work-heading">One topic.<br />A month of practice.</h2>
            <p className={styles.cadence}><strong>4 calls</strong><span>90 minutes each</span></p>
          </header>

          <ol className={styles.method} aria-label="The four stages of the monthly work">
            {stages.map((item, index) => (
              <li key={item.name}>
                <div className={styles.stageHeading}><span className={styles.stageNumber} aria-hidden="true">0{index + 1}</span><h3>{item.name}</h3></div>
                <p className={styles.stageTitle}>{item.title}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.roadmap} aria-labelledby="monthly-roadmap-heading">
          <div className={styles.roadmapHeading}>
            <h3 id="monthly-roadmap-heading">Coming up</h3>
            <p>One starting point. Then a new topic each month.</p>
          </div>
          <ol className={styles.months}>
            {confirmedMonths.map(month => (
              <li key={month.date}>
                <time dateTime={month.date}>{month.month} <span>{month.year}</span></time>
                <h4>{month.topic}</h4>
                <p>{month.note}</p>
              </li>
            ))}
          </ol>
          <p className={styles.roadmapNote}>More 2027 topics will be announced as they’re confirmed.</p>
        </div>

        <p className={styles.challenge}><strong>A monthly group challenge.</strong><span>Each topic comes with a small challenge to put the work into practice together.</span></p>

        <details className={styles.sampleDisclosure}>
          <summary><span>Explore a month: TIME</span><span className={styles.disclosureMark} aria-hidden="true">+</span></summary>
          <div className={styles.sample}>
            <div className={styles.sampleIntro}>
              <p className={styles.eyebrow}>December 2026 · TIME</p>
              <h3>Time for<br />what matters.</h3>
              <p className={styles.sampleNote}>An example of how we’ll explore one topic through four different conversations.</p>
              <p className={styles.annotation}>Make room for it.</p>
            </div>
            <div className={styles.sampleWork}>
              <fieldset className={styles.selector}>
                <legend>Explore each stage</legend>
                <div className={styles.selectorOptions}>
                  {stages.map((item, index) => (
                    <label key={item.name} className={styles.selectorOption} data-selected={index === selectedStage}>
                      <input type="radio" name={selectorId} value={item.name} checked={index === selectedStage} onChange={() => setSelectedStage(index)} aria-controls={`${selectorId}-example`} />
                      <span>{item.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className={styles.example} id={`${selectorId}-example`} aria-live="polite" aria-atomic="true">
                <p className={styles.exampleStage}>0{selectedStage + 1} / {stage.name}</p>
                <p className={styles.stageDescription}>{stage.description}</p>
                <h4>{stage.question}</h4>
                <dl>
                  <div><dt>In the call</dt><dd>{stage.exercise}</dd></div>
                  <div><dt>In your life</dt><dd>{stage.action}</dd></div>
                </dl>
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
};

export default MembershipMonthlySection;
