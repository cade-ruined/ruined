export const PAYMENT_SETUP_CONTEXT = "ruined_payment_method_setup";
export const PAYMENT_SETUP_CONSENT_VERSION = "save-payment-method-v1";
export const PAYMENT_SETUP_CONSENT_TEXT = "Save my payment method securely with Stripe for a future checkout I choose to complete. This does not start a membership or subscription, authorize a charge, or reserve an offer. I can remove it before starting checkout.";

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
