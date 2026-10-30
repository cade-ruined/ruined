import type { TimelineReflection } from "@/lib/membership/journal-model";
import styles from "./TimelineStoryContent.module.css";

const questions = [
  { field: "meaning", label: "What I made it mean", number: "01" },
  { field: "belief", label: "What I started believing", number: "02" },
  { field: "presentImpact", label: "How it shows up now", number: "03" },
  { field: "perspective", label: "What I can see now", number: "04" },
] as const;

/** Only render the publication snapshot, never legacy private Foundations answers. */
export default function TimelineStoryContent({ reflection }: { reflection?: TimelineReflection | null }) {
  if (!reflection || !questions.some(({ field }) => reflection[field]?.trim())) return null;
  return <div className={styles.reflections} aria-label="The story in perspective">
    {questions.map(({ field, label, number }) => reflection[field]?.trim() ? <section className={styles.reflection} data-tone={field} key={field}>
      <header><span aria-hidden="true">{number}</span><h4>{label}</h4></header>
      <p>{reflection[field]}</p>
    </section> : null)}
  </div>;
}
