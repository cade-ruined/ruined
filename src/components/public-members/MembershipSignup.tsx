"use client";

import { useId, useState } from "react";
import DirectInvitationRequestForm from "./DirectInvitationRequestForm";
import MembershipWaitlistForm from "./MembershipWaitlistForm";
import { formatMembershipPrice, MEMBERSHIP_OFFERS, MEMBERSHIP_PLANS, type MembershipBillingPlan } from "@/lib/membership/pricing";
import styles from "./MembershipOverview.module.css";

export default function MembershipSignup({ enabled, preview = false, previewInvitation = false, paymentSetupOnly = false, plan, onPlanChange }: {
  enabled: boolean;
  preview?: boolean;
  previewInvitation?: boolean;
  paymentSetupOnly?: boolean;
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
      <li>{paymentSetupOnly ? "03 / Optional payment setup" : "03 / Payment"}</li>
    </ol>
    <p className={styles.signupExplanation}>{paymentSetupOnly ? "Start with your personal invitation. Verify your email and complete your profile, then optionally save a payment method. Nothing is charged and membership does not begin yet. You’ll review the agreement and current offer before confirming payment later." : "Start with a personal invitation from The Ruined Project. Open it from your email, verify it’s you, then complete your profile and membership agreement. Your first payment completes signup."}</p>
    <fieldset className={styles.planSwitch} disabled={verifying}>
      <legend className={styles.srOnly}>{paymentSetupOnly ? "Your preferred future billing plan" : "Choose your signup plan"}</legend>
      <label data-selected={plan === "monthly"}><input type="radio" name={`${id}-plan`} value="monthly" checked={plan === "monthly"} onChange={() => onPlanChange("monthly")} />Monthly</label>
      <label data-selected={plan === "annual"}><input type="radio" name={`${id}-plan`} value="annual" checked={plan === "annual"} onChange={() => onPlanChange("annual")} />Annual <span>Save {formatMembershipPrice(MEMBERSHIP_PLANS.monthly.amount * 12 - MEMBERSHIP_PLANS.annual.amount)}</span></label>
    </fieldset>
    <div className={styles.signupPrice} aria-live="polite">{paymentSetupOnly ? "Membership pricing: " : null}{amount} / {price.interval}<span>{paymentSetupOnly ? `Your ${plan} selection is a preference, not a purchase or reserved offer. No payment is due now. You’ll review the available price, term, and applicable tax before choosing to pay.` : plan === "annual" ? `${amount} paid upfront for a full year, equal to 10 monthly payments.` : `${amount} due at signup. 12-month initial commitment; 12 payments totaling ${formatMembershipPrice(MEMBERSHIP_OFFERS.individual_monthly.initialTermAmount)}.`} All prices in USD; applicable tax is added. U.S. membership only.</span></div>
    <DirectInvitationRequestForm paymentSetupOnly={paymentSetupOnly} preview={preview || !enabled} billingPlan={plan} onRequestStateChange={setVerifying} />
    <p className={styles.signupTerms}>Already invited? Use your personal invitation link to keep your invitation connected.</p>
  </section>;
}
