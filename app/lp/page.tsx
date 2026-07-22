import type { Metadata } from "next";
import Image from "next/image";
import ParallaxHero from "./parallax-hero";
import styles from "./lp.module.css";

export const metadata: Metadata = {
  title: "After the Fear — A Private Six-Week Working Group",
  description:
    "A private six-week working group for founders and creative leaders ready to make a consequential decision and build the next 90 days around it.",
  alternates: { canonical: "/lp" },
  openGraph: {
    title: "After the Fear — A Private Six-Week Working Group",
    description:
      "Six weeks. Twelve seats. A live decision, a clear direction, and a 90-day field plan.",
    images: [{ url: "/after-the-fear-hero.webp", width: 2400, height: 1600 }],
  },
};

const programmeFacts = [
  ["06 weeks", "Live working room"],
  ["12 seats", "Reviewed for fit"],
  ["Weekly", "Decisions, not lessons"],
  ["02 private", "Calibration sessions"],
] as const;

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <ParallaxHero />

      <section className={styles.programme} id="format" aria-labelledby="programme-title">
        <header className={styles.programmeHeader}>
          <p className={styles.sectionLabel}>The room / 01</p>
          <h2 id="programme-title">One decision.<br /><em>Worked all the way through.</em></h2>
          <p>
            Bring a live decision affecting your business, studio, team, or body of work—and the authority to act on it.
          </p>
        </header>

        <dl className={styles.programmeFacts}>
          {programmeFacts.map(([fact, detail]) => (
            <div key={fact}>
              <dt>{fact}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>

        <div className={styles.programmeBrief}>
          <div>
            <span>Leave with</span>
            <p>A clear direction, a focused 90-day field plan, and people who will notice whether you move.</p>
          </div>
          <div>
            <span>The process</span>
            <p>Applications are reviewed personally. If the moment fits, we will invite you to a private 20-minute conversation.</p>
          </div>
          <div className={styles.programmeClose}>
            <p>A working room, <em>not an audience.</em></p>
            <a className={styles.primaryButton} href="#apply">Return to application <span aria-hidden>↑</span></a>
            <small>Expect a reply within two business days.</small>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <a href="#top" aria-label="Return to the top">
          <Image src="/ruined-wordmark.svg" alt="Ruined" width={1000} height={206} />
        </a>
        <p>After the Fear · Private programme 01</p>
        <div><a href="mailto:studio@ruined.studio">studio@ruined.studio</a><a href="/privacy">Privacy</a></div>
        <small>© 2026 The Ruined Project</small>
      </footer>
    </main>
  );
}
