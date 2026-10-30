import Image from "next/image";

import styles from "./MemberFoundationsHome.module.css";

export default function MemberFoundationsHome() {
  return (
    <main className={`member-journey-page ${styles.page}`}>
      <div className={styles.opening}>
        <div aria-hidden="true" className={styles.artwork}>
          <Image
            alt=""
            aria-hidden="true"
            className={styles.photograph}
            fill
            priority
            sizes="(max-width: 600px) 100vw, (max-width: 1023px) 90vw, 1100px"
            src="/membership/foundations/beginning.webp"
          />
        </div>
        <header className={styles.header}>
          <p className={`member-handwritten ${styles.eyebrow}`}>Your practice</p>
          <h1 className="member-page-title">Foundations</h1>
          <p className={styles.intro}>
            Make room for what matters.
          </p>
        </header>

        <section aria-label="Foundations 01 presentation" className={styles.practice}>
          <p className={styles.deckLabel}>Foundations 01</p>
          <div className={styles.resume}>
            <p className={styles.moment}>After the Fear.</p>
            {/* This route returns standalone HTML, not a Next.js page payload. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className={`member-button member-button-primary ${styles.continue}`} href="/my/foundations/deck">
              <span>Open Foundations 01</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p className={styles.privacy}>Explore the presentation at your own pace.</p>
        </section>
      </div>

    </main>
  );
}
