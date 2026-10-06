"use client";

import { useId, useState } from "react";
import DirectInvitationRequestForm from "./DirectInvitationRequestForm";
import MembershipWaitlistForm from "./MembershipWaitlistForm";
import { formatMembershipPrice, MEMBERSHIP_OFFERS, MEMBERSHIP_PLANS, type MembershipBillingPlan } from "@/lib/membership/pricing";
import styles from "./MembershipOverview.module.css";

export default function MembershipSignup({ enabled, preview = false, previewInvitation = false, paymentSetupOnly = false, registrationOnly = false, prepaymentRequired = false, plan, onPlanChange, onRecipientNameChange, showPricing = true, compact = false, onRequestStateChange }: {
  enabled: boolean;
  preview?: boolean;
  previewInvitation?: boolean;
  paymentSetupOnly?: boolean;
  registrationOnly?: boolean; prepaymentRequired?: boolean;
  plan: MembershipBillingPlan;
  onPlanChange: (plan: MembershipBillingPlan) => void;
  onRecipientNameChange?: (name: string) => void;
  showPricing?: boolean;
  compact?: boolean;
  onRequestStateChange?: (locked: boolean) => void;
}) {
  const id = useId();
  const [verifying, setVerifying] = useState(false);
  const price = MEMBERSHIP_PLANS[plan];
  const amount = formatMembershipPrice(price.amount);

  if (!enabled && !(preview && previewInvitation)) return <section className={`${styles.signupStage} ${styles.signupForm}`} aria-label="Join the membership waitlist">
    <p>{compact ? "Leave your details. We’ll email you when membership opens." : "Membership is opening soon. Join the waitlist and we’ll be in touch when it’s time to begin."}</p>
    {preview ? <p className={styles.signupPreviewNotice}>Preview only. Your details are not submitted here.</p> : null}
    <MembershipWaitlistForm tone="paper" disabled={preview} />
  </section>;

  return <section className={`${styles.signupStage} ${styles.signupForm}`} aria-label="Join Ruined">
    <p className={styles.signupExplanation}>{prepaymentRequired ? "Make your invitation. Confirm your email, add your information, then review your terms and pay your first month or full year to finish registration. Your profile opens later by email." : registrationOnly ? "Make your invitation. Confirm your email, add your information, and save your card to register. Your profile opens later." : compact ? "Add your name and email. Verify your code, then create your profile." : "Your invitation starts here. Enter your name and email, verify the code we send, then create your profile."}</p>
    {prepaymentRequired ? <p className={styles.signupExplanation}>Your exact offer, including any eligible Founding rate, is confirmed before you pay. Service begins with your cohort’s first Foundations call.</p> : registrationOnly ? <p className={styles.signupExplanation}>Eligible individuals who complete registration with a verified saved card lock in $349/month. Your receipt confirms the rate. No payment is taken; couples pricing is separate.</p> : null}
    {showPricing && <><fieldset className={styles.planSwitch} disabled={verifying}>
      <legend className={styles.srOnly}>{paymentSetupOnly && !prepaymentRequired ? "Your preferred future billing plan" : "Choose your signup plan"}</legend>
      <label data-selected={plan === "monthly"}><input type="radio" name={`${id}-plan`} value="monthly" checked={plan === "monthly"} onChange={() => onPlanChange("monthly")} />Monthly</label>
      <label data-selected={plan === "annual"}><input type="radio" name={`${id}-plan`} value="annual" checked={plan === "annual"} onChange={() => onPlanChange("annual")} />Annual <span>Save {formatMembershipPrice(MEMBERSHIP_PLANS.monthly.amount * 12 - MEMBERSHIP_PLANS.annual.amount)}</span></label>
    </fieldset>
    <div className={styles.signupPrice} aria-live="polite">{paymentSetupOnly && !prepaymentRequired ? "Future membership: " : null}{amount} / {price.interval}<span>{prepaymentRequired ? plan === "annual" ? "Standard individual rate. Your full year is paid at Checkout. Service and your initial 12-month term begin with your cohort’s first Foundations call; your next annual charge is one calendar year later." : "Standard individual rate. Your first month is paid at Checkout. Service and your initial 12-month term begin with your cohort’s first Foundations call; 11 further monthly installments begin one calendar month later." : paymentSetupOnly ? registrationOnly ? "Choosing a plan here is a preference, not a purchase. Eligible individual Founding pricing is confirmed when registration is complete with a verified saved card. No payment is due now. Review your confirmed offer and agreement before explicitly confirming checkout." : "Your selection is a preference, not a purchase or reserved offer. No payment is due now. Review the current offer and agreement before confirming payment at launch." : plan === "annual" ? `${amount} paid upfront when you activate membership, equal to 10 monthly payments.` : `${amount} due when you activate paid membership. 12-month initial commitment; 12 payments totaling ${formatMembershipPrice(MEMBERSHIP_OFFERS.individual_monthly.initialTermAmount)}.`} USD. Applicable tax is added. U.S. membership only.</span></div></>}
    {showPricing && prepaymentRequired ? <p className={styles.signupTerms}>Cancel before service begins for a full refund, including tax. After service begins, monthly early exit costs the lower of $1,500 or the unpaid initial installments, replacing those installments. Monthly plans renew monthly after the initial year; annual plans renew annually. Review your exact price, dates, agreement, and payment authorization before paying.</p> : null}
    <DirectInvitationRequestForm compact={compact} paymentSetupOnly={paymentSetupOnly} registrationOnly={registrationOnly} prepaymentRequired={prepaymentRequired} preview={preview || !enabled} billingPlan={plan} onRequestStateChange={locked => { setVerifying(locked); onRequestStateChange?.(locked); }} onRecipientNameChange={onRecipientNameChange} />
  </section>;
}
