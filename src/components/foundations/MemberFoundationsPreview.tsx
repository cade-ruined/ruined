import Image from "next/image";

import styles from "./MemberFoundationsPreview.module.css";

export default function MemberFoundationsPreview() {
  return (
    <main className={`member-journey-page ${styles.page}`}>
      <section aria-labelledby="foundations-preview-title" className={styles.opening}>
        <div aria-hidden="true" className={styles.artwork}>
          <Image
            alt=""
            className={styles.photograph}
            fill
            priority
            sizes="(max-width: 600px) 100vw, (max-width: 1023px) 90vw, 960px"
            src="/membership/foundations/beginning.webp"
          />
        </div>

        <header className={styles.header}>
          <h1 className="member-page-title" id="foundations-preview-title">Foundations</h1>
          <p className={styles.status}>
            <span aria-hidden="true" className={styles.lock} />
            Coming soon
          </p>
          <p className={styles.intro}>Foundations will open at launch.</p>
        </header>
      </section>
    </main>
  );
}
