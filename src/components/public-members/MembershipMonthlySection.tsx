"use client";

import { useId, useState, type ComponentType } from "react";
import styles from "./MembershipMonthlySection.module.css";

const stages = [
  {
    name: "SEE",
    title: "Notice what is there.",
    description: "Look closely at the beliefs, habits, and patterns shaping your life. Start with what is actually happening.",
    question: "What story about yourself do you keep repeating?",
    exercise: "Finish the sentence “I’m the kind of person who…” a few different ways. Notice which answers feel like facts.",
    action: "Catch one of those stories as it shows up in an ordinary moment. Write down what happened.",
  },
  {
    name: "FACE",
    title: "Get honest about it.",
    description: "Stay with what you have noticed. Name the fear, discomfort, or cost you might otherwise avoid.",
    question: "What does that story protect you from?",
    exercise: "Choose one repeated story. Write what it helps you avoid, then what it has kept you from trying.",
    action: "Name one real moment when the story made a decision for you. Bring that moment into the conversation.",
  },
  {
    name: "CUT",
    title: "Make room for change.",
    description: "Decide what no longer serves you. Remove an unnecessary belief, obligation, or habit so something else has room.",
    question: "What could you stop doing to keep that story alive?",
    exercise: "Find one habit that reinforces the story. Choose a small, specific way to interrupt it.",
    action: "Try the interruption once. Notice the discomfort without immediately returning to the familiar response.",
  },
  {
    name: "GROW",
    title: "Put it into practice.",
    description: "Turn what you have learned into a choice you can live. Try it, reflect on it, and keep working with what changes.",
    question: "What would you do if the old story were no longer in charge?",
    exercise: "Describe one different response to a familiar situation. Make it small enough to try in your actual life.",
    action: "Try that response. Share what happened with your Circle and decide what to carry forward.",
  },
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

        <details className={styles.sampleDisclosure}>
          <summary><span>Explore a sample month</span><span className={styles.disclosureMark} aria-hidden="true">+</span></summary>
          <div className={styles.sample}>
            <div className={styles.sampleIntro}>
              <p className={styles.eyebrow}>Sample month · Example topic</p>
              <h3>The stories<br />we keep.</h3>
              <p className={styles.sampleNote}>A fictional example, not a scheduled topic.</p>
              <p className={styles.annotation}>Try the method.</p>
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
