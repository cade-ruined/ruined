"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MEMBERSHIP_LINKS } from "@/data/public-membership";
import { formatMembershipPrice, MEMBERSHIP_PLANS } from "@/lib/membership/pricing";
import MembershipSignup from "./MembershipSignup";
import styles from "./MembershipOverview.module.css";

const includes = [
  { number: "01", title: "Foundations", detail: "A clearer starting point.", body: "Guided reflection, your personal timeline, and practical work to understand where you are and what you want to build.", image: "/membership/archive-material-placeholder.webp", alt: "An editorial study of cloth, worked metal, and unfinished paper.", className: "foundations" },
  { number: "02", title: "Your Circle", detail: "People to do the work with.", body: "Up to ten members, guided by a Shaper. A smaller space for honest conversation, shared work, and showing up for one another.", image: "/ruined-hero-lounge.jpg", alt: "A warm gathering room with worn leather seating.", className: "circle" },
  { number: "03", title: "Beyond the screen", detail: "Put it into practice.", body: "Learning resources to return to and opportunities to gather in person. Bring what you’re working on into the rest of your life.", image: "/events/byob-01/gallery/01-img-8059.webp", alt: "People gathering at a Ruined community event beside Tibble Fork.", className: "experiences" },
];

const questions = [
  { question: "Do I need an invitation?", answer: "You can request your own personal invitation from The Ruined Project when membership opens. Choose your plan and leave your name and email. If a member invited you, use their invitation link and the email address it was sent to." },
  { question: "When do I pay?", answer: "At signup. Your first monthly payment or full annual payment is due when you join. Review your plan and membership terms, then confirm payment to start your membership. Standard invitations follow the same payment step." },
  { question: "What if my invitation is complimentary?", answer: "Your invitation will say so, including an end date if one applies. You’ll complete your profile and agreement without a payment step. Complimentary access does not automatically become a paid subscription." },
  { question: "Are gatherings and physical items included?", answer: "Each experience lists its own access, availability, and any separate cost. Specific garments and artifacts are shared separately. Membership does not promise every event or physical item at no additional charge." },
  { question: "What happens after I join?", answer: "You’ll have your own member space, begin Foundations, and be connected with your Circle. You can start Foundations while your Circle is being arranged; completing it requires an active Circle assignment." },
  { question: "What are the renewal and cancellation terms?", answer: "You’ll review the applicable renewal, cancellation, and refund terms in your membership agreement before confirming payment. Your first payment is taken at signup, and your chosen plan renews monthly or annually." },
];

export default function MembershipOverview({ preview = false, signupEnabled = false }: { preview?: boolean; signupEnabled?: boolean }) {
  const [annual, setAnnual] = useState(false);
  const filmDialog = useRef<HTMLDialogElement>(null);
  const signupDialog = useRef<HTMLDialogElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  const [modal, setModal] = useState<"film" | "signup" | null>(null);
  const [signupVersion, setSignupVersion] = useState(0);
  const price = annual ? MEMBERSHIP_PLANS.annual : MEMBERSHIP_PLANS.monthly;

  useEffect(() => {
    if (!modal) return;
    const dialog = (modal === "film" ? filmDialog : signupDialog).current;
    const video = film.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      video?.pause();
      document.body.style.overflow = previousOverflow;
    };
  }, [modal]);

  useEffect(() => {
    const video = film.current;
    const pauseHidden = () => { if (document.hidden) video?.pause(); };
    document.addEventListener("visibilitychange", pauseHidden);
    return () => { document.removeEventListener("visibilitychange", pauseHidden); video?.pause(); };
  }, []);

  function join() {
    setSignupVersion(version => version + 1);
    setModal("signup");
  }

  return <main className={styles.page}>
    <section className={`${styles.wrap} ${styles.hero}`} aria-labelledby="membership-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>The Ruined Project <span>/</span> Membership</p>
        <h1 id="membership-title">Good company.<br /><em>Real work.</em></h1>
        <p className={styles.heroDescription}>A private membership for people making something of their lives. A place to find your people, get clear, and put intention into practice.</p>
        <p className={styles.handwritten}>You don’t have to do it alone.</p>
        <div className={styles.heroActions}>
          <button className={styles.primary} type="button" onClick={join}>{signupEnabled ? "Get my invitation" : "Join the waitlist"} <span aria-hidden="true">↗</span></button>
          <a className={styles.textLink} href="#inside-membership">Take a look inside <span aria-hidden="true">↓</span></a>
        </div>
        <p className={styles.heroPrice}>{formatMembershipPrice(MEMBERSHIP_PLANS.monthly.amount)} / month <span>or annual membership.</span> <a href="#membership-pricing">See pricing</a></p>
        <p className={styles.paymentTiming}>{signupEnabled ? "Your invitation comes first. Payment completes signup." : "Join the waitlist. We’ll be in touch when membership opens."}</p>
      </div>
      <figure className={styles.heroArt}>
        <div className={styles.heroPhoto}>
          <Image src="/membership/foundations/beginning.webp" alt="A well-worn couch, an open field, and room to begin." fill priority sizes="(min-width: 900px) 48vw, 100vw" />
          <button className={styles.filmTrigger} type="button" onClick={() => setModal("film")} aria-label="Watch the Ruined membership film, 2 minutes 15 seconds">
            <span className={styles.play} aria-hidden="true">▶</span><span>Meet Ruined<small>Watch the film · 2:15</small></span><span className={styles.filmArrow} aria-hidden="true">↗</span>
          </button>
        </div>
        <figcaption><span>Somewhere to begin.</span><span>Alpine, Utah / Ruined</span></figcaption>
      </figure>
    </section>

    <nav className={`${styles.wrap} ${styles.chapterNav}`} aria-label="Membership overview">
      <a href="#inside-membership"><span>01</span> What’s inside <span aria-hidden="true">↓</span></a>
      <a href="#membership-pricing"><span>02</span> The membership <span aria-hidden="true">↓</span></a>
      <a href="#how-to-join"><span>03</span> Your next step <span aria-hidden="true">↓</span></a>
    </nav>

    <section className={`${styles.wrap} ${styles.inside}`} id="inside-membership" aria-labelledby="inside-heading">
      <div className={styles.sectionHeader}><p className={styles.eyebrow}>01 / What’s inside</p><h2 id="inside-heading">Make room for<br /><em>what matters.</em></h2><p>Space to reflect. People to return to.<br />Something to put into practice.</p></div>
      <div className={styles.includes}>
        {includes.map(item => <article key={item.number} className={styles.inclusion}>
          <div className={`${styles.inclusionImage} ${styles[item.className]}`}><Image src={item.image} alt={item.alt} fill sizes="(min-width: 760px) 32vw, 100vw" /><span>{item.number}</span></div>
          <h3>{item.title}</h3><p className={styles.inclusionDetail}>{item.detail}</p><p className={styles.inclusionBody}>{item.body}</p>
        </article>)}
      </div>
      <p className={styles.smallPrint}>Circle imagery is illustrative. Experiences list their availability and any separate cost.</p>
    </section>

    <section className={styles.membershipBand} id="membership-pricing" aria-labelledby="price-heading">
      <div className={`${styles.wrap} ${styles.membershipGrid}`}>
        <div className={styles.membershipCopy}>
          <p className={styles.eyebrow}>02 / The membership</p>
          <h2 id="price-heading">One membership.<br /><em>A shared commitment.</em></h2>
          <p>Come with something you’re working on. Be willing to look at it honestly. Make room for other people to do the same.</p>
          <ul className={styles.includedList}>
            <li>Guided Foundations experience</li><li>A small Circle, guided by a Shaper</li><li>Academy lessons and resources</li><li>Your personal journal and member space</li><li>Opportunities to connect in person</li>
          </ul>
          <p className={styles.membershipNote}>The same membership, whichever way you pay.</p>
        </div>
        <div className={styles.pricePanel}>
          <fieldset className={styles.planSwitch}><legend className={styles.srOnly}>Choose membership billing</legend>
            <label data-selected={!annual}><input type="radio" name="membership-billing" value="monthly" checked={!annual} onChange={() => setAnnual(false)} />Monthly</label>
            <label data-selected={annual}><input type="radio" name="membership-billing" value="annual" checked={annual} onChange={() => setAnnual(true)} />Annual <span>Save {formatMembershipPrice(MEMBERSHIP_PLANS.monthly.amount * 12 - MEMBERSHIP_PLANS.annual.amount)}</span></label>
          </fieldset>
          <div className={styles.priceReadout} aria-live="polite" aria-atomic="true">
            <p className={styles.price}>{formatMembershipPrice(price.amount)}<span>/ {price.interval}</span></p>
            <p className={styles.billing}>{annual ? `${formatMembershipPrice(price.amount)} paid upfront each year.` : `${formatMembershipPrice(price.amount)} billed each month.`}</p>
            <p className={styles.equivalent}>{annual ? `Equivalent to ${formatMembershipPrice(MEMBERSHIP_PLANS.annual.amount / 12)} per month. Save ${formatMembershipPrice(MEMBERSHIP_PLANS.monthly.amount * 12 - MEMBERSHIP_PLANS.annual.amount)} over twelve monthly payments.` : "A monthly commitment. Full membership access."}</p>
          </div>
          <button className={styles.primary} type="button" onClick={join}>{signupEnabled ? "Get my invitation" : "Join the waitlist"} <span aria-hidden="true">↗</span></button>
          <p className={styles.priceReassurance}>{signupEnabled ? "Your first payment is due at signup." : "No payment is taken to join the waitlist."}</p>
          <div className={styles.priceFootnote}><span>All prices in USD.</span><p>You’ll review your billing choice, applicable taxes, and membership terms before confirming payment.</p></div>
          <p className={styles.alreadyMember}>Already a member? <Link href={preview ? "/access" : MEMBERSHIP_LINKS.signIn}>Sign in ↗</Link></p>
        </div>
      </div>
    </section>

    <section className={`${styles.wrap} ${styles.how}`} id="how-to-join" aria-labelledby="join-heading">
      <div className={styles.sectionHeader}><p className={styles.eyebrow}>03 / Your next step</p><h2 id="join-heading">Find your place.<br /><em>Then begin.</em></h2><p>Know what happens next.<br />Decide when you’re ready.</p></div>
      <ol className={styles.steps}>
        <li><span>01</span><h3>Open your invitation.</h3><p>When membership opens, choose your plan and request an invitation with your name and email. Your personalized card arrives by email and is valid for 48 hours.</p></li>
        <li><span>02</span><h3>Join Ruined.</h3><p>Accept your invitation, verify your email, complete your profile, and review the agreement. Your membership begins when payment is confirmed.</p></li>
        <li><span>03</span><h3>Begin the work.</h3><p>Enter your member space, make your profile your own, and begin Foundations while we connect your Circle.</p></li>
      </ol>
      <p className={styles.invitationNote}><Image src="/ruined-mark.svg" alt="" width={284} height={400} />Already have a personal invitation? Follow its link to join so your invitation stays connected. Complimentary invitations skip payment.</p>
    </section>

    <section className={`${styles.wrap} ${styles.faq}`} aria-labelledby="questions-heading">
      <div><p className={styles.eyebrow}>A few things to know</p><h2 id="questions-heading">Good questions.</h2><p>Something else on your mind?<br /><a href="mailto:connect@theruinedproject.com">Talk to us ↗</a></p></div>
      <div className={styles.questions}>{questions.map(item => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div>
    </section>

    <section className={`${styles.wrap} ${styles.closing}`} aria-labelledby="closing-heading"><p className={styles.handwritten}>This is for you.</p><h2 id="closing-heading">You’re allowed to<br /><em>become someone new.</em></h2><button className={styles.primary} type="button" onClick={join}>{signupEnabled ? "Get my invitation" : "Join the waitlist"} <span aria-hidden="true">↗</span></button><p>{signupEnabled ? "Start with your invitation. Take the next step when you’re ready." : "Join the waitlist for your next step."}</p></section>

    <dialog ref={filmDialog} className={styles.filmDialog} aria-label="Ruined membership film" onClose={() => setModal(null)} onCancel={() => setModal(null)} onClick={event => { if (event.target === event.currentTarget) setModal(null); }}>
      <button className={styles.filmClose} type="button" aria-label="Close film" onClick={() => setModal(null)}>Close <span aria-hidden="true">×</span></button>
      <video ref={film} controls playsInline preload="none" data-cursor-native poster="/membership/foundations/beginning.webp" width={720} height={1280} aria-label="Inside Ruined — membership film"><source src="/media/membership-introduction.mp4" type="video/mp4" /><a href="/media/membership-introduction.mp4">Watch the membership film</a></video>
    </dialog>
    <dialog ref={signupDialog} className={styles.signupDialog} aria-labelledby="signup-heading" onClose={() => setModal(null)} onCancel={() => setModal(null)} onClick={event => { if (event.target === event.currentTarget) setModal(null); }}>
      <button className={styles.signupClose} type="button" aria-label="Close membership signup" onClick={() => setModal(null)}>×</button>
      <div className={styles.signupContent}>
        <p className={styles.eyebrow}>{preview ? "Signup preview" : "Your next step"}</p>
        <h2 id="signup-heading">Your place<br /><em>begins here.</em></h2>
        {modal === "signup" ? <MembershipSignup key={signupVersion} enabled={signupEnabled} preview={preview} plan={annual ? "annual" : "monthly"} onPlanChange={plan => setAnnual(plan === "annual")} /> : null}
      </div>
    </dialog>
  </main>;
}
