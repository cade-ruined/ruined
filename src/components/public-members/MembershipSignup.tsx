"use client";

import { useId, useState } from "react";
import DirectInvitationRequestForm from "./DirectInvitationRequestForm";
import MembershipWaitlistForm from "./MembershipWaitlistForm";
import { formatMembershipPrice, MEMBERSHIP_PLANS, type MembershipBillingPlan } from "@/lib/membership/pricing";
import styles from "./MembershipOverview.module.css";

export default function MembershipSignup({ enabled, preview = false, previewInvitation = false, plan, onPlanChange }: {
  enabled: boolean;
  preview?: boolean;
  previewInvitation?: boolean;
  plan: MembershipBillingPlan;
  onPlanChange: (plan: MembershipBillingPlan) => void;
}) {
  const id = useId();
  const [verifying, setVerifying] = useState(false);
  const price = MEMBERSHIP_PLANS[plan];
  const amount = formatMembershipPrice(price.amount);

  if (!enabled && !(preview && previewInvitation)) return <section className={`${styles.signupStage} ${styles.signupForm}`} aria-label="Join the membership waitlist">
    <p>Membership is opening soon. Join the waitlist and we’ll be in touch when it’s time to begin.</p>
    {preview ? <p className={styles.signupPreviewNotice}>Preview only. Your details are not submitted here.</p> : null}
    <MembershipWaitlistForm tone="paper" disabled={preview} />
  </section>;

  return <section className={`${styles.signupStage} ${styles.signupForm}`} aria-label="Join Ruined">
    <ol className={styles.signupSteps} aria-label="Signup progress">
      <li aria-current="step">01 / Your invitation</li>
      <li>02 / Verify &amp; complete profile</li>
      <li>03 / Payment</li>
    </ol>
    <p className={styles.signupExplanation}>Start with a personal invitation from The Ruined Project. Open it from your email, verify it’s you, then complete your profile and membership agreement. Your first payment completes signup.</p>
    <fieldset className={styles.planSwitch} disabled={verifying}>
      <legend className={styles.srOnly}>Choose your signup plan</legend>
      <label data-selected={plan === "monthly"}><input type="radio" name={`${id}-plan`} value="monthly" checked={plan === "monthly"} onChange={() => onPlanChange("monthly")} />Monthly</label>
      <label data-selected={plan === "annual"}><input type="radio" name={`${id}-plan`} value="annual" checked={plan === "annual"} onChange={() => onPlanChange("annual")} />Annual <span>Save {formatMembershipPrice(MEMBERSHIP_PLANS.monthly.amount * 12 - MEMBERSHIP_PLANS.annual.amount)}</span></label>
    </fieldset>
    <div className={styles.signupPrice} aria-live="polite">{amount} / {price.interval}<span>{plan === "annual" ? `${amount} paid upfront at signup, then each year.` : `${amount} due at signup, then each month.`} All prices in USD.</span></div>
    <DirectInvitationRequestForm preview={preview || !enabled} billingPlan={plan} onRequestStateChange={setVerifying} />
    <p className={styles.signupTerms}>Already invited? Use your personal invitation link to keep your invitation connected.</p>
  </section>;
}
