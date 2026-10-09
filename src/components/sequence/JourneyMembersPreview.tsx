"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import MembershipLandingModal from "./MembershipLandingModal";
import styles from "./JourneyMembersPreview.module.css";

export default function JourneyMembersPreview({ headingId }: { headingId: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <section className={styles.shell} aria-labelledby={headingId} data-journey-members-preview>
      <h2 id={headingId} className="sr-only">After the fear</h2>
      <button
        ref={trigger}
        type="button"
        className={styles.preview}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Explore Ruined membership"
        onClick={() => setOpen(true)}
      >
        <span className={styles.hero}>
          <span className={styles.copy}>
            <span className={styles.title} aria-hidden="true">After the fear</span>
            <span className={styles.handwritten}>You become the author</span>
            <span className={styles.description}>Honest conversations. Meaningful work.<br />People who follow through.</span>
          </span>
        </span>
        <span className={styles.caption}>
          <span>Explore membership</span>
          <span className={styles.arrow} aria-hidden="true">↗</span>
        </span>
      </button>
      {open && createPortal(
        <MembershipLandingModal onClose={() => setOpen(false)} returnFocus={trigger} />,
        document.body,
      )}
    </section>
  );
}
