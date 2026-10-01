"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MEMBERSHIP_LINKS } from "@/data/public-membership";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";
import MembershipInvitationCard, { MembershipInvitationRoom } from "./MembershipInvitationCard";
import MembershipSignup from "./MembershipSignup";
import MembershipFoundationsSection from "./MembershipFoundationsSection";
import MembershipMonthlySection from "./MembershipMonthlySection";
import MembershipCommunitySection from "./MembershipCommunitySection";
import MembershipOfferSection, { type MembershipLandingMode } from "./MembershipOfferSection";
import MembershipQuestions from "./MembershipQuestions";
import styles from "./MembershipOverview.module.css";

const chapters = [
  { id: "how-it-works", label: "Overview" },
  { id: "foundations", label: "The work" },
  { id: "your-invitation", label: "Pricing & join" },
] as const;

function MembershipSectionNav() {
  const [active, setActive] = useState<string>(chapters[0].id);
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // Include the breathing room used by section scroll margins, including subpixel rounding.
      const edge = (navigation.current?.getBoundingClientRect().bottom ?? 130) + 40;
      let current: string = chapters[0].id;
      for (const chapter of chapters) {
        const section = document.getElementById(chapter.id);
        if (section && section.getBoundingClientRect().top <= edge) current = chapter.id;
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("toggle", schedule, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("toggle", schedule, true);
    };
  }, []);
  return <nav ref={navigation} className={styles.chapterNav} aria-label="Explore membership"><div className={styles.wrap}>
    {chapters.map((chapter, index) => <a key={chapter.id} href={`#${chapter.id}`} aria-current={active === chapter.id ? "location" : undefined}><span aria-hidden="true">0{index + 1}</span>{chapter.label}{chapter.id === "your-invitation" && <span className={styles.joinArrow} aria-hidden="true">↗</span>}</a>)}
  </div></nav>;
}

export default function MembershipOverview({ preview = false, signupEnabled = false, paymentSetupOnly = false, registrationOnly = false }: { preview?: boolean; signupEnabled?: boolean; paymentSetupOnly?: boolean; registrationOnly?: boolean }) {
  const invitationAvailable = signupEnabled || (preview && paymentSetupOnly);
  const mode: MembershipLandingMode = !invitationAvailable ? "waitlist" : paymentSetupOnly ? "payment-setup" : "paid";
  const ctaLabel = invitationAvailable ? "Create my invitation" : "Join the waitlist";
  const [plan, setPlan] = useState<MembershipBillingPlan>("monthly");
  const [recipientName, setRecipientName] = useState("");
  const [registrationLocked, setRegistrationLocked] = useState(false);
  const filmDialog = useRef<HTMLDialogElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  const [filmOpen, setFilmOpen] = useState(false);

  const openFilm = () => {
    const dialog = filmDialog.current;
    const video = film.current;
    if (!dialog || !video) return;
    dialog.showModal();
    setFilmOpen(true);
    // Start within the click gesture so mobile browsers can play with sound.
    void video.play().catch(() => { /* Native controls remain available if playback is interrupted. */ });
  };

  useEffect(() => {
    if (!filmOpen) return;
    const dialog = filmDialog.current;
    const video = film.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      video?.pause();
      document.body.style.overflow = previousOverflow;
    };
  }, [filmOpen]);

  useEffect(() => {
    const video = film.current;
    const pauseHidden = () => { if (document.hidden) video?.pause(); };
    document.addEventListener("visibilitychange", pauseHidden);
    return () => { document.removeEventListener("visibilitychange", pauseHidden); video?.pause(); };
  }, []);

  return <main className={styles.page}>
    <section className={styles.hero} aria-labelledby="membership-title">
      <Image className={styles.heroBackground} src="/membership/hero-couch-wide.jpg" alt="" fill priority sizes="100vw" />
      <div className={`${styles.wrap} ${styles.heroInner}`}>
        <h1 id="membership-title">After the fear<br /><em>You become the author</em></h1>
        <p className={styles.heroDescription}>A personal-development community for honest conversations, meaningful work, and people who follow through. Start with your story. Build what comes next.</p>
        <div className={styles.heroActions}><a className={styles.primary} href="#your-invitation">{ctaLabel}<span aria-hidden="true">↗</span></a><a className={styles.textLink} href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a></div>
        <a className={styles.invitationTeaser} href="#your-invitation" aria-label="See your Ruined invitation">
          <span className={styles.teaserCard} aria-hidden="true"><span>You’re allowed</span><Image src="/ruined-mark.svg" alt="" width={60} height={86} /><span>to become someone new.</span></span>
          <span className={styles.teaserNote}>This is for you.<span>Your invitation awaits ↗</span></span>
        </a>
      </div>
    </section>

    <MembershipSectionNav />

    <section className={styles.meetRuined} id="inside-membership" aria-labelledby="inside-heading">
      <button className={styles.featureFilmTrigger} type="button" onClick={openFilm} aria-label="Play Meet Ruined, 2 minutes 15 seconds">
        <Image src="/ruined-hero-lounge.jpg" alt="" fill sizes="100vw" />
        <span className={styles.featureFilmPlay} aria-hidden="true">▶</span>
        <span className={styles.featureFilmCaption} aria-hidden="true">Watch the film <span>2:15 ↗</span></span>
      </button>
      <h2 className={styles.featureFilmTitle} id="inside-heading">Meet Ruined.</h2>
    </section>

    <section className={`${styles.wrap} ${styles.explanation}`} id="how-it-works" aria-labelledby="how-heading">
      <div className={styles.explanationIntro}><div><p className={styles.eyebrow}>One community. A shared practice.</p><h2 id="how-heading">A place to begin.<br />People to keep going with.</h2></div></div>
      <ol className={styles.journeyMap} aria-label="Your membership journey">
        <li><a href="#foundations"><span>01<span> / BEGIN</span></span><h3>Foundations <span aria-hidden="true">↗</span></h3><strong>4 live virtual sessions · 90 minutes each</strong><p>A one-time starting point before the ongoing monthly work.</p></a></li>
        <li><a href="#monthly-work"><span>02<span> / PRACTICE</span></span><h3>Each Month <span aria-hidden="true">↗</span></h3><strong>1 topic · 4 calls · A group challenge</strong><p>SEE. FACE. CUT. GROW. Put the work into your life.</p></a></li>
        <li><a href="#circles"><span>03<span> / CONNECT</span></span><h3>Your Circle <span aria-hidden="true">↗</span></h3><strong>8–12 people · Twice a month</strong><p>Familiar faces. Honest conversation and follow-through.</p></a></li>
      </ol>
    </section>

    <MembershipFoundationsSection ctaLabel={ctaLabel} />
    <MembershipMonthlySection ctaLabel={ctaLabel} />
    <MembershipCommunitySection ctaLabel={ctaLabel} />
    <section className={styles.invitationBand} id="your-invitation" aria-labelledby="invitation-heading">
      <MembershipInvitationRoom className={styles.invitationRoom} frameToCard>
      <div className={`${styles.wrap} ${styles.invitationGrid}`}>
        <div className={styles.invitationArt}>
          <p className={styles.eyebrow}>From The Ruined Project. To you.</p>
          <h2 id="invitation-heading">It starts with<br /><em>an invitation.</em></h2>
          <MembershipInvitationCard recipientName={recipientName} />
        </div>
        <div className={styles.registration}>
          <div className={styles.invitationSignup} id="membership-details">
            <h3>{invitationAvailable ? "Make it yours." : "Be here for the beginning."}</h3>
            <MembershipSignup compact showPricing={false} registrationOnly={registrationOnly} previewInvitation={preview && mode === "payment-setup"} paymentSetupOnly={mode === "payment-setup"} enabled={signupEnabled} preview={preview} plan={plan} onPlanChange={setPlan} onRecipientNameChange={setRecipientName} onRequestStateChange={setRegistrationLocked} />
          </div>
          <div className={styles.registrationPricing}>
            <MembershipOfferSection plan={plan} onPlanChange={setPlan} mode={mode} registrationOnly={registrationOnly} disabled={registrationLocked} />
          </div>
          <p className={styles.alreadyMember}>Already a member? <Link href={preview ? "/access" : MEMBERSHIP_LINKS.signIn}>Sign in ↗</Link></p>
        </div>
      </div>
      </MembershipInvitationRoom>
    </section>

    <section className={`${styles.wrap} ${styles.nextSteps}`} aria-labelledby="next-heading">
      <div><h2 id="next-heading">How it starts.</h2></div>
      <ol>
        <li><span>01</span><h3>{mode === "waitlist" ? "Join the list." : "Make your invitation."}</h3><p>{mode === "waitlist" ? "Leave your details. We’ll email you when it’s time to begin." : "Add your name and watch your card become yours. Create your invitation right here."}</p></li>
        <li><span>02</span><h3>{mode === "waitlist" ? "Hear from Ruined." : "Verify your email."}</h3><p>{mode === "waitlist" ? "You’ll receive the next steps and the membership offer before deciding to join." : registrationOnly ? "Enter your email code, then fill out your information." : "Enter the confirmation code we send to your email to continue to your profile."}</p></li>
        <li><span>03</span><h3>{mode === "waitlist" ? "Get ready to begin." : registrationOnly ? "You’re registered." : "Make your profile."}</h3><p>{registrationOnly && mode !== "waitlist" ? "Save your card securely, with no charge today. Your welcome email confirms registration. We’ll send another email when your profile is ready." : mode === "paid" ? "Choose your member tag, complete your profile, and review your agreement. Confirm payment to activate membership." : mode === "payment-setup" ? "Create your profile and review your agreement. Saving a card is optional; no charge or paid membership starts until you explicitly confirm payment." : "When membership opens, review your agreement and confirm payment before starting Foundations."}</p></li>
      </ol>
    </section>


    <MembershipQuestions mode={mode} registrationOnly={registrationOnly} />

    <div className={styles.finalNote}><p>What happens next is still yours.</p><span>After the fear.</span></div>

    <dialog ref={filmDialog} className={styles.filmDialog} aria-label="Ruined membership film" onClose={() => setFilmOpen(false)} onCancel={() => setFilmOpen(false)} onClick={event => { if (event.target === event.currentTarget) setFilmOpen(false); }}>
      <button className={styles.filmClose} type="button" aria-label="Close film" onClick={() => setFilmOpen(false)}>Close <span aria-hidden="true">×</span></button>
      <video ref={film} controls playsInline preload="none" data-cursor-native poster="/media/membership-introduction-poster.jpg" width={720} height={1280} aria-label="Inside Ruined — membership film"><source src="/media/membership-introduction.mp4" type="video/mp4" /><a href="/media/membership-introduction.mp4">Watch the membership film</a></video>
    </dialog>
  </main>;
}
