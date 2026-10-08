"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import CursorParallax from "../foundations/CursorParallax";
import SlashTransition from "../foundations/SlashTransition";
import type { FoundationCallSlide } from "./deck-content";
import styles from "./foundations-call.module.css";

const ease = [0.22, 1, 0.36, 1] as const;
const number = (value: number) => String(value).padStart(2, "0");

function Reveal({ children, delay = 0, reduced = false, className = "" }: { children: ReactNode; delay?: number; reduced?: boolean; className?: string }) {
  return <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .66, delay: reduced ? 0 : delay, ease }}>{children}</motion.div>;
}

function TimelineLink() {
  return <a className={styles.timelineLink} href="/foundations/01/timeline" target="_blank" rel="noopener noreferrer">Open your Timeline <span aria-hidden="true">↗</span><span className={styles.srOnly}> (opens in a new tab)</span></a>;
}

function Heading({ slide }: { slide: FoundationCallSlide }) {
  return <header className={styles.contentHeader}>
    {slide.eyebrow && <p className={styles.eyebrow}>{slide.eyebrow}</p>}
    <h1 className={styles.headline}>{slide.headline}</h1>
  </header>;
}

function Footer({ slide }: { slide: FoundationCallSlide }) {
  return slide.footer ? <p className={styles.footnote}>{slide.footer}</p> : null;
}

function Support({ lines }: { lines?: string[] }) {
  return lines ? <div className={styles.support}>{lines.map(line => <p key={line}>{line}</p>)}</div> : null;
}

function WordField({ slide, reduced }: { slide: FoundationCallSlide; reduced: boolean }) {
  const words = slide.steps ?? slide.lines ?? [];
  return <div className={styles.wordField} aria-label={slide.title}>
    {words.map((word, index) => <motion.span key={word} tabIndex={0} initial={reduced ? false : { opacity: 0, y: 30, filter: "blur(7px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: reduced ? 0 : .66, delay: reduced ? 0 : index * .07, ease }} className={styles.fieldWord}>{word}</motion.span>)}
  </div>;
}

function Sequence({ slide, reduced }: { slide: FoundationCallSlide; reduced: boolean }) {
  const [selected, setSelected] = useState(0);
  const items = slide.pairs?.map(pair => ({ title: pair.label, detail: pair.text })) ?? slide.steps?.map(step => ({ title: step, detail: "" })) ?? [];
  const interactive = items.some(item => item.detail);
  return <>
    <ol className={slide.kind === "model" ? styles.model : styles.sequence} data-count={items.length}>
      {items.map((item, index) => <motion.li key={item.title} initial={reduced ? false : { opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .66, delay: reduced ? 0 : index * .11, ease }} data-selected={interactive && selected === index}>
        {interactive ? <button type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}><span className={styles.stepNumber}>{number(index + 1)}</span><span>{item.title}</span><small>{item.detail}</small></button> : <div><span className={styles.stepNumber}>{number(index + 1)}</span><span>{item.title}</span></div>}
      </motion.li>)}
    </ol>
  </>;
}

function Culture({ slide, reduced }: { slide: FoundationCallSlide; reduced: boolean }) {
  const [selected, setSelected] = useState(0);
  return <div className={styles.cultureCards}>
    {slide.pairs?.map((pair, index) => <motion.button type="button" key={pair.label} className={styles.cultureCard} aria-pressed={selected === index} onClick={() => setSelected(index)} initial={reduced ? false : { opacity: 0, y: 35, rotate: 0 }} animate={{ opacity: 1, y: 0, rotate: reduced || selected === index ? 0 : (index % 3 - 1) * .8 }} whileHover={reduced ? {} : { y: -5, rotate: 0 }} transition={{ duration: reduced ? 0 : .45, delay: reduced ? 0 : index * .04, ease }}>
      <span className={styles.stepNumber}>{number(index + 1)}</span><strong>{pair.label}</strong><span>{pair.text}</span>
    </motion.button>)}
  </div>;
}

function EventStory({ slide }: { slide: FoundationCallSlide }) {
  const [share, setShare] = useState(50);
  const pairs = slide.pairs ?? [{ label: "EVENT", text: "What actually happened." }, { label: "STORY", text: "What I decided it meant." }];
  return <>
    <div className={styles.eventStory} style={{ "--event-share": `${share}%` } as CSSProperties}>
      {pairs.map(pair => <section key={pair.label}><p className={styles.eyebrow}>{pair.label}</p><p>{pair.text}</p></section>)}
      <div className={styles.splitDivider} style={{ left: `${share}%` }} aria-hidden="true"><span>↔</span></div>
      <input className={styles.splitRange} type="range" min="30" max="70" value={share} onChange={event => setShare(Number(event.target.value))} aria-label="Explore the distinction between event and story" aria-valuetext={`${share}% event, ${100 - share}% story`} />
    </div>
    <p className={styles.interactionHint}>Drag the divide. Two parts of one experience.</p>
  </>;
}

function Examples({ slide, reduced }: { slide: FoundationCallSlide; reduced: boolean }) {
  const [selected, setSelected] = useState(0);
  const stories = slide.lines ?? slide.steps ?? [];
  const event = slide.pairs?.[0]?.text ?? "";
  return <div className={styles.exampleComposition}>
    <CursorParallax strength={reduced ? 0 : 8} className={styles.eventCardWrap}>
      <div className={styles.eventCard}><span className={styles.eyebrow}>Event</span><p>{event}</p><span className={styles.cardCorner} aria-hidden="true">↗</span></div>
    </CursorParallax>
    <div className={styles.storyChoices} aria-label="Possible stories">
      {stories.map((story, index) => <motion.button type="button" key={story} aria-pressed={selected === index} onClick={() => setSelected(index)} initial={reduced ? false : { opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduced ? 0 : .5, delay: reduced ? 0 : index * .08, ease }}><span>{number(index + 1)}</span><span>{story}</span></motion.button>)}
    </div>
  </div>;
}

function Timeline({ reduced }: { reduced: boolean }) {
  const [active, setActive] = useState(0);
  return <>
    <div className={styles.timeline}>
      <div className={styles.timelineTrack} aria-label="Timeline reflection">
        {["What happened?", "What did you make it mean?"].map((label, index) => <button type="button" key={label} aria-pressed={active === index} onClick={() => setActive(index)}><span className={styles.timelineDot} /><small>{number(index + 1)}</small><span>{label}</span></button>)}
      </div>
      <motion.div className={styles.timelineEmphasis} animate={{ x: active === 0 ? "0%" : "100%" }} transition={{ duration: reduced ? 0 : .6, ease }} aria-hidden="true" />
    </div>
    <TimelineLink />
  </>;
}

function Influence({ slide, reduced }: { slide: FoundationCallSlide; reduced: boolean }) {
  const [selected, setSelected] = useState(0);
  return <div className={styles.influenceCards}>
    {slide.pairs?.map((pair, index) => <motion.button type="button" key={pair.label} aria-pressed={selected === index} onClick={() => setSelected(index)} className={styles.influenceCard} whileHover={reduced ? {} : { y: -5, rotate: 0 }} initial={reduced ? false : { y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1, rotate: reduced || selected === index ? 0 : 1 }} transition={{ duration: reduced ? 0 : .5, ease }}><span className={styles.eyebrow}>The belief</span><h2>{pair.label}</h2><ul>{pair.text.split("\n").map(line => <li key={line}>{line}</li>)}</ul></motion.button>)}
  </div>;
}

function Perspective({ slide, reduced }: { slide: FoundationCallSlide; reduced: boolean }) {
  const [now, setNow] = useState(false);
  const quotes = slide.pairs?.[now ? 1 : 0]?.text.split("\n") ?? [];
  return <>
    <div className={styles.perspectiveTabs} aria-label="Perspective"><button type="button" aria-pressed={!now} onClick={() => setNow(false)}>Then</button><button type="button" aria-pressed={now} onClick={() => setNow(true)}>Now</button></div>
    <div className={styles.perspectiveCards} aria-live="polite">{quotes.map((quote, index) => <motion.div key={`${index}-${now}`} className={styles.perspectiveCard} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .45, ease }}><span className={styles.stepNumber}>{number(index + 1)} / {now ? "Now" : "Then"}</span><p>{quote}</p></motion.div>)}</div>
  </>;
}

function Exercise() {
  const [remaining, setRemaining] = useState(600);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) setDeadline(null);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  function toggle() {
    if (deadline !== null) {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      setDeadline(null);
    } else {
      const seconds = remaining || 600;
      setRemaining(seconds);
      setDeadline(Date.now() + seconds * 1000);
    }
  }
  return <div className={styles.exercise}>
    <div className={styles.timer} role="timer" aria-label="Time remaining">{number(Math.floor(remaining / 60))}<span>:</span>{number(remaining % 60)}</div>
    <div className={styles.timerControls}><button type="button" onClick={toggle}>{deadline !== null ? "Pause" : remaining < 600 && remaining > 0 ? "Resume" : "Start 10 minutes"}</button><button type="button" onClick={() => { setDeadline(null); setRemaining(600); }}>Reset</button></div>
    <p className={styles.srOnly} role="status">{remaining === 0 ? "Your ten minutes are complete. Return to the conversation when you’re ready." : ""}</p>
    <TimelineLink />
  </div>;
}

export default function SlideContent({ slide, reducedMotion = false }: { slide: FoundationCallSlide; reducedMotion?: boolean }) {
  const reduced = reducedMotion;
  if (slide.kind === "cover") return <div className={styles.cover}>
    {!reduced && <SlashTransition className={styles.coverSlash} />}
    <Reveal reduced={reduced}><Image className={styles.coverWordmark} src="/ruined-wordmark.svg" width={174} height={52} alt="Ruined" priority /></Reveal>
    <CursorParallax strength={reduced ? 0 : 10} className={styles.coverComposition}>
      <Reveal delay={.1} reduced={reduced}><h1 className={styles.coverTitle}>Foundations</h1></Reveal>
      <Reveal delay={.23} reduced={reduced} className={styles.coverNumber}><span>01</span></Reveal>
    </CursorParallax>
    <Reveal delay={.36} reduced={reduced} className={styles.coverBottom}><p>Your story. Our story.</p><span>After the fear.</span></Reveal>
  </div>;

  if (slide.kind === "section") return <div className={styles.section} data-content={slide.id}>
    <p className={styles.eyebrow}>{slide.eyebrow}</p>
    <CursorParallax strength={reduced ? 0 : 8}><h1 className={styles.sectionTitle}>{slide.headline}</h1></CursorParallax>
    <Support lines={slide.lines} /><Footer slide={slide} />
  </div>;

  if (slide.kind === "pair" || slide.kind === "review") return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    <div className={styles.storyPair}>{slide.pairs?.map((pair, index) => <Reveal key={pair.label} reduced={reduced} delay={index * .13} className={styles.storyPanel}><span className={styles.stepNumber}>{number(index + 1)}</span><h2>{pair.label}</h2><p>{pair.text}</p></Reveal>)}</div>
    <Support lines={slide.lines} /><Footer slide={slide} />
    {slide.id === "between-calls" && <TimelineLink />}
  </div>;

  return <div className={styles.content} data-content={slide.id}>
    <Heading slide={slide} />
    {slide.kind === "word-field" && <><Support lines={slide.steps ? slide.lines : undefined} /><WordField slide={slide} reduced={reduced} /></>}
    {(slide.kind === "sequence" || slide.kind === "model") && <><Sequence slide={slide} reduced={reduced} /><Support lines={slide.lines} /></>}
    {slide.kind === "definition" && <div className={styles.definitions}>{slide.pairs?.map((pair, index) => <Reveal key={pair.label} reduced={reduced} delay={index * .15}><h2>{pair.label}</h2><ul>{pair.text.split("\n").map(line => <li key={line}>{line}</li>)}</ul></Reveal>)}</div>}
    {slide.kind === "event-story" && <EventStory slide={slide} />}
    {slide.kind === "examples" && <><Support lines={slide.id === "what-did-it-mean" ? slide.steps : undefined} /><Examples slide={slide} reduced={reduced} /></>}
    {slide.kind === "timeline" && <Timeline reduced={reduced} />}
    {slide.kind === "prompts" && (slide.id === "how-we-show-up" ? <Culture slide={slide} reduced={reduced} /> : <>
      {slide.id === "what-happened" && <Support lines={slide.pairs?.map(pair => pair.text)} />}
      <Support lines={slide.steps ? slide.lines : undefined} />
      <ol className={slide.id === "what-happened" ? styles.categories : styles.prompts}>{(slide.steps ?? slide.lines)?.map((line, index) => <li key={line}><span>{number(index + 1)}</span><p>{line}</p></li>)}</ol>
    </>)}
    {slide.kind === "founder" && <div className={styles.founderComposition}><div className={styles.founderName} aria-hidden="true">Ty.</div><ol className={styles.prompts}>{(slide.steps ?? slide.lines)?.map((line, index) => <li key={line}><span>{number(index + 1)}</span><p>{line}</p></li>)}</ol></div>}
    {slide.kind === "date" && <><div className={styles.date}><div><span>Month</span><strong>MM</strong></div><i aria-hidden="true">/</i><div><span>Year</span><strong>YYYY</strong></div></div><Support lines={slide.lines} /></>}
    {slide.kind === "influence" && <><Support lines={slide.lines} /><Influence slide={slide} reduced={reduced} /></>}
    {slide.kind === "perspective" && <Perspective slide={slide} reduced={reduced} />}
    {slide.kind === "exercise" && <><Support lines={slide.lines} /><Exercise /></>}
    {(slide.kind === "statement" || slide.kind === "bridge") && <><Support lines={slide.lines} />{slide.pairs && <div className={styles.statementAside}>{slide.pairs.map(pair => <div key={pair.label}><p className={styles.eyebrow}>{pair.label}</p><p>{pair.text}</p></div>)}</div>}</>}
    <Footer slide={slide} />
  </div>;
}
