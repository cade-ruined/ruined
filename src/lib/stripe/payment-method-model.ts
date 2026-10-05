export const PAYMENT_SETUP_CONTEXT = "ruined_payment_method_setup";
// Historical evidence is immutable; old provider attempts retain their wording.
export const PAYMENT_SETUP_CONSENTS = {
  "save-payment-method-v1": "Save my payment method securely with Stripe for a future checkout I choose to complete. This does not start a membership or subscription, authorize a charge, or reserve an offer. I can remove it before starting checkout.",
  "save-payment-method-v2": "Save my payment method securely with Stripe for a future checkout I choose to complete. This does not start a membership or subscription or authorize a charge. I can remove it before starting checkout.",
} as const;
export const PAYMENT_SETUP_CONSENT_VERSION = "save-payment-method-v2";
export const PAYMENT_SETUP_CONSENT_TEXT = PAYMENT_SETUP_CONSENTS[PAYMENT_SETUP_CONSENT_VERSION];

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
