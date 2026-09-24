"use client";

import { useId, useState } from "react";
import PasswordlessAccessForm from "@/components/platform/PasswordlessAccessForm";
import { formatMembershipPrice, MEMBERSHIP_PLANS, type MembershipBillingPlan } from "@/lib/membership/pricing";
import styles from "./MembershipOverview.module.css";

export default function MembershipSignup({ enabled, preview = false, plan, onPlanChange }: {
  enabled: boolean;
  preview?: boolean;
  plan: MembershipBillingPlan;
  onPlanChange: (plan: MembershipBillingPlan) => void;
}) {
  const id = useId();
  const [verifying, setVerifying] = useState(false);
  const price = MEMBERSHIP_PLANS[plan];
  const amount = formatMembershipPrice(price.amount);

  return <section className={`${styles.signupStage} ${styles.signupForm}`} aria-label="Join Ruined">
    <ol className={styles.signupSteps} aria-label="Signup progress">
      <li aria-current="step">01 / Verify email</li>
      <li>02 / Profile &amp; agreement</li>
      <li>03 / Payment</li>
    </ol>
    <p className={styles.signupExplanation}>Verify your email, complete your profile, and review the membership agreement. Your first payment completes signup.</p>
    <fieldset className={styles.planSwitch} disabled={verifying}>
      <legend className={styles.srOnly}>Choose your signup plan</legend>
      <label data-selected={plan === "monthly"}><input type="radio" name={`${id}-plan`} value="monthly" checked={plan === "monthly"} onChange={() => onPlanChange("monthly")} />Monthly</label>
      <label data-selected={plan === "annual"}><input type="radio" name={`${id}-plan`} value="annual" checked={plan === "annual"} onChange={() => onPlanChange("annual")} />Annual <span>Save {formatMembershipPrice(MEMBERSHIP_PLANS.monthly.amount * 12 - MEMBERSHIP_PLANS.annual.amount)}</span></label>
    </fieldset>
    <div className={styles.signupPrice} aria-live="polite">{amount} / {price.interval}<span>{plan === "annual" ? `${amount} paid upfront at signup, then each year.` : `${amount} due at signup, then each month.`} All prices in USD.</span></div>
    {!enabled ? <p className={styles.signupPreviewNotice} role="status">{preview ? "Preview only. Email verification and payment are not connected here. No account is created or payment taken." : "Online signup is not available yet. Please check back shortly or contact Ruined."}</p> : null}
    <PasswordlessAccessForm enabled={enabled} signupPlan={plan} onVerificationChange={setVerifying} />
    <p className={styles.signupTerms}>Already invited? Use your personal invitation link to keep your invitation connected.</p>
  </section>;
}
