"use client";

import { useEffect, useRef, useState } from "react";
import MembershipWaitlistForm from "@/components/public-members/MembershipWaitlistForm";
import { MEMBERSHIP_INTRO, MEMBERSHIP_LINKS } from "@/data/public-membership";
import styles from "./JourneyMembersPreview.module.css";

export default function JourneyMembersPreview({ headingId }: { headingId: string }) {
  const [open, setOpen] = useState(true);
  const film = useRef<HTMLVideoElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const panelId = `${headingId}-registration`;

  useEffect(() => {
    if (!moveFocus.current) return;
    (open ? closeButton : reopenButton).current?.focus({ preventScroll: true });
    moveFocus.current = false;
  }, [open]);

  useEffect(() => {
    const video = film.current;
    if (!video) return;
    const pauseWhenHidden = () => {
      if (document.hidden || video.closest('[hidden], [inert], [aria-hidden="true"], [data-walking]')) video.pause();
    };
    // The walk keeps its rooms mounted. Stop the film as its room leaves view.
    const visibility = new MutationObserver(pauseWhenHidden);
    for (let parent = video.parentElement; parent; parent = parent.parentElement) {
      visibility.observe(parent, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden", "data-walking"] });
    }
    const intersection = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) video.pause();
    });
    intersection.observe(video);
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      visibility.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      video.pause();
    };
  }, []);

  function changeOpen(next: boolean) {
    if (!next) film.current?.pause();
    moveFocus.current = true;
    setOpen(next);
  }

  return (
    <div className={styles.shell} onKeyDown={(event) => {
      if (event.key !== "Escape" || !open) return;
      event.preventDefault();
      event.stopPropagation();
      changeOpen(false);
    }}>
      <button
        ref={reopenButton}
        className={styles.reopen}
        type="button"
        hidden={open}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => changeOpen(true)}
      >
        Join the waitlist <span aria-hidden="true">↗</span>
      </button>
      {/* Keep the form mounted so dismissing it never clears a draft or resets a submission. */}
      <section id={panelId} hidden={!open} className={styles.preview} aria-labelledby={headingId} data-journey-members-preview data-mobile-internal-scroll>
        <button
          ref={closeButton}
          className={styles.close}
          type="button"
          aria-label="Close registration form"
          onClick={() => changeOpen(false)}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
        <figure className={styles.film}>
          <video
            ref={film}
            className={styles.video}
            aria-label="Inside Ruined — membership film"
            controls
            playsInline
            data-cursor-native
            preload="none"
            poster="/media/membership-introduction-poster.jpg"
            width={720}
            height={1280}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <source src="/media/membership-introduction.mp4" type="video/mp4" />
            <a href="/media/membership-introduction.mp4">Watch the membership film</a>
          </video>
          <figcaption><span>Inside Ruined</span><span>2:15</span></figcaption>
        </figure>
        <div className={styles.copy}>
          <p className={styles.label}>Members</p>
          <h2 id={headingId} className="ui-heading">{MEMBERSHIP_INTRO.headline}</h2>
          <p className={styles.description}>Leave your details. We’ll be in touch when membership opens.</p>
          <div className={styles.signup}>
            <MembershipWaitlistForm tone="paper" />
            <a className={styles.signIn} href={MEMBERSHIP_LINKS.signIn}>Member sign-in</a>
          </div>
        </div>
      </section>
    </div>
  );
}
