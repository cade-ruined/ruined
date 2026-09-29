import type { MembershipOfferId } from "@/lib/membership/pricing";

/** Verified live catalog, September 28, 2026. Never use these IDs with sandbox credentials.
 * This mapping is not an eligibility check or an instruction to activate any offer.
 */
export const LIVE_MEMBERSHIP_PRICE_IDS = {
  individual_monthly: "price_1UJdWe4cnqzISerX5M3cmhmg",
  individual_annual: "price_1UKj3o4cnqzISerXU0XE4XqR",
  founding_individual_monthly: "price_1UKj3t4cnqzISerXN7qIIjlp",
  founding_individual_annual: "price_1UKj3x4cnqzISerXDPcIzYTq",
  couple_monthly: "price_1UKj404cnqzISerXnzOBEcus",
  couple_annual: "price_1UKj444cnqzISerXAglLehVo",
} as const satisfies Record<MembershipOfferId, string>;

/** Verified sandbox catalog; never pair these prices with live credentials. */
export const SANDBOX_MEMBERSHIP_PRICE_IDS = {
  individual_monthly: "price_1UJKWj9rQIwIEzKeJ9okUjcw",
  individual_annual: "price_1UKjCf9rQIwIEzKeLeraUnRw",
  founding_individual_monthly: "price_1UKjCj9rQIwIEzKeoNSBIVEq",
  founding_individual_annual: "price_1UKjCm9rQIwIEzKe8KR9v0eV",
  couple_monthly: "price_1UKjCp9rQIwIEzKegrbFc8Y2",
  couple_annual: "price_1UKjCt9rQIwIEzKeConBClmk",
} as const satisfies Record<MembershipOfferId, string>;
