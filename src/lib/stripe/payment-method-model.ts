export const PAYMENT_SETUP_CONTEXT = "ruined_payment_method_setup";
// Historical evidence is immutable; old provider attempts retain their wording.
export const PAYMENT_SETUP_CONSENTS = {
  "save-payment-method-v1": "Save my payment method securely with Stripe for a future checkout I choose to complete. This does not start a membership or subscription, authorize a charge, or reserve an offer. I can remove it before starting checkout.",
  "save-payment-method-v2": "Save my payment method securely with Stripe for a future checkout I choose to complete. This does not start a membership or subscription or authorize a charge. I can remove it before starting checkout.",
} as const;
export const PAYMENT_SETUP_CONSENT_VERSION = "save-payment-method-v2";
export const PAYMENT_SETUP_CONSENT_TEXT = PAYMENT_SETUP_CONSENTS[PAYMENT_SETUP_CONSENT_VERSION];

// An operator saves their own card for the selected member. This is not the
// member's agreement, and must never reuse the member's storage consent.
export const OPERATOR_PAYMENT_SETUP_CONSENT_VERSION = "operator-save-member-card-v1";
export const OPERATOR_PAYMENT_SETUP_CONSENT_TEXT = "I am the cardholder and authorize this member to use my saved card for their first membership payment and recurring renewals under the plan and terms they review at checkout. Stripe will save my card securely. Saving it today does not charge it, start a subscription, or accept the member's agreement.";

export type SavedPaymentMethodDisplay = {
  type: string;
  label: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
};
export type MemberPaymentMethodStatus = {
  enabled: boolean;
  eligible: boolean;
  canRemove: boolean;
  removalPending: boolean;
  reason: string | null;
  state: "not_saved" | "pending" | "saved";
  paymentMethod: SavedPaymentMethodDisplay | null;
};
export class PaymentMethodSetupError extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
    this.name = "PaymentMethodSetupError";
  }
}
