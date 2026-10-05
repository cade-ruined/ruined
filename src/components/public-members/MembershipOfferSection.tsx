"use client";

import { useId } from "react";
import { formatMembershipPrice, MEMBERSHIP_OFFERS, type MembershipBillingPlan, type MembershipOfferTier } from "@/lib/membership/pricing";
import styles from "./MembershipOfferSection.module.css";

export type MembershipLandingMode = "waitlist" | "payment-setup" | "paid";
const tiers: { key: MembershipOfferTier; name: string; detail: string }[] = [
  { key: "individual", name: "Individual", detail: "One person" },
  { key: "founding_individual", name: "Founding rate", detail: "Eligibility required" },
  { key: "couple", name: "Couples", detail: "Two adults · one bill" },
];

export default function MembershipOfferSection({ plan, onPlanChange, mode, disabled = false, registrationOnly = false, comparisonOnly = false }: {
  plan: MembershipBillingPlan;
  onPlanChange: (plan: MembershipBillingPlan) => void;
  mode: MembershipLandingMode;
  disabled?: boolean;
  registrationOnly?: boolean;
  comparisonOnly?: boolean;
}) {
  const id = useId();
  const registrationOpen = registrationOnly && mode !== "waitlist";
  return <section className={styles.offer} id="membership-pricing" aria-labelledby="offer-heading">
    <div className={styles.heading}><h2 id="offer-heading">Membership.</h2><p>{comparisonOnly ? "Compare payment options. You’ll choose your plan before activating membership." : "One community. Everything you need to begin."}</p></div>

    <fieldset className={styles.planSwitch} disabled={disabled}>
      <legend className={styles.srOnly}>Compare membership payment options</legend>
      {(["monthly", "annual"] as const).map(option => <label key={option} data-selected={plan === option}>
        <input type="radio" name={`${id}-payment`} value={option} aria-label={option === "monthly" ? "Monthly" : "Annual"} checked={plan === option} onChange={() => { if (!disabled) onPlanChange(option); }} />
        <span>{option === "monthly" ? "Monthly" : "Annual"}</span>
        {option === "annual" && <small>Save 2 months</small>}
      </label>)}
    </fieldset>

    <div className={styles.prices}>
      {tiers.map(tier => {
        const offer = MEMBERSHIP_OFFERS[`${tier.key}_${plan}`];
        const price = formatMembershipPrice(offer.amount);
        return <article key={tier.key} className={styles.price} data-tier={tier.key} data-founding={tier.key === "founding_individual" || undefined}>
          <div className={styles.priceHeading}><h3>{tier.name}</h3><p className={styles.detail}>{tier.detail}</p></div>
          <p className={styles.amount}>{price}<span>/{plan === "monthly" ? "month" : "year"}</span></p>
          {plan === "annual" && <p className={styles.paymentDetail}>Paid upfront<span>Save {formatMembershipPrice(offer.annualSavings)} per year</span></p>}
        </article>;
      })}
    </div>

    <ul className={styles.included} aria-label="Included with every membership">
      <li><span aria-hidden="true">✓</span> Foundations, once</li>
      <li><span aria-hidden="true">✓</span> 4 Membership calls / month</li>
      <li><span aria-hidden="true">✓</span> 2 Circle calls / month</li>
      <li><span aria-hidden="true">✓</span> Your member space</li>
    </ul>

    <div className={styles.essentialTerms}>
      <p className={styles.modeNote}>{mode === "paid"
        ? <><strong>Pay when you activate.</strong> Your first monthly or full annual payment starts billing.</>
        : mode === "payment-setup"
          ? registrationOnly ? <><strong>$0 today.</strong> Save a card to complete registration. Profiles open later by email. You’ll review and confirm payment separately before paid membership begins.</> : <><strong>$0 today.</strong> Saving a card is optional. No charge or active membership until you review your offer and explicitly confirm payment.</>
          : <><strong>Free to join the waitlist.</strong> Paid membership begins only if you choose to join when it opens.</>}
      </p>
      <p><strong>12-month initial commitment.</strong> Monthly early exit costs the lower of $1,500 or the remaining unpaid installments, replacing those installments.</p>
    </div>

    <p className={styles.preferenceNote}>{registrationOpen ? "Eligible individuals who complete registration with a verified saved card lock in $349/month. Your registration receipt confirms the rate. Payment requires a separate checkout you choose to complete." : "Compare payment options here. Your final offer is confirmed before payment; no price or place is reserved."}</p>

    <details className={styles.paymentTerms}>
      <summary>Payment terms &amp; founding eligibility<span aria-hidden="true">+</span></summary>
      <div className={styles.terms}>
        <div><h3>Payment &amp; renewal</h3><p>Monthly payments are installments during the initial year. Annual payment is the full year paid upfront; the saving shown compares it with 12 monthly payments. After the initial year, monthly plans continue month to month and annual plans renew annually until canceled. Turning off renewal does not itself end the initial commitment.</p></div>
        {registrationOpen ? <div><h3>The founding rate</h3><p>Eligibility is checked when registration is complete. The first 50 places count current active paid and complimentary members, held checkouts, and completed registrations awaiting membership activation. Each person in a couples membership counts separately; couples plans keep their separate price.</p><p>Your confirmed individual Founding rate is reserved through your first paid membership activation, then stays with you while that membership remains continuously active. When membership ends, founding benefits end. Rejoining requires a new eligibility check.</p><p>Requesting an invitation, joining the waitlist, or saving a card alone does not reserve the rate. Complete registration with a verified saved card. No charge, subscription, or profile activation happens during registration; paid membership requires a later checkout you explicitly confirm.</p></div> : <div><h3>The founding rate</h3><p>Available when fewer than 50 other registered members are active at joining, including paid and complimentary members. Each person in a couples membership counts separately; the founding price applies to individual plans.</p><p>Your awarded founding rate stays with you while that membership remains continuously active. If you leave, founding benefits end. Rejoining requires a new eligibility check.</p><p>Requesting an invitation, joining the waitlist, or saving a card does not reserve a price or place. Eligibility and your final offer are confirmed during membership signup.</p></div>}
      </div>
    </details>
    <p className={styles.offerFooter}>USD. Applicable tax added at checkout. US adults 18+. Events and physical items may cost extra.</p>
  </section>;
}
