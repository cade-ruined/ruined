"use client";

import Link from "next/link";
import { useState } from "react";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";
import MembershipSignup from "./MembershipSignup";
import styles from "./MembershipOverview.module.css";

export default function MembershipSignupPage({ initialPlan, enabled, preview, previewInvitation = false }: {
  initialPlan: MembershipBillingPlan;
  enabled: boolean;
  preview: boolean;
  previewInvitation?: boolean;
}) {
  const [plan, setPlan] = useState(initialPlan);

  function changePlan(nextPlan: MembershipBillingPlan) {
    setPlan(nextPlan);
    const url = new URL(window.location.href);
    url.searchParams.set("plan", nextPlan);
    window.history.replaceState(window.history.state, "", url);
  }

  return <main className={`${styles.page} ${styles.signupPage}`}>
    <div className={styles.signupPageContent}>
      <Link className={styles.signupBack} href="/membership">← Membership</Link>
      <p className={styles.eyebrow}>The Ruined Project / Membership</p>
      <h1>Your place<br /><em>begins here.</em></h1>
      <MembershipSignup enabled={enabled} preview={preview} previewInvitation={previewInvitation} plan={plan} onPlanChange={changePlan} />
      <p className={styles.alreadyMember}>Already a member? <Link href="/access">Sign in ↗</Link></p>
    </div>
  </main>;
}
