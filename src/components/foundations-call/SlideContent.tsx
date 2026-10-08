"use client";

import { useState } from "react";
import Image from "next/image";
import type { FoundationCallSlide } from "./deck-content";
import styles from "./foundations-call.module.css";

const TIMELINE_URL = "/foundations/01/timeline";

function TimelineLink() {
  return <a className={styles.timelineLink} href={TIMELINE_URL} target="_blank" rel="noopener noreferrer">Open your Timeline <span aria-hidden="true">↗</span><span className={styles.srOnly}> (opens the worksheet in a new tab)</span></a>;
}

function Heading({ slide }: { slide: FoundationCallSlide }) {
  return <>
    {slide.eyebrow && <p className={styles.eyebrow}>{slide.eyebrow}</p>}
    <h1 className={styles.headline}>{slide.headline}</h1>
  </>;
}

function Footer({ slide }: { slide: FoundationCallSlide }) {
  return slide.footer ? <p className={styles.footnote}>{slide.footer}</p> : null;
}

function EventStory() {
  const [example, setExample] = useState(0);
  const examples = [
    { label: "Betrayal", event: "Someone betrayed me.", stories: ["I’m not enough.", "People can’t be trusted.", "People eventually leave.", "I was stupid for trusting them."] },
    { label: "Business", event: "My business failed.", stories: ["I’m a failure.", "I can’t trust myself.", "Risk is dangerous.", "I need to prove everyone wrong."] },
  ];
  const selected = examples[example];
  return <>
    <div className={styles.exampleSelector} aria-label="Example">
      {examples.map((item, index) => <button key={item.label} type="button" aria-pressed={example === index} onClick={() => setExample(index)}>{item.label}</button>)}
    </div>
    <div className={styles.eventStory} aria-live="polite">
      <section><p className={styles.eyebrow}>Event</p><p className={styles.definition}>What actually happened.</p><p className={styles.event}>{selected.event}</p></section>
      <section><p className={styles.eyebrow}>Story</p><p className={styles.definition}>What I decided it meant.</p><ul className={styles.stories}>{selected.stories.map(story => <li key={story}>{story}</li>)}</ul></section>
    </div>
  </>;
}

function Timeline() {
  return <figure className={styles.timeline} aria-label="Example life timeline from birth to today, with events above the line and meanings below it">
    <figcaption><span>What happened?</span><span>Illustrative moments</span></figcaption>
    <div className={styles.timelineEvents}>
      <div><p>Dad left</p><span className={styles.pin} /><p>People leave.</p></div>
      <div><p>Won a championship</p><span className={styles.pin} /><p>I’m valuable<br />when I win.</p></div>
      <div><p>Built a successful company</p><span className={styles.pin} /><p>I can figure<br />anything out.</p></div>
    </div>
    <div className={styles.timelineEnds}><span>Birth</span><span>Today</span></div>
    <p className={styles.timelineQuestion}>What did I make it mean?</p>
  </figure>;
}

export default function SlideContent({ slide }: { slide: FoundationCallSlide }) {
  if (slide.kind === "cover") return <div className={styles.cover}>
    <Image className={styles.coverWordmark} src="/ruined-wordmark.svg" width={174} height={52} alt="Ruined" priority />
    <h1 className={styles.coverTitle}>Foundations <span>01</span></h1>
    <p className={styles.coverLine}>Your story. Our story.</p>
    <p className={styles.signature}>After the fear.</p>
  </div>;

  if (slide.id === "your-story-our-story" || slide.kind === "review") return <div className={styles.content} data-content={slide.id}>
    <p className={styles.eyebrow}>{slide.kind === "review" ? "What we began to see" : "A shared beginning"}</p>
    <h1 className={styles.srOnly}>{slide.headline}</h1>
    <div className={styles.storyPair}>{slide.pairs?.map((pair, index) => <section key={pair.label}>
      <span className={styles.pairNumber}>0{index + 1}</span><h2>{pair.label}</h2><p>{pair.text}</p>
    </section>)}</div>
    {slide.lines && <div className={styles.roadmap} aria-label={slide.kind === "review" ? "What we learned" : "Today’s path"}>{slide.lines.map((line, i) => <span key={line}><small>{String(i + 1).padStart(2, "0")}</small>{line}</span>)}</div>}
    <Footer slide={slide} />
  </div>;

  if (slide.id === "between-calls") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    <div className={styles.support}>{slide.pairs?.map(pair => <p key={pair.label}>{pair.label.toLowerCase()}</p>)}</div>
    <p className={styles.footnote}>No forced gratitude, forgiveness, positive lesson, or reframe.<br />Just get curious.</p>
    <TimelineLink />
  </div>;

  if (slide.kind === "sequence" || slide.kind === "model") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    <ol className={slide.kind === "model" ? styles.model : styles.sequence} aria-label={slide.title}>
      {slide.steps?.map((step, i) => <li key={step}><span className={styles.stepNumber}>{String(i + 1).padStart(2, "0")}</span><span>{step}</span>{i < (slide.steps?.length ?? 0) - 1 && <span className={styles.connector} aria-hidden="true">→</span>}</li>)}
    </ol>
    {slide.lines && <div className={styles.support}>{slide.lines.map(line => <p key={line}>{line}</p>)}</div>}
    <Footer slide={slide} />
  </div>;

  if (slide.kind === "event-story") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} /><EventStory /><Footer slide={slide} />
  </div>;

  if (slide.kind === "timeline") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} /><Timeline />
    <div className={styles.timelineBottom}><p>One life.<br />More than one kind of story.</p><TimelineLink /></div>
  </div>;

  if (slide.kind === "examples") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    <div className={styles.examples}>
      <div className={styles.exampleLabels}><span>What happened</span><span>What I made it mean</span></div>
      {slide.pairs?.map(pair => <div className={styles.exampleRow} key={pair.label}><p>{pair.label}</p><span aria-hidden="true">→</span><p>{pair.text}</p></div>)}
    </div>
    <Footer slide={slide} />
  </div>;

  if (slide.kind === "prompts") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    <ol className={styles.prompts}>{(slide.lines ?? slide.steps)?.map((line, index) => <li key={line}><span>{String(index + 1).padStart(2, "0")}</span><p>{line}</p></li>)}</ol>
    <Footer slide={slide} />
  </div>;

  if (slide.kind === "founder") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    <div className={styles.founderQuestions}>{(slide.lines ?? slide.steps)?.map(line => <p key={line}>{line}</p>)}</div>
    <Footer slide={slide} />
  </div>;

  return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    {slide.pairs && <div className={styles.contrasts}>{slide.pairs.map(pair => <div key={pair.label}><span>{pair.label}</span><span aria-hidden="true">/</span><span>{pair.text}</span></div>)}</div>}
    {slide.lines && <div className={styles.support}>{slide.lines.map(line => <p key={line}>{line}</p>)}</div>}
    {slide.steps && <div className={styles.wordField}>{slide.steps.map(step => <span key={step}>{step}</span>)}</div>}
    <Footer slide={slide} />
    {slide.kind === "bridge" && <p className={styles.signature}>After the fear.</p>}
  </div>;
}
