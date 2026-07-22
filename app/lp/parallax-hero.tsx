import Image from "next/image";
import LeadForm from "./lead-form";
import styles from "./lp.module.css";

export default function ParallaxHero() {
  return (
    <section className={styles.hero} id="top" aria-labelledby="landing-title">
      <Image
        className={styles.heroImage}
        src="/after-the-fear-hero.webp"
        alt="A woman walking through shadowed concrete architecture crossed by sunlight"
        fill
        sizes="100vw"
        priority
      />
      <div className={styles.heroWash} aria-hidden />

      <nav className={styles.nav} aria-label="Landing page navigation">
        <a href="#top" aria-label="After the Fear — home">
          <Image src="/ruined-wordmark.svg" alt="Ruined" width={1000} height={206} priority />
        </a>
        <div className={styles.navMeta} aria-hidden>
          Private programme&nbsp;&nbsp;/&nbsp;&nbsp;01
        </div>
        <a className={styles.navCta} href="#apply">
          Request an invitation <span aria-hidden>↘</span>
        </a>
      </nav>

      <div className={styles.heroBody}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Ruined presents · After the Fear</p>
          <h1 id="landing-title" className={styles.heroTitle}>
            After<br /><em>the fear.</em>
          </h1>
          <p className={styles.heroCopy}>
            Six weeks for founders and creative leaders ready to turn one consequential decision into a focused 90-day field plan.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#apply">
              Request an invitation <span aria-hidden>↘</span>
            </a>
          </div>

          <div className={styles.videoPlaceholder} role="img" aria-label="Placeholder for the After the Fear programme film">
            <div>
              <span>Film / 01</span>
              <strong>After the Fear</strong>
            </div>
            <p>Programme film forthcoming</p>
            <span aria-hidden>16:09</span>
          </div>
        </div>
      </div>

      <LeadForm />
    </section>
  );
}
