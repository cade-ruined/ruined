"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  FOUNDATION_FINAL_OVERVIEW,
  FOUNDATION_MOMENTS,
  FOUNDATION_SESSIONS,
  type FoundationChapterId,
  type FoundationFounder,
  type FoundationReflection,
} from "@/data/foundations";
import ChapterOverview from "./ChapterOverview";
import CursorParallax from "./CursorParallax";
import FilmGrain from "./FilmGrain";
import FounderArtifact from "./FounderArtifact";
import PhilosophyNoise from "./PhilosophyNoise";
import PresenterControls from "./PresenterControls";
import ProgressPath from "./ProgressPath";
import ReflectionPrompt from "./ReflectionPrompt";
import RuinedMarkBuilder, {
  type RuinedMarkProgress,
} from "./RuinedMarkBuilder";
import SlashTransition from "./SlashTransition";
import WordSequence from "./WordSequence";
import styles from "./foundations.module.css";

type ReflectionValues = Record<string, string>;

const CHAPTER_STARTS = FOUNDATION_SESSIONS.map((session) => ({
  number: session.number,
  title: session.title,
  id: session.id,
  momentIndex: FOUNDATION_MOMENTS.findIndex(
    (moment) =>
      "chapterId" in moment &&
      moment.chapterId === session.id &&
      moment.kind === "chapter-opening"
  ),
}));

const EDITING_TARGET =
  "input, textarea, select, [contenteditable='true'], [role='slider']";
const ACTIVATION_TARGET = "button, a, [role='button']";

const revealTransition = {
  duration: 0.66,
  ease: [0.22, 1, 0.36, 1] as const,
};

function revealFor(
  reducedMotion: boolean,
  delay = 0,
  duration = revealTransition.duration
) {
  return reducedMotion
    ? { duration: 0, delay: 0 }
    : { ...revealTransition, duration, delay };
}

function createInitialResponses(): ReflectionValues {
  return Object.fromEntries(
    FOUNDATION_SESSIONS.flatMap((session) =>
      session.reflection.fields.map((field) => [field.id, field.placeholder])
    )
  );
}

function chapterForMoment(index: number): FoundationChapterId | undefined {
  const moment = FOUNDATION_MOMENTS[index];
  return "chapterId" in moment ? moment.chapterId : undefined;
}

export default function PresentationShell() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const momentRefs = useRef<(HTMLElement | null)[]>([]);
  const reduceMotion = useReducedMotion();
  const [activeMoment, setActiveMoment] = useState(0);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [grainEnabled, setGrainEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [responses, setResponses] =
    useState<ReflectionValues>(createInitialResponses);
  const [responsesDirty, setResponsesDirty] = useState(false);
  const [responsibility, setResponsibility] = useState(50);
  const [cultureCommitted, setCultureCommitted] = useState(false);
  const [letterStep, setLetterStep] = useState(0);
  const [letterComplete, setLetterComplete] = useState(false);
  const [closingOverview, setClosingOverview] = useState(false);
  const [selectedDna, setSelectedDna] = useState("perspective");
  const [selectedArtifact, setSelectedArtifact] = useState("letter");
  const [selectedResponses, setSelectedResponses] = useState<string[]>([]);
  const [experienceRevision, setExperienceRevision] = useState(0);

  const currentChapter = chapterForMoment(activeMoment);
  const activeLabel = FOUNDATION_MOMENTS[activeMoment]?.label ?? "";

  const symbolProgress = useMemo<RuinedMarkProgress>(() => {
    if (activeMoment >= 21 || letterComplete) return 4;
    if (activeMoment >= 18) return 3;
    if (activeMoment >= 13) return 2;
    if (activeMoment >= 8) return 1;
    return 0;
  }, [activeMoment, letterComplete]);

  const scrollToMoment = useCallback(
    (index: number) => {
      const clamped = Math.max(
        0,
        Math.min(index, FOUNDATION_MOMENTS.length - 1)
      );
      momentRefs.current[clamped]?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    },
    [reduceMotion]
  );

  const goNext = useCallback(() => {
    if (activeMoment === FOUNDATION_MOMENTS.length - 1) {
      setClosingOverview(true);
      return;
    }
    scrollToMoment(activeMoment + 1);
  }, [activeMoment, scrollToMoment]);

  const goPrevious = useCallback(() => {
    if (activeMoment === FOUNDATION_MOMENTS.length - 1 && closingOverview) {
      setClosingOverview(false);
      return;
    }
    scrollToMoment(activeMoment - 1);
  }, [activeMoment, closingOverview, scrollToMoment]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const strongest = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!strongest) return;
        const index = Number((strongest.target as HTMLElement).dataset.index);
        if (Number.isFinite(index)) setActiveMoment(index);
      },
      {
        root: scroller,
        rootMargin: "-12% 0px -12% 0px",
        threshold: [0.12, 0.25, 0.4, 0.6],
      }
    );

    momentRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1) as FoundationChapterId;
    const chapter = CHAPTER_STARTS.find((item) => item.id === hash);
    if (!chapter) return;
    requestAnimationFrame(() => scrollToMoment(chapter.momentIndex));
  }, [scrollToMoment]);

  useEffect(() => {
    if (!currentChapter) return;
    const nextHash = `#${currentChapter}`;
    if (window.location.hash === nextHash) return;
    window.history.replaceState(null, "", nextHash);
  }, [currentChapter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (overviewOpen) return;
      const target = event.target as HTMLElement | null;

      if (event.key === "Escape") {
        event.preventDefault();
        setOverviewOpen(true);
        return;
      }
      if (target?.closest(EDITING_TARGET)) return;
      if (event.code === "Space" && target?.closest(ACTIVATION_TARGET)) return;

      if (
        event.key === "ArrowRight" ||
        event.key === "ArrowDown" ||
        event.key === "PageDown" ||
        event.code === "Space"
      ) {
        event.preventDefault();
        goNext();
      } else if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowUp" ||
        event.key === "PageUp"
      ) {
        event.preventDefault();
        goPrevious();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, overviewOpen]);

  const jumpToChapter = (chapterId: FoundationChapterId) => {
    const chapter = CHAPTER_STARTS.find((item) => item.id === chapterId);
    if (!chapter) return;
    setOverviewOpen(false);
    scrollToMoment(chapter.momentIndex);
  };

  const restart = () => {
    if (
      responsesDirty &&
      !window.confirm(
        "Restart Foundations? Your in-memory reflection edits will be reset."
      )
    ) {
      return;
    }
    setResponses(createInitialResponses());
    setResponsesDirty(false);
    setResponsibility(50);
    setCultureCommitted(false);
    setLetterStep(0);
    setLetterComplete(false);
    setClosingOverview(false);
    setOverviewOpen(false);
    setGrainEnabled(true);
    setSoundEnabled(false);
    setSelectedDna("perspective");
    setSelectedArtifact("letter");
    setSelectedResponses([]);
    setExperienceRevision((revision) => revision + 1);
    window.history.replaceState(null, "", "/foundations");
    scrollToMoment(0);
  };

  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      // Fullscreen is an optional presenter enhancement.
    }
  };

  return (
    <main
      className={`${styles.shell} bg-black text-[#f5f3ee]`}
      data-grain={grainEnabled ? "on" : "off"}
    >
      <FilmGrain enabled={grainEnabled && !reduceMotion} />

      <header className={styles.presentationHeader}>
        <button
          type="button"
          className={styles.presentationIdentity}
          onClick={() => setOverviewOpen(true)}
          aria-label="Open Foundations chapter overview"
        >
          <span>RUINED</span>
          <i aria-hidden />
          <span>FOUNDATIONS</span>
        </button>

        <div className={styles.presentationStatus}>
          <RuinedMarkBuilder
            progress={symbolProgress}
            className={styles.headerMark}
          />
          <span>
            {String(activeMoment + 1).padStart(2, "0")} /{" "}
            {FOUNDATION_MOMENTS.length}
          </span>
          <span>{soundEnabled ? "AMBIENT / ON" : "AMBIENT / OFF"}</span>
        </div>
      </header>

      <div
        ref={scrollerRef}
        className={styles.scroller}
        aria-label="Ruined Foundations presentation"
      >
        {FOUNDATION_MOMENTS.map((moment, index) => (
          <section
            key={moment.id}
            id={moment.id}
            ref={(node) => {
              momentRefs.current[index] = node;
            }}
            data-index={index}
            data-active={activeMoment === index ? "true" : "false"}
            data-stage={moment.stage}
            data-kind={moment.kind}
            className={`${styles.moment} ${momentTheme(moment.kind)}`}
            aria-label={`${index + 1} of ${FOUNDATION_MOMENTS.length}: ${
              moment.label
            }`}
            aria-current={activeMoment === index ? "step" : undefined}
          >
            <div className={styles.momentInner}>
              {renderMoment({
                moment,
                index,
                active: activeMoment === index,
                reducedMotion: !!reduceMotion,
                responses,
                onResponseChange: (fieldId, value) =>
                  {
                    setResponsesDirty(true);
                    setResponses((current) => ({
                      ...current,
                      [fieldId]: value,
                    }));
                  },
                responsibility,
                setResponsibility,
                cultureCommitted,
                setCultureCommitted,
                letterStep,
                setLetterStep,
                letterComplete,
                setLetterComplete,
                closingOverview,
                setClosingOverview,
                selectedDna,
                setSelectedDna,
                selectedArtifact,
                setSelectedArtifact,
                selectedResponses,
                setSelectedResponses,
                experienceRevision,
                jumpToChapter,
                goNext,
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        Moment {activeMoment + 1} of {FOUNDATION_MOMENTS.length}: {activeLabel}
      </p>

      <nav className={styles.primaryArrows} aria-label="Moment navigation">
        <button
          type="button"
          onClick={goPrevious}
          disabled={activeMoment === 0 && !closingOverview}
          aria-label="Previous presentation moment"
        >
          <span aria-hidden>↑</span>
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={
            activeMoment === FOUNDATION_MOMENTS.length - 1 && closingOverview
          }
          aria-label="Next presentation moment"
        >
          <span aria-hidden>↓</span>
        </button>
      </nav>

      <ProgressPath
        chapters={CHAPTER_STARTS}
        activeMoment={activeMoment}
        totalMoments={FOUNDATION_MOMENTS.length}
        onSelect={scrollToMoment}
      />

      <PresenterControls
        key={experienceRevision}
        canGoPrevious={activeMoment > 0 || closingOverview}
        canGoNext={
          activeMoment < FOUNDATION_MOMENTS.length - 1 || !closingOverview
        }
        grainEnabled={grainEnabled}
        soundEnabled={soundEnabled}
        overviewOpen={overviewOpen}
        onPrevious={goPrevious}
        onNext={goNext}
        onOverview={() => setOverviewOpen(true)}
        onToggleGrain={() => setGrainEnabled((value) => !value)}
        onToggleSound={() => setSoundEnabled((value) => !value)}
        onRestart={restart}
        onFullscreen={enterFullscreen}
      />

      <ChapterOverview
        open={overviewOpen}
        chapters={FOUNDATION_SESSIONS}
        currentChapterId={currentChapter}
        onClose={() => setOverviewOpen(false)}
        onSelect={jumpToChapter}
      />
    </main>
  );
}

type RenderMomentProps = {
  moment: (typeof FOUNDATION_MOMENTS)[number];
  index: number;
  active: boolean;
  reducedMotion: boolean;
  responses: ReflectionValues;
  onResponseChange: (fieldId: string, value: string) => void;
  responsibility: number;
  setResponsibility: (value: number) => void;
  cultureCommitted: boolean;
  setCultureCommitted: (value: boolean) => void;
  letterStep: number;
  setLetterStep: (value: number) => void;
  letterComplete: boolean;
  setLetterComplete: (value: boolean) => void;
  closingOverview: boolean;
  setClosingOverview: (value: boolean) => void;
  selectedDna: string;
  setSelectedDna: (value: string) => void;
  selectedArtifact: string;
  setSelectedArtifact: (value: string) => void;
  selectedResponses: string[];
  setSelectedResponses: (value: string[]) => void;
  experienceRevision: number;
  jumpToChapter: (chapterId: FoundationChapterId) => void;
  goNext: () => void;
};

function renderMoment(props: RenderMomentProps) {
  const { moment, active } = props;

  switch (moment.kind) {
    case "entry-mark":
      return (
        <div className={styles.entryComposition}>
          <SlashTransition active={active} />
          <motion.div
            className={styles.entryTitle}
            initial={
              props.reducedMotion
                ? false
                : { clipPath: "inset(0 100% 0 0)", opacity: 0 }
            }
            animate={
              active
                ? { clipPath: "inset(0 0 0 0)", opacity: 1 }
                : { clipPath: "inset(0 100% 0 0)", opacity: 0 }
            }
            transition={revealFor(props.reducedMotion, 1.15, 0.85)}
          >
            <div className={styles.entryWordmark}>
              <Image
                src="/ruined-wordmark.svg"
                alt={moment.content.wordmark}
                width={1000}
                height={206}
                priority
                draggable={false}
              />
            </div>
            <h1>{moment.content.title}</h1>
            <span>{moment.content.supportingLine}</span>
          </motion.div>
          <button
            type="button"
            className={styles.enterPrompt}
            onClick={props.goNext}
          >
            <span>{moment.content.prompt}</span>
            <i aria-hidden>→</i>
          </button>
        </div>
      );

    case "statement":
      return (
        <div className={styles.statementMoment}>
          <p className={styles.momentIndex}>00 / A SHARED BEGINNING</p>
          <h2>
            {moment.content.lines.map((line, lineIndex) => (
              <motion.span
                key={line}
                initial={false}
                animate={
                  active
                    ? {
                        clipPath: "inset(-18% -8% -36% -8%)",
                        y: 0,
                      }
                    : {
                        clipPath: "inset(-18% -8% 118% -8%)",
                        y: 28,
                      }
                }
                transition={revealFor(
                  props.reducedMotion,
                  lineIndex * 0.14
                )}
              >
                {line}
              </motion.span>
            ))}
          </h2>
          <span className={styles.cropRule} aria-hidden />
        </div>
      );

    case "purpose":
      return (
        <div className={styles.purposeMoment}>
          <div>
            <p className={styles.eyebrow}>Purpose / 00.3</p>
            <h2>
              This is not{" "}
              <span className={styles.removedWord}>
                {moment.content.removedWord}
              </span>
              .
            </h2>
          </div>
          <motion.div
            className={styles.purposeReplacement}
            initial={
              props.reducedMotion
                ? false
                : {
                    opacity: 0,
                    y: 30,
                    clipPath: "inset(0 0 100% 0)",
                  }
            }
            whileInView={{
              opacity: 1,
              y: 0,
              clipPath: "inset(0 0 0 0)",
            }}
            viewport={{ once: true, amount: 0.35 }}
            transition={revealFor(props.reducedMotion, 0.12)}
          >
            <h3>{moment.content.replacement}</h3>
            <p>{moment.content.body}</p>
          </motion.div>
        </div>
      );

    case "chapter-path":
      return (
        <div className={styles.chapterPathMoment}>
          <div className={styles.chapterPathIntro}>
            <p className={styles.eyebrow}>Four chapters / One beginning</p>
            <h2>{moment.content.title}</h2>
          </div>
          <ol className={styles.chapterPathList}>
            {moment.content.chapters.map((chapter) => (
              <li key={chapter.id}>
                <button
                  type="button"
                  onClick={() => props.jumpToChapter(chapter.id)}
                >
                  <span>{chapter.number}</span>
                  <strong>{chapter.title}</strong>
                  <small>{chapter.coreQuestion}</small>
                  <i aria-hidden>↗</i>
                </button>
              </li>
            ))}
          </ol>
        </div>
      );

    case "chapter-opening":
      return (
        <ChapterOpening
          number={moment.content.number}
          title={moment.content.title}
          questionLines={moment.content.questionLines}
          chapterId={moment.chapterId}
          active={active}
          reducedMotion={props.reducedMotion}
        />
      );

    case "founder-artifact":
      return (
        <FounderMoment
          founder={moment.content}
          experienceRevision={props.experienceRevision}
        />
      );

    case "teaching":
      return (
        <div className={styles.teachingMoment}>
          <div className={styles.teachingLead}>
            <p className={styles.eyebrow}>The Reframe / Teaching</p>
            <h2>WHAT REMAINS WHEN THE ORIGINAL PURPOSE IS REMOVED?</h2>
          </div>
          <ol className={styles.teachingStatements}>
            {moment.content.statements.map((statement, statementIndex) => (
              <motion.li
                key={statement.id}
                initial={
                  props.reducedMotion
                    ? false
                    : {
                        opacity: 0,
                        y: 24,
                        clipPath: "inset(0 0 100% 0)",
                      }
                }
                whileInView={{
                  opacity: 1,
                  y: 0,
                  clipPath: "inset(0 0 0 0)",
                }}
                viewport={{ once: true, amount: 0.45 }}
                transition={revealFor(
                  props.reducedMotion,
                  statementIndex * 0.08
                )}
              >
                <span>{String(statementIndex + 1).padStart(2, "0")}</span>
                <p>{statement.text}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      );

    case "reflection":
      return (
        <div className={styles.reflectionMoment}>
          <ReflectionPrompt
            key={`${moment.id}-${props.experienceRevision}`}
            reflection={moment.content}
            values={props.responses}
            onChange={props.onResponseChange}
            onAction={
              moment.content.kind === "commitment"
                ? () => props.setCultureCommitted(true)
                : props.goNext
            }
            actionComplete={
              moment.content.kind === "commitment"
                ? props.cultureCommitted
                : false
            }
          />
          <aside className={styles.reflectionMark}>
            <RuinedMarkBuilder
              progress={
                moment.content.kind === "commitment" && props.cultureCommitted
                  ? 3
                  : moment.chapterId === "culture"
                    ? 2
                    : moment.chapterId === "philosophy"
                      ? 2
                      : 1
              }
            />
            <span>YOUR WORDS STAY IN THIS MOMENT.</span>
          </aside>
        </div>
      );

    case "philosophy-reframe":
      return (
        <ResponsibilityMoment
          value={props.responsibility}
          onChange={props.setResponsibility}
          content={moment.content}
          active={active}
        />
      );

    case "noise-to-meaning":
      return (
        <PhilosophyNoise
          fragments={moment.content.fragments}
          result={moment.content.result}
          active={active}
        />
      );

    case "culture-code":
      return (
        <CultureCodeMoment
          content={moment.content}
          selectedDna={props.selectedDna}
          onSelectDna={props.setSelectedDna}
          reducedMotion={props.reducedMotion}
        />
      );

    case "path-and-artifacts":
      return (
        <CulturePathMoment
          content={moment.content}
          selectedArtifact={props.selectedArtifact}
          onSelectArtifact={props.setSelectedArtifact}
          active={active}
          reducedMotion={props.reducedMotion}
        />
      );

    case "founder-and-membership":
      return (
        <MembershipMoment
          founder={moment.content.founder}
          membership={moment.content.membership}
          reducedMotion={props.reducedMotion}
          experienceRevision={props.experienceRevision}
        />
      );

    case "letter":
      return (
        <FutureLetter
          reflection={moment.content}
          values={props.responses}
          onChange={props.onResponseChange}
          step={props.letterStep}
          onStepChange={props.setLetterStep}
          complete={props.letterComplete}
          onComplete={() => {
            props.setLetterComplete(true);
            window.setTimeout(props.goNext, 520);
          }}
          reducedMotion={props.reducedMotion}
        />
      );

    case "welcome-and-overview":
      return (
        <ClosingMoment
          content={moment.content}
          showOverview={props.closingOverview}
          onEnter={() => props.setClosingOverview(true)}
          selected={props.selectedResponses}
          onToggle={(id) =>
            props.setSelectedResponses(
              props.selectedResponses.includes(id)
                ? props.selectedResponses.filter((item) => item !== id)
                : [...props.selectedResponses, id]
            )
          }
          active={active}
          reducedMotion={props.reducedMotion}
        />
      );
  }
}

function momentTheme(kind: (typeof FOUNDATION_MOMENTS)[number]["kind"]) {
  if (kind === "reflection" || kind === "letter") return styles.momentPaper;
  if (kind === "purpose" || kind === "chapter-path")
    return styles.momentBone;
  if (kind === "culture-code" || kind === "path-and-artifacts")
    return styles.momentTable;
  return styles.momentDark;
}

function ChapterOpening({
  number,
  title,
  questionLines,
  chapterId,
  active,
  reducedMotion,
}: {
  number: string;
  title: string;
  questionLines: readonly string[];
  chapterId: FoundationChapterId;
  active: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className={styles.chapterOpening} data-chapter={chapterId}>
      <div className={styles.chapterRegistration}>
        <span>{number}</span>
        <strong>{title.toUpperCase()}</strong>
        <i aria-hidden />
      </div>
      <h2>
        {questionLines.map((line, index) => {
          const interruptions = line.includes("INTERRUPTIONS");
          const invitations = line.includes("INVITATIONS");
          return (
            <motion.span
              key={line}
              className={`${interruptions ? styles.interruptions : ""} ${
                invitations ? styles.invitations : ""
              }`}
              initial={false}
              animate={
                active
                  ? {
                      x: interruptions ? [0, -8, 5, 0] : 0,
                      opacity: 1,
                      clipPath: "inset(-12% -6% -24% -6%)",
                    }
                  : {
                      x: index % 2 ? 42 : -42,
                      opacity: 0,
                      clipPath: "inset(-12% 106% -24% -6%)",
                    }
              }
              transition={revealFor(reducedMotion, index * 0.11)}
            >
              {line}
            </motion.span>
          );
        })}
      </h2>
      <div className={styles.chapterOpeningMark}>
        <RuinedMarkBuilder
          progress={
            chapterId === "story"
              ? 1
              : chapterId === "philosophy"
                ? 2
                : chapterId === "culture"
                  ? 3
                  : 4
          }
        />
      </div>
    </div>
  );
}

function FounderMoment({
  founder,
  experienceRevision,
}: {
  founder: FoundationFounder;
  experienceRevision: number;
}) {
  return (
    <div className={styles.founderMoment}>
      <CursorParallax className={styles.founderArtifactWrap} strength={14}>
        <FounderArtifact key={experienceRevision} founder={founder} />
      </CursorParallax>
      <div className={styles.founderCopy}>
        <p className={styles.eyebrow}>
          {founder.name} / {founder.role} / {founder.duration}
        </p>
        <blockquote>
          {founder.quote.split("\n").map((line) => (
            <span key={`${founder.name}-${line}`}>{line || "\u00a0"}</span>
          ))}
        </blockquote>

        {founder.storyFramework ? (
          <ol className={styles.storyFramework}>
            {founder.storyFramework.map((beat, index) => (
              <li key={beat.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{beat.label}</strong>
                <p>{beat.body}</p>
              </li>
            ))}
          </ol>
        ) : null}

        {founder.supportingCopy ? (
          <div className={styles.founderSupporting}>
            {founder.supportingCopy.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResponsibilityMoment({
  value,
  onChange,
  content,
  active,
}: {
  value: number;
  onChange: (value: number) => void;
  content: Extract<
    (typeof FOUNDATION_MOMENTS)[number],
    { kind: "philosophy-reframe" }
  >["content"];
  active: boolean;
}) {
  const diagram =
    content.responsibility.kind === "responsibility-diagram"
      ? content.responsibility
      : null;
  if (!diagram) return null;

  return (
    <div className={styles.responsibilityMoment}>
      <div className={styles.responsibilityHeader}>
        <p className={styles.eyebrow}>Responsibility / Choice</p>
        {content.words.kind === "word-sequence" ? (
          <WordSequence words={content.words.words} active={active} />
        ) : null}
        <h2>FROM BLAME TO RESPONSIBILITY.</h2>
      </div>
      <div
        className={styles.responsibilitySplit}
        style={
          {
            "--left-share": `${value}%`,
            "--right-share": `${100 - value}%`,
          } as CSSProperties
        }
      >
        <div className={styles.responsibilityLeft}>
          <h2>{diagram.left}</h2>
          <p>{diagram.leftLabel}</p>
        </div>
        <div className={styles.responsibilityRight}>
          <h2>{diagram.right}</h2>
          <p>{diagram.rightLabel}</p>
        </div>
        <input
          className={styles.responsibilityRange}
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label="Shift emphasis from what happened to what I choose next"
          aria-valuetext={`${100 - value}% emphasis on what I choose next`}
        />
        <span
          className={styles.responsibilityDivider}
          style={{ left: `${value}%` }}
          aria-hidden
        >
          <i />
        </span>
      </div>
    </div>
  );
}

function CultureCodeMoment({
  content,
  selectedDna,
  onSelectDna,
  reducedMotion,
}: {
  content: Extract<
    (typeof FOUNDATION_MOMENTS)[number],
    { kind: "culture-code" }
  >["content"];
  selectedDna: string;
  onSelectDna: (id: string) => void;
  reducedMotion: boolean;
}) {
  if (content.dna.kind !== "dna" || content.expectations.kind !== "expectations")
    return null;

  return (
    <div className={styles.cultureCodeMoment}>
      <div className={styles.dnaBlock}>
        <p className={styles.eyebrow}>03 / Physical principles</p>
        <h2>{content.dna.title}</h2>
        <div className={styles.dnaTable}>
          {content.dna.cards.map((card, index) => (
            <motion.button
              key={card.id}
              type="button"
              className={`${styles.dnaCard} ${
                selectedDna === card.id ? styles.dnaCardSelected : ""
              }`}
              onClick={() => onSelectDna(card.id)}
              aria-pressed={selectedDna === card.id}
              initial={
                reducedMotion
                  ? false
                  : { y: 44, rotate: 0, opacity: 0 }
              }
              whileInView={{
                y: 0,
                rotate: (index % 3 - 1) * 1.2,
                opacity: 1,
              }}
              viewport={{ once: true, amount: 0.35 }}
              transition={revealFor(reducedMotion, index * 0.06)}
            >
              <small>DNA / {String(index + 1).padStart(2, "0")}</small>
              <strong>{card.title}</strong>
              <span>{card.statement}</span>
            </motion.button>
          ))}
        </div>
      </div>
      <div className={styles.expectationsBlock}>
        <p className={styles.eyebrow}>Culture / Expectations</p>
        <h3>{content.expectations.title}</h3>
        <ol>
          {content.expectations.expectations.map((item, index) => (
            <motion.li
              key={item.id}
              initial={
                reducedMotion ? false : { y: 18, opacity: 0 }
              }
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={revealFor(
                reducedMotion,
                index * 0.06
              )}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item.statement}
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function CulturePathMoment({
  content,
  selectedArtifact,
  onSelectArtifact,
  active,
  reducedMotion,
}: {
  content: Extract<
    (typeof FOUNDATION_MOMENTS)[number],
    { kind: "path-and-artifacts" }
  >["content"];
  selectedArtifact: string;
  onSelectArtifact: (id: string) => void;
  active: boolean;
  reducedMotion: boolean;
}) {
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [activePathStep, setActivePathStep] = useState(0);

  useEffect(() => {
    if (!active) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const centered = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!centered) return;
        const index = Number((centered.target as HTMLElement).dataset.pathIndex);
        if (Number.isFinite(index)) setActivePathStep(index);
      },
      { rootMargin: "-34% 0px -34% 0px", threshold: [0.15, 0.45, 0.8] }
    );
    stepRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [active]);

  return (
    <div className={styles.culturePathMoment}>
      <div className={styles.verticalPath}>
        <p className={styles.eyebrow}>The Path / From event to identity</p>
        <ol
          style={
            {
              "--path-progress":
                (activePathStep + 1) / content.path.steps.length,
            } as CSSProperties
          }
        >
          {content.path.steps.map((step, index) => (
            <motion.li
              key={step.id}
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
              data-path-index={index}
              data-centered={activePathStep === index ? "true" : "false"}
              initial={
                reducedMotion ? false : { opacity: 0, y: 18 }
              }
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={revealFor(reducedMotion, index * 0.05)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </motion.li>
          ))}
        </ol>
      </div>
      <div className={styles.museumBlock}>
        <div className={styles.museumIntro}>
          <p className={styles.eyebrow}>Why artifacts matter</p>
          {content.artifacts.statements.map((statement) => (
            <p key={statement}>{statement}</p>
          ))}
        </div>
        <div className={styles.museumGrid}>
          {content.artifacts.objects.map((object, index) => (
            <button
              key={object.id}
              type="button"
              className={`${styles.museumObject} ${
                selectedArtifact === object.id
                  ? styles.museumObjectSelected
                  : ""
              }`}
              onClick={() => onSelectArtifact(object.id)}
              aria-pressed={selectedArtifact === object.id}
            >
              <i aria-hidden data-object={object.id} />
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{object.label}</strong>
              <small>{content.artifacts.reveal}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MembershipMoment({
  founder,
  membership,
  reducedMotion,
  experienceRevision,
}: {
  founder: FoundationFounder;
  membership: Extract<
    (typeof FOUNDATION_SESSIONS)[number]["teaching"][number],
    { kind: "membership" }
  >;
  reducedMotion: boolean;
  experienceRevision: number;
}) {
  return (
    <div className={styles.membershipMoment}>
      <div className={styles.membershipArtifact}>
        <FounderArtifact key={experienceRevision} founder={founder} />
        <p>
          {founder.name} / {founder.role} / {founder.duration}
        </p>
      </div>
      <div className={styles.membershipCopy}>
        <blockquote>{founder.quote}</blockquote>
        <ol>
          {membership.statements.map((statement, index) => (
            <motion.li
              key={statement}
              initial={
                reducedMotion
                  ? false
                  : {
                      opacity: 0,
                      y: 18,
                      clipPath: "inset(0 0 100% 0)",
                    }
              }
              whileInView={{
                opacity: 1,
                y: 0,
                clipPath: "inset(0 0 0 0)",
              }}
              viewport={{ once: true, amount: 0.5 }}
              transition={revealFor(reducedMotion, index * 0.08)}
            >
              {statement}
            </motion.li>
          ))}
        </ol>
        <h2>
          {membership.closing.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h2>
      </div>
    </div>
  );
}

function FutureLetter({
  reflection,
  values,
  onChange,
  step,
  onStepChange,
  complete,
  onComplete,
  reducedMotion,
}: {
  reflection: FoundationReflection;
  values: ReflectionValues;
  onChange: (fieldId: string, value: string) => void;
  step: number;
  onStepChange: (step: number) => void;
  complete: boolean;
  onComplete: () => void;
  reducedMotion: boolean;
}) {
  const field = reflection.fields[step];
  const percent = Math.round(((step + 1) / reflection.fields.length) * 100);

  return (
    <div className={styles.letterMoment}>
      <div className={styles.letterTitle}>
        <p className={styles.eyebrow}>04 / Final reflection</p>
        <h2>
          A LETTER
          <span>TO YOUR FUTURE SELF</span>
        </h2>
        <RuinedMarkBuilder progress={complete ? 4 : 3} />
      </div>
      <div className={styles.letterSheet}>
        <div className={styles.letterProgress}>
          <span>
            {String(step + 1).padStart(2, "0")} /{" "}
            {String(reflection.fields.length).padStart(2, "0")}
          </span>
          <div aria-hidden>
            <i style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
          <strong>{percent}%</strong>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.label
            key={field.id}
            className={styles.letterField}
            initial={{ opacity: 0, x: 48, clipPath: "inset(0 0 0 100%)" }}
            animate={{ opacity: 1, x: 0, clipPath: "inset(0 0 0 0)" }}
            exit={{ opacity: 0, x: -48, clipPath: "inset(0 100% 0 0)" }}
            transition={revealFor(reducedMotion)}
          >
            <span>{field.label}</span>
            <textarea
              value={values[field.id] ?? field.placeholder}
              onChange={(event) => onChange(field.id, event.target.value)}
              rows={7}
            />
          </motion.label>
        </AnimatePresence>
        <div className={styles.letterControls}>
          <button
            type="button"
            onClick={() => onStepChange(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            ← Back
          </button>
          {step < reflection.fields.length - 1 ? (
            <button type="button" onClick={() => onStepChange(step + 1)}>
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={onComplete}
              aria-pressed={complete}
            >
              {complete ? "Letter complete" : reflection.actionLabel} ↗
            </button>
          )}
        </div>
        <p>{reflection.interactionNote}</p>
      </div>
    </div>
  );
}

function ClosingMoment({
  content,
  showOverview,
  onEnter,
  selected,
  onToggle,
  active,
  reducedMotion,
}: {
  content: Extract<
    (typeof FOUNDATION_MOMENTS)[number],
    { kind: "welcome-and-overview" }
  >["content"];
  showOverview: boolean;
  onEnter: () => void;
  selected: string[];
  onToggle: (id: string) => void;
  active: boolean;
  reducedMotion: boolean;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {!showOverview ? (
        <motion.div
          key="welcome"
          className={styles.welcomeMoment}
          initial={false}
          animate={
            active
              ? { opacity: 1, clipPath: "inset(0 0 0 0)" }
              : { opacity: 0, clipPath: "inset(0 0 18% 0)" }
          }
          exit={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
          transition={revealFor(reducedMotion, 0.18, 0.7)}
        >
          <RuinedMarkBuilder progress={4} className={styles.welcomeMark} />
          <div>
            <h2>{content.welcome.title}</h2>
            <motion.h3
              initial={false}
              animate={
                active ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }
              }
              transition={revealFor(reducedMotion, 0.8, 0.7)}
            >
              {content.welcome.secondaryTitle}
            </motion.h3>
          </div>
          <div className={styles.welcomeBody}>
            {content.welcome.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <button type="button" className={styles.cutButton} onClick={onEnter}>
            <span>{content.welcome.actionLabel}</span>
            <span aria-hidden>→</span>
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="overview"
          className={styles.finalOverview}
          initial={{ opacity: 0, clipPath: "inset(100% 0 0 0)" }}
          animate={{ opacity: 1, clipPath: "inset(0 0 0 0)" }}
          transition={revealFor(reducedMotion)}
        >
          <div className={styles.completedChapters}>
            <p className={styles.eyebrow}>Foundations / Complete</p>
            <ol>
              {content.overview.chapters.map((chapter, index) => (
                <li key={chapter.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{chapter.title}</strong>
                  <i>COMPLETE</i>
                </li>
              ))}
            </ol>
            <div className={styles.finalSummary}>
              {content.overview.summary.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
          <div className={styles.discussionBlock}>
            <h2>{content.overview.discussionQuestion}</h2>
            <div className={styles.responseCards}>
              {content.overview.responseCards.map((response) => (
                <button
                  key={response.id}
                  type="button"
                  onClick={() => onToggle(response.id)}
                  aria-pressed={selected.includes(response.id)}
                >
                  {response.label}
                </button>
              ))}
            </div>
            <p className={styles.responseSentence}>
              {content.overview.selectionLead}
              {selected.length
                ? ` ${selected
                    .map(
                      (id) =>
                        FOUNDATION_FINAL_OVERVIEW.responseCards.find(
                          (item) => item.id === id
                        )?.label.toLowerCase()
                    )
                    .filter(Boolean)
                    .join(", ")}.`
                : "…"}
            </p>
            <ol className={styles.discussionAgenda}>
              {content.overview.agenda.map((item, index) => (
                <li key={item}>
                  <span>0{index + 1}</span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
