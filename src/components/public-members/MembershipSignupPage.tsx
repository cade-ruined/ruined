"use client";

import Link from "next/link";
import { useState } from "react";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";
import MembershipInvitationCard, { MembershipInvitationRoom } from "./MembershipInvitationCard";
import MembershipSignup from "./MembershipSignup";
import styles from "./MembershipOverview.module.css";

export default function MembershipSignupPage({ initialPlan, enabled, preview, previewInvitation = false, paymentSetupOnly = false, registrationOnly = false, prepaymentRequired = false }: {
  initialPlan: MembershipBillingPlan;
  enabled: boolean;
  preview: boolean;
  previewInvitation?: boolean;
  paymentSetupOnly?: boolean;
  registrationOnly?: boolean; prepaymentRequired?: boolean;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [recipientName, setRecipientName] = useState("");

  function changePlan(nextPlan: MembershipBillingPlan) {
    setPlan(nextPlan);
    const url = new URL(window.location.href);
    url.searchParams.set("plan", nextPlan);
    window.history.replaceState(window.history.state, "", url);
  }

  return <main className={`${styles.page} ${styles.signupPage}`}>
    <MembershipInvitationRoom className={`${styles.invitationRoom} ${styles.signupRoom}`} frameToCard>
      <div className={`${styles.wrap} ${styles.invitationGrid}`}>
        <div className={`${styles.invitationArt} ${styles.signupArt}`}>
          <Link className={styles.signupBack} href="/membership">← Membership</Link>
          <h1>It starts with<br /><em>an invitation.</em></h1>
          <MembershipInvitationCard recipientName={recipientName} />
        </div>
        <div className={`${styles.registration} ${styles.signupPageContent}`}>
          <h2>Make it yours.</h2>
          <MembershipSignup registrationOnly={registrationOnly} prepaymentRequired={prepaymentRequired} paymentSetupOnly={paymentSetupOnly} enabled={enabled} preview={preview} previewInvitation={previewInvitation} plan={plan} onPlanChange={changePlan} onRecipientNameChange={setRecipientName} />
          <p className={styles.alreadyMember}>Already a member? <Link href="/access">Sign in ↗</Link></p>
        </div>
      </div>
    </MembershipInvitationRoom>
  </main>;
}
