import type { MemberRegistrationSnapshot } from "./registration-model";

type PaymentRequirements = Pick<MemberRegistrationSnapshot, "requiresInitialPayment" | "requiresPaymentMethod">;
export type RegistrationPaymentDestination = "/my/activate" | "/my/payment-method" | "/my/registered";

/** Availability changes the next screen, never the member's recorded agreement or payment requirement. */
export function registrationPaymentDestination(registration: PaymentRequirements, paidCheckoutAvailable: boolean): RegistrationPaymentDestination {
  if (registration.requiresInitialPayment) return "/my/activate";
  if (registration.requiresPaymentMethod) return paidCheckoutAvailable ? "/my/activate" : "/my/payment-method";
  return "/my/registered";
}

export function memberRegistrationDestination(registration: MemberRegistrationSnapshot | null, paidCheckoutAvailable: boolean): string | null {
  if (!registration || registration.state === "activated") return null;
  if (!registration.profileComplete) return "/my/join";
  if (registration.ready) return "/my/registered";
  return registrationPaymentDestination(registration, paidCheckoutAvailable);
}

/** Stripe Checkout collects a payment method; a separate saved card is not an entry requirement. */
export function canReviewRegistrationBilling(registration: MemberRegistrationSnapshot | null, paidCheckoutAvailable: boolean): boolean {
  return !registration || registration.state === "activated" || registration.ready ||
    (registration.profileComplete && (registration.requiresInitialPayment ||
      (registration.requiresPaymentMethod && paidCheckoutAvailable)));
}
